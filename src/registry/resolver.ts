/**
 * Dependency resolver — recursive depth-first topological sort with cycle
 * detection. Forked from OCX's registry/resolver.ts (MIT), which is based on
 * shadcn/ui's resolver.
 *
 * pipm semantics: profile-typed dependencies are resolved (and flattened) the
 * same way as content dependencies — the DFS guarantees deps land before the
 * component that needs them, and the installer applies kind-specific rules.
 */

import type { RegistryConfig } from "../schemas/config"
import type { ComponentVersion } from "../schemas/registry"
import { NetworkError, NotFoundError, PipmError, ValidationError } from "../utils/errors"
import type { AuthResolver } from "./auth"
import { fetchComponentVersion } from "./fetcher"

export function parseQualifiedComponent(ref: string): { namespace: string; component: string } {
	const slash = ref.indexOf("/")
	if (slash === -1) throw new ValidationError(`Expected "<alias>/<component>", got "${ref}"`)
	return { namespace: ref.slice(0, slash), component: ref.slice(slash + 1) }
}

export function createQualifiedComponent(namespace: string, component: string): string {
	return `${namespace}/${component}`
}

export function parseComponentRef(
	ref: string,
	defaultNamespace?: string,
): { namespace: string; component: string } {
	if (ref.includes("/")) return parseQualifiedComponent(ref)
	if (defaultNamespace) return { namespace: defaultNamespace, component: ref }
	throw new ValidationError(`Component '${ref}' must include a registry alias (e.g. 'acme/${ref}')`)
}

export interface ResolvedComponent {
	registryName: string
	baseUrl: string
	qualifiedName: string
	version: ComponentVersion
}

export interface ResolvedGraph {
	/** Components in install order (dependencies first). */
	components: ResolvedComponent[]
	installOrder: string[]
}

export async function resolveDependencies(
	registries: Record<string, RegistryConfig>,
	componentNames: string[],
	resolveAuth?: AuthResolver,
): Promise<ResolvedGraph> {
	const resolved = new Map<string, ResolvedComponent>()
	const visiting = new Set<string>()

	async function resolve(namespace: string, name: string, path: string[]): Promise<void> {
		const qualifiedName = createQualifiedComponent(namespace, name)
		if (resolved.has(qualifiedName)) return
		if (visiting.has(qualifiedName)) {
			throw new ValidationError(
				`Circular dependency detected: ${[...path, qualifiedName].join(" → ")}`,
			)
		}
		visiting.add(qualifiedName)

		const regConfig = registries[namespace]
		if (!regConfig) {
			throw new NotFoundError(
				`Registry alias '${namespace}' not found. Add it with 'pipm registry add <url> --name ${namespace}'.`,
			)
		}

		let version: ComponentVersion
		try {
			version = await fetchComponentVersion(regConfig.url, name, resolveAuth?.(namespace))
		} catch (err) {
			if (err instanceof NetworkError) throw err
			if (err instanceof NotFoundError) {
				throw new NotFoundError(`Component '${name}' not found in registry '${namespace}'.`)
			}
			if (err instanceof PipmError) throw err
			throw new NetworkError(
				`Failed to fetch '${name}' from '${namespace}': ${err instanceof Error ? err.message : String(err)}`,
				regConfig.url,
			)
		}

		// depth-first: resolve dependencies before adding this component
		for (const dep of version.dependencies) {
			const depRef = parseComponentRef(dep, namespace)
			await resolve(depRef.namespace, depRef.component, [...path, qualifiedName])
		}

		resolved.set(qualifiedName, {
			registryName: namespace,
			baseUrl: regConfig.url,
			qualifiedName,
			version,
		})
		visiting.delete(qualifiedName)
	}

	for (const name of componentNames) {
		const ref = parseComponentRef(name)
		await resolve(ref.namespace, ref.component, [])
	}

	return {
		components: Array.from(resolved.values()),
		installOrder: Array.from(resolved.keys()),
	}
}
