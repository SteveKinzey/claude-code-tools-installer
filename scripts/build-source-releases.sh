#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="${ROOT_DIR}/releases"
cd "$ROOT_DIR"
git diff --quiet && git diff --cached --quiet || {
  echo "Refusing to build a source bundle from an uncommitted worktree." >&2
  exit 2
}

revision="${SOURCE_REVISION:-$(git describe --tags --always --dirty)}"
safe_revision="$(printf '%s' "$revision" | tr -cd 'A-Za-z0-9._-')"
test -n "$safe_revision" || { echo "Could not determine a safe source revision." >&2; exit 2; }

mkdir -p "$RELEASE_DIR"
prefix="claude-code-tools-installer-source-${safe_revision}"
zip_path="$RELEASE_DIR/${prefix}.zip"
tar_path="$RELEASE_DIR/${prefix}.tar.gz"
manifest_path="$RELEASE_DIR/${prefix}.sha256"

git archive --format=zip --prefix="${prefix}/" HEAD > "$zip_path"
git archive --format=tar --prefix="${prefix}/" HEAD | gzip -n > "$tar_path"
{
  shasum -a 256 "$zip_path"
  shasum -a 256 "$tar_path"
} > "$manifest_path"

echo "Built reproducible source bundles for $revision in $RELEASE_DIR"
echo "These are source-only archives. They are not platform installers and must not be attached to executable download cards."
