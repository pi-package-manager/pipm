/**
 * Build standalone pipm binaries with Bun --compile.
 * Adapted from OCX (MIT). Mirrors the Pi harness target strings.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"))

const targets: { name: string; target: Bun.Build.Target }[] = [
	{ name: "darwin-arm64", target: "bun-darwin-arm64" },
	{ name: "darwin-x64", target: "bun-darwin-x64" },
	{ name: "linux-arm64", target: "bun-linux-arm64" },
	{ name: "linux-x64", target: "bun-linux-x64" },
	{ name: "linux-arm64-musl", target: "bun-linux-arm64-musl" },
	{ name: "linux-x64-musl", target: "bun-linux-x64-musl" },
	{ name: "windows-x64", target: "bun-windows-x64" },
]

const outDir = "./dist/bin"

async function buildBinary(build: { name: string; target: Bun.Build.Target }) {
	const ext = build.name.includes("windows") ? ".exe" : ""
	const outfile = join(outDir, `pipm-${build.name}${ext}`)
	console.log(`Building ${build.target}...`)

	const result = await Bun.build({
		entrypoints: ["./src/index.ts"],
		compile: {
			target: build.target,
			outfile,
			autoloadDotenv: false,
		},
		minify: true,
		define: {
			__VERSION__: JSON.stringify(pkg.version),
		},
	})

	if (!result.success) {
		console.error(`Failed to compile binary for ${build.target}`)
		console.error(result.logs)
		process.exit(1)
	}
	console.log(`✓ ${outfile}`)
}

const args = process.argv.slice(2)
const targetArg = args.find((a) => a.startsWith("--target="))
const allFlag = args.includes("--all")

if (allFlag) {
	for (const build of targets) await buildBinary(build)
} else if (targetArg) {
	const targetName = targetArg.replace("--target=", "")
	const build = targets.find((t) => t.name === targetName || t.target === targetName)
	if (!build) {
		console.error(`Invalid target: ${targetName}`)
		console.error(`Valid targets: ${targets.map((t) => t.name).join(", ")}`)
		process.exit(1)
	}
	await buildBinary(build)
} else {
	const platform = process.platform
	const arch = process.arch
	let build: (typeof targets)[number] | undefined
	if (platform === "darwin" && arch === "arm64")
		build = targets.find((t) => t.name === "darwin-arm64")
	else if (platform === "darwin") build = targets.find((t) => t.name === "darwin-x64")
	else if (platform === "linux" && arch === "arm64")
		build = targets.find((t) => t.name === "linux-arm64")
	else if (platform === "linux") build = targets.find((t) => t.name === "linux-x64")
	else if (platform === "win32") build = targets.find((t) => t.name === "windows-x64")
	if (!build) {
		console.error(`Unsupported platform: ${platform}-${arch}`)
		process.exit(1)
	}
	await buildBinary(build)
}

console.log("\n✓ Binary build complete")
