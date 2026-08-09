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

## Install

Once a release is published, install the prebuilt binary from GitHub Releases:

```bash
curl -fsSL https://raw.githubusercontent.com/<owner>/pipm/main/scripts/install.sh | sh
# pin a version / dir:
PIPM_VERSION=v0.0.1 PIPM_INSTALL=~/.local/bin curl -fsSL .../install.sh | sh
```

The script detects your OS/arch (incl. Apple-Silicon Rosetta and musl/Alpine), downloads the
matching `pipm-<os>-<arch>` asset from the release, verifies it against the release's `SHA256SUMS`,
and installs it to `/usr/local/bin` (or `~/.local/bin`). Or build from source (below).

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

## Usage

```bash
# Author a registry: registry.jsonc + files/  (see examples/registry-starter)
pipm build ./my-registry --out ./my-registry/registry   # vendors + hashes + locks

# Serve ./registry over any static HTTP host, or use the folder directly.
pipm registry add ./my-registry/registry --name acme     # or an https:// URL
pipm install acme/backend-dev                            # → ~/.pi/agent
pipm add acme/some-skill                                 # add one component
pipm list
pipm verify                                              # SHA-256 integrity
pipm remove some-skill

# install into a different Pi home:
pipm --pi-home /tmp/pi install acme/backend-dev          # → /tmp/pi/agent
PI_CODING_AGENT_DIR=/tmp/pi/agent pi
```

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
