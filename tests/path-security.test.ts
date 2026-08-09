import { describe, expect, it } from "bun:test"
import { isPathSafe, PathValidationError, validatePath } from "../src/utils/path-security"

const base = "/tmp/base"

describe("validatePath", () => {
	it("accepts safe relative paths", () => {
		expect(validatePath(base, "skills/hello/SKILL.md")).toBe("/tmp/base/skills/hello/SKILL.md")
	})

	it("rejects path traversal", () => {
		expect(() => validatePath(base, "../escape")).toThrow(PathValidationError)
	})

	it("rejects absolute paths", () => {
		expect(() => validatePath(base, "/etc/passwd")).toThrow(PathValidationError)
	})

	it("rejects null bytes", () => {
		expect(() => validatePath(base, "a\0b")).toThrow(PathValidationError)
	})

	it("isPathSafe returns booleans", () => {
		expect(isPathSafe(base, "ok/file.ts")).toBe(true)
		expect(isPathSafe(base, "../../nope")).toBe(false)
	})
})
