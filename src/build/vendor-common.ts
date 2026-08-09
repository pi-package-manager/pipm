/**
 * Shared vendoring helpers (glob include filtering).
 */

import { join } from "node:path"
import { Glob } from "bun"
import { copyPath, listFilesRecursive } from "../utils/fs"

/** Copy every file under `srcRoot` matching any of the `include` globs into `destDir`. */
export async function copyIncluded(
	srcRoot: string,
	destDir: string,
	include: string[],
): Promise<void> {
	const all = await listFilesRecursive(srcRoot)
	const globs = include.map((g) => new Glob(g))
	for (const rel of all) {
		if (globs.some((g) => g.match(rel))) {
			await copyPath(join(srcRoot, rel), join(destDir, rel))
		}
	}
}
