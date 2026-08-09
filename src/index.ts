#!/usr/bin/env bun
/**
 * pipm CLI entrypoint.
 */

import { buildProgram } from "./cli/bootstrap"
import { PipmError } from "./utils/errors"
import { log } from "./utils/logger"

async function main(): Promise<void> {
	const program = buildProgram()
	try {
		await program.parseAsync(process.argv)
	} catch (err) {
		if (err instanceof PipmError) {
			log.error(err.message)
			process.exit(err.exitCode)
		}
		log.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
		process.exit(1)
	}
}

await main()
