/**
 * Starter registry template, baked into the binary (no network fetch, unlike
 * OCX's `init --registry` which downloads a GitHub tarball). `pipm init registry`
 * writes these files verbatim, substituting the registry name + author.
 */

export interface TemplateOptions {
	name: string
	author: string
}

/** Return a map of relative-path → file-content for a new registry project. */
export function starterTemplate(opts: TemplateOptions): Record<string, string> {
	const registryJsonc = `{
	// A pipm registry: edit this manifest, put content under files/, then run
	//   pipm build .
	"$schema": "https://pipm.dev/schemas/v1/registry.json",
	"name": ${JSON.stringify(opts.name)},
	"version": "1.0.0",
	"author": ${JSON.stringify(opts.author)},
	"pi": ">=0.80.0",
	"pipm": ">=0.1.0",
	"components": [
		{
			"name": "hello",
			"type": "skill",
			"description": "A friendly hello-world skill",
			"source": { "type": "static", "files": ["skills/hello/SKILL.md"] }
		},
		{
			"name": "greet",
			"type": "extension",
			"description": "A tiny greeting extension",
			"source": { "type": "static", "files": ["extensions/greet.ts"] }
		},
		{
			"name": "starter",
			"type": "profile",
			"description": "Starter profile = hello skill + greet extension",
			"source": {
				"type": "static",
				"files": [{ "path": "profiles/starter/AGENTS.md", "target": "AGENTS.md" }]
			},
			"dependencies": ["hello", "greet"],
			"pi": { "theme": "dark" }
		}
	]
}
`

	const skill = `---
name: hello
description: Say hello to the user in a friendly way. Use when the user greets you.
---

# Hello Skill

When invoked, greet the user warmly and offer to help.
`

	const extension = `/**
 * A tiny Pi extension. The default export is a factory that receives the Pi
 * extension API. Register commands, hook events, etc.
 */

// biome-ignore lint/suspicious/noExplicitAny: extension API type lives in Pi
export default function greetExtension(pi: any): void {
	pi.registerCommand("greet", {
		description: "Greet the user",
		handler: async () => {
			// runs when the user types /greet
		},
	})
}
`

	const agents = `# ${opts.name} — starter profile

This profile was installed by pipm. It bundles the \`hello\` skill and the
\`greet\` extension. Edit this file to set the profile's instructions.
`

	return {
		"registry.jsonc": registryJsonc,
		"files/skills/hello/SKILL.md": skill,
		"files/extensions/greet.ts": extension,
		"files/profiles/starter/AGENTS.md": agents,
	}
}
