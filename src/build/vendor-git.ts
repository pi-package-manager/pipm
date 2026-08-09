/**
 * Vendor files from a git repository, pinned to a resolved commit SHA.
 * Mirrors Pi's own git clone/rev-parse approach (spawn git, no extra dep).
 */

import { join } from "node:path"
import type { z } from "zod"
import type { gitSourceSchema } from "../schemas/registry"
import { BuildError } from "../utils/errors"
import {
	copyPath,
	isDirectory,
	listFilesRecursive,
	makeTempDir,
	pathExists,
	removePath,
} from "../utils/fs"
import { hasCommand, run, runOrThrow } from "./exec"
import { copyIncluded } from "./vendor-common"

type GitSource = z.infer<typeof gitSourceSchema>

export interface GitVendorResult {
	commit: string
	repo: string
	ref?: string
}

/**
 * Clone `source.repo` at `source.ref`, copy `subpath`/`include` into `destDir`,
 * and return the pinned commit SHA.
 */
export async function vendorGit(source: GitSource, destDir: string): Promise<GitVendorResult> {
	if (!(await hasCommand("git"))) {
		throw new BuildError("`git` is required to vendor git sources but was not found on PATH.")
	}

	const tmp = await makeTempDir("pipm-git-")
	try {
		const ref = source.ref
		let cloned = false
		if (ref) {
			const shallow = await run(["git", "clone", "--depth", "1", "--branch", ref, source.repo, tmp])
			cloned = shallow.code === 0
		}
		if (!cloned) {
			// full clone + checkout (handles arbitrary commit SHAs and default branch)
			await removePath(tmp)
			await runOrThrow(["git", "clone", source.repo, tmp])
			if (ref) await runOrThrow(["git", "checkout", ref], { cwd: tmp })
		}

		const revParse = await runOrThrow(["git", "rev-parse", "HEAD"], { cwd: tmp })
		const commit = revParse.stdout.trim()

		// remove the .git directory so it is never vendored
		await removePath(join(tmp, ".git"))

		const srcRoot = source.subpath ? join(tmp, source.subpath) : tmp
		if (!(await pathExists(srcRoot))) {
			throw new BuildError(`git subpath "${source.subpath}" not found in ${source.repo}`)
		}

		if (source.include && source.include.length > 0) {
			await copyIncluded(srcRoot, destDir, source.include)
		} else if (await isDirectory(srcRoot)) {
			for (const rel of await listFilesRecursive(srcRoot)) {
				await copyPath(join(srcRoot, rel), join(destDir, rel))
			}
		} else {
			// single file subpath
			const base = source.subpath ? (source.subpath.split("/").pop() ?? "file") : "file"
			await copyPath(srcRoot, join(destDir, base))
		}

		return { commit, repo: source.repo, ref: source.ref }
	} finally {
		await removePath(tmp)
	}
}
