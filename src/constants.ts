/**
 * pipm constants — schema URLs, env prefixes, filenames.
 */

// Injected by the bundler (scripts/build*.ts define __VERSION__). Falls back in dev.
declare const __VERSION__: string
export const CLI_VERSION: string = typeof __VERSION__ !== "undefined" ? __VERSION__ : "0.1.0-dev"

export const PIPM_DOMAIN = "pipm.dev"
export const REGISTRY_SCHEMA_URL = `https://${PIPM_DOMAIN}/schemas/v1/registry.json`
export const CONFIG_SCHEMA_URL = `https://${PIPM_DOMAIN}/schemas/v1/config.json`

// Environment variables
export const ENV_PI_HOME = "PI_HOME"
// Pi's own env var that points at a single agent directory.
export const ENV_PI_CODING_AGENT_DIR = "PI_CODING_AGENT_DIR"
// Per-registry auth override prefix, e.g. PIPM_REGISTRY_<ALIAS>_TOKEN
export const ENV_REGISTRY_PREFIX = "PIPM_REGISTRY_"

// Filenames / layout
export const DEFAULT_PI_HOME_DIRNAME = ".pi"
export const AGENT_PROFILE_NAME = "agent"
export const PROFILES_DIRNAME = "profiles"
export const CONFIG_FILENAME = "pipm.jsonc"
export const RECEIPT_DIR = ".pipm"
export const RECEIPT_FILE = "receipt.jsonc"
export const LOCKFILE_NAME = "pipm-lock.json"
export const REGISTRY_OUT_DIRNAME = "registry"
export const REGISTRY_INDEX_FILE = "index.json"
export const COMPONENTS_DIRNAME = "components"
export const WELL_KNOWN_FILE = ".well-known/pipm.json"

export const DEFAULT_COMPONENT_VERSION = "1.0.0"
export const NPM_REGISTRY_BASE = "https://registry.npmjs.org"
