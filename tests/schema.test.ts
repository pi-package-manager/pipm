import { describe, expect, it } from "bun:test"
import {
	blockedTargetReason,
	componentSourceSchema,
	parseSourceString,
	piNameSchema,
	registrySchema,
	unsafeTargetReason,
} from "../src/schemas/registry"

describe("source string parsing", () => {
	it("parses npm specifiers with scope + version", () => {
		expect(parseSourceString("npm:@acme/x@1.2.3")).toEqual({
			type: "npm",
			package: "@acme/x",
			version: "1.2.3",
		})
	})
	it("parses scoped npm without version", () => {
		expect(parseSourceString("npm:@acme/x")).toEqual({ type: "npm", package: "@acme/x" })
	})
	it("parses a git URL", () => {
		expect(parseSourceString("https://github.com/acme/pi-tps")).toEqual({
			type: "git",
			repo: "https://github.com/acme/pi-tps",
		})
	})
	it("componentSourceSchema accepts the shorthand", () => {
		const parsed = componentSourceSchema.parse("npm:@acme/x@1.0.0")
		expect(parsed).toMatchObject({ type: "npm", package: "@acme/x" })
	})
})

describe("piNameSchema", () => {
	it("accepts kebab names", () => {
		expect(piNameSchema.safeParse("my-skill-1").success).toBe(true)
	})
	it("rejects uppercase / underscores", () => {
		expect(piNameSchema.safeParse("My_Skill").success).toBe(false)
	})
})

describe("blockedTargetReason", () => {
	it("blocks protected paths", () => {
		expect(blockedTargetReason("settings.json")).not.toBeNull()
		expect(blockedTargetReason(".pipm/receipt.jsonc")).not.toBeNull()
		expect(blockedTargetReason("npm/package.json")).not.toBeNull()
	})
	it("allows normal targets", () => {
		expect(blockedTargetReason("skills/x/SKILL.md")).toBeNull()
		expect(blockedTargetReason("npm/node_modules/x/index.js")).toBeNull()
	})
})

describe("unsafeTargetReason", () => {
	it("blocks protected paths for every kind (incl. plugin)", () => {
		expect(unsafeTargetReason("skill", "memory/x.md")).not.toBeNull()
		expect(unsafeTargetReason("plugin", "memory/pwned.md")).not.toBeNull()
		expect(unsafeTargetReason("plugin", "sessions/x")).not.toBeNull()
		expect(unsafeTargetReason("plugin", "npm/package.json")).not.toBeNull()
		expect(unsafeTargetReason("profile", "settings.json")).not.toBeNull()
	})
	it("restricts plugins to the npm/ prefix", () => {
		expect(unsafeTargetReason("plugin", "npm/node_modules/x/index.js")).toBeNull()
		expect(unsafeTargetReason("plugin", "skills/x/SKILL.md")).not.toBeNull()
		expect(unsafeTargetReason("plugin", "extensions/x.ts")).not.toBeNull()
	})
	it("allows normal per-kind targets", () => {
		expect(unsafeTargetReason("skill", "skills/x/SKILL.md")).toBeNull()
		expect(unsafeTargetReason("extension", "extensions/x.ts")).toBeNull()
		expect(unsafeTargetReason("profile", "AGENTS.md")).toBeNull()
	})
})

describe("registrySchema", () => {
	const base = { $schema: "x", name: "r", version: "1.0.0", author: "a" }

	it("accepts a valid registry", () => {
		const r = registrySchema.safeParse({
			...base,
			components: [
				{
					name: "hello",
					type: "skill",
					description: "d",
					source: { type: "static", files: ["a.md"] },
				},
			],
		})
		expect(r.success).toBe(true)
	})

	it("rejects an unknown bare dependency", () => {
		const r = registrySchema.safeParse({
			...base,
			components: [
				{
					name: "a",
					type: "skill",
					description: "d",
					source: { type: "static", files: ["a.md"] },
					dependencies: ["does-not-exist"],
				},
			],
		})
		expect(r.success).toBe(false)
	})

	it("rejects a non-semver version", () => {
		expect(registrySchema.safeParse({ ...base, version: "nope", components: [] }).success).toBe(
			false,
		)
	})
})
