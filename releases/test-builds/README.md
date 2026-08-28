# Desktop Test Builds

This directory is reserved for **unsigned local test packages** produced by the desktop installer build commands. Generated artifacts are ignored by version control.

The release workflow is deliberately separated into two layers:

| Artifact | Contents | Distribution status |
|---|---|---|
| Root ZIP, Linux tarball, Windows ZIP | Desktop source, all three platform installers, the complete 30-tool catalog, validation scripts, README, and assets | Complete source distribution |
| `test-builds/` Electron artifacts | Runnable desktop application that bundles the platform installer adapters and complete catalog | Local validation only until signed |
| Public macOS DMG | Signed and notarized desktop application | Must be rebuilt and notarized before publication |
| Public Windows package | Signed and timestamped desktop application | Must be rebuilt and signed before publication |

Do not overwrite an existing signed release with an unsigned test artifact.
