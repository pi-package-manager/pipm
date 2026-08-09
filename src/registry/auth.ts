/**
 * Per-registry authentication resolution.
 * Forked from OCX's registry/auth.ts (MIT). Env prefix OCX_ -> PIPM_.
 *
 * Credential precedence for the Authorization header (first wins):
 *   1. CLI flags        (only for a one-off `--from <url>` ephemeral registry)
 *   2. Per-registry env  PIPM_REGISTRY_<ALIAS>_TOKEN | _BASIC | _TOKEN_FILE
 *   3. Config `auth` block (literal always; env/file refs only in trusted scopes)
 *   4. Config `headers` raw Authorization (${ENV} expansion, trusted scopes only)
 *
 * Local (committed, untrusted) scopes may only use literal credentials.
 */

import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { ENV_REGISTRY_PREFIX } from "../constants"
import {
	AUTH_REF_FIELDS,
	type RegistryAuthConfig,
	type RegistryConfig,
	registryAuthConfigSchema,
} from "../schemas/config"
import { ConfigError, ValidationError } from "../utils/errors"

/**
 * - `user`      → <pi-home>/pipm.jsonc (user-owned; trusted)
 * - `local`     → committed ./pipm.jsonc (untrusted; literal-only)
 * - `ephemeral` → a `--from <url>` registry (trusted; auth from CLI flags)
 */
export type RegistryScope = "user" | "local" | "ephemeral"

export interface RequestAuth {
	headers?: Record<string, string>
	rejectUnauthorized?: boolean
}

export interface CliAuth {
	auth?: RegistryAuthConfig
	headers?: Record<string, string>
}

export interface CredentialFlags {
	token?: string
	tokenEnv?: string
	tokenFile?: string
	username?: string
	password?: string
	passwordEnv?: string
	passwordFile?: string
}

const ENV_REF = /\$\{([^}]+)\}/g

function isTrustedScope(scope: RegistryScope): boolean {
	return scope !== "local"
}

function hasEnvRef(value: string): boolean {
	return /\$\{[^}]+\}/.test(value)
}

function expandEnvRefs(value: string): string {
	return value.replace(ENV_REF, (_m, name: string) => {
		const resolved = process.env[name]
		if (resolved === undefined) {
			throw new ConfigError(
				`Environment variable "${name}" referenced in registry config is not set.`,
			)
		}
		return resolved
	})
}

function requireEnv(name: string): string {
	const value = process.env[name]
	if (!value) {
		throw new ConfigError(
			`Environment variable "${name}" (referenced in registry auth) is not set.`,
		)
	}
	return value
}

function expandTilde(filePath: string): string {
	if (filePath === "~") return homedir()
	if (filePath.startsWith("~/")) return join(homedir(), filePath.slice(2))
	return filePath
}

function readSecretFile(filePath: string): string {
	try {
		const contents = readFileSync(expandTilde(filePath), "utf8").trim()
		if (!contents) throw new ConfigError(`Credential file "${filePath}" is empty.`)
		return contents
	} catch (error) {
		if (error instanceof ConfigError) throw error
		const reason = error instanceof Error ? error.message : String(error)
		throw new ConfigError(`Failed to read credential file "${filePath}": ${reason}`)
	}
}

function bearerHeader(token: string): Record<string, string> {
	return { Authorization: `Bearer ${token}` }
}
function basicHeader(userpass: string): Record<string, string> {
	return { Authorization: `Basic ${Buffer.from(userpass).toString("base64")}` }
}

export function normalizeAliasEnv(alias: string): string {
	return alias.toUpperCase().replace(/[^A-Z0-9]/g, "_")
}

function assertLocalScopeSafe(alias: string, regConfig: RegistryConfig): void {
	const problems: string[] = []
	const auth = regConfig.auth as Record<string, unknown> | undefined
	if (auth) {
		for (const field of AUTH_REF_FIELDS) {
			if (auth[field] !== undefined) problems.push(`auth.${field}`)
		}
	}
	if (regConfig.headers) {
		for (const [name, value] of Object.entries(regConfig.headers)) {
			if (hasEnvRef(value)) problems.push(`headers.${name} (\${…} reference)`)
		}
	}
	const envKey = normalizeAliasEnv(alias)
	for (const suffix of ["TOKEN", "TOKEN_FILE", "BASIC"] as const) {
		if (process.env[`${ENV_REGISTRY_PREFIX}${envKey}_${suffix}`]) {
			problems.push(`the ${ENV_REGISTRY_PREFIX}${envKey}_${suffix} environment override`)
		}
	}
	if (problems.length > 0) {
		throw new ConfigError(
			`Registry '${alias}' is defined in committed local config but uses ${problems.join(", ")}. ` +
				`For security, env/file credential references are only honored in <pi-home>/pipm.jsonc.`,
		)
	}
}

function pickSecret(
	literal: string | undefined,
	envVar: string | undefined,
	file: string | undefined,
	trusted: boolean,
): string | undefined {
	if (literal !== undefined) return literal
	if (trusted && envVar) return requireEnv(envVar)
	if (trusted && file) return readSecretFile(file)
	return undefined
}

