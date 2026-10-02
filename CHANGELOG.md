# Changelog

All notable changes are documented in this file. Version tags use the calendar-based format `vYYYY.MM.DD`.

## Unreleased

### Pinned third-party setup code

- The macOS, Linux, and Windows adapters no longer run third-party code at `@latest` or at an unversioned "whatever npm/GitHub serves today". Every package or repository that setup downloads and runs is pinned in one `CCTI pinned third-party setup code` block near the top of each adapter:
  - npm (exact versions): `skills` 1.7.0 (skill installs), `claude-mem` 13.28.0, `@playwright/mcp` 0.0.83 (Playwright MCP registration), `repomix` 1.18.1 (global CLI and the Repomix MCP registration), `bun` 1.4.2 (gstack prerequisite, macOS/Linux), `@colbymchenry/codegraph` 1.6.1, `firecrawl-cli` 1.25.1, `@musistudio/claude-code-router` 3.1.1.
  - gstack: fetched by commit `7fca42ad8b6c707b8a38f579f72bf3c4f7de6d85` (`git fetch --depth 1 origin <sha>`, detached checkout) into a staging folder; CCTI verifies `git rev-parse HEAD` equals the pin before moving it into `~/.claude/skills/gstack`, and stops with nothing installed otherwise. gstack's `./setup` only runs after that verification. An existing gstack checkout is still left as it is (its commit is logged).
- Global npm installs record the bare package name in the manifest as before, so rollback is unchanged. MCP servers that are already registered are not rewritten.
- Reference repositories that are cloned only for reading (never executed) stay on their default branch.
- New `scripts/test-pinned-setup-code.js` (part of `npm run check`) fails if an adapter, `desktop/src/main.js`, or the catalogs run an `@latest` or unversioned third-party `npx`/global npm package, if gstack is not fetched by a verified SHA, or if the three adapters' pins differ.

**How to bump a pin:** check the new release (`npm view <pkg>@<version> dist.integrity`, or `git ls-remote https://github.com/garrytan/gstack.git HEAD` for gstack), change the one line in the pin block of `setup-my-claude.sh`, `setup-my-claude-linux.sh`, and `setup-my-claude.ps1` to the same value, run `cd desktop && npm run check`, and note the bump here.

## v2026.10.02.01 — Desktop safety, working confirmations, and responsiveness

> **Release boundary:** This entry describes the tagged source. macOS, Windows, and Linux downloads exist only after the exact-tag artifacts pass their own staging gates and a separate GitHub Release publication is approved. Windows NSIS remains unsigned.

### Five confirmation flows repaired ([#60](https://github.com/SteveKinzey/claude-code-tools-installer/pull/60))

- Replaced Electron 44's unsupported `window.prompt()` with an in-app, exact-phrase confirmation dialog for **Remove Claude Code**, **Uninstall CCTI**, **Remove project package**, **Remove CCTI extras**, and **Start fresh**. Cancel and Escape make no change.
- Added a main-process, single-use Start fresh review with a ten-minute expiry and an exact `DELETE CLAUDE DATA` check before any deletion.

### Security and performance ([#60](https://github.com/SteveKinzey/claude-code-tools-installer/pull/60))

- Resolve Windows executables from trusted absolute PATH entries rather than an untrusted project folder; isolate project-scoped `npx` from the project's `.npmrc` in macOS, Linux, and Windows adapters.
- Add renderer Content-Security-Policy, bounds for review maps, an action lock for cleanup, repository-source validation, and timeouts for online Compass and anonymous success-count requests. Windows updater messages describe integrity checks, not signatures; the installer is unsigned.
- Check Claude once per scan, parallelize bounded skill/backup hashing, reject oversized skill manifests before reading contents, and reduce renderer work for activity logs, overlapping scans, component search, and catalog toggles.

### CI maintenance ([#59](https://github.com/SteveKinzey/claude-code-tools-installer/pull/59))

