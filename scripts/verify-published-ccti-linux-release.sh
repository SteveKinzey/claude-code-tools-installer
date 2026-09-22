#!/usr/bin/env bash
# Download and verify a public CCTI Linux archive, SHA-256 sidecar, and Sigstore bundle.
# Usage: verify-published-ccti-linux-release.sh vYYYY.MM.DD [download-directory]
set -euo pipefail

repository="SteveKinzey/claude-code-tools-installer"
tag="${1:-}"
download_dir="${2:-}"

if [[ -z "$tag" ]]; then
  echo "Usage: $0 vYYYY.MM.DD [download-directory]" >&2
  exit 2
fi
[[ "$tag" =~ ^v[0-9]{4}\.[0-9]{2}\.[0-9]{2}$ ]] || { echo "Tag must use vYYYY.MM.DD." >&2; exit 2; }
command -v gh >/dev/null || { echo "gh is required to download release assets." >&2; exit 2; }
command -v cosign >/dev/null || { echo "cosign is required to verify the Sigstore bundle." >&2; exit 2; }

is_draft="$(gh release view "$tag" --repo "$repository" --json isDraft --jq '.isDraft')"
[[ "$is_draft" == false ]] || { echo "Refusing to verify draft release $tag as public evidence." >&2; exit 1; }
cleanup=0
if [[ -z "$download_dir" ]]; then
  download_dir="$(mktemp -d)"
  cleanup=1
else
  mkdir -p "$download_dir"
fi
trap '[[ "$cleanup" == 1 ]] && rm -rf "$download_dir"' EXIT

gh release download "$tag" --repo "$repository" --dir "$download_dir" \
  --pattern '*linux-x64.tar.gz' \
  --pattern '*linux-x64.tar.gz.sha256' \
  --pattern '*linux-x64.tar.gz.sigstore.json'

mapfile -t archives < <(find "$download_dir" -maxdepth 1 -type f -name '*linux-x64.tar.gz' -print | sort)
[[ "${#archives[@]}" -eq 1 ]] || { echo "Expected exactly one Linux archive; found ${#archives[@]}." >&2; exit 1; }
archive="${archives[0]}"
checksum="${archive}.sha256"
bundle="${archive}.sigstore.json"
node "$(dirname "$0")/verify-linux-release-archive.js" "$archive" "$checksum" "$bundle"
cosign verify-blob "$archive" \
  --bundle "$bundle" \
  --certificate-identity "https://github.com/${repository}/.github/workflows/release-linux-signed.yml@refs/tags/${tag}" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  --certificate-github-workflow-repository "$repository" \
  --certificate-github-workflow-ref "refs/tags/${tag}"
printf 'Public Linux release verified: %s\n' "$tag"
