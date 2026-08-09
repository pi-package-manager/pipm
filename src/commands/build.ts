/**
 * `pipm build` — build an immutable registry folder from a registry.jsonc.
 */

import type { Command } from "commander"
import { buildRegistry } from "../build/build-registry"
import { type GlobalOpts, resolveContext } from "../cli/context"
import { isJsonMode, printJson } from "../utils/logger"

export function registerBuildCommand(program: Command): void {
	program
		.command("build [path]")
		.description("Build an immutable registry/ folder from registry.jsonc (vendors npm/git/static)")
		.option("--out <dir>", "Output directory (default: <source>/registry)")
		.option("--timestamp <iso>", "Override the lockfile generatedAt stamp")
		.action(async (path: string | undefined, opts: Record<string, unknown>, cmd: Command) => {
			const g = cmd.optsWithGlobals() as GlobalOpts
			await resolveContext(g) // configures logging
			const result = await buildRegistry({
				source: path ?? process.cwd(),
				out: opts.out as string | undefined,
				timestamp: (opts.timestamp as string | undefined) ?? new Date().toISOString(),
				dryRun: Boolean(g.dryRun),
			})
			if (isJsonMode()) printJson(result)
		})
}
