/**
 * `pipm init` — create the pi-home skeleton and a pipm.jsonc.
 * `pipm init registry <path>` — scaffold a new registry project (offline).
 */

import { basename, join, resolve } from "node:path"
import type { Command } from "commander"
import { type Context, type GlobalOpts, resolveContext } from "../cli/context"
import { configPath, resolveAgentDir, savePipmConfig } from "../install/pi-home"
import { ConflictError, ValidationError } from "../utils/errors"
import { ensureDir, pathExists, writeFileEnsured } from "../utils/fs"
import { isJsonMode, log, printJson } from "../utils/logger"
import { starterTemplate } from "./registry-template"

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function registerInitCommand(program: Command): void {
	const init = program
		.command("init")
		.description("Create the Pi home skeleton and a pipm.jsonc config")
		.action(async (_opts, cmd: Command) => {
			const ctx: Context = await resolveContext(cmd.optsWithGlobals() as GlobalOpts)
			await ensureDir(resolveAgentDir(ctx.piHome))
			if (!(await pathExists(configPath(ctx.piHome)))) {
				await savePipmConfig(ctx.piHome, ctx.config)
			}
			if (isJsonMode()) {
				printJson({ piHome: ctx.piHome, config: configPath(ctx.piHome) })
			} else {
				log.success(`Initialized Pi home at ${ctx.piHome}`)
				log.item("config", configPath(ctx.piHome))
			}
		})

	init
		.command("registry <path>")
		.description("Scaffold a new registry project at <path> (offline)")
		.option("--name <name>", "Registry name (default: directory basename)")
		.option("--author <author>", "Author for the registry manifest")
		.action(async (path: string, opts: Record<string, unknown>, cmd: Command) => {
			await resolveContext(cmd.optsWithGlobals() as GlobalOpts) // configure logging
			const dir = resolve(path)
			const name = (opts.name as string | undefined) ?? basename(dir)
			const author = (opts.author as string | undefined) ?? "you@example.com"

			if (!NAME_RE.test(name)) {
				throw new ValidationError(
					`Invalid registry name "${name}": use lowercase alphanumerics with single hyphens (e.g. my-registry), or pass --name.`,
				)
			}
			if (await pathExists(join(dir, "registry.jsonc"))) {
				throw new ConflictError(`registry.jsonc already exists at ${dir}`)
			}

			const files = starterTemplate({ name, author })
			for (const [rel, content] of Object.entries(files)) {
				await writeFileEnsured(join(dir, rel), content)
			}

			if (isJsonMode()) {
				printJson({ scaffolded: dir, name, files: Object.keys(files) })
				return
			}
			log.success(`Scaffolded registry "${name}" at ${dir}`)
			for (const rel of Object.keys(files)) log.item("+", rel)
			log.info("\nNext steps:")
			log.info(`  1. Edit ${join(name, "registry.jsonc")} and add content under files/`)
			log.info(`  2. pipm build ${path}`)
			log.info(`  3. pipm registry add ${join(path, "registry")} --name ${name}`)
			log.info(`  4. pipm install ${name}/starter`)
		})
}
