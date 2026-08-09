/**
 * Subprocess helper for build-time vendoring (git clone, npm install, tar).
 */

import { BuildError } from "../utils/errors"

export interface RunResult {
	code: number
	stdout: string
	stderr: string
}

export async function run(cmd: string[], opts?: { cwd?: string }): Promise<RunResult> {
	const proc = Bun.spawn(cmd, {
		cwd: opts?.cwd,
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
	})
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	])
	const code = await proc.exited
	return { code, stdout, stderr }
}

export async function runOrThrow(cmd: string[], opts?: { cwd?: string }): Promise<RunResult> {
	const result = await run(cmd, opts)
	if (result.code !== 0) {
		throw new BuildError(
			`Command failed (exit ${result.code}): ${cmd.join(" ")}\n${result.stderr.trim() || result.stdout.trim()}`,
		)
	}
	return result
}

/** Whether an executable is available on PATH. */
export async function hasCommand(name: string): Promise<boolean> {
	const which = process.platform === "win32" ? "where" : "which"
	const result = await run([which, name])
	return result.code === 0
}
