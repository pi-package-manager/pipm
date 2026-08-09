/**
 * Pi-home + agent-dir resolution and pipm.jsonc / machine-config I/O.
 *
 * Pi-home precedence: --pi-home flag > PI_HOME env > machine config piHome
 * > ~/.pi. pipm always installs into <pi-home>/agent — the exact directory Pi
 * loads (Pi's default agent dir is ~/.pi/agent). Run it via
 *   PI_CODING_AGENT_DIR=<pi-home>/agent pi   (or just `pi` when pi-home is ~/.pi).
 */

import { homedir } from "node:os"
import { join } from "node:path"
import {
	AGENT_PROFILE_NAME,
	CONFIG_FILENAME,
	CONFIG_SCHEMA_URL,
	DEFAULT_PI_HOME_DIRNAME,
	ENV_PI_HOME,
} from "../constants"
import {
	type MachineConfig,
	machineConfigSchema,
	type PipmConfig,
	pipmConfigSchema,
} from "../schemas/config"
import { ConfigError } from "../utils/errors"
import { ensureDir, pathExists, readText, writeFileEnsured } from "../utils/fs"
import { parseJsonc } from "../utils/jsonc"

export function expandTilde(p: string): string {
	if (p === "~") return homedir()
	if (p.startsWith("~/")) return join(homedir(), p.slice(2))
	return p
}

function machineConfigPath(): string {
	const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
	return join(base, "pipm", "config.jsonc")
}

export async function loadMachineConfig(): Promise<MachineConfig> {
	const path = machineConfigPath()
	if (!(await pathExists(path))) return { piHome: undefined }
	const parsed = machineConfigSchema.safeParse(parseJsonc(await readText(path), "config.jsonc"))
	if (!parsed.success) throw new ConfigError(`Invalid machine config at ${path}`)
	return parsed.data
}

export async function resolvePiHome(flag?: string): Promise<string> {
	if (flag) return expandTilde(flag)
	if (process.env[ENV_PI_HOME]) return expandTilde(process.env[ENV_PI_HOME] as string)
	const machine = await loadMachineConfig()
	if (machine.piHome) return expandTilde(machine.piHome)
	return join(homedir(), DEFAULT_PI_HOME_DIRNAME)
}

/** The single Pi agent directory pipm owns and installs into. */
export function resolveAgentDir(piHome: string): string {
	return join(piHome, AGENT_PROFILE_NAME)
}

export function configPath(piHome: string): string {
	return join(piHome, CONFIG_FILENAME)
}

export async function loadPipmConfig(piHome: string): Promise<PipmConfig> {
	const path = configPath(piHome)
	if (!(await pathExists(path))) {
		return pipmConfigSchema.parse({ $schema: CONFIG_SCHEMA_URL, registries: {} })
	}
	const parsed = pipmConfigSchema.safeParse(parseJsonc(await readText(path), CONFIG_FILENAME))
	if (!parsed.success) {
		throw new ConfigError(`Invalid ${CONFIG_FILENAME}: ${parsed.error.issues[0]?.message}`)
	}
	return parsed.data
}

export async function savePipmConfig(piHome: string, config: PipmConfig): Promise<void> {
	await ensureDir(piHome)
	if (!config.$schema) config.$schema = CONFIG_SCHEMA_URL
	await writeFileEnsured(configPath(piHome), `${JSON.stringify(config, null, 2)}\n`)
}
