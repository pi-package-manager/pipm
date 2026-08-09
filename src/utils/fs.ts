/**
 * Filesystem helpers built on node:fs/promises + Bun.
 */

import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import {
	cp,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"

export { existsSync }

export async function ensureDir(dir: string): Promise<void> {
	await mkdir(dir, { recursive: true })
}

export async function writeFileEnsured(path: string, content: Buffer | string): Promise<void> {
	await ensureDir(dirname(path))
	await writeFile(path, content)
}

export async function readBuffer(path: string): Promise<Buffer> {
	return readFile(path)
}

export async function readText(path: string): Promise<string> {
	return readFile(path, "utf-8")
}

export async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path)
		return true
	} catch {
		return false
	}
}

export async function isDirectory(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory()
	} catch {
		return false
	}
}

export async function copyPath(src: string, dest: string): Promise<void> {
	await ensureDir(dirname(dest))
	await cp(src, dest, { recursive: true })
}

export async function removePath(path: string): Promise<void> {
	await rm(path, { recursive: true, force: true })
}

export async function renamePath(src: string, dest: string): Promise<void> {
	await rename(src, dest)
}

export async function makeTempDir(prefix: string): Promise<string> {
	return mkdtemp(join(tmpdir(), prefix))
}

/** Recursively list files under `dir`, returning paths relative to `dir` (posix separators). */
export async function listFilesRecursive(dir: string): Promise<string[]> {
	const out: string[] = []
	async function walk(current: string): Promise<void> {
		const entries = await readdir(current, { withFileTypes: true })
		for (const entry of entries) {
			const abs = join(current, entry.name)
			if (entry.isDirectory()) {
				await walk(abs)
			} else if (entry.isFile() || entry.isSymbolicLink()) {
				out.push(relative(dir, abs).split("\\").join("/"))
			}
		}
	}
	if (await isDirectory(dir)) await walk(dir)
	return out.sort()
}

export function sha256File(content: Buffer | string): string {
	return createHash("sha256").update(content).digest("hex")
}
