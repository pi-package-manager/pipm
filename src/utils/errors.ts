/**
 * Custom error classes with error codes and exit codes.
 * Adapted from OCX (MIT).
 */

export type ErrorCode =
	| "NOT_FOUND"
	| "NETWORK_ERROR"
	| "CONFIG_ERROR"
	| "VALIDATION_ERROR"
	| "CONFLICT"
	| "PERMISSION_ERROR"
	| "INTEGRITY_ERROR"
	| "BUILD_ERROR"

export const EXIT_CODES = {
	SUCCESS: 0,
	GENERAL: 1,
	CONFLICT: 6,
	INTEGRITY: 65,
	NOT_FOUND: 66,
	NETWORK: 69,
	CONFIG: 78,
} as const

export class PipmError extends Error {
	constructor(
		message: string,
		public readonly code: ErrorCode,
		public readonly exitCode: number = EXIT_CODES.GENERAL,
	) {
		super(message)
		this.name = "PipmError"
	}
}

export class NotFoundError extends PipmError {
	constructor(message: string) {
		super(message, "NOT_FOUND", EXIT_CODES.NOT_FOUND)
		this.name = "NotFoundError"
	}
}

export class NetworkError extends PipmError {
	constructor(
		message: string,
		public readonly url?: string,
		public readonly status?: number,
	) {
		super(message, "NETWORK_ERROR", EXIT_CODES.NETWORK)
		this.name = "NetworkError"
	}
}

export class ConfigError extends PipmError {
	constructor(message: string) {
		super(message, "CONFIG_ERROR", EXIT_CODES.CONFIG)
		this.name = "ConfigError"
	}
}

export class ValidationError extends PipmError {
	constructor(message: string) {
		super(message, "VALIDATION_ERROR", EXIT_CODES.GENERAL)
		this.name = "ValidationError"
	}
}

export class ConflictError extends PipmError {
	constructor(message: string) {
		super(message, "CONFLICT", EXIT_CODES.CONFLICT)
		this.name = "ConflictError"
	}
}

export class IntegrityError extends PipmError {
	constructor(
		public readonly component: string,
		public readonly expected: string,
		public readonly found: string,
	) {
		super(
			`Integrity verification failed for "${component}"\n` +
				`  Expected: ${expected}\n` +
				`  Found:    ${found}`,
			"INTEGRITY_ERROR",
			EXIT_CODES.INTEGRITY,
		)
		this.name = "IntegrityError"
	}
}

export class BuildError extends PipmError {
	constructor(message: string) {
		super(message, "BUILD_ERROR", EXIT_CODES.GENERAL)
		this.name = "BuildError"
	}
}
