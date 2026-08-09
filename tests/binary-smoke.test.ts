import { describe, expect, it } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Smoke-test the compiled binary. Gated behind PIPM_DIST_TESTS=1 so the normal
 * `bun test` run doesn't require a prior binary build.
 *   PIPM_DIST_TESTS=1 bun test tests/binary-smoke.test.ts
 */
const ENABLED = process.env.PIPM_DIST_TESTS === "1"

function binaryPath(): string | null {
	const arch = process.arch === "arm64" ? "arm64" : "x64"
	const os =
		process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux"
	const p = join(import.meta.dir, "..", "dist", "bin", `pipm-${os}-${arch}`)
	return existsSync(p) ? p : null
}

describe.skipIf(!ENABLED)("binary smoke", () => {
	it("prints the package version", async () => {
		const bin = binaryPath()
		expect(bin).not.toBeNull()
		const pkg = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf-8"))
		const proc = Bun.spawn([bin as string, "--version"], { stdout: "pipe" })
		const out = (await new Response(proc.stdout).text()).trim()
		await proc.exited
		expect(out).toBe(pkg.version)
	})

	it("prints help with all top-level commands", async () => {
		const bin = binaryPath()
		const proc = Bun.spawn([bin as string, "--help"], { stdout: "pipe" })
		const out = await new Response(proc.stdout).text()
		await proc.exited
		for (const cmd of ["init", "registry", "build", "install", "add", "remove", "verify", "list"]) {
			expect(out).toContain(cmd)
		}
	})
})
