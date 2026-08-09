/**
 * Registry transport. Fetches the index, per-component packuments, and vendored
 * file bytes from either an HTTP(S) registry or a local folder / file:// path.
 * Forked from OCX's registry/fetcher.ts (MIT) with a local-folder branch added.
 */

import { readFile } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import { fileURLToPath } from "node:url"
import { COMPONENTS_DIRNAME, REGISTRY_INDEX_FILE } from "../constants"
import {
	type ComponentVersion,
	type Packument,
	packumentSchema,
	type RegistryIndex,
	registryIndexSchema,
} from "../schemas/registry"
import { NetworkError, NotFoundError, ValidationError } from "../utils/errors"
import { parseJsonc } from "../utils/jsonc"
import type { RequestAuth } from "./auth"

let insecureTls = false
export function setInsecureTls(value: boolean): void {
	insecureTls = value
}

/** True when the registry URL points at the local filesystem rather than HTTP. */
export function isLocalRegistry(url: string): boolean {
	return url.startsWith("file://") || (!/^https?:\/\//i.test(url) && !url.startsWith("//"))
}

/** Resolve the local registry root directory from a path or file:// URL. */
function localRoot(url: string): string {
	if (url.startsWith("file://")) return fileURLToPath(url)
	return isAbsolute(url) ? url : join(process.cwd(), url)
}

function buildRequestInit(auth?: RequestAuth): RequestInit {
	const init: RequestInit = {}
	if (auth?.headers) init.headers = auth.headers
	if (auth?.rejectUnauthorized === false || insecureTls) {
		// Bun-specific TLS override
		;(init as RequestInit & { tls?: { rejectUnauthorized: boolean } }).tls = {
			rejectUnauthorized: false,
		}
	}
	return init
}

async function httpGet(url: string, auth?: RequestAuth): Promise<Response> {
	let res: Response
	try {
		res = await fetch(url, buildRequestInit(auth))
	} catch (err) {
		throw new NetworkError(
			`Failed to reach ${url}: ${err instanceof Error ? err.message : String(err)}`,
			url,
		)
	}
	if (res.status === 404) throw new NotFoundError(`Not found: ${url}`)
	if (!res.ok) {
		throw new NetworkError(
			`Request failed (${res.status} ${res.statusText}) for ${url}`,
			url,
			res.status,
		)
	}
	return res
}

async function getText(baseUrl: string, relPath: string, auth?: RequestAuth): Promise<string> {
	if (isLocalRegistry(baseUrl)) {
		const abs = join(localRoot(baseUrl), relPath)
		try {
			return await readFile(abs, "utf-8")
		} catch {
			throw new NotFoundError(`Not found: ${abs}`)
		}
	}
	const res = await httpGet(`${baseUrl.replace(/\/$/, "")}/${relPath}`, auth)
	return res.text()
}

async function getBytes(baseUrl: string, relPath: string, auth?: RequestAuth): Promise<Buffer> {
	if (isLocalRegistry(baseUrl)) {
		const abs = join(localRoot(baseUrl), relPath)
		try {
			return await readFile(abs)
		} catch {
			throw new NotFoundError(`Not found: ${abs}`)
		}
	}
	const res = await httpGet(`${baseUrl.replace(/\/$/, "")}/${relPath}`, auth)
	return Buffer.from(await res.arrayBuffer())
}

export async function fetchRegistryIndex(
	baseUrl: string,
	auth?: RequestAuth,
): Promise<RegistryIndex> {
	const text = await getText(baseUrl, REGISTRY_INDEX_FILE, auth)
	const parsed = registryIndexSchema.safeParse(parseJsonc(text, "index.json"))
	if (!parsed.success) {
		throw new ValidationError(
			`Invalid registry index at ${baseUrl}: ${parsed.error.issues[0]?.message}`,
		)
	}
	return parsed.data
}

export async function fetchPackument(
	baseUrl: string,
	name: string,
	auth?: RequestAuth,
): Promise<Packument> {
	const text = await getText(baseUrl, `${COMPONENTS_DIRNAME}/${name}.json`, auth)
	const parsed = packumentSchema.safeParse(parseJsonc(text, `${name}.json`))
	if (!parsed.success) {
		throw new ValidationError(`Invalid packument for "${name}": ${parsed.error.issues[0]?.message}`)
	}
	return parsed.data
}

/** Fetch the latest published version manifest for a component. */
export async function fetchComponentVersion(
	baseUrl: string,
	name: string,
	auth?: RequestAuth,
): Promise<ComponentVersion> {
	const packument = await fetchPackument(baseUrl, name, auth)
	const latest = packument["dist-tags"].latest
	const version = packument.versions[latest]
	if (!version) {
		throw new NotFoundError(`Component "${name}" has no version "${latest}" in its packument.`)
	}
	return version
}

/** Fetch the raw bytes of one vendored file within a component. */
export async function fetchFileContent(
	baseUrl: string,
	name: string,
	filePath: string,
	auth?: RequestAuth,
): Promise<Buffer> {
	return getBytes(baseUrl, `${COMPONENTS_DIRNAME}/${name}/${filePath}`, auth)
}
