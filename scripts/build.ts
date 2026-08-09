/**
 * Build script for pipm CLI — compiles TypeScript to a single JS bundle.
 * Adapted from OCX (MIT).
 */

import { readFileSync } from "node:fs"

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"))

const result = await Bun.build({
	entrypoints: ["./src/index.ts"],
	outdir: "./dist",
	target: "bun",
	format: "esm",
	minify: true,
	sourcemap: "external",
	define: {
		__VERSION__: JSON.stringify(pkg.version),
	},
})

if (!result.success) {
	console.error("✗ Build failed:")
	for (const log of result.logs) console.error(log)
	process.exit(1)
}

console.log(`✓ Build complete: ./dist/index.js (v${pkg.version})`)
