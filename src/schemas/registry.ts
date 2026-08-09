/**
 * Registry manifest schemas (registry.jsonc) and built-registry artifacts
 * (packuments + index). Forked from OCX's schemas/registry.ts (MIT) and
 * retargeted at Pi: component kinds are skill|extension|plugin|profile and each
 * component carries a discriminated `source` of npm|git|static.
 */

import { z } from "zod"

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/

/** Pi resource / component name: lowercase alnum + single hyphens, 1-64 chars. */
export const piNameSchema = z
	.string()
	.min(1)
	.max(64)
	.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be lowercase alphanumeric with single hyphens")

export const componentKindSchema = z.enum(["skill", "extension", "plugin", "profile"])
export type ComponentKind = z.infer<typeof componentKindSchema>

// ── file targets (Cargo-style: string path, or { path, target }) ──────────────
export const componentFileObjectSchema = z.object({
	path: z.string().min(1),
	target: z.string().min(1).optional(),
})
export const componentFileSchema = z.union([z.string().min(1), componentFileObjectSchema])
export type ComponentFile = z.infer<typeof componentFileSchema>

// ── source discriminated union ────────────────────────────────────────────────
export const npmSourceSchema = z.object({
	type: z.literal("npm"),
	package: z.string().min(1),
	version: z.string().min(1).optional(),
	subpath: z.string().optional(),
	include: z.array(z.string()).optional(),
})
export const gitSourceSchema = z.object({
	type: z.literal("git"),
	repo: z.string().min(1),
	ref: z.string().optional(),
	subpath: z.string().optional(),
	include: z.array(z.string()).optional(),
})
export const staticSourceSchema = z.object({
	type: z.literal("static"),
	files: z.array(componentFileSchema).min(1),
})

export const componentSourceObjectSchema = z.discriminatedUnion("type", [
	npmSourceSchema,
	gitSourceSchema,
	staticSourceSchema,
])

/** Expand a Cargo-style source string ("npm:pkg@ver" or a git URL) to an object. */
export function parseSourceString(value: string): unknown {
	const v = value.trim()
	if (v.startsWith("npm:")) {
		const spec = v.slice(4)
		const at = spec.lastIndexOf("@")
		// keep the leading @ of scoped packages: only split on an @ after position 0
		if (at > 0) {
			return { type: "npm", package: spec.slice(0, at), version: spec.slice(at + 1) }
		}
		return { type: "npm", package: spec }
	}
	if (
		v.startsWith("git+") ||
		v.endsWith(".git") ||
		v.startsWith("git@") ||
		/^https?:\/\/.*\/(?:.+)$/.test(v)
	) {
		return { type: "git", repo: v.replace(/^git\+/, "") }
	}
	return value
}

export const componentSourceSchema = z.preprocess(
	(val) => (typeof val === "string" ? parseSourceString(val) : val),
	componentSourceObjectSchema,
)
export type ComponentSource = z.infer<typeof componentSourceObjectSchema>

// ── profile settings block (becomes the profile's settings.json base) ──────────
export const piProfileConfigSchema = z
	.object({
		theme: z.string().optional(),
		packages: z.array(z.string()).optional(),
	})
	.catchall(z.unknown())
export type PiProfileConfig = z.infer<typeof piProfileConfigSchema>

// ── component manifest (an entry in registry.jsonc `components[]`) ─────────────
export const componentManifestSchema = z.object({
	name: piNameSchema,
	type: componentKindSchema,
	description: z.string().min(1).max(1024),
	source: componentSourceSchema,
	dependencies: z.array(z.string()).default([]),
	vendorDeps: z.enum(["bundle", "defer"]).optional(),
	pi: piProfileConfigSchema.optional(),
})
export type ComponentManifest = z.infer<typeof componentManifestSchema>

