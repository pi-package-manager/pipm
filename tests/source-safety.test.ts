import { describe, expect, it } from "bun:test"
import { assertContained, assertSafeGitRef, assertSafeGitRepo } from "../src/build/source-safety"

describe("assertSafeGitRepo", () => {
	it("allows https / ssh / git / scp-like / local paths", () => {
		expect(() => assertSafeGitRepo("https://github.com/a/b")).not.toThrow()
		expect(() => assertSafeGitRepo("ssh://git@github.com/a/b")).not.toThrow()
		expect(() => assertSafeGitRepo("git://host/a/b")).not.toThrow()
		expect(() => assertSafeGitRepo("git@github.com:a/b.git")).not.toThrow()
		expect(() => assertSafeGitRepo("/tmp/local-repo")).not.toThrow()
	})
	it("rejects the ext:: transport helper (RCE)", () => {
		expect(() => assertSafeGitRepo("ext::sh -c 'id'")).toThrow()
	})
	it("rejects file:// and other non-allowlisted schemes", () => {
		expect(() => assertSafeGitRepo("file:///etc/passwd")).toThrow()
	})
	it("rejects option injection (leading dash)", () => {
		expect(() => assertSafeGitRepo("--upload-pack=touch /tmp/pwn")).toThrow()
	})
})

describe("assertSafeGitRef", () => {
	it("allows normal refs", () => {
		expect(() => assertSafeGitRef("v1.2.3")).not.toThrow()
		expect(() => assertSafeGitRef("main")).not.toThrow()
	})
	it("rejects option injection and whitespace/control", () => {
		expect(() => assertSafeGitRef("--foo")).toThrow()
		expect(() => assertSafeGitRef("a b")).toThrow()
	})
})

describe("assertContained", () => {
	it("allows contained relative paths", () => {
		expect(() => assertContained("/base", "sub/dir/file.ts")).not.toThrow()
	})
	it("rejects traversal and absolute escapes", () => {
		expect(() => assertContained("/base", "../../etc/passwd")).toThrow()
		expect(() => assertContained("/base", "/etc/passwd")).toThrow()
	})
})
