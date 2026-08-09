/**
 * Commander program construction + command registration.
 * Forked from OCX's cli/bootstrap.ts (MIT).
 */

import { Command } from "commander"
import { registerBuildCommand } from "../commands/build"
import { registerInitCommand } from "../commands/init"
import { registerAddCommand, registerInstallCommand } from "../commands/install"
import {
	registerListCommand,
	registerRemoveCommand,
	registerSearchCommand,
	registerVerifyCommand,
} from "../commands/manage"
import { registerRegistryCommand } from "../commands/registry"
import { CLI_VERSION } from "../constants"

export function buildProgram(): Command {
	const program = new Command()

	program
		.name("pipm")
		.description("pipm — Pi Package Manager. Immutable, OCX-style registries for Pi.")
		.version(CLI_VERSION, "-V, --version", "Print the pipm version")
		// global options (inherited by subcommands via optsWithGlobals())
		.option(
			"--pi-home <path>",
			"Path to the Pi home (default: $PI_HOME or ~/.pi); installs into <pi-home>/agent",
		)
		.option("--json", "Machine-readable JSON output")
		.option("--dry-run", "Compute changes without writing")
		.option("-q, --quiet", "Suppress non-error logs")
		.option("-v, --verbose", "Verbose logging")

	registerInitCommand(program)
	registerRegistryCommand(program)
	registerBuildCommand(program)
	registerInstallCommand(program)
	registerAddCommand(program)
	registerRemoveCommand(program)
	registerVerifyCommand(program)
	registerListCommand(program)
	registerSearchCommand(program)

	return program
}
