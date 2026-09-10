# Electron dependency security remediation

**Repository:** `SteveKinzey/claude-code-tools-installer`  
**Date:** 2026-09-10  
**Status:** Remediation implemented and host-platform package validated. Signed macOS and Windows CI validation remains the release gate for a future public artifact.

## Executive summary

The repository had two open **high-severity Dependabot alerts** in `desktop/package-lock.json`. Both originated from the transitive development dependency `extract-zip@2.0.1`, pulled in by `electron@39.8.10`. GitHub identifies both advisories as path-traversal or arbitrary-file-write risks through malicious symlink entries and lists no patched `extract-zip` version. The remediated dependency graph upgrades Electron to **44.3.0**, which replaces the external vulnerable package with `@electron-internal/extract-zip@1.0.5`. An isolated lockfile test and the updated project audit both return **zero vulnerabilities**. [1] [2]

The upgrade is paired with a package engine requirement of Node **22.12.0 or later**, and all seven desktop CI workflows now use the same explicit baseline plus `npm ci`. The desktop `check` command now includes a permanent security contract and fails on high or critical npm audit findings. Electron 44 brings platform implications: macOS 12 is no longer supported, and Windows x86 and Linux ARMv7 binaries are no longer produced. Current CCTI packaging targets and Windows CI exercise supported 64-bit paths. [3] [4]

## Verified alert inventory

| Alert | Dependency chain | Severity and scope | Affected range | Selected remediation |
| --- | --- | --- | --- | --- |
| #1 — **extract-zip unvalidated symlink path traversal** | `electron@39.8.10` → `extract-zip@2.0.1` | High; development dependency; `desktop/package-lock.json` | `extract-zip <= 2.0.1` | Upgrade Electron to 44.3.0, which removes `extract-zip` from the lockfile. |
| #2 — **extract-zip allows arbitrary file writes through symlink archive entries** | `electron@39.8.10` → `extract-zip@2.0.1` | High; development dependency; `desktop/package-lock.json` | `extract-zip <= 2.0.1` | Upgrade Electron to 44.3.0, which removes `extract-zip` from the lockfile. |

The authenticated repository view confirmed **two open** and **zero closed** alerts. Both are listed as development dependencies and are detected in the desktop lockfile. The GitHub API token used by the command-line integration lacks the `vulnerability_alerts:read` permission, so alert details were reviewed in the authenticated browser and cross-checked using local `npm audit` output. No secret or dependency alert state was changed during that review.

## Implemented remediation

| Area | Change | Security effect |
| --- | --- | --- |
| Direct dependency | `electron` changed from `^39.2.7` (locked 39.8.10) to `^44.3.0`. | Removes the audited `extract-zip@2.0.1` chain. |
| Lockfile | Resolved Electron is 44.3.0; `node_modules/extract-zip` is absent. | Commits a reproducible, audited graph. |
| Node engine | `desktop/package.json` now requires `>=22.12.0`. | Meets Electron 44’s package engine requirement. |
| CI dependency installs | Seven desktop workflows now pin Node `22.12.0` and use `npm ci`. | Prevents lockfile drift and CI/runtime mismatch. |
| Release gate | `npm run security:check` validates the selected Electron line, lockfile, workflow Node baseline, deterministic installs, and `npm audit --audit-level=high`. | Makes reintroduction of this vulnerable chain or high/critical audit findings release-blocking. |
| Manifest diff | Verified manifests are ordered by the signed payload export timestamp and compare active additions only. | Prevents file-picker ordering from reversing added/removed results or treating an external Claude Code version change as a tool deletion. |

## Manifest comparison contract review

The comparison utility accepts exactly two distinct manifest files. Each manifest must be below the local size limit, readable, structurally complete, and have a matching SHA-256 checksum over its canonical `## Manifest payload` before any inventory is parsed. If either check fails, CCTI returns one error and does not reveal a partial result.

The output uses only entries from `## Active tools and additions`. It trims Markdown list entries, excludes recognized “not detected” or empty-inventory placeholder values, deduplicates exact matches, and locale-sorts the resulting sets. It does not interpret version changes, infer tool renames, normalize case, or semantically merge similar item names. The older signed Unix timestamp is **Before** and the newer is **After**. If equal or unavailable, picker order is retained and the output explicitly discloses that fallback. The renderer receives only filenames, ordering mode, and the three output sets; it never receives paths, manifest bodies, raw settings, or hashes.

| Output field | Definition | User-facing rule |
| --- | --- | --- |
| **Added** | `after − before` | Prefix each entry with `+`. Show `No tools added` when empty. |
| **Removed** | `before − after` | Prefix each entry with `-`. Show `No tools removed` when empty. |
| **Unchanged** | `after ∩ before` | Show the count, without implying a preserved runtime was removed. |
| **Order notice** | Timestamp or picker-order mode | Show whether chronological payload timestamps or the disclosed fallback established Before/After. |

## Validation evidence

| Validation | Result |
| --- | --- |
| Authenticated Dependabot review | Confirmed two open high-severity development alerts in `desktop/package-lock.json`. |
| Isolated `electron@43.6.0` lockfile test | Full audit returned zero vulnerabilities; this was a lower-risk fallback line. |
| Isolated `electron@44.3.0` lockfile test | Full audit returned zero vulnerabilities; selected as the current long-lived remediation line. |
| Deterministic installation | `npm ci` completed against the updated lockfile. |
| Production audit | `npm audit --omit=dev --audit-level=high` returned zero findings. |
| Full audit gate | `npm audit --audit-level=high` returned zero findings. |
| Full desktop suite | Passed catalog, components, detail catalog, uninstall/manifest, diagnostics, update, project, and release-config checks. The UI contract verified **96 renderer IDs** and **43 secure bridge methods**. |
| Host package build | Linux x64 Electron 44 package completed. The non-empty archive SHA-256 is `4b4f89d7e956b604d5e49d57432bf5524ada725cf12e26e481af8956d2dd0d58`. |

## Compatibility and release plan

Electron 44 does not support macOS 12, Windows x86, or Linux ARMv7. CCTI’s current Windows Store CI already builds x64 and ARM64 packages. The local Linux package validation targets x64. Before publishing any public artifact, run the signed macOS and Windows CI workflows and test supported targets, including CCTI’s main window, manifest drag-and-drop verification, chronological diff output, native notification behavior, and clean uninstall. No public release tag or existing release artifact was changed by this remediation.

The next planned maintenance pass should investigate the npm deprecation notices from transitive build tooling (`inflight`, `rimraf@2`, `glob@7`, and `boolean`). They are not reported as open vulnerabilities by the clean audit and were not changed in this remediation. Updating `electron-builder` and its dependency tree should be reviewed independently so that packaging behavior remains stable.

## References

[1]: https://github.com/advisories/GHSA-jmr9-qjv8-65gv "extract-zip unvalidated symlink path traversal"
[2]: https://github.com/advisories/GHSA-7pqw-9j4j-h8q3 "extract-zip allows arbitrary file writes through symlink archive entries"
[3]: https://www.electronjs.org/blog/electron-44-0 "Electron 44 release notes"
[4]: https://www.electronjs.org/docs/latest/breaking-changes "Electron breaking changes"
