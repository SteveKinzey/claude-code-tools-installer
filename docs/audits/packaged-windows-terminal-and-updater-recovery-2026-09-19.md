# Packaged Windows Terminal and Updater Recovery Validation

**Date:** 2026-09-19

**Validated commit:** `d1e59bf905747608fc61379e451dffc3b7835931`

**Windows workflow:** [Test CCTI Windows terminal adapters, run 35453934799](https://github.com/SteveKinzey/claude-code-tools-installer/actions/runs/35453934799)

**Workflow result:** Passed on `windows-2022` in 3 minutes 23 seconds

## Summary

CCTI now verifies its two Windows terminal choices against **packaged application code**, not only the repository source tree. The workflow builds the Windows ZIP, extracts `resources/app.asar`, and invokes CCTI's actual terminal preference and Claude launch handlers from the extracted package. The same change set strengthens updater recovery coverage with a real temporary malformed ZIP fixture.

| Validation area | Result | Evidence boundary |
|---|---:|---|
| Packaged PowerShell adapter | Pass | `app.asar` was extracted; the selected-project marker was written through the fixed PowerShell payload. |
| Packaged Windows Terminal adapter | Pass | `app.asar` was extracted; the selected-project marker was written through the fixed Windows Terminal payload. |
| Fixed adapter contracts | Pass | Cross-platform mocked adapter contract suite passed before the real Windows execution fixture. |
| Full desktop quality gate | Pass | The Windows workflow completed `npm run check` before packaging. |
| Corrupted ZIP recovery | Pass | A real malformed temporary ZIP fixture triggered the updater error state, with retry and install gating asserted. |
| Linux review | Reviewed | The prior Linux package report records real GNOME Terminal and Konsole adapter execution, explicit retry behavior, and de-duplication accessibility scope. |

## Packaged Windows Adapter Evidence

The workflow completed these package-specific steps in order: build the x64 Windows ZIP, extract `resources/app.asar` with the Electron ASAR tool, and point the fixture to the extracted `src/main.js`. The uploaded JSON evidence reported `applicationSource: "<packaged-app-asar>"`.

| CCTI choice | Fixture status | Selected project directory | Headless execution evidence |
|---|---:|---:|---|
| PowerShell | Verified fake `claude.cmd` executed | Preserved | Exact detached payload replayed with `pwsh.exe`; source: `direct-powershell-adapter` |
| Windows Terminal | Verified fake `claude.cmd` executed | Preserved | Exact nested PowerShell payload replayed; source: `windows-terminal-payload` |

The fixture uses a temporary project directory containing spaces and a disposable `claude.cmd` that only accepts `--version` or writes a marker. It checks CCTI's real `terminal:set-preference` and `claude:run` handlers for both choices. It also terminates only fixture-created process trees and deletes its temporary directory.

> GitHub-hosted Windows runners do not have an interactive desktop. This validates CCTI’s packaged detached launch payload and its execution through deterministic PowerShell replay after removing only `-NoExit`. It does **not** claim visual terminal-window or tab presentation evidence.

## Corrupted Update ZIP Recovery

The `updates:check` regression now creates a unique temporary file named `corrupt-signed-update.zip` whose bytes deliberately omit the ZIP `PK` signature. The `electron-updater` boundary emits download progress, then rejects that exact malformed archive through the normal updater `error` path.

| Stage | Required CCTI behavior | Verified |
|---|---|---:|
| Corrupt ZIP rejection | Return to retryable `available` state | Yes |
| Install state | Keep `canInstall: false` | Yes |
| User safety message | State that the current CCTI app was not changed | Yes |
| Install request after error | Reject; do not call `quitAndInstall()` | Yes |
| Explicit retry | Recheck metadata and request a fresh package | Yes |
| Fresh verified download | Transition to `downloaded` and enable installation | Yes |
| Fixture cleanup | Remove the malformed ZIP temporary directory | Yes |

This is a deterministic main-process recovery test. It verifies CCTI’s response after `electron-updater` rejects a malformed archive; it does not replace end-to-end Electron updater signature or SHA-512 verification performed by the packaged native updater.

## Linux, Update, and De-duplication Review

The complete Linux terminal, update recovery, and de-duplication review was reviewed in full. Its source evidence is intentionally scoped and redacted:

- A packaged Linux tarball was extracted and tested under Xvfb and a disposable DBus session.
- GNOME Terminal and Konsole each executed the fixed Claude fixture from distinct selected project paths containing spaces.
- The updater regression covered a partial-download rejection followed by an explicit verified retry.
- The de-duplication audit was fixture-only and redacted real paths, contents, credentials, and environment values.
- The audit records six passing checks and 16 live announcement regions. It covers content-hash collisions, exact backup previews, no-overwrite restoration, newest backup selection, corrupted manifests, missing backup files, and hidden-Electron dialog semantics.

The Linux evidence is not a formal accessibility certification. It proves the reviewed dialog semantics and keyboard flow in a hidden Electron renderer; real assistive-technology validation remains a separate target-platform activity.

## Reusable Skill Update

The reusable CCTI Terminal Updater Release skill now requires packaged Windows ZIP / ASAR validation for the Windows adapters and a physical malformed ZIP fixture for updater recovery. Its terminal adapter reference also defines the headless Windows evidence boundary and the expected corrupted-ZIP retry checks. The skill passed the `/skill-creator` validator after the update.

## Regression Evidence

The current source passed:

```text
npm --prefix desktop run check
npm --prefix desktop run terminal-adapters:check
npm --prefix desktop run updates:check
```

The Windows workflow also ran the complete desktop quality gate, fixed adapter contracts, the Windows ZIP build, packaged-ASAR extraction, and the two-adapter fixture before uploading its minimal JSON evidence.
