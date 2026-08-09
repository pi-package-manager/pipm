import { afterEach, describe, expect, it } from "bun:test"
import {
	buildRegistryAuthConfig,
	createAuthResolver,
	normalizeAliasEnv,
	resolveRegistryAuth,
} from "../src/registry/auth"

afterEach(() => {
	delete process.env.PIPM_REGISTRY_ACME_TOKEN
})

describe("buildRegistryAuthConfig", () => {
	it("builds a bearer config from --token", () => {
		expect(buildRegistryAuthConfig({ token: "s3cr3t" })).toEqual({
			type: "bearer",
			token: "s3cr3t",
		})
	})
	it("builds a basic config", () => {
		expect(buildRegistryAuthConfig({ username: "u", password: "p" })).toEqual({
			type: "basic",
			username: "u",
			password: "p",
		})
	})
	it("rejects mixing bearer + basic", () => {
		expect(() => buildRegistryAuthConfig({ token: "x", username: "u" })).toThrow()
	})
	it("returns undefined with no flags", () => {
		expect(buildRegistryAuthConfig({})).toBeUndefined()
	})
})

describe("resolveRegistryAuth", () => {
	it("emits an Authorization header for a literal bearer token", () => {
		const auth = resolveRegistryAuth(
			"acme",
			{ url: "https://x", auth: { type: "bearer", token: "t" } },
			"user",
		)
		expect(auth.headers?.Authorization).toBe("Bearer t")
	})

	it("builds Basic base64", () => {
		const auth = resolveRegistryAuth(
			"acme",
			{ url: "https://x", auth: { type: "basic", username: "u", password: "p" } },
			"user",
		)
		expect(auth.headers?.Authorization).toBe(`Basic ${Buffer.from("u:p").toString("base64")}`)
	})

	it("honors the per-registry env override in a trusted scope", () => {
		process.env.PIPM_REGISTRY_ACME_TOKEN = "envtok"
		const auth = resolveRegistryAuth("acme", { url: "https://x" }, "user")
		expect(auth.headers?.Authorization).toBe("Bearer envtok")
	})

	it("rejects env-ref credentials in a committed local scope", () => {
		expect(() =>
			resolveRegistryAuth(
				"acme",
				{ url: "https://x", auth: { type: "bearer", tokenEnv: "X" } },
				"local",
			),
		).toThrow()
	})

	it("sets insecure → rejectUnauthorized false", () => {
		const auth = resolveRegistryAuth("acme", { url: "https://x", insecure: true }, "user")
		expect(auth.rejectUnauthorized).toBe(false)
	})
})

describe("createAuthResolver", () => {
	it("resolves per-alias lazily", () => {
		const resolve = createAuthResolver(
			{ acme: { url: "https://x", auth: { type: "bearer", token: "t" } } },
			"user",
		)
		expect(resolve("acme")?.headers?.Authorization).toBe("Bearer t")
		expect(resolve("unknown")).toBeUndefined()
	})
})

describe("normalizeAliasEnv", () => {
	it("uppercases and replaces non-alphanumerics", () => {
		expect(normalizeAliasEnv("my-reg.1")).toBe("MY_REG_1")
	})
})
