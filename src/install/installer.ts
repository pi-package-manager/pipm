/**
 * Install a resolved graph of components into a Pi profile directory.
 *
 * Because the registry is pre-vendored, installing is a pure copy: fetch the
 * already-vendored bytes, verify their hashes, write them under the profile
 * root, then apply settings.json side-effects and a receipt. Forked in spirit
 * from OCX's commands/add.ts (MIT) with the runtime-npm-install branch removed.
 */

import { basename, join } from "node:path"
import { RECEIPT_DIR, RECEIPT_FILE } from "../constants"
import type { AuthResolver } from "../registry/auth"
import { fetchFileContent } from "../registry/fetcher"
import type { ResolvedGraph } from "../registry/resolver"
import {
	createCanonicalId,
	type InstalledComponent,
	type Receipt,
	receiptSchema,
} from "../schemas/config"
import { unsafeTargetReason } from "../schemas/registry"
import { IntegrityError, ValidationError } from "../utils/errors"
import {
	ensureDir,
	existsSync,
	pathExists,
	readText,
	removePath,
	writeFileEnsured,
} from "../utils/fs"
import { hashContent } from "../utils/hash"
import { parseJsonc } from "../utils/jsonc"
import { log } from "../utils/logger"
import { validatePath } from "../utils/path-security"
import { type PlannedWrite, registerPlannedWriteOrThrow } from "../utils/planned-writes"
import {
	addPackage,
	ensureNpmProject,
	loadSettings,
	mergeProfileConfig,
	type Settings,
	saveSettings,
} from "./settings"

const INSTRUCTION_TARGETS = new Set(["AGENTS.md", "APPEND_SYSTEM.md"])

function receiptPath(profileRoot: string): string {
	return join(profileRoot, RECEIPT_DIR, RECEIPT_FILE)
}

export async function loadReceipt(
	profileRoot: string,
	piHome: string,
	profile: string,
): Promise<Receipt> {
	const path = receiptPath(profileRoot)
	if (!(await pathExists(path))) {
		return receiptSchema.parse({ version: 1, root: profileRoot, piHome, profile, installed: {} })
	}
	const parsed = receiptSchema.safeParse(parseJsonc(await readText(path), RECEIPT_FILE))
	if (!parsed.success) {
		return receiptSchema.parse({ version: 1, root: profileRoot, piHome, profile, installed: {} })
	}
	return parsed.data
}

async function saveReceipt(profileRoot: string, receipt: Receipt): Promise<void> {
	await writeFileEnsured(receiptPath(profileRoot), `${JSON.stringify(receipt, null, 2)}\n`)
}

export interface InstallResult {
	installed: { name: string; kind: string; files: number }[]
	skipped: string[]
	profileRoot: string
}

/**
 * Install every component in `graph` into `profileRoot`.
 * @param dryRun when true, computes + validates writes but does not touch disk.
 */
