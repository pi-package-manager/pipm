/**
 * Render the pipm docs (Markdown/.mdx) to static HTML files under docs/dist/.
 * Docs are published as both Markdown (the .mdx sources) and generated HTML.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { marked } from "marked"

const DOCS = join(import.meta.dir, "..", "docs")
const OUT = join(DOCS, "dist")

marked.setOptions({ gfm: true })

interface Group {
	group: string
	pages: string[]
}
interface DocsJson {
	name: string
	navigation: { anchors: { groups: Group[] }[] }
}

const docsJson: DocsJson = JSON.parse(readFileSync(join(DOCS, "docs.json"), "utf-8"))
const groups: Group[] = docsJson.navigation.anchors[0]?.groups ?? []
const allPages = groups.flatMap((g) => g.pages)

function parseFrontmatter(src: string): { title: string; description: string; body: string } {
	let title = ""
	let description = ""
	let body = src
	if (src.startsWith("---")) {
		const end = src.indexOf("\n---", 3)
		if (end !== -1) {
			const fm = src.slice(3, end)
			body = src.slice(end + 4).replace(/^\s*\n/, "")
			for (const line of fm.split("\n")) {
				const m = line.match(/^(\w+):\s*(.*)$/)
				if (!m) continue
				const key = m[1]
				const val = (m[2] ?? "").trim().replace(/^["']|["']$/g, "")
				if (key === "title") title = val
				else if (key === "description") description = val
			}
		}
	}
	return { title, description, body }
}

/** Rewrite root-relative doc links (/a/b[#x]) to relative .html links for a page at `depth`. */
function rewriteLinks(html: string, depth: number): string {
	const prefix = "../".repeat(depth)
	return html.replace(/href="\/([^"#]*)(#[^"]*)?"/g, (_m, path: string, anchor = "") => {
		const clean = path.replace(/\/$/, "")
		return `href="${prefix}${clean}.html${anchor}"`
	})
}

function sidebar(activePage: string, depth: number): string {
	const prefix = "../".repeat(depth)
	const parts: string[] = []
	for (const g of groups) {
		parts.push(`<div class="nav-group"><div class="nav-title">${g.group}</div>`)
		for (const page of g.pages) {
			const active = page === activePage ? ' class="active"' : ""
			const label = titleOf(page)
			parts.push(`<a href="${prefix}${page}.html"${active}>${label}</a>`)
		}
		parts.push(`</div>`)
	}
	return parts.join("\n")
}

const titleCache = new Map<string, string>()
function titleOf(page: string): string {
	if (titleCache.has(page)) return titleCache.get(page) as string
	const src = readFileSync(join(DOCS, `${page}.mdx`), "utf-8")
	const { title } = parseFrontmatter(src)
	const t = title || page
	titleCache.set(page, t)
	return t
}

function template(opts: {
	siteName: string
	title: string
	description: string
	content: string
	nav: string
	depth: number
}): string {
	const fav = `${"../".repeat(opts.depth)}favicon.svg`
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${opts.title} · ${opts.siteName}</title>
<meta name="description" content="${opts.description.replace(/"/g, "&quot;")}">
<link rel="icon" href="${fav}">
<style>
:root{--bg:#fff;--fg:#1a1a2e;--muted:#6b6b80;--border:#e6e6ef;--accent:#5B57D1;--code-bg:#f5f5fb}
@media(prefers-color-scheme:dark){:root{--bg:#15151f;--fg:#e8e8f0;--muted:#a0a0b8;--border:#2a2a3a;--accent:#8B87F0;--code-bg:#1e1e2c}}
*{box-sizing:border-box}
body{margin:0;font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--fg);background:var(--bg)}
.layout{display:flex;max-width:1200px;margin:0 auto;min-height:100vh}
aside{width:260px;flex:none;border-right:1px solid var(--border);padding:24px 16px;position:sticky;top:0;height:100vh;overflow-y:auto}
aside .brand{font-weight:700;font-size:18px;margin:0 8px 20px;color:var(--accent)}
.nav-group{margin-bottom:18px}
.nav-title{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 8px 6px}
aside a{display:block;padding:5px 8px;border-radius:6px;color:var(--fg);text-decoration:none;font-size:14px}
aside a:hover{background:var(--code-bg)}
aside a.active{background:var(--accent);color:#fff}
main{flex:1;min-width:0;padding:40px 48px;overflow-x:auto}
main .lead{color:var(--muted);font-size:18px;margin-top:-8px}
h1,h2,h3{line-height:1.25}
h1{font-size:32px;margin:0 0 8px}h2{margin-top:36px;border-bottom:1px solid var(--border);padding-bottom:6px}
a{color:var(--accent)}
code{background:var(--code-bg);padding:2px 6px;border-radius:5px;font-size:.9em;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
pre{background:var(--code-bg);padding:16px;border-radius:10px;overflow-x:auto}
pre code{background:none;padding:0}
table{border-collapse:collapse;width:100%;margin:16px 0;display:block;overflow-x:auto}
th,td{border:1px solid var(--border);padding:8px 12px;text-align:left}
th{background:var(--code-bg)}
blockquote{border-left:3px solid var(--accent);margin:16px 0;padding:4px 16px;color:var(--muted);background:var(--code-bg);border-radius:0 8px 8px 0}
@media(max-width:820px){.layout{flex-direction:column}aside{width:auto;height:auto;position:static;border-right:none;border-bottom:1px solid var(--border)}main{padding:24px}}
</style>
</head>
<body>
<div class="layout">
<aside><div class="brand">${opts.siteName}</div>${opts.nav}</aside>
<main>${opts.content}</main>
</div>
</body>
</html>
`
}

// build
mkdirSync(OUT, { recursive: true })
if (existsSync(join(DOCS, "favicon.svg")))
	cpSync(join(DOCS, "favicon.svg"), join(OUT, "favicon.svg"))

let count = 0
for (const page of allPages) {
	const srcPath = join(DOCS, `${page}.mdx`)
	if (!existsSync(srcPath)) {
		console.warn(`! missing doc: ${page}.mdx`)
		continue
	}
	const { title, description, body } = parseFrontmatter(readFileSync(srcPath, "utf-8"))
	const depth = page.split("/").length - 1
	const rendered = rewriteLinks(marked.parse(body) as string, depth)
	const lead = description ? `<p class="lead">${description}</p>` : ""
	const content = `<h1>${title || page}</h1>${lead}${rendered}`
	const html = template({
		siteName: docsJson.name,
		title: title || page,
		description,
		content,
		nav: sidebar(page, depth),
		depth,
	})
	const outFile = join(OUT, `${page}.html`)
	mkdirSync(dirname(outFile), { recursive: true })
	writeFileSync(outFile, html)
	count++
}

// index.html → first page
const first = allPages[0]
if (first) {
	writeFileSync(
		join(OUT, "index.html"),
		`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${first}.html"><link rel="canonical" href="${first}.html"><a href="${first}.html">${docsJson.name}</a>`,
	)
}

console.log(`✓ Rendered ${count} pages → ${OUT}`)
