# Changelog

All notable changes are documented in this file. Version tags use the calendar-based format `vYYYY.MM.DD`.

## v2026.09.11 — Security-hardened Store readiness release

> **Release status:** This is a source and release-process update. It does not attach or replace a platform binary. The latest verified downloadable artifacts remain on [`v2026.08.12`](https://github.com/SteveKinzey/claude-code-tools-installer/releases/tag/v2026.08.12). The Microsoft Store MSIX route remains unsubmitted until exact Partner Center identity, package, and certification evidence exist.

### Security and release process

- Audited all GitHub Actions workflows for token scope, secret exposure paths, unsafe triggers, cache use, and supply-chain integrity.
- Pinned every workflow action to a reviewed full commit SHA and enabled a repository policy requiring SHA-pinned Actions.
- Disabled persisted checkout credentials in every workflow.
- Reduced GitHub Pages write and OIDC permissions to the jobs that require them.
- Scoped macOS signing/notarization and Store identity values to only the workflow steps that consume them.
- Changed the privileged macOS signing and publishing workflow to manual dispatch against an existing date-formatted tag; creating a tag no longer triggers a release automatically.
- Added a weekly Monday dependency security workflow. It installs the lockfile without lifecycle scripts, runs the desktop and workflow security contracts, scans npm dependencies, and retains a JSON audit report for 30 days.
- Kept Dependabot enabled for daily npm updates, weekly GitHub Actions updates, and pull-request dependency review for high-severity findings.

### Microsoft Store MSIX readiness

- Replaced generic Windows Store packaging with explicit `x64` and `ARM64` Electron Builder scripts.
- Added guarded non-production fixture modes for Store-bundle and clean-Windows lifecycle tests, avoiding Partner Center identity values during CI validation.
- Added bundle validation for exactly one x64 and one ARM64 AppX package, manifest identity checks, package installation, app launch, removal, and checksum output.
- Removed alternate signed-EXE distribution wording and retained the Store-only Windows delivery boundary in documentation.

### Desktop reliability and safety

- Resolved the repeated Claude Code checking loop with bounded process timeouts and user bypass controls.
- Added a complete typed-acknowledgment app uninstall flow that preserves Claude Code and exports a manifest before removal.
- Added manifest checksum, timestamp, export-location, terminal verification, and integrity-difference reporting.
- Added shareable local desktop diagnostic reports and background release-update status.
- Added project prerequisite planning and private, reviewable Project Interview PRD drafting.

### macOS distribution readiness

- Added a branded macOS application icon and strengthened signed/notarized build validation.
- Improved signing identity guidance, notarization order, DMG verification, and release checksum handling.

### Validation

- Full desktop contract suite passed.
- `npm audit` and production-only npm audit returned zero known vulnerabilities at release preparation time.
- GitHub Actions static security analysis completed with no findings after remediation.
- The Windows Store MSIX fixture bundle and clean install lifecycle passed on GitHub-hosted Windows runners before this release.
- GitHub Pages deployment and live Field Guide health checks passed after the action runtime upgrades.

## v2026.08.12

Initial verified multi-platform CCTI release. See the [GitHub release record](https://github.com/SteveKinzey/claude-code-tools-installer/releases/tag/v2026.08.12) for released asset names, checksums, and platform-specific verification evidence.
