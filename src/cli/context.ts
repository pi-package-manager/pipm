/**
 * Shared CLI context: resolve pi-home, load pipm.jsonc, and configure logging
 * from global flags. pipm always targets <pi-home>/agent (see pi-home.ts).
 */

import { loadPipmConfig, resolveAgentDir, resolvePiHome } from "../install/pi-home"
import { setInsecureTls } from "../registry/fetcher"
import type { PipmConfig } from "../schemas/config"
import { configureLogger } from "../utils/logger"

export interface GlobalOpts {
	piHome?: string
	json?: boolean
	dryRun?: boolean
	quiet?: boolean
	verbose?: boolean
	insecureSkipTlsVerify?: boolean
}

export interface Context {
	piHome: string
	/** The agent directory pipm installs into: <pi-home>/agent. */
	agentDir: string
	config: PipmConfig
	json: boolean
	dryRun: boolean
}

export async function resolveContext(opts: GlobalOpts): Promise<Context> {
	configureLogger({
		json: Boolean(opts.json),
		quiet: Boolean(opts.quiet),
		verbose: Boolean(opts.verbose),
	})
	if (opts.insecureSkipTlsVerify) setInsecureTls(true)

	const piHome = await resolvePiHome(opts.piHome)
	const config = await loadPipmConfig(piHome)
	return {
		piHome,
		agentDir: resolveAgentDir(piHome),
		config,
		json: Boolean(opts.json),
		dryRun: Boolean(opts.dryRun),
	}
}
