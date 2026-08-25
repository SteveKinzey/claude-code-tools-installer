#!/usr/bin/env bash
# Field Guide Publication Skill: read-only verification of the deployed GitHub Pages guide.
set -euo pipefail

BASE_URL="${1:-https://stevekinzey.github.io/claude-code-tools-installer}"
BASE_URL="${BASE_URL%/}"
PDF_URL="${BASE_URL}/downloads/claude-code-tools-installer-guide-2026.pdf"

html_file="$(mktemp)"
trap 'rm -f "$html_file"' EXIT

pass_count=0

pass() {
  printf 'PASS  %s\n' "$1"
  pass_count=$((pass_count + 1))
}

require_http_200() {
  local url="$1"
  local label="$2"
  local status
  status="$(curl --location --silent --show-error --max-time 30 --output /dev/null --write-out '%{http_code}' "$url")"
  if [[ "$status" != "200" ]]; then
    printf 'FAIL  %s returned HTTP %s: %s\n' "$label" "$status" "$url" >&2
    exit 1
  fi
  pass "$label"
}

printf 'Checking deployed Field Guide: %s\n' "$BASE_URL"

homepage_status="$(curl --location --silent --show-error --max-time 30 --output "$html_file" --write-out '%{http_code}' "${BASE_URL}/")"
if [[ "$homepage_status" != "200" ]]; then
  printf 'FAIL  Field Guide homepage returned HTTP %s\n' "$homepage_status" >&2
  exit 1
fi

grep -Fq 'Claude Code Tools Installer' "$html_file" || {
  printf 'FAIL  Field Guide homepage is missing its expected document title.\n' >&2
  exit 1
}
grep -Fq '<div id="root"></div>' "$html_file" || {
  printf 'FAIL  Field Guide homepage is missing its client application root.\n' >&2
  exit 1
}
pass 'Field Guide homepage returns HTTP 200 with its expected client application shell'

for anchor_id in top protocol starter-stack install safety; do
  require_http_200 "${BASE_URL}/#${anchor_id}" "Internal Field Guide fragment #${anchor_id}"
done
pass 'All published Field Guide fragment routes return the live application shell'

origin="$(printf '%s' "$BASE_URL" | sed -E 's#^(https?://[^/]+).*$#\1#')"

while IFS= read -r asset_path; do
  require_http_200 "${origin}${asset_path}" "Internal static asset ${asset_path}"
done < <(
  grep -oE '(src|href)="/[^"]+"' "$html_file" \
    | sed -E 's/^[^\"]+\"//; s/\"$//' \
    | grep '^/claude-code-tools-installer/' \
    | sort -u
)

require_http_200 "$PDF_URL" 'Downloadable Field Guide PDF'
pdf_content_type="$(curl --location --silent --show-error --max-time 30 --head "$PDF_URL" | awk -F': ' 'tolower($1) == "content-type" {print tolower($2)}' | tr -d '\r')"
if [[ "$pdf_content_type" != application/pdf* ]]; then
  printf 'FAIL  PDF content type was %s\n' "${pdf_content_type:-missing}" >&2
  exit 1
fi
pass 'Downloadable Field Guide PDF has application/pdf content type'

printf 'SUCCESS  %s live health checks passed.\n' "$pass_count"
