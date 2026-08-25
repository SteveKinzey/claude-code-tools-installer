#!/usr/bin/env bash
# Verify the Field Guide GitHub Pages workflow and published public assets after an authorized push.
set -euo pipefail

REPO_DIR="${1:-$HOME/code/claude-code-tools-installer}"
OWNER_REPO="${OWNER_REPO:-SteveKinzey/claude-code-tools-installer}"
WORKFLOW_NAME="${WORKFLOW_NAME:-Deploy Field Guide to GitHub Pages}"
SITE_URL="${SITE_URL:-https://stevekinzey.github.io/claude-code-tools-installer/}"
PDF_URL="${PDF_URL:-https://stevekinzey.github.io/claude-code-tools-installer/downloads/claude-code-tools-installer-guide-2026.pdf}"
DISPATCH="${DISPATCH:-0}"

if [[ ! -d "$REPO_DIR/.git" ]]; then
  printf 'ERROR  Not a Git repository: %s\n' "$REPO_DIR" >&2
  exit 2
fi

cd "$REPO_DIR"
git fetch origin main
LOCAL_HEAD="$(git rev-parse HEAD)"
REMOTE_HEAD="$(git rev-parse origin/main)"

if [[ "$LOCAL_HEAD" != "$REMOTE_HEAD" ]]; then
  printf 'ERROR  Local HEAD is not yet pushed to origin/main. Push before verifying Pages.\n' >&2
  exit 2
fi

if [[ "$DISPATCH" == "1" ]]; then
  gh workflow run "$WORKFLOW_NAME" --repo "$OWNER_REPO" --ref main
  printf 'Manual workflow dispatch requested.\n'
fi

RUN_ID="$(gh run list --repo "$OWNER_REPO" --workflow "$WORKFLOW_NAME" --branch main --limit 10 --json databaseId,headSha,status,conclusion --jq ".[] | select(.headSha == \"$REMOTE_HEAD\") | .databaseId" | head -n 1)"
if [[ -z "$RUN_ID" ]]; then
  printf 'ERROR  No Pages workflow run found for remote commit %s.\n' "$REMOTE_HEAD" >&2
  printf '       Use DISPATCH=1 after confirming GitHub Actions is enabled, or wait for the push trigger.\n' >&2
  exit 1
fi

printf 'Watching GitHub Actions run %s for commit %s\n' "$RUN_ID" "$REMOTE_HEAD"
gh run watch "$RUN_ID" --repo "$OWNER_REPO" --exit-status

printf 'Checking published site: %s\n' "$SITE_URL"
curl --fail --silent --show-error --location --head "$SITE_URL" >/dev/null
printf 'Checking PDF download: %s\n' "$PDF_URL"
curl --fail --silent --show-error --location --head "$PDF_URL" >/dev/null

printf 'PASS  GitHub Pages deployment succeeded; site and PDF URLs are live.\n'
