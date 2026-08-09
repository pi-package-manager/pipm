/**
 * `pipm build` — resolve a registry.jsonc, vendor every component's source
 * (npm/git/static) into a self-contained, immutable `registry/` folder, hash and
 * pin everything, and emit packuments + index + lockfile.
 *
 * Forked from OCX's lib/build-registry.ts (MIT), extended to actually download
 * and vendor npm tarballs + git repos (OCX only copies local files).
 */

import { readFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { CLI_VERSION, DEFAULT_COMPONENT_VERSION } from "../constants"
import type { LockedComponent, Lockfile } from "../schemas/lockfile"
import {
	type ComponentManifest,
	type ComponentVersion,
	type ResolvedFile,
	registrySchema,
	unsafeTargetReason,
} from "../schemas/registry"
import { BuildError } from "../utils/errors"
import {
	copyPath,
	ensureDir,
	isDirectory,
	listFilesRecursive,
	makeTempDir,
	pathExists,
	readBuffer,
	removePath,
	writeFileEnsured,
} from "../utils/fs"
import { hashBundle, hashContent } from "../utils/hash"
import { parseJsonc } from "../utils/jsonc"
import { log } from "../utils/logger"
import { validatePath } from "../utils/path-security"
import { vendorGit } from "./vendor-git"
import { vendorNpmPlugin, vendorNpmSimple } from "./vendor-npm"
import { vendorStatic } from "./vendor-static"

const CODE_EXT = /\.(ts|js|mjs|cjs)$/

export interface BuildOptions {
	/** Path to the registry.jsonc source file, or its directory. */
	source: string
	/** Output directory (default: <sourceDir>/registry). */
	out?: string
	/** Stamp for the lockfile generatedAt (Date.now() is unavailable in some runtimes). */
	timestamp: string
	dryRun?: boolean
}

export interface BuildResult {
	outDir: string
	lockfilePath: string
	componentCount: number
}

/** Map a component's vendored file rel-paths to profile-root-relative install targets. */
function computeTargets(
	kind: ComponentManifest["type"],
	name: string,
	rels: string[],
): Map<string, string> {
	const map = new Map<string, string>()
	if (kind === "skill") {
		for (const rel of rels) map.set(rel, `skills/${name}/${rel}`)
	} else if (kind === "profile") {
		for (const rel of rels) map.set(rel, rel)
	} else if (kind === "plugin") {
		for (const rel of rels) map.set(rel, `npm/${rel}`)
	} else {
		// extension: single loose code file, or a folder
		const looseCode = rels.length === 1 && CODE_EXT.test(rels[0] ?? "") && !rels[0]?.includes("/")
		if (looseCode) {
			const ext = (rels[0] ?? "").match(CODE_EXT)?.[0] ?? ".ts"
			map.set(rels[0] as string, `extensions/${name}${ext}`)
		} else {
			for (const rel of rels) map.set(rel, `extensions/${name}/${rel}`)
		}
	}
	return map
}

/** Relocate a raw package dir into destDir/node_modules/<pkg> (static/git plugins). */
async function nestPluginPackage(
	rawDir: string,
	destDir: string,
	fallbackName: string,
): Promise<string> {
	let pkgName = fallbackName
	const pkgJsonPath = join(rawDir, "package.json")
	if (await pathExists(pkgJsonPath)) {
		const parsed = JSON.parse(await readFile(pkgJsonPath, "utf-8")) as { name?: string }
		if (parsed.name) pkgName = parsed.name
	}
	await copyPath(rawDir, join(destDir, "node_modules", pkgName))
	return pkgName
}

async function vendorComponent(
	component: ComponentManifest,
	sourceDir: string,
	destDir: string,
): Promise<{ resolved: Record<string, unknown>; primaryPackage?: string }> {
	const { type: kind, source } = component
	await ensureDir(destDir)

	if (kind === "plugin") {
		const vendorDeps = component.vendorDeps ?? "bundle"
		if (source.type === "npm") {
			const { version, primaryPackage } = await vendorNpmPlugin(source, destDir, vendorDeps)
			return {
				resolved: { type: "npm", package: source.package, version, vendorDeps },
				primaryPackage,
			}
		}
		// static / git plugin: vendor raw, then nest under node_modules/<pkg>
		const raw = await makeTempDir("pipm-rawplugin-")
		try {
			let resolved: Record<string, unknown>
			if (source.type === "git") {
				const git = await vendorGit(source, raw)
				resolved = { type: "git", repo: git.repo, ref: git.ref, commit: git.commit }
			} else {
				await vendorStatic(source, sourceDir, raw)
				resolved = { type: "static" }
			}
			const primaryPackage = await nestPluginPackage(raw, destDir, component.name)
			return { resolved, primaryPackage }
		} finally {
			await removePath(raw)
		}
	}

	// skill / extension / profile — vendor content directly into destDir
	if (source.type === "npm") {
		const { version } = await vendorNpmSimple(source, destDir)
		return { resolved: { type: "npm", package: source.package, version } }
	}
	if (source.type === "git") {
		const git = await vendorGit(source, destDir)
		return { resolved: { type: "git", repo: git.repo, ref: git.ref, commit: git.commit } }
	}
	await vendorStatic(source, sourceDir, destDir)
	return { resolved: { type: "static" } }
}

export async function buildRegistry(options: BuildOptions): Promise<BuildResult> {
	// locate registry.jsonc
	const srcArg = resolve(options.source)
	let manifestPath: string
	let sourceDir: string
	if (await isDirectory(srcArg)) {
		sourceDir = srcArg
		manifestPath = join(srcArg, "registry.jsonc")
		if (!(await pathExists(manifestPath))) manifestPath = join(srcArg, "registry.json")
	} else {
		manifestPath = srcArg
		sourceDir = dirname(srcArg)
	}
	if (!(await pathExists(manifestPath))) {
		throw new BuildError(`registry manifest not found at ${manifestPath}`)
	}

	const parsed = registrySchema.safeParse(
		parseJsonc(await readFile(manifestPath, "utf-8"), basename(manifestPath)),
	)
	if (!parsed.success) {
		const issues = parsed.error.issues
			.map((i) => `  • ${i.path.join(".")}: ${i.message}`)
			.join("\n")
		throw new BuildError(`Invalid registry manifest:\n${issues}`)
	}
	const registry = parsed.data
	const outDir = options.out ? resolve(options.out) : join(sourceDir, "registry")

	log.heading(`Building registry "${registry.name}" v${registry.version}`)
	log.debug(`source: ${manifestPath}`)
	log.debug(`out:    ${outDir}`)

	if (options.dryRun) {
		for (const c of registry.components) {
			log.item(c.type, `${c.name}  (source: ${c.source.type})`)
		}
		log.info(`\nDry run — ${registry.components.length} components would be vendored to ${outDir}`)
		return {
			outDir,
			lockfilePath: join(outDir, "pipm-lock.json"),
			componentCount: registry.components.length,
		}
	}

	// fresh output
	await removePath(outDir)
	await ensureDir(join(outDir, "components"))

	const lockComponents: Record<string, LockedComponent> = {}
	const indexComponents: { name: string; type: ComponentManifest["type"]; description: string }[] =
		[]

	for (const component of registry.components) {
		log.step(`vendoring ${component.type} "${component.name}" (${component.source.type})`)
		const destDir = join(outDir, "components", component.name)
		const { resolved, primaryPackage } = await vendorComponent(component, sourceDir, destDir)

		const rels = await listFilesRecursive(destDir)
		if (rels.length === 0) {
			throw new BuildError(`component "${component.name}" vendored zero files`)
		}
		const targets = computeTargets(component.type, component.name, rels)

		const files: ResolvedFile[] = []
		const lockFiles: Record<string, { sha256: string; size: number }> = {}
		const bundleInput: { path: string; content: Buffer }[] = []
		for (const rel of rels) {
			const target = targets.get(rel) as string
			// path-safety: target must be a safe relative path and not protected
			validatePath("/__profile__", target)
			const unsafe = unsafeTargetReason(component.type, target)
			if (unsafe) {
				throw new BuildError(`component "${component.name}": ${unsafe}`)
			}
			const content = await readBuffer(join(destDir, rel))
			const sha256 = hashContent(content)
			files.push({ path: rel, target, sha256, size: content.length })
			lockFiles[rel] = { sha256, size: content.length }
			bundleInput.push({ path: rel, content })
		}

		const contentHash = `sha256:${hashBundle(bundleInput)}`

		const version: ComponentVersion = {
			name: component.name,
			type: component.type,
			description: component.description,
			resolved: resolved as ComponentVersion["resolved"],
			contentHash,
			files,
			dependencies: component.dependencies,
			vendorDeps: component.vendorDeps,
			pi: component.pi,
			primaryPackage,
		}

		const packument = {
			name: component.name,
			"dist-tags": { latest: DEFAULT_COMPONENT_VERSION },
			versions: { [DEFAULT_COMPONENT_VERSION]: version },
		}
		await writeFileEnsured(
			join(outDir, "components", `${component.name}.json`),
			`${JSON.stringify(packument, null, 2)}\n`,
		)

		lockComponents[component.name] = {
			type: component.type,
			source: resolved,
			contentHash,
			files: lockFiles,
			vendorDeps: component.vendorDeps,
			dependencies: component.dependencies,
			primaryPackage,
		}
		indexComponents.push({
			name: component.name,
			type: component.type,
			description: component.description,
		})
	}

	// index.json
	const index = {
		$schema: registry.$schema,
		name: registry.name,
		version: registry.version,
		author: registry.author,
		pi: registry.pi,
		pipm: registry.pipm,
		components: indexComponents,
	}
	await writeFileEnsured(join(outDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`)

	// .well-known discovery
	await writeFileEnsured(
		join(outDir, ".well-known", "pipm.json"),
		`${JSON.stringify({ registry: "/index.json", lockfile: "/pipm-lock.json" }, null, 2)}\n`,
	)

	// lockfile (both in the output and next to the source manifest)
	const lockfile: Lockfile = {
		lockfileVersion: 1,
		registry: { name: registry.name, version: registry.version },
		pipm: CLI_VERSION,
		generatedAt: options.timestamp,
		components: lockComponents,
	}
	const lockText = `${JSON.stringify(lockfile, null, 2)}\n`
	await writeFileEnsured(join(outDir, "pipm-lock.json"), lockText)
	await writeFileEnsured(join(sourceDir, "pipm-lock.json"), lockText)

	log.success(`Built ${registry.components.length} components → ${outDir}`)
	return {
		outDir,
		lockfilePath: join(outDir, "pipm-lock.json"),
		componentCount: registry.components.length,
	}
}
