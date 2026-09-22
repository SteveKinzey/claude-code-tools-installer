# Changelog

All notable changes are documented in this file. Version tags use the calendar-based format `vYYYY.MM.DD`.

## v2026.09.22 — Complete setup verification and cross-platform release delivery

> **Release status:** Prepared for a signed, notarized macOS release and a keylessly signed Linux archive. A source commit is not a downloadable desktop release until the GitHub Release contains the matching verified assets and integrity evidence.

### Terminal-free setup clarity

- Added the Step 1 **Verify setup** panel. It reads known local status for Claude Code, Bun, gstack, installed skills, Repomix, MCP connections, supported plugins, and the Anthropic Skills marketplace without opening Terminal or changing configuration.
- Complete setup now installs its supported recommended plugins inside CCTI rather than leaving a plugin-command checklist for users to run manually.
- Classified gstack’s optional CSO image notice as informational. CCTI now reports gstack ready when its actual setup, version, browser-helper, and health-skill markers are present.
- Preserved a truthful Windows boundary: gstack upstream setup remains unavailable on Windows until its source supports that platform.
- Clarified that Microsoft Store MSIX submission is separate from the CCTI app’s setup experience. No MSIX package, Partner Center submission, or Windows distribution change is part of this release.

### Cross-platform release delivery

- Adds manual staging and shared-publish gates for one draft GitHub Release containing notarized macOS updater assets and a versioned Linux x64 archive.
- The Linux artifact requires a conventional SHA-256 sidecar and a keyless Sigstore bundle bound to the exact tag and GitHub Actions workflow before publication.
- Preserves the Windows delivery boundary: CI and Store-path validation do not create or attach a standalone signed Windows binary.

### Validation

- Full desktop suite passed, including the new app-managed Complete setup and read-only verification regression test.
- `npm audit --audit-level=high` reported zero vulnerabilities.

## v2026.09.21 — Native macOS updater release

> **Release status:** [`v2026.09.21`](https://github.com/SteveKinzey/claude-code-tools-installer/releases/tag/v2026.09.21) is a public macOS release at immutable commit `f2d6a551338341b44641d45ceb0399dade5b26c4`. It includes a notarized arm64 DMG, native update ZIP, `latest-mac.yml`, and detached SHA-256 files. Windows evidence is CI validation for the tagged commit; Linux evidence is a locally packaged, adapter-tested archive only. Neither is a public Windows or Linux binary for this tag.

### Native macOS update delivery

- Published signed arm64 DMG and native updater ZIP with `latest-mac.yml` and detached SHA-256 checksums.
- Verified the public manifest SHA-512 entries and byte sizes against the release DMG and ZIP.
- Verified the downloaded DMG staple, deep code signature, and Gatekeeper assessment as `accepted` from a Notarized Developer ID.
- Performed a real in-place update from installed v2026.9.20 to v2026.9.21. The app downloaded and verified the public ZIP, required an explicit **Restart to Update**, then relaunched the replaced `/Applications` bundle as v2026.9.21.
- Confirmed native ShipIt waits until every CCTI process has quit before replacing the target app bundle; this is expected safety behavior, not a silent update path.

### Release automation and validation

- Hardened installer and release safety controls, including macOS release-asset replacement handling and checkout-action maintenance.
- Corrected Windows component-lock validation and stabilized Windows setup-manager fixture cleanup.
- Validated PowerShell and Windows Terminal fixed adapters on the exact tagged commit in [GitHub Actions run 35456328468](https://github.com/SteveKinzey/claude-code-tools-installer/actions/runs/35456328468). The test built/extracted a packaged Windows app and replayed verified fixtures from selected project directories.
- Built a clean Linux x64 archive locally and verified `resources/app.asar`, GNOME Terminal, and Konsole adapters against packaged application code. This remains local-package evidence until a signed public Linux asset and release workflow exist.

### Evidence boundary

- Later workflow runs on commits after `f2d6a551…` do not change the validation result for v2026.09.21 and must be reported separately when assessing current `main`.

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
