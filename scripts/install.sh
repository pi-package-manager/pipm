#!/bin/sh
# pipm installer — forked from OCX's install.sh (MIT), adapted for pipm.
# Downloads a prebuilt binary from GitHub Releases and installs it as `pipm`.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/<owner>/pipm/main/scripts/install.sh | sh
#
# Environment variables:
#   PIPM_VERSION  - version tag to install, e.g. v0.0.1 (default: latest release)
#   PIPM_INSTALL  - install directory (default: /usr/local/bin, else ~/.local/bin)
#   PIPM_REPO     - GitHub owner/repo to download from (default: jsuchy/pipm)
#   CI            - set to skip interactive niceties

set -e

REPO="${PIPM_REPO:-jsuchy/pipm}"
GITHUB_URL="https://github.com/$REPO"

# ── colour output (TTY-aware) ────────────────────────────────────────────────
if [ -t 1 ]; then tty_escape() { printf "\033[%sm" "$1"; }; else tty_escape() { :; }; fi
tty_mkbold() { tty_escape "1;$1"; }
tty_blue="$(tty_mkbold 34)"; tty_red="$(tty_mkbold 31)"; tty_yellow="$(tty_mkbold 33)"
tty_green="$(tty_mkbold 32)"; tty_bold="$(tty_mkbold 39)"; tty_reset="$(tty_escape 0)"
info() { printf "%s==>%s %s\n" "${tty_blue}" "${tty_reset}" "$1"; }
warn() { printf "%sWarning%s: %s\n" "${tty_yellow}" "${tty_reset}" "$1" >&2; }
error() { printf "%sError%s: %s\n" "${tty_red}" "${tty_reset}" "$1" >&2; exit 1; }
success() { printf "%s==>%s %s\n" "${tty_green}" "${tty_reset}" "$1"; }

# ── platform detection ───────────────────────────────────────────────────────
detect_platform() {
    os="$(uname -s)"
    case "$os" in
        Darwin) PLATFORM="darwin" ;;
        Linux) PLATFORM="linux" ;;
        MINGW*|MSYS*|CYGWIN*|Windows_NT) PLATFORM="windows" ;;
        *) error "Unsupported operating system: $os" ;;
    esac

    arch="$(uname -m)"
    case "$arch" in
        arm64|aarch64) ARCH="arm64" ;;
        x86_64|amd64) ARCH="x64" ;;
        *) error "Unsupported architecture: $arch" ;;
    esac

    # Apple Silicon running an x64 shell (Rosetta) → prefer the native arm64 build
    if [ "$PLATFORM" = "darwin" ] && [ "$ARCH" = "x64" ]; then
        if [ "$(sysctl -n sysctl.proc_translated 2>/dev/null)" = "1" ]; then
            info "Rosetta 2 detected — installing native arm64 binary."
            ARCH="arm64"
        fi
    fi

    # musl/Alpine → use the -musl build (only meaningful on linux)
    MUSL=""
    if [ "$PLATFORM" = "linux" ]; then
        if [ -f /etc/alpine-release ]; then
            MUSL="-musl"; info "Alpine Linux detected — using musl build."
        elif ldd --version 2>&1 | grep -q musl; then
            MUSL="-musl"; info "musl libc detected — using musl build."
        fi
    fi

    # pipm ships windows only for x64
    if [ "$PLATFORM" = "windows" ]; then ARCH="x64"; fi
}

