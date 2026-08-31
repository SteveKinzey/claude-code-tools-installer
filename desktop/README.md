# Claude Code Tools Installer Desktop

This directory contains the native desktop installer for the complete Claude Code Tools Installer product. It presents the **35-choice curated catalog** used by the platform scripts, while treating Claude Code itself as a required core capability.

The desktop app does not embed third-party tools or credentials. On launch, it checks whether Claude Code is installed and says either **Yes, Claude Code is installed** or **No, Claude Code is not installed**. When a person chooses **Yes, install Claude Code**, the app runs the bundled platform adapter in `--claude-only` mode, which invokes Anthropic’s official installer, waits until `claude --version` succeeds, and reports the final result. It does not add optional tools in this path. The separate complete-setup option remains available for people who explicitly want the recommended tool set.

Every curated extra uses an **On** or **Off** control. On adds the reviewed extra to the in-app plan; Off leaves it out and never removes existing software. After confirmation, CCTI runs supported skills, CLIs, MCP servers, and fixed plugin installations itself. Users do not need to open Terminal or PowerShell. Account, secret, paid, or unverified actions remain clear in-app review states and are never silently configured.

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
