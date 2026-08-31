# Hosted Package Verification — 2026-08-31

This record separates completed package checks from an interactive installation test on a person’s computer.

## macOS test artifact

GitHub Actions run `33446353333` built the source at commit `6c41cce` on `macos-14`. It installed desktop dependencies, ran `npm run check`, produced an unsigned DMG and ZIP, and uploaded them as a seven-day test artifact.

The packaged source uses CCTI’s in-app **Yes, install Claude Code** action. The action runs the bundled macOS adapter, waits for the official Claude Code installer, re-checks `claude --version`, and returns a result to the app. The macOS artifact is not signed, notarized, or published as a replacement release.

> The hosted build verifies packaging and source contracts. It does not prove that a person launched the DMG, approved any macOS security prompt, or completed the interactive Claude Code installation on a Mac.

## Windows ZIP test artifact

GitHub Actions run `33447081470` built the source at commit `4834dff` on `windows-2022`. It installed dependencies, ran `npm run check`, produced an unsigned Windows ZIP, extracted the ZIP, and verified that it contained both `Claude Code Tools Installer.exe` and the bundled `setup-my-claude.ps1` resource.

That source includes the reviewed installed-plugin On/Off controls and background installation state. The ZIP is a temporary test artifact, not a signed EXE and not a public release replacement.

> The hosted Windows check proves the archive was built and contains the required packaged files. It does not prove a person launched the app or completed a Windows installation flow.

## Next release gate

Before either test artifact replaces a public download, a person should open it on the matching operating system and confirm that **Yes, install Claude Code** remains in CCTI, runs the official installer, waits for the result, and never downloads a shell or PowerShell script for the user to run manually.
