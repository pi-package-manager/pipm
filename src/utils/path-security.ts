import * as path from "node:path"

/**
 * Path traversal / containment validation.
 * Copied near-verbatim from OCX (MIT), which adapted it from
 * Vercel Turborepo + pillarjs/resolve-path + Docker safepath.
 */

export class PathValidationError extends Error {
	constructor(
		message: string,
		public readonly attemptedPath: string,
		public readonly reason: string,
	) {
		super(message)
		this.name = "PathValidationError"
	}
}

const WINDOWS_RESERVED = new Set([
	"CON",
	"PRN",
	"AUX",
	"NUL",
	"COM1",
	"COM2",
	"COM3",
	"COM4",
	"COM5",
	"COM6",
	"COM7",
	"COM8",
	"COM9",
	"LPT1",
	"LPT2",
	"LPT3",
	"LPT4",
	"LPT5",
	"LPT6",
	"LPT7",
	"LPT8",
	"LPT9",
])

/**
 * Validate that `userPath` is a safe relative path within `basePath`.
 * @returns the resolved absolute path
 * @throws {PathValidationError} when unsafe
 */
export function validatePath(basePath: string, userPath: string): string {
	if (userPath.includes("\0")) {
		throw new PathValidationError("Path contains null bytes", userPath, "null_byte")
	}
	if (path.isAbsolute(userPath) || path.win32.isAbsolute(userPath)) {
		throw new PathValidationError("Path must be relative", userPath, "absolute_path")
	}
	if (/^[a-zA-Z]:/.test(userPath) || userPath.startsWith("\\\\")) {
		throw new PathValidationError("Path contains Windows absolute", userPath, "windows_absolute")
	}
	const baseName = path.basename(userPath).toUpperCase().split(".")[0] ?? ""
	if (WINDOWS_RESERVED.has(baseName)) {
		throw new PathValidationError("Path uses Windows reserved name", userPath, "windows_reserved")
	}
	const normalized = userPath.normalize("NFC")
	const unified = normalized.replace(/\\/g, "/")
	const resolvedBase = path.resolve(basePath)
	const resolvedCombined = path.resolve(resolvedBase, unified)
	const relativePath = path.relative(resolvedBase, resolvedCombined)
	if (
		relativePath.startsWith("../") ||
		relativePath.startsWith("..\\") ||
		relativePath === ".." ||
		path.isAbsolute(relativePath)
	) {
		throw new PathValidationError("Path escapes base directory", userPath, "path_traversal")
	}
	return resolvedCombined
}

export function isPathSafe(basePath: string, userPath: string): boolean {
	try {
		validatePath(basePath, userPath)
		return true
	} catch {
		return false
	}
}