export async function installGraph(
	graph: ResolvedGraph,
	opts: {
		profileRoot: string
		piHome: string
		profile: string
		resolveAuth?: AuthResolver
		dryRun?: boolean
	},
): Promise<InstallResult> {
	const { profileRoot, piHome, profile, resolveAuth, dryRun } = opts

	const receipt = await loadReceipt(profileRoot, piHome, profile)
	const settings: Settings = await loadSettings(profileRoot)

	const planned = new Map<string, PlannedWrite>()
	const instructionBuffers = new Map<string, Buffer[]>()
	const newReceiptEntries: Record<string, InstalledComponent> = {}
	const result: InstallResult = { installed: [], skipped: [], profileRoot }

	for (const component of graph.components) {
		const { version } = component
		const hex = version.contentHash.replace(/^sha256:/, "")
		const canonicalId = createCanonicalId(
			component.baseUrl,
			component.registryName,
			version.name,
			hex,
		)

		// idempotency / integrity vs any prior install of the same name
		const priorId = Object.keys(receipt.installed).find((id) => {
			const e = receipt.installed[id]
			return e && e.registryName === component.registryName && e.name === version.name
		})
		if (priorId) {
			if (priorId === canonicalId) {
				result.skipped.push(version.name)
				continue
			}
			// content changed → treat as update: drop stale receipt entry (files re-written below)
			delete receipt.installed[priorId]
		}

		const componentFiles: { path: string; hash: string; shared?: boolean }[] = []
		const addedPackages: string[] = []
		let mergedKeys: string[] = []

		// settings side-effects
		if (version.type === "plugin" && version.primaryPackage) {
			const spec = `npm:${version.primaryPackage}`
			if (addPackage(settings, spec)) addedPackages.push(spec)
		}
		if (version.type === "profile" && version.pi) {
			mergedKeys = mergeProfileConfig(settings, version.pi)
			for (const spec of version.pi.packages ?? []) {
				if (!addedPackages.includes(spec)) addedPackages.push(spec)
			}
		}

		// fetch + plan each file
		for (const file of version.files) {
			const content = await fetchFileContent(
				component.baseUrl,
				version.name,
				file.path,
				resolveAuth?.(component.registryName),
			)
			const gotHash = hashContent(content)
			if (gotHash !== file.sha256) {
				throw new IntegrityError(`${version.name}/${file.path}`, file.sha256, gotHash)
			}

			// path safety
			const absPath = validatePath(profileRoot, file.target)
			const unsafe = unsafeTargetReason(version.type, file.target)
			if (unsafe) {
				throw new ValidationError(`Refusing unsafe target from "${version.name}": ${unsafe}`)
			}

			const targetBase = basename(file.target)
			if (INSTRUCTION_TARGETS.has(file.target) && INSTRUCTION_TARGETS.has(targetBase)) {
				// concatenate instruction files across components (deps first)
				const arr = instructionBuffers.get(absPath) ?? []
				arr.push(content)
				instructionBuffers.set(absPath, arr)
				componentFiles.push({ path: file.target, hash: gotHash, shared: true })
				continue
			}

			registerPlannedWriteOrThrow(planned, {
				absolutePath: absPath,
				relativePath: file.target,
				content,
				source: version.name,
			})
			componentFiles.push({ path: file.target, hash: gotHash })
		}

		newReceiptEntries[canonicalId] = {
			registryUrl: component.baseUrl,
			registryName: component.registryName,
			name: version.name,
			kind: version.type,
			revision: version.contentHash,
			hash: hex,
			files: componentFiles,
			settings: { packages: addedPackages, mergedKeys },
			installedAt: new Date().toISOString(),
			updatedAt: null,
		}
		result.installed.push({ name: version.name, kind: version.type, files: componentFiles.length })
	}

	// merge instruction buffers into single planned writes
	for (const [absPath, buffers] of instructionBuffers) {
		const joined = Buffer.concat(
			buffers.flatMap((b, i) => (i === 0 ? [b] : [Buffer.from("\n\n"), b])),
		)
		planned.set(absPath, {
			absolutePath: absPath,
			relativePath: absPath,
			content: joined,
			source: "instructions",
		})
	}

	if (dryRun) {
		for (const w of planned.values()) log.item("write", w.relativePath)
		log.info(`\nDry run — ${planned.size} files, ${result.installed.length} components`)
		return result
	}

	// ── write with rollback ───────────────────────────────────────────────────
	const backups = new Map<string, Buffer | null>() // absPath -> previous bytes (null = new file)
	const written: string[] = []
	try {
		for (const w of planned.values()) {
			backups.set(
				w.absolutePath,
				existsSync(w.absolutePath)
					? await Bun.file(w.absolutePath).bytes().then(Buffer.from)
					: null,
			)
			await ensureDir(join(w.absolutePath, ".."))
			await writeFileEnsured(w.absolutePath, w.content)
			written.push(w.absolutePath)
		}

		await ensureNpmProject(profileRoot)
		await saveSettings(profileRoot, settings)

		for (const [id, entry] of Object.entries(newReceiptEntries)) receipt.installed[id] = entry
		await saveReceipt(profileRoot, receipt)
	} catch (err) {
		log.error("Install failed, rolling back…")
		for (const p of written) {
			const prev = backups.get(p)
			if (prev === null || prev === undefined) await removePath(p)
			else await writeFileEnsured(p, prev)
		}
		throw err
	}

	return result
}