function authFromConfig(auth: RegistryAuthConfig, trusted: boolean): Record<string, string> | null {
	if (auth.type === "bearer") {
		const token = pickSecret(auth.token, auth.tokenEnv, auth.tokenFile, trusted)
		return token === undefined ? null : bearerHeader(token)
	}
	const password = pickSecret(auth.password, auth.passwordEnv, auth.passwordFile, trusted)
	return password === undefined ? null : basicHeader(`${auth.username ?? ""}:${password}`)
}

function authFromEnvOverride(alias: string): Record<string, string> | null {
	const key = normalizeAliasEnv(alias)
	const token = process.env[`${ENV_REGISTRY_PREFIX}${key}_TOKEN`]
	if (token) return bearerHeader(token)
	const tokenFile = process.env[`${ENV_REGISTRY_PREFIX}${key}_TOKEN_FILE`]
	if (tokenFile) return bearerHeader(readSecretFile(tokenFile))
	const basic = process.env[`${ENV_REGISTRY_PREFIX}${key}_BASIC`]
	if (basic) return basicHeader(basic)
	return null
}

function authFromCli(cli: CliAuth): Record<string, string> {
	const headers: Record<string, string> = { ...(cli.headers ?? {}) }
	if (cli.auth) {
		const authHeader = authFromConfig(cli.auth, true)
		if (authHeader) Object.assign(headers, authHeader)
	}
	return headers
}

/** Build a RegistryAuthConfig from CLI credential flags (bearer XOR basic). */
export function buildRegistryAuthConfig(flags: CredentialFlags): RegistryAuthConfig | undefined {
	const bearerFlags = [
		flags.token !== undefined ? "--token" : null,
		flags.tokenEnv ? "--token-env" : null,
		flags.tokenFile ? "--token-file" : null,
	].filter((v): v is string => v !== null)
	const basicFlags = [
		flags.username ? "--username" : null,
		flags.password !== undefined ? "--password" : null,
		flags.passwordEnv ? "--password-env" : null,
		flags.passwordFile ? "--password-file" : null,
	].filter((v): v is string => v !== null)

	if (bearerFlags.length === 0 && basicFlags.length === 0) return undefined
	if (bearerFlags.length > 0 && basicFlags.length > 0) {
		throw new ValidationError(
			`Cannot combine Bearer (${bearerFlags.join(", ")}) and Basic (${basicFlags.join(", ")}) auth flags.`,
		)
	}

	let candidate: Record<string, unknown>
	if (bearerFlags.length > 0) {
		candidate = { type: "bearer" }
		if (flags.token !== undefined) candidate.token = flags.token
		if (flags.tokenEnv) candidate.tokenEnv = flags.tokenEnv
		if (flags.tokenFile) candidate.tokenFile = flags.tokenFile
	} else {
		candidate = { type: "basic" }
		if (flags.username) candidate.username = flags.username
		if (flags.password !== undefined) candidate.password = flags.password
		if (flags.passwordEnv) candidate.passwordEnv = flags.passwordEnv
		if (flags.passwordFile) candidate.passwordFile = flags.passwordFile
	}

	const parsed = registryAuthConfigSchema.safeParse(candidate)
	if (!parsed.success) {
		const issue = parsed.error.issues[0]
		throw new ValidationError(`Invalid auth options: ${issue?.message ?? parsed.error.message}`)
	}
	return parsed.data
}

export function resolveRegistryAuth(
	alias: string,
	regConfig: RegistryConfig,
	scope: RegistryScope,
	cliAuth?: CliAuth,
): RequestAuth {
	const trusted = isTrustedScope(scope)
	if (scope === "local") assertLocalScopeSafe(alias, regConfig)

	const headers: Record<string, string> = {}
	if (regConfig.headers) {
		for (const [name, value] of Object.entries(regConfig.headers)) {
			headers[name] = trusted ? expandEnvRefs(value) : value
		}
	}
	if (regConfig.auth) {
		const configAuth = authFromConfig(regConfig.auth, trusted)
		if (configAuth) Object.assign(headers, configAuth)
	}
	const envAuth = trusted ? authFromEnvOverride(alias) : null
	if (envAuth) Object.assign(headers, envAuth)
	if (cliAuth) Object.assign(headers, authFromCli(cliAuth))

	const result: RequestAuth = {}
	if (Object.keys(headers).length > 0) result.headers = headers
	if (regConfig.insecure) result.rejectUnauthorized = false
	return result
}

export type AuthResolver = (alias: string) => RequestAuth | undefined

export function createAuthResolver(
	registries: Record<string, RegistryConfig>,
	scope: RegistryScope,
	opts?: { ephemeral?: { alias: string; cliAuth?: CliAuth } },
): AuthResolver {
	const memo = new Map<string, RequestAuth | undefined>()
	return (alias: string) => {
		if (memo.has(alias)) return memo.get(alias)
		const regConfig = registries[alias]
		let auth: RequestAuth | undefined
		if (regConfig) {
			const isEphemeral = opts?.ephemeral?.alias === alias
			auth = resolveRegistryAuth(
				alias,
				regConfig,
				isEphemeral ? "ephemeral" : scope,
				isEphemeral ? opts?.ephemeral?.cliAuth : undefined,
			)
		}
		memo.set(alias, auth)
		return auth
	}
}
