import { describe, expect, it } from "bun:test"
import {
	blockedTargetReason,
	componentSourceSchema,
	parseSourceString,
	piNameSchema,
	registrySchema,
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
