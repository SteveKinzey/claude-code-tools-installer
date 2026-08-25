#!/usr/bin/env bash
# Read-only verification for a Field Guide GitHub Pages repository using SSH.
set -euo pipefail

REPO_DIR="${1:-$HOME/code/claude-code-tools-installer}"
SSH_HOST_ALIAS="${SSH_HOST_ALIAS:-github-claude-tools}"
OWNER_REPO="${OWNER_REPO:-SteveKinzey/claude-code-tools-installer}"
EXPECTED_REMOTE="git@${SSH_HOST_ALIAS}:${OWNER_REPO}.git"
SSH_BIN="${SSH_BIN:-ssh}"
WORKFLOW_PATH=".github/workflows/deploy-field-guide-pages.yml"
SITE_PATH="docs/installation-guide/site"

PASS=0
FAIL=0

pass() { printf 'PASS  %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf 'FAIL  %s\n' "$1"; FAIL=$((FAIL + 1)); }

if [[ ! -d "$REPO_DIR/.git" ]]; then
  printf 'ERROR  Not a Git repository: %s\n' "$REPO_DIR" >&2
  exit 2
fi

cd "$REPO_DIR"
printf 'Verifying %s\n\n' "$REPO_DIR"

ACTUAL_REMOTE="$(git remote get-url origin 2>/dev/null || true)"
if [[ "$ACTUAL_REMOTE" == "$EXPECTED_REMOTE" ]]; then
  pass "origin uses the expected repository-scoped SSH remote"
else
  fail "origin is '$ACTUAL_REMOTE'; expected '$EXPECTED_REMOTE'"
fi

SSH_OUTPUT_FILE="$(mktemp)"
set +e
"$SSH_BIN" -o BatchMode=yes -o ConnectTimeout=10 -T "git@${SSH_HOST_ALIAS}" >"$SSH_OUTPUT_FILE" 2>&1
SSH_STATUS=$?
set -e
SSH_OUTPUT="$(cat "$SSH_OUTPUT_FILE")"
rm -f "$SSH_OUTPUT_FILE"

if grep -qi 'successfully authenticated' <<<"$SSH_OUTPUT"; then
  pass "SSH key authenticates with GitHub via ${SSH_HOST_ALIAS}"
else
  fail "SSH authentication did not confirm success via ${SSH_HOST_ALIAS}; review 'ssh -vT git@${SSH_HOST_ALIAS}'"
fi

if [[ -f "$WORKFLOW_PATH" ]] \
  && grep -q 'path: docs/installation-guide/site' "$WORKFLOW_PATH" \
  && grep -q 'actions/upload-pages-artifact@' "$WORKFLOW_PATH" \
  && grep -q 'actions/deploy-pages@' "$WORKFLOW_PATH"; then
  pass "GitHub Pages workflow targets the isolated static guide"
else
  fail "GitHub Pages workflow is missing or does not target ${SITE_PATH}"
fi

if [[ -f "$SITE_PATH/index.html" ]] \
  && ! grep -R '/manus-storage/\|/__manus__/' "$SITE_PATH" \
  && ! grep -oE '(href|src)="/[^"]+"' "$SITE_PATH/index.html" >/dev/null; then
  pass "static guide has no managed, preview-only, or root-relative asset paths"
else
  fail "static guide asset boundary check failed"
fi

if git diff --exit-code origin/main..HEAD -- \
  setup-my-claude.sh \
  setup-my-claude-linux.sh \
  setup-my-claude.ps1 \
  releases >/dev/null; then
  pass "installer scripts and release artifacts are unchanged ahead of origin/main"
else
  fail "installer scripts or release artifacts changed ahead of origin/main"
fi

printf '\nSummary: %d passed, %d failed.\n' "$PASS" "$FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
