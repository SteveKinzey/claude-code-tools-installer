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
  /^[[:space:]]*# GitHub may ignore make_latest/ { active = 1 }
  active {
    sub(/^          /, "")
    gsub(/\$\{\{ steps\.release\.outputs\.tag \}\}/, "$TAG")
    print
  }
' "$workflow" > "$temp_root/publish-block.sh"

grep -Fq 'make_latest=true' "$temp_root/publish-block.sh" || {
  echo "Simulation setup failed: the workflow does not request make_latest=true." >&2
  exit 2
}
grep -Fq 'X-GitHub-Api-Version: 2026-03-10' "$temp_root/publish-block.sh" || {
  echo "Simulation setup failed: the workflow does not pin the documented GitHub API version." >&2
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
  [[ "$*" == *'X-GitHub-Api-Version: 2026-03-10'* ]] || { echo 'PATCH omitted the required GitHub API version header' >&2; exit 43; }
  if [[ "$*" == *'draft=false'* ]]; then
    [[ "$*" == *'make_latest=false'* ]] || { echo 'publication PATCH must not combine draft=false with make_latest=true' >&2; exit 41; }
    printf 'true' > "$MOCK_PUBLISHED_FILE"
    printf '{"ok":true}\n'
    exit 0
  fi
  [[ "$*" == *'make_latest=true'* ]] || { echo 'latest-pointer PATCH omitted make_latest=true' >&2; exit 42; }
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

if [[ "$1" == 'release' && "$2" == 'view' && "$*" == *'databaseId,isDraft,isPrerelease,assets'* ]]; then
  draft=true
  [[ -f "$MOCK_PUBLISHED_FILE" ]] && draft=false
  asset_id=asset-1
  [[ "${MOCK_CHANGE_INVENTORY:-0}" == 1 ]] && asset_id=replaced-asset
  printf '{"databaseId":393445255,"isDraft":%s,"isPrerelease":false,"assets":[{"id":"%s","name":"fixture.dmg","size":1,"state":"uploaded","digest":"sha256:%064d"}]}\n' "$draft" "$asset_id" 1
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

cat > "$mock_bin/git" <<'MOCK_GIT'
#!/usr/bin/env bash
[[ "$1" == rev-parse ]] || exit 2
printf '%s\n' "$GITHUB_SHA"
MOCK_GIT
chmod +x "$mock_bin/git"


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
  local case_dir="$temp_root/$label"
  mkdir -p "$case_dir"
  local initial='{"databaseId":393445255,"isDraft":true,"isPrerelease":false,"assets":[{"id":"asset-1","name":"fixture.dmg","size":1,"state":"uploaded","digest":"sha256:0000000000000000000000000000000000000000000000000000000000000001"}]}'
  node "$repo_root/scripts/release-inventory.cjs" save "$case_dir/ccti-verified-inventory.json" "$initial"

  set +e
  (cd "$repo_root" && PATH="$mock_bin:$PATH" \
    GITHUB_REPOSITORY='SteveKinzey/claude-code-tools-installer' \
    release_database_id='393445255' \
    MOCK_STATE_FILE="$state_file" \
    MOCK_LOG_FILE="$log_file" \
    MOCK_LATEST_SEQUENCE="$sequence" \
    RUNNER_TEMP="$case_dir" \
    MOCK_PUBLISHED_FILE="$case_dir/published" \
    MOCK_CHANGE_INVENTORY="${MOCK_CHANGE_INVENTORY:-0}" \
    GITHUB_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    TAG='v2099.01.02' \
    bash -euo pipefail "$temp_root/publish-block.sh" >"$stdout_file" 2>"$stderr_file")
  local exit_code=$?
  set -e

  [[ "$exit_code" == "$expected_exit" ]] || {
    echo "$label simulation expected exit $expected_exit, got $exit_code." >&2
    cat "$stderr_file" >&2
    exit 1
  }
  if [[ "${MOCK_CHANGE_INVENTORY:-0}" == 1 ]]; then
    ! grep -q 'PATCH' "$log_file" || { echo 'Changed inventory reached a release mutation.' >&2; exit 1; }
    printf '%s' "$exit_code"
    return
  fi
  grep -Fq 'draft=false -f make_latest=false' "$log_file" || {
    echo "$label simulation did not publish the draft before latest-pointer promotion." >&2
    exit 1
  }
  grep -Fq 'make_latest=true' "$log_file" || {
    echo "$label simulation did not send make_latest=true." >&2
    exit 1
  }
  first_publish_line="$(grep -n -m1 -F 'draft=false -f make_latest=false' "$log_file" | cut -d: -f1)"
  first_promote_line="$(grep -n -m1 -F 'make_latest=true' "$log_file" | cut -d: -f1)"
  (( first_publish_line < first_promote_line )) || {
    echo "$label simulation promoted latest before publication." >&2
    exit 1
  }
  grep -Fq 'X-GitHub-Api-Version: 2026-03-10' "$log_file" || {
    echo "$label simulation did not send the GitHub API version header." >&2
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

changed_exit="$(MOCK_CHANGE_INVENTORY=1 run_case changed 'v2099.01.02' 1)"
echo "Changed-inventory simulation passed: stopped before publication (exit $changed_exit)."
