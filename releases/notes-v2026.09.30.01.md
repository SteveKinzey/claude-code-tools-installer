# v2026.09.30.01 — Draft release notes

> **Unpublished draft.** This source candidate is not a downloadable release. Do not publish these notes or advertise a platform download until that platform's exact signed artifact, checksum, and release gate have been verified.

## Desktop build updates

- Electron 44.4.5 ([#26](https://github.com/SteveKinzey/claude-code-tools-installer/pull/26)).
- **electron-builder 26.17.0**, updated from 26.16.1 ([#54](https://github.com/SteveKinzey/claude-code-tools-installer/pull/54)).
- Package version updated to `2026.9.3001`; local `.manus/` metadata is excluded from Git.

## Validation and availability

- Desktop contract suite passed locally on macOS for this source candidate; `npm audit --audit-level=high` reported zero vulnerabilities.
- The next release's macOS, Windows, and Linux availability must be recorded from the exact published artifacts and their checksums, not inferred from source or a local unsigned build.
