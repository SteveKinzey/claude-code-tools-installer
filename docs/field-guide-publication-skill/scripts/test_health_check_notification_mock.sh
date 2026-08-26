#!/usr/bin/env bash
# Field Guide Publication Skill: offline payload test; never calls a real webhook.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
notifier="${script_dir}/notify_health_check_failure.sh"

for provider in discord slack; do
  output="$(FIELD_GUIDE_ALERT_DRY_RUN=1 FIELD_GUIDE_ALERT_PROVIDER="$provider" GITHUB_REPOSITORY='example/field-guide' GITHUB_RUN_ID='12345' "$notifier")"
  printf '%s\n' "$output"
  [[ "$output" == *'MOCK PASS'* ]] || { printf 'FAIL  Missing mock pass output for %s.\n' "$provider" >&2; exit 1; }
  if [[ "$provider" == discord ]]; then
    [[ "$output" == *'"content"'* ]] || { printf 'FAIL  Discord payload is missing content.\n' >&2; exit 1; }
  else
    [[ "$output" == *'"text"'* ]] || { printf 'FAIL  Slack payload is missing text.\n' >&2; exit 1; }
  fi
done

printf 'SUCCESS  Mock notification payloads passed with no external delivery.\n'