# ── version resolution ───────────────────────────────────────────────────────
resolve_version() {
    if [ -n "${PIPM_VERSION:-}" ]; then
        VERSION="$PIPM_VERSION"
        info "Using specified version: $VERSION"
    else
        info "Fetching latest version..."
        VERSION=$(curl --fail --silent --location \
            "https://api.github.com/repos/$REPO/releases/latest" | \
            grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')
        [ -z "$VERSION" ] && error "Could not determine latest version. Set PIPM_VERSION or check your connection."
        info "Latest version: $VERSION"
    fi
}

# ── SHA256 verification (against the release's SHA256SUMS) ────────────────────
compute_sha256() {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
    elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
    elif command -v openssl >/dev/null 2>&1; then openssl dgst -sha256 "$1" | awk '{print $NF}'
    else warn "No SHA256 tool found — skipping checksum verification."; return 1; fi
}

verify_checksum() {
    file="$1"; sums_url="$2"; binary_name="$3"
    expected=$(curl --fail --silent --location "$sums_url" 2>/dev/null | grep " $binary_name\$" | cut -d' ' -f1)
    if [ -z "$expected" ]; then warn "No checksum for $binary_name — skipping verification."; return 0; fi
    actual=$(compute_sha256 "$file") || return 0
    if [ "$expected" != "$actual" ]; then
        error "Checksum verification failed!
Expected: $expected
Actual:   $actual
This may indicate a corrupted download or a security issue. Report: $GITHUB_URL/issues"
    fi
    info "Checksum verified."
}

# ── install ──────────────────────────────────────────────────────────────────
install_pipm() {
    install_dir="$1"
    if [ "$PLATFORM" = "windows" ]; then
        binary_name="pipm-windows-${ARCH}.exe"
    else
        binary_name="pipm-${PLATFORM}-${ARCH}${MUSL}"
    fi

    download_url="$GITHUB_URL/releases/download/$VERSION/$binary_name"
    sums_url="$GITHUB_URL/releases/download/$VERSION/SHA256SUMS"

    info "Downloading pipm $VERSION ($binary_name)..."
    TMP_DIR=$(mktemp -d)
    trap 'rm -rf "$TMP_DIR"' EXIT

    if ! curl --fail --location --silent --show-error --retry 3 "$download_url" -o "$TMP_DIR/pipm"; then
        error "Failed to download from: $download_url
Check that the version exists ($GITHUB_URL/releases/tag/$VERSION) and ships a $PLATFORM-$ARCH$MUSL binary."
    fi

    verify_checksum "$TMP_DIR/pipm" "$sums_url" "$binary_name"

    chmod +x "$TMP_DIR/pipm"
    mkdir -p "$install_dir"
    mv "$TMP_DIR/pipm" "$install_dir/pipm" 2>/dev/null || error "Failed to install to $install_dir. Check permissions."
    success "pipm $VERSION installed to $install_dir/pipm"
}

# ── PATH hint ─────────────────────────────────────────────────────────────────
print_path_instructions() {
    install_dir="$1"
    case ":$PATH:" in *":$install_dir:"*) return ;; esac
    shell_name="$(basename "${SHELL:-/bin/sh}")"
    printf "\n"; warn "$install_dir is not in your PATH."
    case "$shell_name" in
        zsh) printf "  # ~/.zshrc:\n  %sexport PATH=\"%s:\$PATH\"%s\n" "${tty_bold}" "$install_dir" "${tty_reset}" ;;
        bash) printf "  # ~/.bashrc:\n  %sexport PATH=\"%s:\$PATH\"%s\n" "${tty_bold}" "$install_dir" "${tty_reset}" ;;
        fish) printf "  # ~/.config/fish/config.fish:\n  %sset -gx PATH %s \$PATH%s\n" "${tty_bold}" "$install_dir" "${tty_reset}" ;;
        *) printf "  %sexport PATH=\"%s:\$PATH\"%s\n" "${tty_bold}" "$install_dir" "${tty_reset}" ;;
    esac
}

# ── main ──────────────────────────────────────────────────────────────────────
main() {
    detect_platform
    info "Detected platform: $PLATFORM-$ARCH$MUSL"
    resolve_version

    if [ -n "${PIPM_INSTALL:-}" ]; then INSTALL_DIR="$PIPM_INSTALL"
    elif [ -w "/usr/local/bin" ]; then INSTALL_DIR="/usr/local/bin"
    else INSTALL_DIR="$HOME/.local/bin"; fi
    info "Install directory: $INSTALL_DIR"

    install_pipm "$INSTALL_DIR"
    print_path_instructions "$INSTALL_DIR"

    printf "\n"; success "Installation complete!"
    info "Get started:"
    printf "  %spipm --help%s\n\n" "${tty_bold}" "${tty_reset}"
}

main "$@"