- Pin CodeQL `init` and `analyze` together to reviewed action v4.38.2; no application-code change from this PR.
- Bump the desktop package and lockfile from `2026.9.3001` to `2026.10.201` for `v2026.10.02.01`. See the exact-tag draft release for platform-specific verification and built-app confirmation evidence.

## v2026.09.30.01 — Release preparation

> **Release status:** Source-only release candidate. No signed or verified platform artifacts have been staged or published for this version. Download availability remains tied to existing verified GitHub releases.

### Desktop build dependencies

- Updated Electron to 44.4.5 ([#26](https://github.com/SteveKinzey/claude-code-tools-installer/pull/26)).
- Updated electron-builder from 26.16.1 to **26.17.0** ([#54](https://github.com/SteveKinzey/claude-code-tools-installer/pull/54)).

### Release readiness

- Bumped the desktop package and lockfile from `2026.9.2605` to `2026.9.3001` for the proposed `v2026.09.30.01` tag.
- Excluded local `.manus/` metadata from Git. Signing, platform validation, checksums, and publication remain separate gates.

## v2026.09.22 — Complete setup verification and cross-platform release delivery

> **Release status:** Prepared for a signed, notarized macOS release and a keylessly signed Linux archive. A source commit is not a downloadable desktop release until the GitHub Release contains the matching verified assets and integrity evidence.

### Terminal-free setup clarity

- Added the Step 1 **Verify setup** panel. It reads known local status for Claude Code, Bun, gstack, installed skills, Repomix, MCP connections, supported plugins, and the Anthropic Skills marketplace without opening Terminal or changing configuration.
- Complete setup now installs its supported recommended plugins inside CCTI rather than leaving a plugin-command checklist for users to run manually.
- Classified gstack’s optional CSO image notice as informational. CCTI now reports gstack ready when its actual setup, version, browser-helper, and health-skill markers are present.
- Preserved a truthful Windows boundary: gstack upstream setup remains unavailable on Windows until its source supports that platform.
- Clarified that Windows distribution is separate from the CCTI app’s setup experience. No Windows distribution change is part of this release.

### Cross-platform release delivery

- Adds manual staging and shared-publish gates for one draft GitHub Release containing notarized macOS updater assets and a versioned Linux x64 archive.
- The Linux artifact requires a conventional SHA-256 sidecar and a keyless Sigstore bundle bound to the exact tag and GitHub Actions workflow before publication.
- Preserves the Windows delivery boundary: CI does not create or attach a standalone signed Windows binary.

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

## v2026.09.11 — Security-hardened Windows readiness release

> **Release status:** This is a source and release-process update. It does not attach or replace a platform binary. The latest verified downloadable artifacts remain on [`v2026.08.12`](https://github.com/SteveKinzey/claude-code-tools-installer/releases/tag/v2026.08.12). A verified Windows release remains pending.

### Security and release process

- Audited all GitHub Actions workflows for token scope, secret exposure paths, unsafe triggers, cache use, and supply-chain integrity.
- Pinned every workflow action to a reviewed full commit SHA and enabled a repository policy requiring SHA-pinned Actions.
- Disabled persisted checkout credentials in every workflow.
- Reduced GitHub Pages write and OIDC permissions to the jobs that require them.
- Scoped macOS signing/notarization values to only the workflow steps that consume them.
- Changed the privileged macOS signing and publishing workflow to manual dispatch against an existing date-formatted tag; creating a tag no longer triggers a release automatically.
- Added a weekly Monday dependency security workflow. It installs the lockfile without lifecycle scripts, runs the desktop and workflow security contracts, scans npm dependencies, and retains a JSON audit report for 30 days.
- Kept Dependabot enabled for daily npm updates, weekly GitHub Actions updates, and pull-request dependency review for high-severity findings.

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
- GitHub Pages deployment and live Field Guide health checks passed after the action runtime upgrades.

## v2026.08.12

Initial verified multi-platform CCTI release. See the [GitHub release record](https://github.com/SteveKinzey/claude-code-tools-installer/releases/tag/v2026.08.12) for released asset names, checksums, and platform-specific verification evidence.
