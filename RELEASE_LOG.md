# CCTI Desktop Release Log — v2026.10.14.01

## Scope and authoritative version

The owner selected **Claude Code Tools Installer desktop app**, not the unrelated connected freight app or separately deployed website source. Use the established immutable daily-revision convention `vYYYY.MM.DD.RR`; `v1.0.0` would downgrade the existing package identity. This candidate is `v2026.10.14.00` / `2026.10.1400`. A tag, changelog, or build-only artifact does not prove public distribution.

## Phase 1 — Preservation and branch audit

- Fetch all remotes without pruning before capturing branches and worktree identities.
- Preserve all initial refs in a verified complete local Git bundle; retain local-only snapshots that are not demonstrably reachable from current public refs.
- Publish and verify 50 archive tags only for already-public commit histories under owner authorization. Never publish unpublished local work merely to create a public backup tag.
- Independent lineage review identified one finished missing lineage (exact-source unsigned Windows preparation); the remaining divergent lines were superseded or obsolete. Attached owner/concurrent worktrees remain intact.

## Phase 2 — Consolidation

- Merge the finished Windows preparation through [PR #87](https://github.com/SteveKinzey/claude-code-tools-installer/pull/87), final main commit `bc6dfd3dc2c2ca9d7d76c83df1d9f39b9ea8cf24`.
- Repair valid review findings before merging: separate tagged build execution from OIDC/attestation permissions, use the reviewed controller validator, reject impossible calendar tags, and exercise real preparation receipts/refusals.
- Complete local native suite/unpublished production build and required Linux/Windows CI passed. Supplemental native Windows build and isolated attestation passed; independently verify both signatures and byte/feed/source integrity. That supplemental artifact used old public source and is not the final new revision.
- After exact-list owner authorization, delete 25 unchanged unprotected remote branches and two unattached local branches; retain every verified archive tag, complete local backup, main, and attached worktree. Prune stale origin tracking refs. No force push, rule bypass, or worktree removal.
- Re-run complete native suite and production build on actual merged main and again after branch cleanup: passed.

## Phase 3 — Scoped cleanup

- Update README purpose, Electron main/preload/renderer trust boundaries, locked setup/testing/build instructions, environment handling, platform trust, and version/freeze rules.
- Correct curated catalog counts and stale Windows/SignPath claims. Preserve historical changelog entries and add a current freeze baseline.
- No production TODO/FIXME/debugger markers or tracked build-cache/secrets were found in the inspected scope. Do not remove intentional activity logs, safety assertions, or supported compatibility lanes as unused code.
- Format new modules consistently and add a complete source syntax gate. Avoid a broad legacy reformat or an unrelated lint toolchain that would obscure security review.
- Frozen install, full native suite, unpublished production build and syntax/hygiene passed at the documentation checkpoint. Production audit was zero; the build audit still had eight propagated moderate findings from one `sprintf-js` advisory, explicitly retained for Phase 4.

## Phase 4 — Hardening decisions

- Pin existing direct dependency versions; preserve Electron 44.7.0, electron-builder 26.17.0 and electron-updater 6.8.9. Reject the audit's suggested builder downgrade.
- Scope a pinned `global-agent` 4.1.3 override to `@electron/get`. It removes `roarr`/`sprintf-js`, rather than pretending the advisory was withdrawn. Unknown global-agent consumers are not covered: the actual downloader uses `require('global-agent').bootstrap()`, and its six loopback proxy/TLS cases must pass on native platforms.
- Bound process-runner stdout/stderr to a shared 256 KiB Unicode-safe budget. Truncated command data is a failed/incomplete result, not a partially valid successful inventory. Preserve spawn/timeout/error semantics and add actual-runner regressions with stubbed children.
- Add a dedicated maintained unsigned Windows release lane: unprivileged exact-tag install/test/build/lifecycle, separate OIDC attestation, separate release-write draft staging. Do not configure Azure, Store, or a signing provider.
- Bind updater bytes into the signed source predicate. The shared publisher verifies bytes/receipts and both exact-source signatures before publication; provenance is not Authenticode signing.
- The desktop has no HTTP listener, auth routes, or application database. Retain renderer CSP, sandbox/isolation, typed single-use reviews, scoped filesystem and executable rules, and consent-based bounded external calls. HSTS/CORS/auth rate limits/web health endpoints are website responsibilities, not justification for adding a server to this desktop app.
- Secret scan: clean at the consolidation checkpoint. Full current-tree/history scanning and all final native/package trust checks must complete before a release is published.

## Phases 5–6 — Publication and freeze gate

**Pending until exact final evidence is recorded.** Require final clean install, complete native/source tests, zero full/runtime audit, redacted current/history secret scan, exact-head Linux/Windows CI, immutable main/tag/package/lock parity, signed/notarized macOS staging, Sigstore Linux staging, and native unsigned Windows install/launch/uninstall plus both attestation checks. Keep previous public downloads intact until all intended new assets verify.

Publication changes public distribution and updater selection; review the exact staged asset inventory and release notes before the final publication action. Main must enforce PRs and required passing checks, and prevent force pushes/deletion. Do not bypass existing rules. After the verified release is frozen, preserve its tag/bytes; later work uses versioned branches and reviewed PRs. Keep the prior verified public release for rollback rather than overwriting artifacts or moving tags.

## Native staging correction — daily revision 01

The original immutable `v2026.10.14.00` staging tag remains unchanged. Its exact-source macOS signing/notarization, Linux native packaged adapter/Sigstore, and CodeQL passed. Windows NSIS install, main-window launch and uninstall also printed a genuine pass, then the wrapper falsely failed because it tested an unset/stale native `$LASTEXITCODE` after invoking a PowerShell script. The draft was not published.

Prepare `v2026.10.14.01` / package `2026.10.1401` through a new versioned branch/PR rather than moving that tag. Correct only the wrapper status protocol: evaluate script `$?`, propagate a real helper failure, then explicitly clear stale native status after success. Required Windows CI now simulates unset, stale and real-failure cases using the actual workflow wrapper; real installer lifecycle is still required in the final release lane. All runtime/dependency changes from the previous candidate are retained, and all exact-source gates must re-run for this new revision. Prior public downloads remain untouched.
