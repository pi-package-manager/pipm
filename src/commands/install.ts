/**
 * `pipm install <alias>/<profile>` — provision the Pi agent dir from a registry,
 * flattening all resolved dependencies into <pi-home>/agent.
 * `pipm add <alias>/<component>` — add one component into <pi-home>/agent.
 */

import type { Command } from "commander"
import { type Context, type GlobalOpts, resolveContext } from "../cli/context"
import { installGraph } from "../install/installer"
import { createAuthResolver } from "../registry/auth"
import { resolveDependencies } from "../registry/resolver"
import type { RegistryConfig } from "../schemas/config"
import { ValidationError } from "../utils/errors"
import { isJsonMode, log, printJson } from "../utils/logger"

interface Effective {
	registries: Record<string, RegistryConfig>
	ref: string
	resolveAuth: ReturnType<typeof createAuthResolver>
}

function buildEffective(ctx: Context, ref: string, fromUrl?: string): Effective {
	const registries: Record<string, RegistryConfig> = { ...ctx.config.registries }
	let normRef = ref
	let ephemeral: { alias: string } | undefined
	if (fromUrl) {
		const alias = ref.includes("/") ? (ref.split("/")[0] as string) : "from"
		if (!ref.includes("/")) normRef = `from/${ref}`
		registries[alias] = { url: fromUrl }
		ephemeral = { alias }
	}
	const resolveAuth = createAuthResolver(registries, "user", ephemeral ? { ephemeral } : undefined)
	return { registries, ref: normRef, resolveAuth }
}

export function registerInstallCommand(program: Command): void {
	program
		.command("install <ref>")
		.alias("i")
		.description("Install a profile (<alias>/<profile>) into <pi-home>/agent, resolving all deps")
		.option("--from <url>", "Install from an ephemeral registry URL/path (not persisted)")
		.action(async (ref: string, opts: Record<string, unknown>, cmd: Command) => {
			const g = cmd.optsWithGlobals() as GlobalOpts
			const ctx = await resolveContext(g)
			const eff = buildEffective(ctx, ref, opts.from as string | undefined)

			const graph = await resolveDependencies(eff.registries, [eff.ref], eff.resolveAuth)
			const target = graph.components.find((c) => c.qualifiedName === eff.ref)
			if (!target) throw new ValidationError(`Could not resolve "${eff.ref}".`)
			if (target.version.type !== "profile") {
				throw new ValidationError(
					`"${eff.ref}" is a ${target.version.type}, not a profile. Use 'pipm add' to install it.`,
				)
			}

			const result = await installGraph(graph, {
				profileRoot: ctx.agentDir,
				piHome: ctx.piHome,
				profile: target.version.name,
				resolveAuth: eff.resolveAuth,
				dryRun: ctx.dryRun,
			})

			if (isJsonMode()) {
				printJson({ profile: target.version.name, agentDir: ctx.agentDir, ...result })
				return
			}
			log.success(`Installed profile "${target.version.name}" → ${ctx.agentDir}`)
			for (const c of result.installed) log.item(c.kind, `${c.name} (${c.files} files)`)
			if (result.skipped.length) log.debug(`skipped (unchanged): ${result.skipped.join(", ")}`)
			log.info(`\nRun it:  PI_CODING_AGENT_DIR=${ctx.agentDir} pi`)
		})
}

export function registerAddCommand(program: Command): void {
	program
		.command("add <ref>")
		.description("Add a component (<alias>/<component>) into <pi-home>/agent, resolving deps")
		.option("--from <url>", "Install from an ephemeral registry URL/path (not persisted)")
		.action(async (ref: string, opts: Record<string, unknown>, cmd: Command) => {
			const g = cmd.optsWithGlobals() as GlobalOpts
			const ctx = await resolveContext(g)
			const eff = buildEffective(ctx, ref, opts.from as string | undefined)

			const graph = await resolveDependencies(eff.registries, [eff.ref], eff.resolveAuth)
			const result = await installGraph(graph, {
				profileRoot: ctx.agentDir,
				piHome: ctx.piHome,
				profile: "agent",
				resolveAuth: eff.resolveAuth,
				dryRun: ctx.dryRun,
			})

			if (isJsonMode()) {
				printJson({ agentDir: ctx.agentDir, ...result })
				return
			}
			log.success(`Added into ${ctx.agentDir}`)
			for (const c of result.installed) log.item(c.kind, `${c.name} (${c.files} files)`)
		})
}
