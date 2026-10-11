# CCTI Functionality and Recovery Guide

**Status:** Source-grounded product guide
**Scope:** Desktop workflow behavior as implemented in the audited source, including repairs that need a new packaged release. This is not a claim that the installed app or published binaries contain these repairs, nor a release-certification, signing, or platform-compatibility claim.

## Start with the safe boundary

CCTI shows choices, plans, and local observations. It does not install an extra merely because it is listed, and connected Compass consent does not authorize remote installation, commands, configuration changes, credential access, or device control.

The desktop private answer source is [`desktop/src/renderer/workflow-help.js`](../desktop/src/renderer/workflow-help.js). It is loaded before [`app.js`](../desktop/src/renderer/app.js), so workflow and recovery questions are answered before catalog comparison or matching. The desktop online consent wording is in [`desktop/src/renderer/index.html`](../desktop/src/renderer/index.html).

## Complete setup recovery and verification

When a supported setup needs attention:

1. Choose **Complete setup** after reviewing the in-app confirmation.
2. Choose **Verify setup** for a read-only local result.
3. Read each result rather than assuming every third-party or account step is complete.

`verifySetupStatus` in [`desktop/src/main.js`](../desktop/src/main.js) checks:

- Claude Code readiness;
- Bun readiness for gstack;
- gstack skill and browser-helper files on supported platforms;
- `taste-skill` and `Planning with Files` in the selected scope;
- the Repomix command and its direct Claude Code connection check;
- the direct Playwright connection check;
- supported plugin and marketplace entries.

On Windows, gstack is explicitly **unavailable**, not reported as a failed installation. Verification directly checks the Repomix and Playwright connections; it does not health-check every connection on a computer. Plugin presence is read through Claude Code's plugin command. Do not tell a person to repair plugins or connections by editing `settings.json`: CCTI does not use that as a repair instruction.

## Global and project skill scope

The **Complete setup** scope selector applies to `taste-skill` and `Planning with Files` only:

| Choice | Result |
|---|---|
| Global | Those two skills are made available in the user's Claude Code skill location. |
| Existing or new project | Those two skills are placed in the selected project's skill location. |

**gstack, supported plugins, MCP connections, and command-line tools stay in the Claude Code setup.** They are not copied into a selected project simply because the two skills use project scope. `verifySetupStatus` checks the scope selected for verification.

## Private Project Interview and PRD

The Project Interview is rendered by [`desktop/src/renderer/app.js`](../desktop/src/renderer/app.js) with questions and draft generation from [`desktop/src/project-interview.js`](../desktop/src/project-interview.js). It:

- keeps answers on the local device;
- creates a first-draft PRD that the person can save;
- separates suggestions for local Claude Code tools from packages for one chosen project;
- adds only user-selected suggestions to review lists; and
- still requires a final plan review before installation.

An interview is advice and a draft, not an installation or pre-approval.

## Terminal preference, profile, test, and report

CCTI offers only detected, supported terminal adapters. It does not accept an arbitrary terminal path or custom shell command. A selected iTerm2 profile is detected and stored as a CCTI preference on macOS. **Test selected terminal** uses CCTI's fixed test action. A missing saved terminal visibly falls back to a detected default.

The terminal report is built in `buildTerminalReport` in [`desktop/src/main.js`](../desktop/src/main.js). It is local and is saved only through the native save dialog. It deliberately excludes executable and project paths, commands, shell output, environment values, other profile names, account names, computer names, and other machine identifiers.

## Inventory: record versus observed state

**Check this computer** is read-only. It can also inspect one selected project. The current scan is the state CCTI presents as current. The CCTI inventory ledger is only an advisory record of what CCTI previously recorded; it does not override an observed result.

Settings files, runtimes, and project packages are inventory information only. Several can be normal, and CCTI does not apply a generic duplicate rule to them. The relevant scan, reconciliation, and ledger modules are under [`desktop/src/inventory/`](../desktop/src/inventory/).

## Duplicates, conflicts, reviews, and restores

CCTI does not add a duplicate skill. It first shows the matching locations and asks for a review. Eligible skill cleanup moves a reviewed folder to a backup rather than silently deleting it.

A backup can be restored only when the original skill folder is absent. The restore logic in `listRestorableSkillBackups` refuses to overwrite an active destination and does not automatically restore an older backup when a newer backup targets the same original location. If a review expires or a current-state recheck finds a change, CCTI reports that no change was made and asks for a new review.

