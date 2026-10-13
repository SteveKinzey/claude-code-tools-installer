# Real-Mac Validation: Test-Only CCTI Build

## Candidate under test

| Field | Verified value |
|---|---|
| Purpose | Test-only real-Mac validation; **not** a normal public macOS release |
| Source commit | `640b67b` |
| Workflow | GitHub Actions run `38187685693` |
| DMG filename | `Claude Code Tools Installer-2026.8.26-mac-arm64.dmg` |
| Size | 110,468,025 bytes (105.35 MiB) |
| SHA-256 | `3f7f267e2170d7dbb3de2329f9cacbfc8591cc2b7c0f8d5c586defe3e585b080` |
| Staged test download | `/manus-storage/Claude Code Tools Installer-2026.8.26-mac-arm64_d60143cf.dmg` |

This candidate was signed, notarized, stapled, and verified in the macOS workflow. Its normal-release wording and link remain blocked until this real-device test is complete and the owner gives a separate normal-release approval.

> The tester changelog and local-feedback controls were added later in source. They are **not** present in this already-built `640b67b` DMG. Test this candidate’s included product features below. A later signed test build would need its own explicit approval before it could include the new tester controls.

## Tester procedure

1. Download the staged DMG from the CCTI test-only card, open it, and drag **Claude Code Tools Installer** to **Applications**.
2. Launch CCTI from Applications. Confirm the app opens without a damaged-app, Gatekeeper, or signing warning.
3. Check **Details** for a tool and a Convex component. Confirm it explains the choice but does not turn it on or add it to an install plan.
4. Open and close **References**. Confirm ordinary setup still works without opening any outside source link.
5. Use **Run Claude Code** with the normal terminal choice. If a project folder is selected, confirm the launch targets that folder.
6. Open the **Remove Claude Code** preview. Confirm it lists only Claude Code CLI/CCTI-managed items, names Claude Desktop/browser data/extensions as protected, and requires the exact `REMOVE CLAUDE CODE` phrase before enabling removal. Cancel instead of removing a working setup unless a separate deletion test is planned.
7. Test the Claude Code status/recheck/install path appropriate to the Mac. Confirm it uses CCTI’s in-app flow rather than asking for terminal commands.
8. Choose an empty project folder for a project component. Confirm CCTI can prepare `package.json` safely and clearly identifies project versus computer-wide locations.
9. Start **Project Interview**. Confirm it drafts suggestions without selecting or installing anything.
10. Record the result, any exact error text, and whether each step passed, failed, or needs follow-up.

## Evidence and release gate

Preserve the DMG checksum, source commit, workflow evidence, and the tester’s results. A successful test is necessary but not sufficient: normal public macOS release wording or a normal download link still requires a separate owner approval.