// ── top-level registry.jsonc ───────────────────────────────────────────────────
export const registrySchema = z
	.object({
		$schema: z.string().optional(),
		name: z.string().min(1),
		version: z.string().regex(SEMVER_RE, "registry version must be semver"),
		author: z.string().min(1),
		pi: z.string().optional(),
		pipm: z.string().optional(),
		components: z.array(componentManifestSchema),
	})
	.superRefine((reg, ctx) => {
		const names = new Set<string>()
		for (const c of reg.components) {
			if (names.has(c.name)) {
				ctx.addIssue({ code: "custom", message: `duplicate component name "${c.name}"` })
			}
			names.add(c.name)
		}
		// bare dependencies must resolve within this registry
		for (const c of reg.components) {
			for (const dep of c.dependencies) {
				if (!dep.includes("/") && !names.has(dep)) {
					ctx.addIssue({
						code: "custom",
						message: `component "${c.name}" depends on unknown "${dep}"`,
					})
				}
			}
		}
	})
export type Registry = z.infer<typeof registrySchema>

// ══════════════════════════════════════════════════════════════════════════════
// Built-registry artifacts (emitted by `pipm build`, served over HTTP)
// ══════════════════════════════════════════════════════════════════════════════

export const resolvedFileSchema = z.object({
	path: z.string(), // location under components/<name>/
	target: z.string(), // install destination relative to the profile root
	sha256: z.string(),
	size: z.number(),
})
export type ResolvedFile = z.infer<typeof resolvedFileSchema>

export const resolvedSourceSchema = z
	.object({ type: z.enum(["npm", "git", "static"]) })
	.catchall(z.unknown())

export const componentVersionSchema = z.object({
	name: piNameSchema,
	type: componentKindSchema,
	description: z.string(),
	resolved: resolvedSourceSchema,
	contentHash: z.string(),
	files: z.array(resolvedFileSchema),
	dependencies: z.array(z.string()).default([]),
	vendorDeps: z.enum(["bundle", "defer"]).optional(),
	pi: piProfileConfigSchema.optional(),
	/** primary npm package name for plugin components (used for settings.json packages entry) */
	primaryPackage: z.string().optional(),
})
export type ComponentVersion = z.infer<typeof componentVersionSchema>

export const packumentSchema = z.object({
	name: piNameSchema,
	"dist-tags": z.object({ latest: z.string() }),
	versions: z.record(z.string(), componentVersionSchema),
})
export type Packument = z.infer<typeof packumentSchema>

export const registryIndexSchema = z.object({
	$schema: z.string().optional(),
	name: z.string(),
	version: z.string(),
	author: z.string(),
	pi: z.string().optional(),
	pipm: z.string().optional(),
	components: z.array(
		z.object({
			name: piNameSchema,
			type: componentKindSchema,
			description: z.string(),
		}),
	),
})
export type RegistryIndex = z.infer<typeof registryIndexSchema>

// ── path safety: targets that registry content may never write to ─────────────
export const BLOCKED_TARGET_PREFIXES = [
	".pipm/",
	".git/",
	".env",
	"pipm.jsonc",
	"settings.json",
	"npm/package.json",
	"memory/",
	"sessions/",
]

/** Returns a reason string if the target is forbidden, else null. */
export function blockedTargetReason(target: string): string | null {
	const norm = target.replace(/\\/g, "/").replace(/^\.\//, "")
	for (const prefix of BLOCKED_TARGET_PREFIXES) {
		if (norm === prefix || norm.startsWith(prefix)) {
			return `target "${target}" is a protected path (${prefix})`
		}
	}
	return null
}

/**
 * Full target-safety check applied at BOTH build and install time, against the
 * (untrusted) packument targets. Every kind is subject to the protected-path
 * list; plugins are additionally restricted to the `npm/` prefix — the only
 * place a vendored plugin ever writes — so a malicious registry cannot use a
 * `type: "plugin"` component to plant files elsewhere in the agent dir.
 */
export function unsafeTargetReason(kind: ComponentKind, target: string): string | null {
	const blocked = blockedTargetReason(target)
	if (blocked) return blocked
	if (kind === "plugin") {
		const norm = target.replace(/\\/g, "/").replace(/^\.\//, "")
		if (!norm.startsWith("npm/")) {
			return `plugin target "${target}" must be under npm/`
		}
	}
	return null
}

/** Resolve a file entry to its { path, target } pair (target defaults to path). */
export function normalizeFile(file: ComponentFile): { path: string; target: string } {
	if (typeof file === "string") return { path: file, target: file }
	return { path: file.path, target: file.target ?? file.path }
}
