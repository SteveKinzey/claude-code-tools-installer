# v2026.10.02.01 — Desktop safety and setup reliability

> **Unpublished release draft.** This source is not a new download until the exact-tag macOS, Linux, and Windows build artifacts pass verification and a separate publication is approved. The Windows NSIS installer is intentionally **unsigned**; no Azure signing is used.

## Five confirmations work in Electron again

[PR #60](https://github.com/SteveKinzey/claude-code-tools-installer/pull/60) replaces unsupported `window.prompt()` calls with one in-app exact-phrase confirmation dialog for **Remove Claude Code**, **Uninstall CCTI**, **Remove project package**, **Remove CCTI extras**, and **Start fresh**. Cancel and Escape make no changes. Start fresh also requires a main-process, single-use review that expires after ten minutes and validates the exact deletion phrase.

## Security and responsiveness

- Windows command launches resolve executables through trusted absolute PATH locations rather than the selected project's directory. Project-scoped `npx` runs with an isolated app-owned prefix, preventing a project `.npmrc` from changing the registry for installer operations across macOS, Linux, and Windows.
- Renderer CSP, bounded review maps, a cleanup action lock, repository-source validation, and timeouts on online Compass and anonymous success-count calls narrow failure modes. Windows updater copy now says **integrity check**, not **signed**.
- Computer checkup reduces duplicate Claude checks and bounds parallel skill and backup hashing. Oversized skill manifests fail before content reads. Activity logs, overlapping scans, component search, and catalog toggles do less renderer work.

## CI and identity

[PR #59](https://github.com/SteveKinzey/claude-code-tools-installer/pull/59) updates the SHA-pinned CodeQL `init` and `analyze` actions together to v4.38.2; it does not change app runtime code. This release increments the desktop package and lockfile from `2026.9.3001` to `2026.10.201` for public tag `v2026.10.02.01`.

## Platform evidence required before publication

- **macOS:** signed and notarized arm64 DMG, native-update ZIP, updater metadata, checksums, and Gatekeeper verification from this tag.
- **Linux:** x64 archive, SHA-256 sidecar, keyless Sigstore bundle bound to this tag/workflow, and packaged adapter smoke test.
- **Windows:** unsigned x64 NSIS installer, checksum, updater metadata, and tagged Windows build/provenance evidence. Windows may display SmartScreen warnings; do not claim Authenticode signing.
- **Functional gate:** run at least one formerly broken confirmation flow in the **built app** on an isolated throwaway setup before approving publication.

The [GitHub Release draft](https://github.com/SteveKinzey/claude-code-tools-installer/releases/tag/v2026.10.02.01), when created, is the source of truth for the exact artifacts and their evidence. **Do not publish the draft or update the website without a separate approval.**
