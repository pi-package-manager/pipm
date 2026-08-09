/**
 * Vendor files from npm. Two modes:
 *  - vendorNpmSimple: download the package tarball, verify integrity, extract,
 *    and copy the requested subpath/globs (used for skill/extension sources).
 *  - vendorNpmPlugin: produce a full, offline-installable node_modules tree for
 *    a plugin. In "bundle" mode this runs `npm install` to capture the plugin +
 *    its production dependency tree; in "defer" mode it vendors just the package.
 *
 * Extends OCX's npm-registry approach (MIT) to actually download + vendor bytes.
 */

import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import semver from "semver"
import type { z } from "zod"
import { NPM_REGISTRY_BASE } from "../constants"
import type { npmSourceSchema } from "../schemas/registry"
import { BuildError, NetworkError } from "../utils/errors"
import {
	copyPath,
	ensureDir,
	isDirectory,
	listFilesRecursive,
	makeTempDir,
	pathExists,
	removePath,
} from "../utils/fs"
import { sriSha512 } from "../utils/hash"
import { hasCommand, runOrThrow } from "./exec"
import { copyIncluded } from "./vendor-common"

type NpmSource = z.infer<typeof npmSourceSchema>

interface NpmDist {
	tarball: string
	integrity?: string
	shasum?: string
}
interface NpmVersionMeta {
	version: string
	dist: NpmDist
}
interface NpmPackument {
	name: string
	"dist-tags"?: Record<string, string>
	versions: Record<string, NpmVersionMeta>
}

function encodeNpmName(pkg: string): string {
	return pkg.startsWith("@") ? pkg.replace("/", "%2f") : pkg
}

async function fetchPackument(pkg: string): Promise<NpmPackument> {
	const url = `${NPM_REGISTRY_BASE}/${encodeNpmName(pkg)}`
	let res: Response
	try {
		res = await fetch(url, { headers: { Accept: "application/json" } })
	} catch (err) {
		throw new NetworkError(
			`Failed to reach npm for "${pkg}": ${err instanceof Error ? err.message : String(err)}`,
			url,
		)
	}
	if (res.status === 404) throw new BuildError(`npm package "${pkg}" not found.`)
	if (!res.ok)
		throw new NetworkError(`npm request failed (${res.status}) for "${pkg}"`, url, res.status)
	return (await res.json()) as NpmPackument
}

function pickVersion(packument: NpmPackument, range?: string): NpmVersionMeta {
	const all = Object.keys(packument.versions)
	const distTags = packument["dist-tags"] ?? {}
	const tagged = range ? distTags[range] : undefined
	let chosen: string | null
	if (!range) {
		chosen = distTags.latest ?? semver.maxSatisfying(all, "*")
	} else if (tagged) {
		// an npm dist-tag ("latest", "next", …) → resolve to its concrete version
		chosen = tagged
	} else if (semver.valid(range)) {
		chosen = range
	} else {
		chosen = semver.maxSatisfying(all, range)
	}
	const meta = chosen ? packument.versions[chosen] : undefined
	if (!meta) {
		throw new BuildError(`No version of "${packument.name}" satisfies "${range ?? "latest"}".`)
	}
	return meta
}

async function downloadAndVerify(meta: NpmVersionMeta): Promise<Buffer> {
	let res: Response
	try {
		res = await fetch(meta.dist.tarball)
	} catch (err) {
		throw new NetworkError(
			`Failed to download tarball: ${err instanceof Error ? err.message : String(err)}`,
			meta.dist.tarball,
		)
	}
	if (!res.ok)
		throw new NetworkError(`Tarball download failed (${res.status})`, meta.dist.tarball, res.status)
	const buf = Buffer.from(await res.arrayBuffer())
	if (meta.dist.integrity) {
		const expected = meta.dist.integrity.split(/\s+/)[0] ?? meta.dist.integrity
		if (expected.startsWith("sha512-")) {
			const actual = sriSha512(buf)
			if (actual !== expected) {
				throw new BuildError(
					`Integrity mismatch for tarball ${meta.dist.tarball}\n  expected ${expected}\n  actual   ${actual}`,
				)
			}
		}
	}
	return buf
}

