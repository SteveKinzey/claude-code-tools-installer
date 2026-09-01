# Hosted Package Verification — 2026-08-31

This record separates completed package checks from an interactive installation test on a person’s computer.

## macOS test artifact

GitHub Actions run `33446353333` built the source at commit `6c41cce` on `macos-14`. It installed desktop dependencies, ran `npm run check`, produced an unsigned DMG and ZIP, and uploaded them as a seven-day test artifact.

The packaged source uses CCTI’s in-app **Yes, install Claude Code** action. The action runs the bundled macOS adapter, waits for the official Claude Code installer, re-checks `claude --version`, and returns a result to the app. The macOS artifact is not signed, notarized, or published as a replacement release.

> The hosted build verifies packaging and source contracts. It does not prove that a person launched the DMG, approved any macOS security prompt, or completed the interactive Claude Code installation on a Mac.

GitHub Actions run `33450635013` added a native delivery guard before upload. On `macos-14`, it mounted the generated DMG and required `Claude Code Tools Installer.app` at the image root while rejecting top-level `README.md` and `setup-my-claude.md`. It also required the ZIP to contain the app bundle. The artifact archive downloaded without ZIP errors and contains a 109,797,737-byte DMG plus a 109,928,108-byte ZIP.

The user reported that macOS described the unsigned test DMG as damaged. The native build and archive tests do not support calling the image corrupted, but they also do not make the app trusted by macOS. Do not direct ordinary users to the unsigned artifact or instruct them to bypass macOS protection. A normal direct Mac release remains blocked until a Developer ID-signed and notarized build can be created and opened successfully by a user.

## Windows ZIP test artifact

GitHub Actions run `33447081470` built the source at commit `4834dff` on `windows-2022`. It installed dependencies, ran `npm run check`, produced an unsigned Windows ZIP, extracted the ZIP, and verified that it contained both `Claude Code Tools Installer.exe` and the bundled `setup-my-claude.ps1` resource.

That source includes the reviewed installed-plugin On/Off controls and background installation state. The ZIP is a temporary test artifact, not a signed EXE and not a public release replacement.

> The hosted Windows check proves the archive was built and contains the required packaged files. It does not prove a person launched the app or completed a Windows installation flow.

## Next release gate

Before either test artifact replaces a public download, a person should open it on the matching operating system and confirm that **Yes, install Claude Code** remains in CCTI, runs the official installer, waits for the result, and never downloads a shell or PowerShell script for the user to run manually.
