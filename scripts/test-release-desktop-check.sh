#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$(mktemp -d)"
cleanup() {
  rm -rf "$fixture"
}
trap cleanup EXIT

mkdir -p "$fixture/scripts" "$fixture/desktop" "$fixture/bin"
cp "$repo/scripts/run-release-desktop-check.sh" "$fixture/scripts/run-release-desktop-check.sh"
chmod +x "$fixture/scripts/run-release-desktop-check.sh"

cat > "$fixture/desktop/package.json" <<'JSON'
{
  "name": "release-audit-fixture",
  "version": "1.0.0",
  "scripts": {
    "check": "true && npm run security:check"
  }
}
JSON

cat > "$fixture/scripts/validate-security-remediation.js" <<'NODE'
process.exit(0);
NODE

cat > "$fixture/bin/npm" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "exec" ]]; then
  count_file="${CCTI_AUDIT_FIXTURE_COUNT:?}"
  count=0
  [[ -f "$count_file" ]] && count="$(cat "$count_file")"
  count=$((count + 1))
  printf '%s' "$count" > "$count_file"
  if [[ "$count" -eq 1 ]]; then
    echo '503 Service Unavailable - We are currently performing maintenance.' >&2
    exit 1
  fi
  echo '{"metadata":{"vulnerabilities":{"high":0,"critical":0}}}'
  exit 0
fi

echo "Unexpected npm fixture invocation: $*" >&2
exit 9
SH
chmod +x "$fixture/bin/npm"

count_file="$fixture/audit-count"
PATH="$fixture/bin:/opt/homebrew/opt/node@22/bin:$PATH" \
  CCTI_AUDIT_FIXTURE_COUNT="$count_file" \
  bash "$fixture/scripts/run-release-desktop-check.sh" > "$fixture/output.log" 2>&1

test "$(cat "$count_file")" = 2
grep -Fq 'Retrying transient npm bulk advisory audit failure (attempt 2/3).' "$fixture/output.log"
grep -Fq '"critical":0' "$fixture/output.log"
printf '%s\n' 'Release desktop audit gate retry fixture passed.'
