#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DMG_PATH="${1:-}"
MOUNT_POINT=""
MOUNTED=0

usage() {
  cat <<'USAGE'
Usage:
  scripts/verify-signed-macos-dmg.sh /absolute/path/to/Claude-Code-Tools-Installer.dmg

If a path is omitted, the script verifies the only DMG in releases/test-builds/.
The script verifies the mounted app bundle, Gatekeeper assessments, and stapled
notarization ticket. It mounts the disk image read-only and detaches it on exit.
USAGE
}

cleanup() {
  if [[ "$MOUNTED" -eq 1 && -n "$MOUNT_POINT" ]]; then
    hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true
  fi
  if [[ -n "$MOUNT_POINT" && -d "$MOUNT_POINT" ]]; then
    rmdir "$MOUNT_POINT" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if [[ -z "$DMG_PATH" ]]; then
  candidates=()
  while IFS= read -r candidate; do
    candidates+=("$candidate")
  done < <(find "$ROOT_DIR/releases/test-builds" -maxdepth 1 -type f -name '*.dmg' -print 2>/dev/null)
  if [[ "${#candidates[@]}" -ne 1 ]]; then
    echo "Pass an explicit DMG path. Found ${#candidates[@]} candidate DMGs under releases/test-builds/." >&2
    usage >&2
    exit 2
  fi
  DMG_PATH="${candidates[0]}"
fi

if [[ ! -f "$DMG_PATH" ]]; then
  echo "DMG not found: $DMG_PATH" >&2
  exit 2
fi

for command in hdiutil codesign spctl xcrun shasum; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "Required macOS command not found: $command" >&2
    exit 2
  }
done

MOUNT_POINT="$(mktemp -d "${TMPDIR:-/tmp}/claude-tools-dmg.XXXXXX")"
echo "Verifying: $DMG_PATH"
echo "SHA-256: $(shasum -a 256 "$DMG_PATH" | awk '{print $1}')"

echo "\n1. Checking the DMG’s stapled notarization ticket"
xcrun stapler validate "$DMG_PATH"

echo "\n2. Checking Gatekeeper’s DMG assessment"
spctl -a -vv -t open "$DMG_PATH"

echo "\n3. Mounting the DMG read-only"
hdiutil attach -nobrowse -readonly -mountpoint "$MOUNT_POINT" "$DMG_PATH" >/dev/null
MOUNTED=1

APP_PATH="$(find "$MOUNT_POINT" -maxdepth 2 -type d -name '*.app' -print -quit)"
if [[ -z "$APP_PATH" ]]; then
  echo "No .app bundle was found in the mounted DMG." >&2
  exit 1
fi

echo "\n4. Verifying nested code signatures"
codesign --verify --deep --strict --verbose=2 "$APP_PATH"

echo "\n5. Displaying the application signing identity"
codesign -dvvv "$APP_PATH" 2>&1 | grep -E '^(Identifier|TeamIdentifier|Authority)=' || true

echo "\n6. Checking Gatekeeper’s application assessment"
spctl -a -vv -t execute "$APP_PATH"

echo "\nVerification passed: signed app, Gatekeeper assessment, and stapled ticket are valid."
