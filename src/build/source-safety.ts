/**
 * Build-time input hardening for untrusted registry.jsonc specs.
 *
 * `pipm build` may run on a spec you didn't author, so git/static source inputs
 * are treated as untrusted: git repos/refs are scheme-allowlisted and can't
 * inject options or transport helpers (e.g. `ext::sh -c …` → RCE), and all
 * filesystem paths are confined to their intended root.
 */

import { BuildError } from "../utils/errors"
import { validatePath } from "../utils/path-security"

const ALLOWED_GIT_SCHEMES = new Set(["https", "http", "git", "ssh"])

/** Flags prepended to every git invocation — disable the `ext`/`file` transports (RCE/disclosure). */
export const GIT_SAFE_FLAGS = ["-c", "protocol.ext.allow=never", "-c", "protocol.file.allow=user"]

function hasControlChars(s: string, includeSpace = false): boolean {
	for (let i = 0; i < s.length; i++) {
		const code = s.charCodeAt(i)
		if (code < 0x20 || code === 0x7f || (includeSpace && code === 0x20)) return true
	}
	return false
}

/** Reject option-injection, transport helpers, and non-allowlisted schemes in a git repo URL. */
export function assertSafeGitRepo(repo: string): void {
	if (!repo || repo.startsWith("-")) {
		throw new BuildError(`unsafe git repo (looks like an option): "${repo}"`)
	}
	if (hasControlChars(repo)) {
		throw new BuildError("git repo contains control characters")
	}
	// `ext::`, `file::`, and other `<helper>::` transport forms enable code execution / disclosure
	if (repo.includes("::")) {
		throw new BuildError(`git transport helpers (e.g. "ext::") are not allowed: "${repo}"`)
	}
	const scheme = repo.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//)
	if (scheme) {
		const name = (scheme[1] ?? "").toLowerCase()
		if (!ALLOWED_GIT_SCHEMES.has(name)) {
			throw new BuildError(
				`git repo scheme "${name}" is not allowed (use https/ssh/git): "${repo}"`,
			)
		}
	}
	// otherwise: scp-like ssh ("git@host:path") or a local path on the builder's own disk
}

/** Reject option-injection and whitespace/control characters in a git ref. */
export function assertSafeGitRef(ref: string): void {
	if (ref.startsWith("-")) {
		throw new BuildError(`unsafe git ref (looks like an option): "${ref}"`)
	}
	if (hasControlChars(ref, true)) {
		throw new BuildError("git ref contains whitespace or control characters")
	}
}

/** Ensure `rel` stays within `base` (no traversal / absolute escape). */
export function assertContained(base: string, rel: string, what = "path"): void {
	try {
		validatePath(base, rel)
	} catch {
		throw new BuildError(`unsafe ${what} "${rel}" — escapes its root`)
	}
}
