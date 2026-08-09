import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildRegistry } from "../src/build/build-registry"
import { installGraph } from "../src/install/installer"
import { listInstalled, removeComponents, verifyComponents } from "../src/install/manage"
import { createAuthResolver } from "../src/registry/auth"
import { resolveDependencies } from "../src/registry/resolver"
import type { RegistryConfig } from "../src/schemas/config"
import { IntegrityError } from "../src/utils/errors"

let src: string
let out: string
let registries: Record<string, RegistryConfig>

function writeFixture(dir: string): void {
	mkdirSync(join(dir, "files/skills/hello"), { recursive: true })
	mkdirSync(join(dir, "files/profiles/demo"), { recursive: true })
	writeFileSync(
		join(dir, "files/skills/hello/SKILL.md"),
		"---\nname: hello\ndescription: say hi\n---\n# hi\n",
	)
	writeFileSync(join(dir, "files/profiles/demo/AGENTS.md"), "# demo profile\n")
	writeFileSync(
		join(dir, "registry.jsonc"),
		JSON.stringify({
			$schema: "https://pipm.dev/schemas/v1/registry.json",
			name: "test",
			version: "1.0.0",
			author: "t@t",
			components: [
				{
					name: "hello",
					type: "skill",
					description: "hello skill",
					source: { type: "static", files: ["skills/hello/SKILL.md"] },
				},
				{
					name: "demo",
					type: "profile",
					description: "demo profile",
					source: {
						type: "static",
						files: [{ path: "profiles/demo/AGENTS.md", target: "AGENTS.md" }],
					},
					dependencies: ["hello"],
					pi: { theme: "dark" },
				},
			],
		}),
	)
}

beforeAll(async () => {
	src = mkdtempSync(join(tmpdir(), "pipm-src-"))
	writeFixture(src)
	const result = await buildRegistry({ source: src, timestamp: "2026-01-01T00:00:00Z" })
	out = result.outDir
	registries = { test: { url: out } }
})

afterAll(() => {
	rmSync(src, { recursive: true, force: true })
})

describe("build", () => {
	it("emits index, packuments, and a lockfile with per-file hashes", () => {
		expect(existsSync(join(out, "index.json"))).toBe(true)
		expect(existsSync(join(out, "components/demo.json"))).toBe(true)
		const lock = JSON.parse(readFileSync(join(src, "pipm-lock.json"), "utf-8"))
		expect(lock.components.hello.contentHash).toMatch(/^sha256:/)
		const file = Object.values(lock.components.hello.files)[0] as { sha256: string }
		expect(file.sha256).toMatch(/^[0-9a-f]{64}$/)
	})
})

describe("resolve", () => {
	it("returns dependencies before dependents (topological)", async () => {
		const graph = await resolveDependencies(
			registries,
			["test/demo"],
			createAuthResolver(registries, "user"),
		)
		expect(graph.installOrder).toEqual(["test/hello", "test/demo"])
	})
})

describe("install → verify → remove", () => {
	it("installs a profile into the agent dir and records a receipt", async () => {
		const agent = mkdtempSync(join(tmpdir(), "pipm-agent-"))
		const graph = await resolveDependencies(
			registries,
			["test/demo"],
			createAuthResolver(registries, "user"),
		)
		await installGraph(graph, {
			profileRoot: agent,
			piHome: agent,
			profile: "demo",
			resolveAuth: createAuthResolver(registries, "user"),
		})

		expect(existsSync(join(agent, "skills/hello/SKILL.md"))).toBe(true)
		expect(existsSync(join(agent, "AGENTS.md"))).toBe(true)
		const settings = JSON.parse(readFileSync(join(agent, "settings.json"), "utf-8"))
		expect(settings.theme).toBe("dark")
		expect(existsSync(join(agent, ".pipm/receipt.jsonc"))).toBe(true)

		const reports = await verifyComponents(agent)
		expect(reports.every((r) => r.intact)).toBe(true)
		expect((await listInstalled(agent)).map((c) => c.name).sort()).toEqual(["demo", "hello"])

		await removeComponents(agent, ["hello"])
		expect(existsSync(join(agent, "skills/hello/SKILL.md"))).toBe(false)

		rmSync(agent, { recursive: true, force: true })
	})

	it("rejects a tampered file at install time (integrity check)", async () => {
		// corrupt a served file without updating its packument hash
		const served = join(out, "components/hello/SKILL.md")
		const original = readFileSync(served)
		writeFileSync(served, Buffer.concat([original, Buffer.from("// tampered")]))

		const agent = mkdtempSync(join(tmpdir(), "pipm-agent-"))
		const graph = await resolveDependencies(
			registries,
			["test/hello"],
			createAuthResolver(registries, "user"),
		)
		let threw = false
		try {
			await installGraph(graph, {
				profileRoot: agent,
				piHome: agent,
				profile: "agent",
				resolveAuth: createAuthResolver(registries, "user"),
			})
		} catch (err) {
			threw = err instanceof IntegrityError
		}
		writeFileSync(served, original) // restore
		rmSync(agent, { recursive: true, force: true })
		expect(threw).toBe(true)
	})
})
