/**
 * Release pipeline for pipm.
 *
 *   bun run scripts/release.ts <version> [options]
 *
 * <version>  an explicit semver (0.0.1, optionally v-prefixed) or a bump keyword
 *            (patch | minor | major).
 *
 * Options:
 *   --targets <a,b>   binary targets to build (default: all)
 *   --no-binaries     skip binary builds (bundle only)
 *   --no-git          don't commit/tag (default: tag when inside a git repo)
 *   --publish         create a GitHub Release and upload the built assets
 *   --prerelease      mark the GitHub Release as a prerelease
 *   --dry-run         print the plan; write nothing
 *
 * Publishing reads a token + repo from the environment (.env is auto-loaded by
 * Bun): GITHUB_TOKEN (or GH_TOKEN, or CI's GITHUB_TOKEN) and GITHUB_REPOSITORY
 * (owner/repo). GITHUB_API_URL defaults to https://api.github.com.
 */

import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..")
const PKG_PATH = join(ROOT, "package.json")
const BIN_DIR = join(ROOT, "dist", "bin")
const CHANGELOG = join(ROOT, "CHANGELOG.md")

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z-.]+)?$/

// ── args ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const positional = argv.filter((a) => !a.startsWith("--"))
const flag = (name: string) => argv.includes(`--${name}`)
const opt = (name: string) => {
	const p = argv.find((a) => a.startsWith(`--${name}=`))
	return p ? p.slice(name.length + 3) : undefined
}
const dryRun = flag("dry-run")
const doBinaries = !flag("no-binaries")
const doGit = !flag("no-git")
const doPublish = flag("publish")
const doPrerelease = flag("prerelease")

function die(msg: string): never {
	console.error(`✗ ${msg}`)
	process.exit(1)
}

async function run(cmd: string[], opts?: { cwd?: string }): Promise<string> {
	const proc = Bun.spawn(cmd, { cwd: opts?.cwd ?? ROOT, stdout: "pipe", stderr: "pipe" })
	const [out, err] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	])
	if ((await proc.exited) !== 0) die(`command failed: ${cmd.join(" ")}\n${err || out}`)
	return out
}

async function tryRun(cmd: string[]): Promise<string | null> {
	const proc = Bun.spawn(cmd, { cwd: ROOT, stdout: "pipe", stderr: "pipe" })
	const out = await new Response(proc.stdout).text()
	return (await proc.exited) === 0 ? out : null
}

// ── version ─────────────────────────────────────────────────────────────────
const pkg = JSON.parse(readFileSync(PKG_PATH, "utf-8"))
const current: string = pkg.version

function resolveVersion(input: string | undefined): string {
	if (!input) die("a version is required (e.g. 0.0.1, or patch|minor|major)")
	if (["patch", "minor", "major"].includes(input)) {
		const m = current.match(SEMVER)
		if (!m) die(`current version "${current}" is not semver`)
		let major = Number(m[1])
		let minor = Number(m[2])
		let patch = Number(m[3])
		if (input === "major") {
			major += 1
			minor = 0
			patch = 0
		} else if (input === "minor") {
			minor += 1
			patch = 0
		} else {
			patch += 1
		}
		return `${major}.${minor}.${patch}`
	}
	const v = input.replace(/^v/, "")
	if (!SEMVER.test(v)) die(`"${input}" is not a valid semver or bump keyword`)
	return v
}

const version = resolveVersion(positional[0])
const tag = `v${version}`
const isGitRepo = (await tryRun(["git", "rev-parse", "--is-inside-work-tree"])) !== null

console.log(`pipm release ${current} → ${version}${dryRun ? "  (dry run)" : ""}`)
console.log(`  binaries: ${doBinaries}  git: ${doGit && isGitRepo}  publish: ${doPublish}`)

// ── changelog ─────────────────────────────────────────────────────────────────
async function buildChangelogSection(): Promise<string> {
	const date = new Date().toISOString().slice(0, 10)
	let lines: string[] = []
	if (isGitRepo) {
		const lastTag = (await tryRun(["git", "describe", "--tags", "--abbrev=0"]))?.trim()
		const range = lastTag ? `${lastTag}..HEAD` : "HEAD"
		const log = (await tryRun(["git", "log", range, "--pretty=format:%s"])) ?? ""
		lines = log
			.split("\n")
			.map((s) => s.trim())
			.filter(Boolean)
	}
	const groups: Record<string, string[]> = { Features: [], Fixes: [], Other: [] }
	for (const s of lines) {
		if (/^feat(\(|:| )/i.test(s)) groups.Features.push(s.replace(/^feat(\([^)]*\))?:?\s*/i, ""))
		else if (/^fix(\(|:| )/i.test(s)) groups.Fixes.push(s.replace(/^fix(\([^)]*\))?:?\s*/i, ""))
		else groups.Other.push(s)
	}
	let body = ""
	for (const [title, items] of Object.entries(groups)) {
		if (items.length === 0) continue
		body += `\n### ${title}\n\n${items.map((i) => `- ${i}`).join("\n")}\n`
	}
	if (!body) body = "\n- Initial release.\n"
	return `## ${version} — ${date}\n${body}`
}