For discovered plugins, an enable/disable action changes whether the plugin is on at a scope; it is not a generic plugin-file delete. Duplicate-resolution actions are separately re-read before execution.

## Extras, removal, and Start fresh

| Action | What it does | What it does not do |
|---|---|---|
| Turn an extra **Off** | Removes it from the current installation plan. | Does not remove existing software. |
| Plugin enable/disable | Changes whether that discovered plugin is enabled in its scope. | Does not delete plugin files. |
| Skill cleanup | Moves the reviewed eligible skill folder to a backup. | Does not silently delete it or overwrite an active restore destination. |
| **Start fresh** | After an exact, single-use review and typed `DELETE CLAUDE DATA`, permanently deletes the listed local Claude Code data and runs Complete setup again. | **Does not create an automatic backup.** |

`reviewFreshSetup` and `takeFreshSetupReview` in [`desktop/src/main.js`](../desktop/src/main.js) issue a ten-minute, single-use review and require the exact confirmation. Save anything needed before approving Start fresh.

## Permanently deleting reviewed turned-off copies

This is a separate workflow from setting an extra **Off** in a current plan. After **Check this computer** finds a turned-off add-on or a skill backup:

1. Select **Review turned-off copies**.
2. Select only the copies to delete and choose **Review deletion**.
3. Read the resulting list, type exactly `DELETE`, then choose **Delete permanently**.

The renderer enables the final action only after the reviewed list and exact word are present. This action is irreversible and applies only to the reviewed turned-off copies. It is implemented in [`desktop/src/renderer/app.js`](../desktop/src/renderer/app.js), `turnedOffCopies`, `openPermanentDeleteDialog`, `reviewPermanentDeletion`, and `applyPermanentDeletion`; the main process checks the confirmation again before deletion.

## Installation Manifest: export, local verification, and comparison

Use **Save Installation Manifest** to choose a location for a private Markdown manifest. Its payload lists product names, categories, scopes, available versions, and the state visible at export time. It contains a **Payload SHA-256** that covers the exact UTF-8 bytes of its `Manifest payload` section. The payload deliberately excludes credentials, secrets, account information, conversation content, raw settings, logs, and absolute folder paths.

- **Open Manifest Folder** reveals the file exported in the current CCTI session.
- **Choose Manifest and Verify** opens one saved `.md` or `.txt` file and checks its recorded payload checksum locally.
- **Drop a saved manifest here to verify** performs the same local check on a dropped file; the UI states that manifest content does not leave the computer.
- **Compare Two Saved Manifests** requires exactly two readable saved files. Both must pass their recorded checksums before CCTI compares their active additions and reports added, removed, and unchanged lines. It orders by export timestamp when it can; otherwise it preserves selected order.

A checksum mismatch is not a valid comparison input. CCTI reports it as changed or incomplete rather than trying to repair it; make a fresh export when a current manifest is needed. The export, local chooser/drop verification, and comparison handlers are `exportInstallationManifest`, `verifyInstallationManifest`, `verifyDroppedInstallationManifest`, and `compareInstallationManifests` in [`desktop/src/main.js`](../desktop/src/main.js).

## CCTI-only uninstall versus Claude Code removal

**Uninstall This App** first presents a reviewed CCTI-only list, then requires the exact typed confirmation `UNINSTALL CCTI`. Its ten-minute review covers CCTI local data, configuration, checklists, managed runtime cache, and app-specific preferences/window state. The reviewed app-uninstall plan explicitly protects the Claude Code CLI, Claude Code settings and history, installed tools, skills, plugins, MCP connections, project files, Claude Desktop, browser extensions, and browser profiles.

**Remove Claude Code from this computer** is a different option, available when Claude Code is installed. Its own review is limited to known Claude Code CLI items and separately states that Claude Desktop, browser extensions, browser profiles, and unrelated Anthropic products are not touched. Do not use the CCTI app-uninstall control when the intended action is Claude Code removal, or vice versa. The two source paths are `resolveAppUninstallPlan`/`applyAppUninstall` and `knownClaudeRemovalPlan`/the Claude-removal handler in [`desktop/src/main.js`](../desktop/src/main.js).

## Remove a project package or reviewed CCTI-managed extras

Project package removal starts from a fresh selected-project check. `reviewProjectPackageRemoval` reads the current package name, version, and `package.json` again; it refuses a changed package, stale discovery, or unsafe package name. The review displays one `npm uninstall --ignore-scripts --no-audit --no-fund -- <package>` action. Applying it requires the exact confirmation `REMOVE PROJECT PACKAGE`, rechecks the package again, and keeps package scripts disabled. It affects the one reviewed package in the selected project, not global tools, skills, add-ons, or another project.

