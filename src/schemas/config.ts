/**
 * Consumer config (pipm.jsonc), registry auth, and install receipt schemas.
 * Forked from OCX's schemas/config.ts (MIT). Env prefix OCX_ -> PIPM_.
 */

import { z } from "zod"
import { componentKindSchema } from "./registry"

// ── registry auth ─────────────────────────────────────────────────────────────
export const registryAuthConfigSchema = z.union([
	z.object({
		type: z.literal("bearer"),
		token: z.string().optional(),
		tokenEnv: z.string().optional(),
		tokenFile: z.string().optional(),
	}),
	z.object({
		type: z.literal("basic"),
		username: z.string(),
		password: z.string().optional(),
		passwordEnv: z.string().optional(),
		passwordFile: z.string().optional(),
	}),
])
export type RegistryAuthConfig = z.infer<typeof registryAuthConfigSchema>

/** Auth fields that are env/file references (only honored in trusted scopes). */
export const AUTH_REF_FIELDS = ["tokenEnv", "tokenFile", "passwordEnv", "passwordFile"] as const

export const registryConfigSchema = z.object({
	url: z.string().min(1),
	headers: z.record(z.string(), z.string()).optional(),
	auth: registryAuthConfigSchema.optional(),
	insecure: z.boolean().optional(),
})
export type RegistryConfig = z.infer<typeof registryConfigSchema>

// ── pipm.jsonc (lives at <pi-home>/pipm.jsonc) ────────────────────────────────
export const pipmConfigSchema = z.object({
	$schema: z.string().optional(),
	defaultProfile: z.string().optional(),
	registries: z.record(z.string(), registryConfigSchema).default({}),
	lockRegistries: z.boolean().optional(),
})
export type PipmConfig = z.infer<typeof pipmConfigSchema>

// ── machine config (~/.config/pipm/config.jsonc) — only relocates pi-home ─────
export const machineConfigSchema = z.object({
	$schema: z.string().optional(),
	piHome: z.string().optional(),
})
export type MachineConfig = z.infer<typeof machineConfigSchema>

// ── install receipt (<profileRoot>/.pipm/receipt.jsonc) ───────────────────────
export const receiptFileSchema = z.object({
	path: z.string(),
	hash: z.string(),
	/** true for concatenated instruction files (AGENTS.md) shared across components */
	shared: z.boolean().optional(),
})

export const installedComponentSchema = z.object({
	registryUrl: z.string(),
	registryName: z.string(),
	name: z.string(),
	kind: componentKindSchema,
	revision: z.string(),
	hash: z.string(),
	files: z.array(receiptFileSchema),
	/** side-effects this component made to settings.json, for clean removal */
	settings: z
		.object({
			packages: z.array(z.string()).default([]),
			mergedKeys: z.array(z.string()).default([]),
		})
		.default({ packages: [], mergedKeys: [] }),
	installedAt: z.string(),
	updatedAt: z.string().nullable().default(null),
})
export type InstalledComponent = z.infer<typeof installedComponentSchema>

export const receiptSchema = z.object({
	version: z.literal(1).default(1),
	root: z.string(),
	piHome: z.string(),
	profile: z.string(),
	installed: z.record(z.string(), installedComponentSchema).default({}),
})
export type Receipt = z.infer<typeof receiptSchema>

// ── canonical component id ─────────────────────────────────────────────────────
/** registryUrl::registryName/name@sha256:<hash> */
export function createCanonicalId(
	registryUrl: string,
	registryName: string,
	name: string,
	hash: string,
): string {
	return `${registryUrl}::${registryName}/${name}@sha256:${hash}`
}

export function parseCanonicalId(id: string): {
	registryUrl: string
	registryName: string
	name: string
	hash: string
} | null {
	const sep = id.indexOf("::")
	if (sep === -1) return null
	const registryUrl = id.slice(0, sep)
	const rest = id.slice(sep + 2)
	const at = rest.lastIndexOf("@sha256:")
	if (at === -1) return null
	const qualified = rest.slice(0, at)
	const hash = rest.slice(at + "@sha256:".length)
	const slash = qualified.indexOf("/")
	if (slash === -1) return null
	return {
		registryUrl,
		registryName: qualified.slice(0, slash),
		name: qualified.slice(slash + 1),
		hash,
	}
}
