/**
 * Receipt-driven management: verify, remove, list installed components.
 */

import { join } from "node:path"
import { RECEIPT_DIR, RECEIPT_FILE } from "../constants"
import type { InstalledComponent, Receipt } from "../schemas/config"
import { receiptSchema } from "../schemas/config"
import { NotFoundError } from "../utils/errors"
import { pathExists, readText, removePath, writeFileEnsured } from "../utils/fs"
import { hashContent } from "../utils/hash"
import { parseJsonc } from "../utils/jsonc"
import { loadSettings, removePackage, saveSettings } from "./settings"

function receiptPath(profileRoot: string): string {
	return join(profileRoot, RECEIPT_DIR, RECEIPT_FILE)
}

export async function readReceipt(profileRoot: string): Promise<Receipt | null> {
	const path = receiptPath(profileRoot)
	if (!(await pathExists(path))) return null
	const parsed = receiptSchema.safeParse(parseJsonc(await readText(path), RECEIPT_FILE))
	return parsed.success ? parsed.data : null
}

async function writeReceipt(profileRoot: string, receipt: Receipt): Promise<void> {
	await writeFileEnsured(receiptPath(profileRoot), `${JSON.stringify(receipt, null, 2)}\n`)
}

export interface VerifyReport {
	name: string
	intact: boolean
	modified: string[]
	missing: string[]
}

export async function verifyComponents(
	profileRoot: string,
	names?: string[],
): Promise<VerifyReport[]> {
	const receipt = await readReceipt(profileRoot)
	if (!receipt) return []
	const reports: VerifyReport[] = []
	for (const entry of Object.values(receipt.installed)) {
		if (names && names.length > 0 && !names.includes(entry.name)) continue
		const modified: string[] = []
		const missing: string[] = []
		for (const file of entry.files) {
			const abs = join(profileRoot, file.path)
			if (!(await pathExists(abs))) {
				missing.push(file.path)
				continue
			}
			// shared instruction files (concatenated) are checked for existence only
			if (file.shared) continue
			if (hashContent(await readText(abs)) !== file.hash) modified.push(file.path)
		}
		reports.push({
			name: entry.name,
			intact: modified.length === 0 && missing.length === 0,
			modified,
			missing,
		})
	}
	return reports
}

export async function listInstalled(profileRoot: string): Promise<InstalledComponent[]> {
	const receipt = await readReceipt(profileRoot)
	return receipt ? Object.values(receipt.installed) : []
}

export async function removeComponents(profileRoot: string, names: string[]): Promise<string[]> {
	const receipt = await readReceipt(profileRoot)
	if (!receipt) throw new NotFoundError(`No pipm receipt in ${profileRoot}`)

	const settings = await loadSettings(profileRoot)
	const removed: string[] = []

	for (const name of names) {
		const id = Object.keys(receipt.installed).find((k) => receipt.installed[k]?.name === name)
		if (!id) throw new NotFoundError(`Component "${name}" is not installed in this profile.`)
		const entry = receipt.installed[id] as InstalledComponent

		for (const file of entry.files) {
			// leave shared instruction files (other components may contribute to them)
			if (file.shared) continue
			await removePath(join(profileRoot, file.path))
		}
		// reverse additive settings changes (packages only — scalar keys may be shared)
		for (const spec of entry.settings.packages) removePackage(settings, spec)

		delete receipt.installed[id]
		removed.push(name)
	}

	await saveSettings(profileRoot, settings)
	await writeReceipt(profileRoot, receipt)
	return removed
}
