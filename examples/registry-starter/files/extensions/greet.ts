/**
 * A tiny Pi extension. The default export is a factory that receives the Pi
 * extension API. It logs at load time and, on session_start, enumerates the
 * skills Pi loaded — so pipm's e2e test can observe (offline) that Pi actually
 * loaded the pipm-installed extension AND skills.
 */

// biome-ignore lint/suspicious/noExplicitAny: extension API type lives in Pi
export default function greetExtension(pi: any): void {
	console.error("[pipm-e2e] loaded extension: greet")

	pi.registerCommand("greet", {
		description: "Greet the user (installed by pipm)",
		handler: async () => {
			console.error("[pipm-e2e] greet command invoked")
		},
	})

	if (typeof pi.on === "function") {
		// biome-ignore lint/suspicious/noExplicitAny: Pi event types live in Pi
		pi.on("session_start", async (_event: any, ctx: any) => {
			try {
				const sp: string = ctx?.getSystemPrompt?.() ?? ""
				console.error(
					`[pipm-e2e] skills in system prompt: hello=${sp.includes("Say hello to the user")} plugin-skill=${sp.includes("plugin-skill")}`,
				)
			} catch (err) {
				console.error(`[pipm-e2e] skills probe error: ${err}`)
			}
		})
	}
}