**CCTI-managed extras** have a separate reviewed action list through `reviewManagedExtrasRemoval` and `applyManagedExtrasRemoval`. Read each listed action before applying it. The implementation leaves Claude Code, unrelated tools, non-CCTI projects, and separately managed items alone; separately managed items remain for manual review rather than being silently removed.

## Review a custom skill or add-on source

The **Add your own skill or add-on** panel accepts only one of these review inputs:

- a direct local skill folder containing `SKILL.md` (not a symbolic link or a file);
- a trusted GitHub `owner/repository`; or
- a trusted HTTPS marketplace link ending in `marketplace.json`.

Choose the local-skill scope when relevant and select **Review this add-on**. CCTI rejects incomplete or unsafe sources before it creates a review. Read the exact result, destination, and any shown command, then choose **Add after review** and accept the final confirmation. Adding a marketplace adds that marketplace to the Claude Code setup; it does not install a plugin from it. See `reviewCustomAddOn` and `applyCustomAddOn` in [`desktop/src/main.js`](../desktop/src/main.js), and the panel controls in [`desktop/src/renderer/index.html`](../desktop/src/renderer/index.html).

## Claude Code not found or slow status check

When CCTI says **No, Claude Code is not installed**, select **Yes, install Claude Code** to use Anthropic's official installer inside CCTI. This path waits until the Claude Code readiness check succeeds and does not add optional tools. If the automatic check takes too long, select **Check again** to retry. **Yes, Claude Code is installed** is for the case where it already exists but the timed check did not complete. Read the local activity details when an installation needs attention.

**Run Diagnostics** is a separate local path and runtime check for a not-found problem. Its short UI summary describes Electron, CCTI-command, and sandbox boundaries; the full copy/save report contains local `PATH` entries and must be reviewed before sharing. Neither is sent automatically, and diagnostics does not install or alter Claude Code. The status decisions are in `refreshClaudeStatus` and `installClaudeCode`, and the diagnostics control is `runDiagnostics`, in [`desktop/src/renderer/app.js`](../desktop/src/renderer/app.js).

## Release integrity and update boundaries

Use a public release and its published **SHA-256** digest to check a downloaded desktop archive. A release page or source commit alone is not proof of a signed or certified binary.

- A Windows installer can be unsigned and can show a Windows protection notice. CCTI makes **no promise** about a future signing date, certification, SmartScreen reputation, or automatic Windows updates.
- Linux is a published archive and manual-update path. This guide makes no automatic Linux updater claim.
- The update banner is a notice. Any download, restart, or update action remains under the person's control.
- `isVerifiedDesktopArtifact` in [`desktop/src/main.js`](../desktop/src/main.js) requires an uploaded, positive-size platform archive with a `sha256:<64-hex>` digest for desktop release selection.

No binary, Windows, Linux, signing, or certification validation is asserted by this guide.

## Diagnostics privacy

**Run Diagnostics** produces a local report. Its first line states that it is not sent anywhere. Copying or saving is an explicit user action. The renderer clears temporary sharing controls after about ten minutes; the main process keeps a bounded temporary report cache with the same lifetime before export.
The repaired export creates a new owner-only file and refuses to overwrite an existing filename. Review local account/project paths before sending the full report to anyone.

The relevant implementations are:

- renderer actions and expiry: [`desktop/src/renderer/app.js`](../desktop/src/renderer/app.js), `runDiagnostics` and `scheduleDiagnosticExpiry`;
- bounded local report storage and save dialog: [`desktop/src/main.js`](../desktop/src/main.js), `runDiagnostics`, `rememberDiagnosticReport`, and `exportDiagnosticReport`.

## Compass, consent, and keyboard focus

Private Compass is the default and uses the bundled workflow helper before catalog answers. The optional online path clearly asks before a question and limited recent context leave the device. It never grants installation or computer-control authority.

For keyboard users, Compass stores its opener and returns focus when minimized, including on `Escape`. The Convex Components library moves focus to its Back control when opened and restores focus to the invoker when closed, including on `Escape`. These behaviors are implemented in [`desktop/src/renderer/app.js`](../desktop/src/renderer/app.js), `openCompass`, `minimizeCompass`, `openComponentLibrary`, and `closeComponentLibrary`.
