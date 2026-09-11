#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
script="$root_dir/scripts/notify-release-drift.sh"

bash -n "$script"

slack_output="$(CCTI_RELEASE_ALERT_DRY_RUN=1 CCTI_RELEASE_ALERT_PROVIDER=slack "$script")"
printf '%s' "$slack_output" | grep -Fq 'MOCK PASS  slack release-drift payload prepared without external delivery.'

discord_output="$(CCTI_RELEASE_ALERT_DRY_RUN=1 CCTI_RELEASE_ALERT_PROVIDER=discord "$script")"
printf '%s' "$discord_output" | grep -Fq 'MOCK PASS  discord release-drift payload prepared without external delivery.'

unset CCTI_RELEASE_ALERT_WEBHOOK || true
skip_output="$(CCTI_RELEASE_ALERT_PROVIDER=slack "$script")"
printf '%s' "$skip_output" | grep -Fq 'CCTI_RELEASE_ALERT_WEBHOOK is not configured'

printf 'Release-drift alert helper tests passed.\n'
