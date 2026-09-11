#!/usr/bin/env bash
# Send a minimal release-artifact drift failure alert without leaking webhook data.
set -euo pipefail

webhook_url="${CCTI_RELEASE_ALERT_WEBHOOK:-}"
provider="${CCTI_RELEASE_ALERT_PROVIDER:-slack}"
dry_run="${CCTI_RELEASE_ALERT_DRY_RUN:-0}"
repository="${GITHUB_REPOSITORY:-SteveKinzey/claude-code-tools-installer}"
run_url="${GITHUB_SERVER_URL:-https://github.com}/${repository}/actions/runs/${GITHUB_RUN_ID:-unknown}"
workflow_name="${CCTI_RELEASE_ALERT_WORKFLOW:-Check CCTI release artifact drift}"

message="${workflow_name} failed for ${repository}. A dated tag is missing a verified executable artifact after its grace period. Review: ${run_url}"
payload="$(MESSAGE="$message" PROVIDER="$provider" python3 - <<'PY'
import json
import os

key = "content" if os.environ["PROVIDER"].lower() == "discord" else "text"
print(json.dumps({key: os.environ["MESSAGE"]}))
PY
)"

if [[ "$dry_run" == "1" ]]; then
  printf 'MOCK PASS  %s release-drift payload prepared without external delivery.\n' "$provider"
  exit 0
fi

if [[ -z "$webhook_url" ]]; then
  printf 'NOTICE  CCTI_RELEASE_ALERT_WEBHOOK is not configured; GitHub Actions remains the release-drift alert record.\n'
  exit 0
fi

if ! curl --fail --silent --show-error --retry 2 --connect-timeout 10 --max-time 20 \
  --request POST \
  --header 'Content-Type: application/json' \
  --data "$payload" \
  "$webhook_url"; then
  printf 'Release-drift alert delivery failed.\n' >&2
  exit 0
fi

printf 'PASS  %s release-drift alert sent.\n' "$provider"