// ── checksums ───────────────────────────────────────────────────────────────
function writeChecksums(): string[] {
	const files = readdirSync(BIN_DIR).filter((f) => f.startsWith("pipm-"))
	const lines = files.map((f) => {
		const hash = createHash("sha256")
			.update(readFileSync(join(BIN_DIR, f)))
			.digest("hex")
		return `${hash}  ${f}`
	})
	writeFileSync(join(BIN_DIR, "SHA256SUMS"), `${lines.join("\n")}\n`)
	return [...files, "SHA256SUMS"]
}

// ── GitHub publish ────────────────────────────────────────────────────────────
async function publishGitHub(assets: string[], notes: string): Promise<void> {
	const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
	const repo = process.env.GITHUB_REPOSITORY
	const api = process.env.GITHUB_API_URL || "https://api.github.com"
	if (!token) die("--publish needs GITHUB_TOKEN (or GH_TOKEN) in the environment / .env")
	if (!repo) die("--publish needs GITHUB_REPOSITORY=owner/repo in the environment / .env")

	const headers = {
		Authorization: `Bearer ${token}`,
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
		"User-Agent": "pipm-release",
	}
	// create (or reuse) the release
	let rel = await fetch(`${api}/repos/${repo}/releases`, {
		method: "POST",
		headers: { ...headers, "Content-Type": "application/json" },
		body: JSON.stringify({ tag_name: tag, name: tag, body: notes, prerelease: doPrerelease }),
	})
	if (rel.status === 422) {
		console.log("  release exists — reusing")
		rel = await fetch(`${api}/repos/${repo}/releases/tags/${tag}`, { headers })
	}
	if (!rel.ok) die(`GitHub release failed (${rel.status}): ${await rel.text()}`)
	const release = (await rel.json()) as { upload_url: string; html_url: string }
	const uploadBase = release.upload_url.replace(/\{\?[^}]*\}$/, "")

	for (const name of assets) {
		const bytes = readFileSync(join(BIN_DIR, name))
		const up = await fetch(`${uploadBase}?name=${encodeURIComponent(name)}`, {
			method: "POST",
			headers: { ...headers, "Content-Type": "application/octet-stream" },
			body: bytes,
		})
		if (!up.ok) die(`asset upload failed for ${name} (${up.status}): ${await up.text()}`)
		console.log(`  ↑ ${name}`)
	}
	console.log(`✓ Published ${tag} → ${release.html_url}`)
}

// ── run ─────────────────────────────────────────────────────────────────────
const changelogSection = await buildChangelogSection()

if (dryRun) {
	console.log(`\n--- CHANGELOG ---\n${changelogSection}`)
	console.log(`\nWould set package.json version to ${version}`)
	console.log(`Would build bundle${doBinaries ? " + binaries" : ""}, write SHA256SUMS`)
	if (doGit && isGitRepo) console.log(`Would commit + tag ${tag}`)
	if (doPublish) console.log(`Would publish GitHub Release ${tag}`)
	process.exit(0)
}

// 1. bump version
pkg.version = version
writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, "\t")}\n`)
console.log(`✓ package.json → ${version}`)

// 2. build the JS bundle
await run(["bun", "run", "scripts/build.ts"])
console.log("✓ built dist/index.js")

// 3. build binaries
let assets: string[] = []
if (doBinaries) {
	const targets = opt("targets")
	if (targets) {
		for (const t of targets.split(","))
			await run(["bun", "run", "scripts/build-binary.ts", `--target=${t}`])
	} else {
		await run(["bun", "run", "scripts/build-binary.ts", "--all"])
	}
	assets = writeChecksums()
	console.log(`✓ built ${assets.length - 1} binaries + SHA256SUMS`)
}

// 4. changelog
const prevChangelog = existsSync(CHANGELOG) ? readFileSync(CHANGELOG, "utf-8") : "# Changelog\n"
const header = "# Changelog\n"
const rest = prevChangelog.startsWith(header)
	? prevChangelog.slice(header.length)
	: `\n${prevChangelog}`
writeFileSync(CHANGELOG, `${header}\n${changelogSection}\n${rest}`)
console.log("✓ updated CHANGELOG.md")

// 5. git commit + tag
if (doGit && isGitRepo) {
	await run(["git", "add", "-A"])
	await run(["git", "commit", "-m", `release: ${tag}`])
	await run(["git", "tag", "-a", tag, "-m", `pipm ${tag}`])
	console.log(`✓ committed + tagged ${tag}`)
} else if (doGit && !isGitRepo) {
	console.log("! not a git repo — skipped commit/tag")
}

// 6. publish
if (doPublish) {
	if (!doBinaries) die("--publish needs binaries; drop --no-binaries")
	await publishGitHub(assets, changelogSection)
}

console.log(`\n✓ release ${tag} ready`)
if (!doPublish) {
	console.log("  Next: push the tag and/or re-run with --publish")
	if (doGit && isGitRepo) console.log(`  git push origin main --tags`)
}
