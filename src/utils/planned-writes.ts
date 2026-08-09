import { ConflictError } from "./errors"

/**
 * In-flight write registry — fails loud on duplicate targets.
 * Copied from OCX (MIT).
 */
export interface PlannedWrite {
	absolutePath: string
	relativePath: string
	content: Buffer
	source: string
}

export function registerPlannedWriteOrThrow(
	plannedWrites: Map<string, PlannedWrite>,
	candidate: PlannedWrite,
): void {
	const existing = plannedWrites.get(candidate.absolutePath)
	if (!existing) {
		plannedWrites.set(candidate.absolutePath, candidate)
		return
	}
	const relation = existing.content.equals(candidate.content) ? "identical" : "different"
	throw new ConflictError(
		`Intra-batch target collision at "${candidate.relativePath}". ` +
			`Both "${existing.source}" and "${candidate.source}" resolve to this path with ${relation} content. ` +
			"Rename one manifest target so each component writes to a unique path.",
	)
}
