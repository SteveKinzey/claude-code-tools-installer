# Claude Code Tools Installer Desktop

This directory contains the native desktop installer for the complete Claude Code Tools Installer product. It presents the **same original 30-tool curated catalog** as the platform scripts, while treating Claude Code itself as a required core capability.

The desktop app does not embed third-party tools or credentials. On launch, it calls the bundled platform installer in `--bootstrap-only` mode. That installer detects and opens Claude Code when available or starts Anthropic's official native installer in the background. The user can then select any combination of the original tools in the desktop interface and explicitly confirm the installation.

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
