/**
 * Lockfile schema (pipm-lock.json) — the immutability anchor. Records the exact
 * resolved pins (npm version + integrity, git commit SHA) and content hashes so
 * a built `registry/` folder is reproducible.
 */

import { z } from "zod"
import { componentKindSchema } from "./registry"

export const lockedFileSchema = z.object({
	sha256: z.string(),
	size: z.number(),
})

export const lockedComponentSchema = z.object({
	type: componentKindSchema,
	source: z.record(z.string(), z.unknown()),
	contentHash: z.string(),
	files: z.record(z.string(), lockedFileSchema),
	vendorDeps: z.enum(["bundle", "defer"]).optional(),
	dependencies: z.array(z.string()).default([]),
	primaryPackage: z.string().optional(),
})
export type LockedComponent = z.infer<typeof lockedComponentSchema>

export const lockfileSchema = z.object({
	lockfileVersion: z.literal(1).default(1),
	registry: z.object({ name: z.string(), version: z.string() }),
	pipm: z.string(),
	generatedAt: z.string(),
	components: z.record(z.string(), lockedComponentSchema),
})
export type Lockfile = z.infer<typeof lockfileSchema>
