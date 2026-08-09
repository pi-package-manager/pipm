/**
 * `pipm remove | verify | list | search`.
 */

import type { Command } from "commander"
import { type GlobalOpts, resolveContext } from "../cli/context"
import { listInstalled, removeComponents, verifyComponents } from "../install/manage"
import { createAuthResolver } from "../registry/auth"
import { fetchRegistryIndex } from "../registry/fetcher"
import { EXIT_CODES } from "../utils/errors"
import { isJsonMode, log, printJson } from "../utils/logger"

export function registerRemoveCommand(program: Command): void {
	program
		.command("remove <components...>")
		.alias("rm")
		.description("Remove installed components from a profile")
		.action(async (components: string[], _opts, cmd: Command) => {
			const g = cmd.optsWithGlobals() as GlobalOpts
			const ctx = await resolveContext(g)
			const removed = await removeComponents(ctx.agentDir, components)
			if (isJsonMode()) printJson({ removed })
			else log.success(`Removed: ${removed.join(", ")}`)
		})
}

export function registerVerifyCommand(program: Command): void {
	program
		.command("verify [components...]")
		.description("Verify installed component files against the receipt (SHA-256)")
		.action(async (components: string[], _opts, cmd: Command) => {
			const g = cmd.optsWithGlobals() as GlobalOpts
			const ctx = await resolveContext(g)
			const reports = await verifyComponents(ctx.agentDir, components)
			if (isJsonMode()) {
				printJson(reports)
			} else if (reports.length === 0) {
				log.info("Nothing installed to verify.")
			} else {
				for (const r of reports) {
					if (r.intact) log.success(`${r.name} intact`)
					else
						log.warn(
							`${r.name} — modified: [${r.modified.join(", ")}] missing: [${r.missing.join(", ")}]`,
						)
				}
			}
			if (reports.some((r) => !r.intact)) process.exitCode = EXIT_CODES.INTEGRITY
		})
}

export function registerListCommand(program: Command): void {
	program
		.command("list")
		.alias("ls")
		.description("List components installed in a profile")
		.action(async (_opts, cmd: Command) => {
			const g = cmd.optsWithGlobals() as GlobalOpts
			const ctx = await resolveContext(g)
			const installed = await listInstalled(ctx.agentDir)
			if (isJsonMode()) {
				printJson(installed.map((c) => ({ name: c.name, kind: c.kind, registry: c.registryName })))
				return
			}
			if (installed.length === 0) {
				log.info(`No components installed in ${ctx.agentDir}.`)
				return
			}
			log.heading(`Installed in ${ctx.agentDir}`)
			for (const c of installed) log.item(c.kind, `${c.name} (${c.registryName})`)
		})
}

export function registerSearchCommand(program: Command): void {
	program
		.command("search [query]")
		.description("Search components across configured registries")
		.action(async (query: string | undefined, _opts, cmd: Command) => {
			const g = cmd.optsWithGlobals() as GlobalOpts
			const ctx = await resolveContext(g)
			const resolveAuth = createAuthResolver(ctx.config.registries, "user")
			const q = (query ?? "").toLowerCase()
			const hits: { registry: string; name: string; type: string; description: string }[] = []
			for (const [alias, cfg] of Object.entries(ctx.config.registries)) {
				try {
					const index = await fetchRegistryIndex(cfg.url, resolveAuth(alias))
					for (const c of index.components) {
						if (!q || c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)) {
							hits.push({ registry: alias, name: c.name, type: c.type, description: c.description })
						}
					}
				} catch (err) {
					log.debug(`skip registry "${alias}": ${err instanceof Error ? err.message : String(err)}`)
				}
			}
			if (isJsonMode()) {
				printJson(hits)
				return
			}
			if (hits.length === 0) {
				log.info("No matching components.")
				return
			}
			for (const h of hits) log.item(`${h.registry}/${h.name}`, `[${h.type}] ${h.description}`)
		})
}
