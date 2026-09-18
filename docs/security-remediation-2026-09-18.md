# CCTI Comprehensive Remediation Update — 2026-09-18

**Update ID:** `CCTI-2026-09-18-COMPREHENSIVE-REPAIR`  
**Repository:** `SteveKinzey/claude-code-tools-installer`  
**Branch:** `fix/release-status-affordances`  
**Release status:** **Validated source update; merge and protected-CI completion pending**

## Objective

This update repairs reproducible defects in the Claude Code Tools Installer desktop application and its release pipeline. The scope is limited to review-binding safety, installation truthfulness, concurrent project-install control, recovery from an unavailable selected project, Electron navigation isolation, trustworthy release-artifact classification, public release publication ordering, Windows portable-release safety, source-bundle reproducibility, current-release documentation, and pull-request validation coverage.

## Security impact

The update strengthens the existing review-first model. A custom skill or marketplace apply action now consumes an opaque, ten-minute reviewed plan rather than rereading editable renderer fields. For copied skills, CCTI rechecks that the source is a direct folder, still contains `SKILL.md`, and has the exact reviewed content manifest before it copies anything. A changed or stale source is rejected.

The Electron primary window now denies renderer-created child windows and in-window navigation. Approved HTTPS destinations are opened through the main-process external-browser boundary; unsafe protocols do not open. This keeps third-party source pages away from the privileged preload bridge.

The installer now reports Complete setup as successful only when the installer exits cleanly **and** CCTI can subsequently verify a usable Claude Code command. Project-component installation acquires its main-process lock before its first asynchronous operation, preventing simultaneous `npm install` calls from racing over one selected project.

Release assurance now rejects checksum sidecars, metadata, generic source archives, and similarly named non-binaries as platform coverage. macOS release automation creates or retains a draft release, uploads the complete asset set, verifies uploaded GitHub asset metadata and checksum-sidecar contents, and only then publishes. It refuses to modify an already-public release. The old unsigned Windows portable-ZIP publication workflow no longer builds or uploads artifacts; Microsoft Store MSIX remains the supported managed Windows path until a separately approved signed Windows workflow exists.

## Changed controls

| Area | Repair | Regression coverage |
|---|---|---|
| Custom additions | Applies only an opaque reviewed plan; local skill manifests are revalidated immediately before copy. | `setup-manager:check`, `action-boundaries:check`, `ui:check` |
| Complete setup | Requires both installer success and verified Claude Code readiness. | `action-boundaries:check`, `ui:check` |
| Component installation | Acquires the exclusive install lock before project inspection or prerequisite work. | `action-boundaries:check`, `ui:check` |
| Setup Manager | Returns a normalized actionable error when a selected project disappears; renderer clears that stale selection. | `setup-manager:check`, `ui:check` |
| Electron isolation | Denies child windows and internal navigation; only valid HTTPS URLs open externally. | `action-boundaries:check`, `ui:check` |
| Release drift | Counts only contracted final platform artifacts, never checksum sidecars, metadata, or source archives. | `release-drift:check` |
| macOS release | Draft-first upload, complete inventory/byte/digest/checksum verification, then publish. | `release-workflows:check` |
| Windows release | Blocks unsigned portable-ZIP construction and public upload; removes write permission. | `release-workflows:check` |
| Source bundles | Creates commit-derived, versioned source-only ZIP/TAR.GZ bundles with checksums. | `release-workflows:check`, shell syntax check |
| CI | Adds pull-request workflow for locked install plus the full `npm run check` gate. | `desktop-validation.yml` |
| Build dependency | Updates `electron-builder` from 26.15.3 to the current maintained v26 release, 26.16.1. | `npm audit --audit-level=high`, complete desktop gate |
| Documentation | Removes stale current-release version, filename, and digest claims. | `release-workflows:check` |

## Migration and rollback

No database, user-data, credential, installation-state, or API migration is required. The reviewed custom-add-on plan is in-memory and expires after ten minutes; users may need to review a custom source again if the application restarts before confirmation.

Rollback is a single Git revert of this update. Reverting restores the prior behavior and does not require data repair. Do **not** revert the Windows upload block without first implementing an immutable-tag, signer-verified Windows release process and confirming the resulting artifact on clean Windows.

## Validation evidence

The full desktop gate passed after the repairs:

```text
cd desktop && npm run check
```

This includes catalog, UI, duplicate-skill, accessibility, portability, setup manager, action boundaries, diagnostics, terminal, update, project prerequisite, project interview, macOS release configuration, release drift, release workflow safety, release alert, security contract, syntax, and high-severity dependency-audit checks. `npm audit --audit-level=high` reported zero vulnerabilities.

The build-tool security check also identified `electron-builder` 26.15.3. The dependency was upgraded to **26.16.1**, the currently maintained v26 release available from npm, and the full validation gate passed again.

A Linux Electron tarball was also built, inspected for the packaged executable and `resources/app.asar`, checksum-recorded locally, and removed from the worktree. The package command's shell wrapper returned a false nonzero status after artifact creation, so package evidence is based on direct archive inspection rather than the wrapper exit code.

## Remaining release gates

The update does not delete or alter any existing public release asset. The historical unsigned Windows portable ZIP remains a public-record decision. Removing or hiding it would change an already-public download and should be performed only after explicit owner confirmation and a release-record review.

GitHub ruleset enforcement is an account-level configuration step: require pull requests, review, conversation resolution, the `Complete desktop validation` check, CodeQL, and dependency review before merging to `main`. The repository source now supplies the missing full validation workflow; it cannot by itself enforce the GitHub branch rule.

No CCTI release has been published by this update. The macOS pipeline is source-hardened but requires a new immutable tag and valid signing/notarization secrets for a controlled artifact release.

## Release status

**Source repair complete. Local validation passed. Pull-request CI, GitHub required-check configuration, and the owner decision on the legacy Windows public ZIP remain pending.**
