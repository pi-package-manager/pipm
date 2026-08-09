/**
 * Minimal logger + spinner with a global quiet/verbose/json mode.
 * Adapted from OCX (MIT).
 */

import { blue, bold, cyan, dim, green, red, yellow } from "kleur/colors"

interface LoggerState {
	quiet: boolean
	verbose: boolean
	json: boolean
}

const state: LoggerState = { quiet: false, verbose: false, json: false }

export function configureLogger(opts: Partial<LoggerState>): void {
	Object.assign(state, opts)
}

export function isJsonMode(): boolean {
	return state.json
}

function out(msg: string): void {
	if (state.quiet || state.json) return
	process.stderr.write(`${msg}\n`)
}

export const log = {
	info: (msg: string) => out(msg),
	success: (msg: string) => out(`${green("✓")} ${msg}`),
	warn: (msg: string) => out(`${yellow("!")} ${msg}`),
	error: (msg: string) => process.stderr.write(`${red("✗")} ${msg}\n`),
	step: (msg: string) => out(`${cyan("›")} ${msg}`),
	debug: (msg: string) => {
		if (state.verbose && !state.json) process.stderr.write(`${dim(`  ${msg}`)}\n`)
	},
	heading: (msg: string) => out(bold(msg)),
	item: (label: string, value: string) => out(`  ${blue(label)} ${value}`),
}

/** Print a machine-readable JSON payload to stdout (json mode only). */
export function printJson(payload: unknown): void {
	process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
}
