#!/usr/bin/env bash
# Field Guide Publication Skill: send a failure-only Discord or Slack incoming-webhook alert.
set -euo pipefail

webhook_url="${FIELD_GUIDE_ALERT_WEBHOOK:-}"
provider="${FIELD_GUIDE_ALERT_PROVIDER:-slack}"
dry_run="${FIELD_GUIDE_ALERT_DRY_RUN:-0}"
repository="${GITHUB_REPOSITORY:-unknown-repository}"
run_url="${GITHUB_SERVER_URL:-https://github.com}/${repository}/actions/runs/${GITHUB_RUN_ID:-unknown-run}"
guide_url="${FIELD_GUIDE_URL:-https://stevekinzey.github.io/claude-code-tools-installer/}"

message="Field Guide health check FAILED for ${repository}. Review the run: ${run_url}. Live guide: ${guide_url}"
payload="$(MESSAGE="$message" PROVIDER="$provider" python3 - <<'PY'
import json
import os

key = "content" if os.environ["PROVIDER"].lower() == "discord" else "text"
print(json.dumps({key: os.environ["MESSAGE"]}))
PY
)"

if [[ "$dry_run" == "1" ]]; then
  printf 'MOCK PASS  %s payload prepared without external delivery: %s\n' "$provider" "$payload"
  exit 0
fi

if [[ -z "$webhook_url" ]]; then
  printf 'NOTICE  FIELD_GUIDE_ALERT_WEBHOOK is not configured; skipping external failure notification.\n'
  exit 0
fi

curl --fail --silent --show-error --max-time 20 \
  --request POST \
  --header 'Content-Type: application/json' \
  --data "$payload" \
  "$webhook_url"
printf 'PASS  %s failure notification sent.\n' "$provider"
