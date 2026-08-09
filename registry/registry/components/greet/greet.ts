/**
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
