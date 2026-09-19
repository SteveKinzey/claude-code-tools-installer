#!/usr/bin/env bash
set -euo pipefail

# Runs the immutable runtime's complete checks while keeping the audit gate
# separate from npm 10's retired quick-audit endpoint. The npm 11 client uses
# the supported bulk advisory endpoint and retries only transient registry
# maintenance or throttling responses. Vulnerabilities and all other failures
# remain release-blocking.
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
desktop_dir="$root/desktop"
cd "$desktop_dir"

check_command="$(node -p "require('./package.json').scripts.check")"
security_clause=' && npm run security:check'
case "$check_command" in
  *"$security_clause"*)
    check_without_network_audit="${check_command/$security_clause/}"
    ;;
  *)
    echo "Desktop quality command is missing the required security audit clause." >&2
    exit 2
    ;;
esac

# Run every deterministic product check from the immutable package manifest.
bash -o pipefail -c "$check_without_network_audit"
# Keep the complete, current workflow and dependency policy contract mandatory.
node "$root/scripts/validate-security-remediation.js"

for attempt in 1 2 3; do
  set +e
  audit_output="$(npm exec --yes --package=npm@11.6.2 -- npm audit --audit-level=high 2>&1)"
  audit_status=$?
  set -e
  printf '%s\n' "$audit_output"

  if [[ "$audit_status" -eq 0 ]]; then
    exit 0
  fi

  if [[ "$attempt" -lt 3 ]] && grep -Eqi '503 Service Unavailable|429 Too Many Requests|performing maintenance' <<<"$audit_output"; then
    printf 'Retrying transient npm bulk advisory audit failure (attempt %s/3).\n' "$((attempt + 1))" >&2
    sleep 15
    continue
  fi

  echo "Dependency audit failed; refusing to continue the release." >&2
  exit "$audit_status"
done
