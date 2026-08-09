/**
 * Vendor files from the local `files/` directory (static source).
 */

import { basename, join } from "node:path"
import type { z } from "zod"
import { normalizeFile, type staticSourceSchema } from "../schemas/registry"
import { BuildError } from "../utils/errors"
import { copyPath, pathExists } from "../utils/fs"

type StaticSource = z.infer<typeof staticSourceSchema>

/**
 * Copy each declared file from `<sourceDir>/files/<path>` into `destDir` at
 * `target` (default = basename). Returns the relative paths written.
 */
export async function vendorStatic(
	source: StaticSource,
	sourceDir: string,
	destDir: string,
): Promise<string[]> {
	const filesRoot = join(sourceDir, "files")
	const written: string[] = []
	for (const file of source.files) {
		const { path } = normalizeFile(file)
		const explicitTarget = typeof file === "string" ? undefined : file.target
		const rel = explicitTarget ?? basename(path)
		const abs = join(filesRoot, path)
		if (!(await pathExists(abs))) {
			throw new BuildError(`static file not found: files/${path}`)
		}
		await copyPath(abs, join(destDir, rel))
		written.push(rel)
	}
	return written
}
