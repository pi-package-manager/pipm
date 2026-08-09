import { describe, expect, it } from "bun:test"
import { hashBundle, hashContent, sriSha512 } from "../src/utils/hash"

describe("hash utils", () => {
	it("hashContent is stable and hex SHA-256", () => {
		const h = hashContent("hello")
		expect(h).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824")
		expect(hashContent(Buffer.from("hello"))).toBe(h)
	})

	it("sriSha512 is formatted as an SRI string", () => {
		const sri = sriSha512(Buffer.from("hello"))
		expect(sri.startsWith("sha512-")).toBe(true)
	})

	it("hashBundle is order-independent and deterministic", () => {
		const a = hashBundle([
			{ path: "b.txt", content: Buffer.from("2") },
			{ path: "a.txt", content: Buffer.from("1") },
		])
		const b = hashBundle([
			{ path: "a.txt", content: Buffer.from("1") },
			{ path: "b.txt", content: Buffer.from("2") },
		])
		expect(a).toBe(b)
	})

	it("hashBundle changes when content changes", () => {
		const a = hashBundle([{ path: "a.txt", content: Buffer.from("1") }])
		const b = hashBundle([{ path: "a.txt", content: Buffer.from("2") }])
		expect(a).not.toBe(b)
	})
})
