#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="${ROOT_DIR}/releases"
STAGING_DIR="$(mktemp -d)"
PRODUCT_DIR="${STAGING_DIR}/claude-code-tools-installer"

cleanup() {
  find "$STAGING_DIR" -depth -delete 2>/dev/null || true
}
trap cleanup EXIT

mkdir -p "$PRODUCT_DIR" "$RELEASE_DIR"
rm -f "$RELEASE_DIR/claude-code-tools-installer.zip" "$RELEASE_DIR/claude-code-tools-installer-linux.tar.gz" "$RELEASE_DIR/claude-code-tools-installer-windows.zip"
cp "$ROOT_DIR/README.md" "$PRODUCT_DIR/"
cp "$ROOT_DIR/setup-my-claude.sh" "$PRODUCT_DIR/"
cp "$ROOT_DIR/setup-my-claude-linux.sh" "$PRODUCT_DIR/"
cp "$ROOT_DIR/setup-my-claude.ps1" "$PRODUCT_DIR/"
cp -R "$ROOT_DIR/assets" "$PRODUCT_DIR/assets"
mkdir -p "$PRODUCT_DIR/desktop"
cp "$ROOT_DIR/desktop/package.json" "$ROOT_DIR/desktop/catalog.json" "$ROOT_DIR/desktop/README.md" "$ROOT_DIR/desktop/RELEASE_MACOS.md" "$ROOT_DIR/desktop/CERTIFICATE_TRANSFER_MACOS.md" "$PRODUCT_DIR/desktop/"
cp -R "$ROOT_DIR/desktop/src" "$PRODUCT_DIR/desktop/src"
cp -R "$ROOT_DIR/desktop/build" "$PRODUCT_DIR/desktop/build"
mkdir -p "$PRODUCT_DIR/scripts"
cp "$ROOT_DIR/scripts/validate-catalog.js" "$ROOT_DIR/scripts/validate-macos-release-config.js" "$ROOT_DIR/scripts/verify-signed-macos-dmg.sh" "$ROOT_DIR/scripts/build-source-releases.sh" "$PRODUCT_DIR/scripts/"

(
  cd "$STAGING_DIR"
  zip -qr "$RELEASE_DIR/claude-code-tools-installer.zip" claude-code-tools-installer
  tar -czf "$RELEASE_DIR/claude-code-tools-installer-linux.tar.gz" claude-code-tools-installer
  zip -qr "$RELEASE_DIR/claude-code-tools-installer-windows.zip" claude-code-tools-installer
)

echo "Rebuilt cross-platform source archives in $RELEASE_DIR"
echo "The desktop Electron packages remain separate unsigned test builds under releases/test-builds/ until platform signing is complete."