async function extractTarball(buf: Buffer): Promise<string> {
	if (!(await hasCommand("tar"))) {
		throw new BuildError("`tar` is required to extract npm tarballs but was not found on PATH.")
	}
	const tmp = await makeTempDir("pipm-npm-")
	const tarPath = join(tmp, "pkg.tgz")
	await writeFile(tarPath, buf)
	const outDir = join(tmp, "out")
	await ensureDir(outDir)
	// npm tarballs wrap everything in a top-level "package/" dir → strip it
	await runOrThrow(["tar", "-xzf", tarPath, "-C", outDir, "--strip-components=1"])
	return outDir
}

/** Vendor selected files from an npm package (skill/extension sources). */
export async function vendorNpmSimple(
	source: NpmSource,
	destDir: string,
): Promise<{ version: string }> {
	const packument = await fetchPackument(source.package)
	const meta = pickVersion(packument, source.version)
	const buf = await downloadAndVerify(meta)
	const extracted = await extractTarball(buf)
	try {
		const srcRoot = source.subpath ? join(extracted, source.subpath) : extracted
		if (!(await pathExists(srcRoot))) {
			throw new BuildError(`npm subpath "${source.subpath}" not found in ${source.package}`)
		}
		if (source.include && source.include.length > 0) {
			await copyIncluded(srcRoot, destDir, source.include)
		} else if (await isDirectory(srcRoot)) {
			for (const rel of await listFilesRecursive(srcRoot)) {
				await copyPath(join(srcRoot, rel), join(destDir, rel))
			}
		} else {
			await copyPath(srcRoot, join(destDir, source.subpath?.split("/").pop() ?? "file"))
		}
		return { version: meta.version }
	} finally {
		// extracted lives under a temp dir; clean its parent
		await removePath(join(extracted, ".."))
	}
}

/**
 * Vendor a plugin as an offline node_modules tree under `destDir/node_modules`.
 * Returns the resolved version and the primary package name.
 */
export async function vendorNpmPlugin(
	source: NpmSource,
	destDir: string,
	vendorDeps: "bundle" | "defer",
): Promise<{ version: string; primaryPackage: string }> {
	const nodeModules = join(destDir, "node_modules")
	await ensureDir(nodeModules)

	if (vendorDeps === "defer") {
		// just the package itself, no transitive deps
		const packument = await fetchPackument(source.package)
		const meta = pickVersion(packument, source.version)
		const buf = await downloadAndVerify(meta)
		const extracted = await extractTarball(buf)
		try {
			await copyPath(extracted, join(nodeModules, source.package))
			return { version: meta.version, primaryPackage: source.package }
		} finally {
			await removePath(join(extracted, ".."))
		}
	}

	// bundle mode: install the full production tree with npm
	if (!(await hasCommand("npm"))) {
		throw new BuildError(
			"`npm` is required to vendor plugin dependency trees (vendorDeps: bundle).",
		)
	}
	const spec = source.version ? `${source.package}@${source.version}` : source.package
	const tmp = await makeTempDir("pipm-plugin-")
	try {
		await writeFile(
			join(tmp, "package.json"),
			JSON.stringify({ name: "pipm-vendor", private: true }),
		)
		await runOrThrow(
			[
				"npm",
				"install",
				spec,
				"--prefix",
				tmp,
				"--omit=dev",
				"--legacy-peer-deps",
				"--ignore-scripts",
				"--no-audit",
				"--no-fund",
				"--no-package-lock",
			],
			{ cwd: tmp },
		)
		const installedModules = join(tmp, "node_modules")
		if (!(await isDirectory(installedModules))) {
			throw new BuildError(`npm install produced no node_modules for "${spec}"`)
		}
		// copy the whole hoisted tree (primary + production deps)
		for (const rel of await listFilesRecursive(installedModules)) {
			await copyPath(join(installedModules, rel), join(nodeModules, rel))
		}
		const pkgJsonPath = join(nodeModules, source.package, "package.json")
		let version = source.version ?? "unknown"
		if (await pathExists(pkgJsonPath)) {
			version =
				(JSON.parse(await readFile(pkgJsonPath, "utf-8")) as { version?: string }).version ??
				version
		}
		return { version, primaryPackage: source.package }
	} finally {
		await removePath(tmp)
	}
}
