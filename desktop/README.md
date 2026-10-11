# Claude Code Tools Installer Desktop

This directory contains the native desktop installer for the complete Claude Code Tools Installer product. It presents the **35-choice curated catalog** used by the platform scripts, while treating Claude Code itself as a required core capability.

The desktop app does not embed third-party tools or credentials. On launch, it checks whether Claude Code is installed and says either **Yes, Claude Code is installed** or **No, Claude Code is not installed**. When a person chooses **Yes, install Claude Code**, the app runs the bundled platform adapter in `--claude-only` mode, which invokes Anthropic’s official installer, waits until `claude --version` succeeds, and reports the final result. It does not add optional tools in this path. The separate complete-setup option remains available for people who explicitly want the recommended tool set.

Every curated extra uses an **On** or **Off** control. On adds the reviewed extra to the in-app plan; Off leaves it out and never removes existing software. After confirmation, CCTI checks and prepares supported prerequisites before it runs the extra: for example, gstack on macOS and Linux receives managed Node.js, Git, and Bun setup before gstack runs. Supported skills, CLIs, MCP servers, and fixed plugin installations run inside CCTI. Complete setup installs its supported recommended plugins in the app, then runs the same local readiness checks exposed by the **Verify setup** panel. Users do not need to open Terminal or PowerShell. Account, secret, paid, or unsupported-platform actions remain clear in-app pause states and are never silently configured.

## Local development

Use Node.js 22 or later, then run:

```bash
cd desktop
npm install
npm run start
```

Run the static JavaScript checks with:

```bash
npm run check
```

## Test packages

The package configuration writes test artifacts to `releases/test-builds/`. A public macOS DMG must be Developer ID signed, notarized, and stapled; a public Windows package must use the selected signing path. Do not replace a signed release artifact with an unsigned test package. Follow [`CERTIFICATE_TRANSFER_MACOS.md`](CERTIFICATE_TRANSFER_MACOS.md) to install a Developer ID signing identity securely and [`RELEASE_MACOS.md`](RELEASE_MACOS.md) for the exact macOS release sequence.

## Source of truth

`catalog.json` is the desktop selection catalog. The IDs intentionally match the existing macOS, Linux, and Windows scripts. Validate catalog parity before release.

## Help, recovery, and safe workflow boundaries

**Compass starts privately.** The bundled workflow helper answers recovery, scope, project-interview, terminal, inventory, duplicate/backup, cleanup, permanent deletion, manifests, app-only uninstall, scoped removals, custom-source review, Claude-not-found diagnostics, release, diagnostics, and consent questions before catalog comparisons. The optional online path receives the canonical source and review IDs plus the full current answer, not only a prompt hint; it asks before a question and limited recent context leave the computer, and it never authorizes remote installation, commands, configuration changes, credential access, or device control.

For a supported setup that needs attention, use **Complete setup** and then the read-only **Verify setup** panel. Verification checks Claude Code, Bun/gstack readiness, the selected skill scope, Repomix and Playwright connections, and supported plugin/marketplace entries. gstack is unavailable on Windows rather than a reported setup failure. CCTI reads plugin status through Claude Code; do not ask people to hand-edit a settings file to repair a plugin or connection.

Complete setup scopes `taste-skill` and `Planning with Files` globally or in one chosen project. gstack, supported plugins, MCP connections, and command-line tools remain in the Claude Code setup. The optional private Project Interview creates a local first-draft PRD and suggestions; it does not install them.

**Cleanup distinctions matter:** turning an extra **Off** only removes it from the current plan; plugin enable/disable is not file deletion; eligible skill cleanup is backup-first and restore refuses to overwrite an active destination. **Start fresh is irreversible and has no automatic backup.** It requires an exact, single-use review and typed confirmation before deleting the listed local Claude Code data and rebuilding the recommended setup.

**Turned-off copies are a separate permanent-delete flow.** After a checkup finds a turned-off add-on or skill backup, use **Review turned-off copies**, select the exact copies, use **Review deletion**, then type exactly `DELETE` before **Delete permanently** becomes available. It is irreversible and applies only to the reviewed list.

**Preserve and check an inventory before an app removal.** **Save Installation Manifest** writes a private Markdown payload with a SHA-256 checksum and excludes credentials, raw settings, logs, and absolute paths. Use **Choose Manifest and Verify** or **Drop a saved manifest here to verify** for a local checksum check; **Compare Two Saved Manifests** requires two readable files that both pass their recorded checksums before reporting added, removed, and unchanged additions. **Uninstall This App** is CCTI-only, has a ten-minute review, and requires `UNINSTALL CCTI`; it leaves Claude Code, its tools, project files, Claude Desktop, and browser data alone. **Remove Claude Code from this computer** is a separate reviewed action for known Claude Code CLI items.

**Scope every removal and source review.** A project package needs a fresh selected-project check, a review, and exact `REMOVE PROJECT PACKAGE` confirmation; scripts remain disabled and no other project is touched. CCTI-managed extras have their own review, and separately managed items remain for manual review. For **Add your own skill or add-on**, review only a direct `SKILL.md` folder, trusted `owner/repository`, or trusted HTTPS `marketplace.json` link before **Add after review**. A marketplace addition is not a plugin installation.

**If Claude Code is not found,** use **Yes, install Claude Code** for Anthropic's official installer (no extras), **Check again** for a slow status check, and **Run Diagnostics** for a local path/runtime report. Diagnostics does not display or send the full PATH and does not install or alter Claude Code.

Diagnostics and terminal reports stay local until a person explicitly copies or saves one. Temporary diagnostic sharing controls expire after about ten minutes. Supported terminal preferences use fixed adapters and can be tested without supplying a custom command.

## Release truth

Only an uploaded public desktop archive with a published SHA-256 digest is valid release evidence for update selection. A Windows installer can be unsigned and may show a Windows protection notice; this project makes no promise about a future signing date, certification, SmartScreen reputation, or automatic Windows updates. Linux is a manual archive/release update path. The update banner is notice-only until the person chooses an action. These source rules do not certify a binary or claim Windows/Linux validation.

See [`../docs/functionality-and-recovery-guide.md`](../docs/functionality-and-recovery-guide.md) for the source-path evidence and full workflow guide.
