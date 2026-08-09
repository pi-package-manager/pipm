/**
 * JSONC parsing helpers.
 * Adapted from OCX (MIT).
 */

import { type ParseError, parse as parseJsoncRaw, printParseErrorCode } from "jsonc-parser"
import { ConfigError } from "./errors"

export function formatJsoncParseError(parseErrors: ParseError[]): string {
	const first = parseErrors[0]
	if (!first) return "Unknown parse error"
	return `${printParseErrorCode(first.error)} at offset ${first.offset}`
}

/** Parse JSONC text, throwing a ConfigError on syntax problems. */
export function parseJsonc<T = unknown>(text: string, label = "file"): T {
	const errors: ParseError[] = []
	const result = parseJsoncRaw(text, errors, { allowTrailingComma: true })
	if (errors.length > 0) {
		throw new ConfigError(`Failed to parse ${label}: ${formatJsoncParseError(errors)}`)
	}
	return result as T
}
