/**
 * settings.json read / merge / write for a Pi profile directory, plus the
 * npm/package.json bootstrap Pi expects. The pipm analog of OCX's
 * updateOpencodeJsonConfig + registry/merge.
 */

import { join } from "node:path"
import type { PiProfileConfig } from "../schemas/registry"
import { pathExists, readText, writeFileEnsured } from "../utils/fs"
import { parseJsonc } from "../utils/jsonc"

export type Settings = Record<string, unknown> & { packages?: string[]; theme?: string }

export function settingsPath(profileRoot: string): string {
	return join(profileRoot, "settings.json")
}

export async function loadSettings(profileRoot: string): Promise<Settings> {
	const path = settingsPath(profileRoot)
	if (!(await pathExists(path))) return {}
	return parseJsonc<Settings>(await readText(path), "settings.json")
}

export async function saveSettings(profileRoot: string, settings: Settings): Promise<void> {
	await writeFileEnsured(settingsPath(profileRoot), `${JSON.stringify(settings, null, 2)}\n`)
}

/** Add an "npm:<pkg>" entry to settings.packages if absent. Returns true if added. */
export function addPackage(settings: Settings, spec: string): boolean {
	if (!settings.packages) settings.packages = []
	if (settings.packages.includes(spec)) return false
	settings.packages.push(spec)
	return true
}

export function removePackage(settings: Settings, spec: string): void {
	if (!settings.packages) return
	settings.packages = settings.packages.filter((p) => p !== spec)
}

/**
 * Merge a profile `pi` config block into settings. Unions `packages`, assigns
 * every other key (child/root wins). Returns the scalar keys that were set.
 */
export function mergeProfileConfig(settings: Settings, pi: PiProfileConfig): string[] {
	const setKeys: string[] = []
	for (const [key, value] of Object.entries(pi)) {
		if (key === "packages") {
			for (const spec of (value as string[]) ?? []) addPackage(settings, spec)
			continue
		}
		settings[key] = value
		setKeys.push(key)
	}
	return setKeys
}

/** Ensure <profileRoot>/npm/package.json exists (Pi requires it for npm packages). */
export async function ensureNpmProject(profileRoot: string): Promise<void> {
	const pkgPath = join(profileRoot, "npm", "package.json")
	if (await pathExists(pkgPath)) return
	await writeFileEnsured(
		pkgPath,
		`${JSON.stringify({ name: "pi-extensions", private: true }, null, 2)}\n`,
	)
}
