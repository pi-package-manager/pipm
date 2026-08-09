/**
 * Hashing helpers — SHA-256 content addressing + deterministic bundle hashing.
 * Adapted from OCX (MIT).
 */

import { createHash } from "node:crypto"

/** SHA-256 hex digest of a string or buffer. */
export function hashContent(content: string | Buffer | Uint8Array): string {
	return createHash("sha256").update(content).digest("hex")
}

/** SHA-512 base64 digest, formatted as an SRI string (sha512-<base64>). */
export function sriSha512(content: Buffer | Uint8Array): string {
	const digest = createHash("sha512").update(content).digest("base64")
	return `sha512-${digest}`
}

/**
 * Deterministic Merkle-ish digest over a set of files.
 * Files are sorted by path; the digest is over "<path>:<sha256>" lines.
 */
export function hashBundle(files: { path: string; content: Buffer | Uint8Array }[]): string {
	const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path))
	const manifestParts = sorted.map((f) => `${f.path}:${hashContent(f.content)}`)
	return hashContent(manifestParts.join("\n"))
}
