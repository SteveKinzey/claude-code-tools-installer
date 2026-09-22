#!/usr/bin/env bash
# Simulates the exact final publication block with a mock GitHub CLI.
# It proves both the happy path and a permanently stale /releases/latest pointer.
set -euo pipefail

repo_root="${1:?Usage: $0 /absolute/path/to/ccti-repository}"
workflow="$repo_root/.github/workflows/publish-verified-release.yml"
[[ -f "$workflow" ]] || { echo "Missing workflow: $workflow" >&2; exit 2; }

temp_root="$(mktemp -d "${TMPDIR:-/tmp}/ccti-latest-pointer.XXXXXX")"
trap 'rm -rf "$temp_root"' EXIT
mock_bin="$temp_root/bin"
mkdir -p "$mock_bin"

awk '
  /^[[:space:]]*gh api --method PATCH .*make_latest=true/ { active = 1 }
  active {
    sub(/^          /, "")
    gsub(/\$\{\{ steps\.release\.outputs\.tag \}\}/, "$TAG")
    print
  }
  active && /^[[:space:]]*gh release view .*isDraft,isPrerelease,url/ { exit }
' "$workflow" > "$temp_root/publish-block.sh"

grep -Fq 'make_latest=true' "$temp_root/publish-block.sh" || {
  echo "Simulation setup failed: the workflow does not request make_latest=true." >&2
  exit 2
}
grep -Fq 'releases/latest' "$temp_root/publish-block.sh" || {
  echo "Simulation setup failed: the workflow does not verify /releases/latest." >&2
  exit 2
}

cat > "$mock_bin/gh" <<'MOCK_GH'
#!/usr/bin/env bash
set -euo pipefail
: "${MOCK_STATE_FILE:?}"
: "${MOCK_LOG_FILE:?}"
printf '%s\n' "$*" >> "$MOCK_LOG_FILE"

if [[ "$1" == 'api' && "$*" == *'--method PATCH'* ]]; then
  [[ "$*" == *'make_latest=true'* ]] || { echo 'PATCH omitted make_latest=true' >&2; exit 41; }
  printf '{"ok":true}\n'
  exit 0
fi

if [[ "$1" == 'api' && "$*" == *'releases/latest'* ]]; then
  count="$(cat "$MOCK_STATE_FILE")"
  count=$((count + 1))
  printf '%s' "$count" > "$MOCK_STATE_FILE"
  IFS=',' read -r -a versions <<< "$MOCK_LATEST_SEQUENCE"
  index=$((count - 1))
  if (( index >= ${#versions[@]} )); then index=$((${#versions[@]} - 1)); fi
  printf '%s\n' "${versions[$index]}"
  exit 0
fi

if [[ "$1" == 'release' && "$2" == 'view' ]]; then
  printf 'https://github.com/SteveKinzey/claude-code-tools-installer/releases/tag/%s\n' "$TAG"
  exit 0
fi

echo "Unexpected gh invocation: $*" >&2
exit 42
MOCK_GH
chmod +x "$mock_bin/gh"

cat > "$mock_bin/sleep" <<'MOCK_SLEEP'
#!/usr/bin/env bash
exit 0
MOCK_SLEEP
chmod +x "$mock_bin/sleep"

run_case() {
  local label="$1"
  local sequence="$2"
  local expected_exit="$3"
  local state_file="$temp_root/$label.state"
  local log_file="$temp_root/$label.log"
  local stdout_file="$temp_root/$label.stdout"
  local stderr_file="$temp_root/$label.stderr"
  printf '0' > "$state_file"
  : > "$log_file"

  set +e
  PATH="$mock_bin:$PATH" \
    GITHUB_REPOSITORY='SteveKinzey/claude-code-tools-installer' \
    release_database_id='393445255' \
    MOCK_STATE_FILE="$state_file" \
    MOCK_LOG_FILE="$log_file" \
    MOCK_LATEST_SEQUENCE="$sequence" \
    TAG='v2099.01.02' \
    bash -euo pipefail "$temp_root/publish-block.sh" >"$stdout_file" 2>"$stderr_file"
  local exit_code=$?
  set -e

  [[ "$exit_code" == "$expected_exit" ]] || {
    echo "$label simulation expected exit $expected_exit, got $exit_code." >&2
    cat "$stderr_file" >&2
    exit 1
  }
  grep -Fq 'make_latest=true' "$log_file" || {
    echo "$label simulation did not send make_latest=true." >&2
    exit 1
  }

  printf '%s' "$exit_code"
}

success_exit="$(run_case 'success' 'v2099.01.01,v2099.01.02' '0')"
success_calls="$(cat "$temp_root/success.state")"
[[ "$success_calls" == '2' ]] || { echo "Success simulation should poll twice; got $success_calls." >&2; exit 1; }

stale_exit="$(run_case 'stale' 'v2099.01.01' '2')"
stale_calls="$(cat "$temp_root/stale.state")"
[[ "$stale_calls" == '6' ]] || { echo "Stale simulation should exhaust six polls; got $stale_calls." >&2; exit 1; }

echo "Latest-pointer simulation passed: success advanced after ${success_calls} poll(s); a stale pointer failed after ${stale_calls} bounded poll(s)."
