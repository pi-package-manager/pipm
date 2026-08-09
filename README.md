# pipm — Pi Package Manager

An immutable, [OCX](https://github.com/kdcokenny/ocx)-style registry system for
[Pi](https://pi.dev). Define skills, extensions, plugins, and **profiles** in a
`registry.jsonc`; `pipm build` downloads and **vendors** everything (npm, git,
static files) into a self-contained, content-hashed `registry/` folder; then
`pipm install` copies the files straight into a Pi home — no npm or git access
needed at install time.

Built with Bun and compiled to a standalone binary. MIT licensed. Auth,
dependency resolution, path-safety, and the CLI structure are forked from OCX
(MIT); the immutable vendoring build and git source support are new.

## Quick start

Install pipm, author a small registry in `/tmp`, build it, and install a profile into an isolated
Pi home — without touching your real `~/.pi`.

### 1. Install pipm

```bash
curl -fsSL https://raw.githubusercontent.com/pi-package-manager/pipm/main/scripts/install.sh | sh
# pin a version / install dir:  PIPM_VERSION=v0.0.1 PIPM_INSTALL=~/.local/bin curl -fsSL .../install.sh | sh
```

The script detects your OS/arch (incl. Apple-Silicon Rosetta and musl/Alpine), downloads the matching
`pipm-<os>-<arch>` asset from the latest GitHub Release, verifies it against `SHA256SUMS`, and installs
to `/usr/local/bin` (or `~/.local/bin`). Prefer source? See [Build](#build).

### 2. Create a registry in `/tmp`

A registry is a `registry.jsonc` manifest plus a `files/` directory. This one defines a hello-world
**skill**, the **`pi-subagents` plugin** (pinned to an explicit version), and an **`all` profile**
that bundles both:

```bash
mkdir -p /tmp/my-registry/files/skills/hello /tmp/my-registry/files/profiles/all

cat > /tmp/my-registry/registry.jsonc <<'EOF'
{
  "$schema": "https://pipm.dev/schemas/v1/registry.json",
  "name": "demo",
  "version": "1.0.0",
  "author": "you@example.com",
  "components": [
    {
      "name": "hello",
      "type": "skill",
      "description": "A hello-world skill",
      "source": { "type": "static", "files": ["skills/hello/SKILL.md"] }
    },
    {
      "name": "pi-subagents",
      "type": "plugin",
      "description": "Run subagents in Pi",
      "vendorDeps": "bundle",
      "source": { "type": "npm", "package": "pi-subagents", "version": "0.44.0" }
    },
    {
      "name": "all",
      "type": "profile",
      "description": "Everything: hello skill + pi-subagents plugin",
      "source": { "type": "static", "files": [{ "path": "profiles/all/AGENTS.md", "target": "AGENTS.md" }] },
      "dependencies": ["hello", "pi-subagents"],
      "pi": { "theme": "dark" }
    }
  ]
}
EOF

cat > /tmp/my-registry/files/skills/hello/SKILL.md <<'EOF'
---
name: hello
description: Say hello to the user. Use when the user greets you or asks for a greeting.
---

# Hello

Greet the user warmly and offer to help.
EOF

cat > /tmp/my-registry/files/profiles/all/AGENTS.md <<'EOF'
# all profile

Installed by pipm. Bundles the hello skill and the pi-subagents plugin.
EOF
```

> Pin the plugin to a specific version (`"version": "0.44.0"`). pipm records the exact version + a
> per-file SHA-256 in the lockfile, so you always control which version installs, and when.

### 3. Build the registry

```bash
pipm build /tmp/my-registry
```

This downloads and **vendors** everything — the `pi-subagents` tarball *and its full dependency tree*
— into `/tmp/my-registry/registry/` (a self-contained, servable folder) and writes
`/tmp/my-registry/pipm-lock.json` (pinned versions + hashes).

### 4. Add the built registry to your machine

```bash
pipm registry add /tmp/my-registry/registry --name demo
```

(A local folder here; once you host `registry/` over HTTP you'd use its URL instead.)

### 5. Install the `all` profile into an isolated Pi home

Use `--pi-home /tmp/pi` so this never touches your existing `~/.pi`:

```bash
pipm --pi-home /tmp/pi install demo/all
```

It lands in `/tmp/pi/agent/`: `skills/hello/`, `npm/node_modules/pi-subagents` (plus its vendored
deps), a `settings.json` (`packages: ["npm:pi-subagents"]`, `theme: dark`), and a
`.pipm/receipt.jsonc`. No npm/git access happened at install time.

### 6. Run Pi against it

```bash
PI_CODING_AGENT_DIR=/tmp/pi/agent pi
```

For your real setup, drop `--pi-home` and it installs into `~/.pi/agent` — Pi's default — so plain
`pi` picks it up.

## Why
A user that wants to have a single profile for their Pi that they can migrate
anywhere else might use pipm to create the profile.

A company that wants to distribute the same profile to every user, or a custom
profile per user with common inheritance might use pipm to create a registry,
then serve the registry on their internal URL to host files for all users.

Pi loads skills/extensions/plugins from a "packages" list that it `npm install`s
at runtime. pipm lets you curate a named bundle once, vendor its exact bytes,
and reproduce it anywhere offline — with a lockfile pinning npm versions and git
commit SHAs.

This helps prevent supply chain attacks - you are always in control of what
version of plugins you install, and when.

## Concepts

pipm always installs into **`<pi-home>/agent`** — the exact directory Pi loads.

| pipm component kind | Installs into `<pi-home>/agent/` as | Pi loads it via |
|---|---|---|
| `skill` | `skills/<name>/SKILL.md` | `<agent-dir>/skills` auto-discovery |
| `extension` | `extensions/<name>.ts` or `extensions/<name>/` | `<agent-dir>/extensions` auto-discovery |
| `plugin` | `npm/node_modules/<pkg>/…` + `settings.json` `packages` | pre-vendored npm package (offline) |
| `profile` | its `AGENTS.md`/`settings.json` + all its deps, flattened | it materializes the agent dir |

Each component declares a **source**: `npm`, `git`, or `static`. A **profile** is
an installable bundle; installing one flattens the union of its resolved
skills/extensions/plugins (and any profiles it depends on) into `<pi-home>/agent`
so it runs on plain Pi core (which has no `extends`). Instruction files
(`AGENTS.md`, `APPEND_SYSTEM.md`) from dependency profiles are concatenated.

## Install target (declarable Pi home)

The Pi home is resolved from, in order: `--pi-home` flag → `PI_HOME` env →
`~/.config/pipm/config.jsonc` `piHome` → `~/.pi`. Everything installs into
`<pi-home>/agent`. With the default (`~/.pi`), that is `~/.pi/agent` — Pi's own
default — so plain `pi` picks it up. For any other home, point Pi at it:

```bash
PI_CODING_AGENT_DIR=<pi-home>/agent pi
```

## Commands

```
pipm init registry <path>          scaffold a new registry project
pipm build [path]                  vendor npm/git/static → immutable registry/ + lockfile
pipm registry add <url> --name <a> add a registry (https:// URL, file://, or local folder)
pipm registry remove|list          manage configured registries
pipm install <alias>/<profile>     install a profile into <pi-home>/agent (resolves deps)
pipm add <alias>/<component>       add one component into <pi-home>/agent
pipm remove <components...>        remove installed components
pipm verify [components...]        SHA-256 integrity check against the receipt
pipm list                          list installed components
pipm search [query]                search across configured registries
```

Global flags: `--pi-home <path>` (default `~/.pi`; installs into `<pi-home>/agent`), `--json`,
`--dry-run`, `-q/--quiet`, `-v/--verbose`.

Private registries: `pipm registry add <url> --name acme --token-env ACME_TOKEN`
(bearer/basic; env/file/literal credential sources, per-registry
`PIPM_REGISTRY_<ALIAS>_TOKEN` env overrides).

## registry.jsonc

```jsonc
{
  "$schema": "https://pipm.dev/schemas/v1/registry.json",
  "name": "acme", "version": "1.0.0", "author": "you@example.com",
  "components": [
    { "name": "routines", "type": "skill",
      "source": { "type": "npm", "package": "@acme/routines", "version": "^1.4.0", "subpath": "skills/routines" } },
    { "name": "tps", "type": "extension",
      "source": { "type": "git", "repo": "https://github.com/acme/pi-tps", "ref": "v2.1.0", "subpath": "extensions/tps" } },
    { "name": "toolkit", "type": "plugin", "vendorDeps": "bundle",
      "source": { "type": "npm", "package": "@acme/toolkit" } },
    { "name": "backend-dev", "type": "profile",
      "source": { "type": "static", "files": [{ "path": "profiles/backend-dev/AGENTS.md", "target": "AGENTS.md" }] },
      "dependencies": ["routines", "tps", "toolkit"],
      "pi": { "theme": "dark" } }
  ]
}
```

## Immutability

`pipm build` pins every source (npm exact version + `dist.integrity`, git commit
SHA), verifies npm tarball integrity (SHA-512), hashes every vendored file
(SHA-256) plus a per-component Merkle `contentHash`, and writes `pipm-lock.json`.
Consumers re-check file hashes before copying, so a tampered mirror is caught.

## Build

```bash
bun install
bun run build                       # → dist/index.js
bun run build:binary                # → dist/bin/pipm-<platform>
bun run scripts/build-binary.ts --target=linux-arm64
```

## Documentation

Docs live in `docs/` as Markdown (`.mdx` with plain-Markdown bodies — forked from OCX's Mintlify
docs and rewritten for pipm). They publish two ways:

- **Markdown** — read `docs/**/*.mdx` directly, or point a Mintlify site at `docs/docs.json`.
- **Static HTML** — `bun run docs:build` renders every page to `docs/dist/**.html` (self-contained,
  with a sidebar and light/dark styling). Serve that folder anywhere.

On every release (and every push to `main`), `.github/workflows/pages.yml` builds the HTML and
deploys it to GitHub Pages: **https://pi-package-manager.github.io/pipm/**. (One-time: enable
Settings → Pages → Source = "GitHub Actions".)

## Testing

```bash
bun test                 # unit + integration (build → install → verify → remove, tamper detection)
bun run test:binary      # smoke-test the compiled binary (PIPM_DIST_TESTS=1)
```

## Releasing

Releases are driven by `scripts/release.ts`: it bumps the version, builds the JS bundle and the
binary matrix, writes `dist/bin/SHA256SUMS`, updates `CHANGELOG.md`, tags the commit, and can
publish a GitHub Release with the binaries attached.

```bash
# dry run — show the plan
bun run release 0.0.1 --dry-run

# build the 0.0.1 artifacts locally (no git, no publish)
bun run release 0.0.1 --no-git --targets=darwin-arm64,linux-arm64

# full release: build all targets, commit + tag, publish to GitHub
bun run release 0.0.1 --publish        # needs GITHUB_TOKEN + GITHUB_REPOSITORY (from .env)

# or bump keywords
bun run release patch
```

Publishing reads `GITHUB_TOKEN` (or `GH_TOKEN`) and `GITHUB_REPOSITORY` from the environment — put
them in `.env` (gitignored; see `.env.example`). In CI you don't set these by hand: pushing a
`v*` tag triggers `.github/workflows/release.yml`, which runs the same script with the Actions-
provided token. `.github/workflows/ci.yml` runs `bun run check` + `bun test` on every push/PR.

## Development

```bash
bun run check          # biome + tsc
bun run dev -- --help  # run from source
```

Source layout: `src/schemas` (registry/config/lockfile), `src/registry`
(auth/fetcher/resolver), `src/build` (vendor-npm/git/static + build-registry),
`src/install` (pi-home/settings/installer/manage), `src/commands`, `src/cli`.
