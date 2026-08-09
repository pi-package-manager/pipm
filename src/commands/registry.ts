/**
 * `pipm registry add|remove|list` — manage configured registries in pipm.jsonc.
 * Forked from OCX's commands/registry.ts (MIT).
 */

import type { Command } from "commander"
import { type Context, type GlobalOpts, resolveContext } from "../cli/context"
import { savePipmConfig } from "../install/pi-home"
import { buildRegistryAuthConfig, type CredentialFlags, createAuthResolver } from "../registry/auth"
import { fetchRegistryIndex } from "../registry/fetcher"
import type { RegistryConfig } from "../schemas/config"
import { ConflictError, NotFoundError } from "../utils/errors"
import { isJsonMode, log, printJson } from "../utils/logger"

function credentialFlags(o: Record<string, unknown>): CredentialFlags {
	return {
		token: o.token as string | undefined,
		tokenEnv: o.tokenEnv as string | undefined,
		tokenFile: o.tokenFile as string | undefined,
		username: o.username as string | undefined,
		password: o.password as string | undefined,
		passwordEnv: o.passwordEnv as string | undefined,
		passwordFile: o.passwordFile as string | undefined,
	}
}

function addAuthOptions(cmd: Command): Command {
	return cmd
		.option("--token <token>", "Bearer token (literal)")
		.option("--token-env <var>", "Env var holding a bearer token")
		.option("--token-file <path>", "File holding a bearer token")
		.option("--username <user>", "Basic auth username")
		.option("--password <pass>", "Basic auth password (literal)")
		.option("--password-env <var>", "Env var holding the basic auth password")
		.option("--password-file <path>", "File holding the basic auth password")
		.option("--insecure-skip-tls-verify", "Skip TLS certificate verification")
}

export function registerRegistryCommand(program: Command): void {
	const registry = program.command("registry").description("Manage registries")

	addAuthOptions(
		registry
			.command("add <url>")
			.description("Add a registry (HTTP URL, file:// URL, or local folder path)")
			.requiredOption("--name <alias>", "Registry alias")
			.option("--skip-validate", "Do not fetch index.json to validate the registry"),
	).action(async (url: string, opts: Record<string, unknown>, cmd: Command) => {
		const g = cmd.optsWithGlobals() as GlobalOpts
		const ctx: Context = await resolveContext(g)
		const alias = opts.name as string

		if (ctx.config.registries[alias]) {
			throw new ConflictError(`Registry "${alias}" already exists. Remove it first.`)
		}

		const regConfig: RegistryConfig = { url }
		const auth = buildRegistryAuthConfig(credentialFlags(opts))
		if (auth) regConfig.auth = auth
		if (opts.insecureSkipTlsVerify) regConfig.insecure = true

		if (!opts.skipValidate) {
			const resolveAuth = createAuthResolver({ [alias]: regConfig }, "user")
			const index = await fetchRegistryIndex(url, resolveAuth(alias))
			log.debug(`validated registry "${index.name}" (${index.components.length} components)`)
		}

		ctx.config.registries[alias] = regConfig
		await savePipmConfig(ctx.piHome, ctx.config)
		if (isJsonMode()) printJson({ added: alias, url })
		else log.success(`Added registry "${alias}" → ${url}`)
	})

	registry
		.command("remove <alias>")
		.description("Remove a configured registry")
		.action(async (alias: string, _opts, cmd: Command) => {
			const ctx = await resolveContext(cmd.optsWithGlobals() as GlobalOpts)
			if (!ctx.config.registries[alias]) throw new NotFoundError(`Registry "${alias}" not found.`)
			delete ctx.config.registries[alias]
			await savePipmConfig(ctx.piHome, ctx.config)
			if (isJsonMode()) printJson({ removed: alias })
			else log.success(`Removed registry "${alias}"`)
		})

	registry
		.command("list")
		.description("List configured registries")
		.action(async (_opts, cmd: Command) => {
			const ctx = await resolveContext(cmd.optsWithGlobals() as GlobalOpts)
			const entries = Object.entries(ctx.config.registries)
			if (isJsonMode()) {
				printJson(entries.map(([name, cfg]) => ({ name, url: cfg.url })))
				return
			}
			if (entries.length === 0) {
				log.info("No registries configured. Add one with 'pipm registry add <url> --name <alias>'.")
				return
			}
			log.heading("Registries")
			for (const [name, cfg] of entries) log.item(name, cfg.url)
		})
}
