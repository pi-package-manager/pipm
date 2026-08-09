/**
 * Entry extension for demo-plugin. Logs at load time so pipm's e2e test can
 * observe the pipm-installed plugin being loaded by Pi (offline).
 */

// biome-ignore lint/suspicious/noExplicitAny: extension API type lives in Pi
export default function demoPlugin(pi: any): void {
	console.error("[pipm-e2e] loaded plugin extension: demo-plugin")
	pi.registerCommand("demo-plugin", {
		description: "Demo plugin command (installed by pipm)",
		handler: async () => {
			console.error("[pipm-e2e] demo-plugin command invoked")
		},
	})
}
