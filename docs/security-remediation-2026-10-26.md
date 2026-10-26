# October 26 dependency and workflow remediation

Baseline main: `5a803978f6d2a8070e7cba7a7c3fe2fd8baefb13`.
[Weekly run 40294922438](https://github.com/SteveKinzey/claude-code-tools-installer/actions/runs/40294922438)
failed inside `npm run check` at its high-severity npm audit, after the preceding
security/desktop contracts passed. The later JSON report step was skipped.

## Scoped dependency changes

| Locked dependency | Before | After | Scope |
| --- | --- | --- | --- |
| Electron | 44.7.1 | 44.9.3 | Exact direct development pin, same supported major; [certificate mitigation advisory](https://github.com/advisories/GHSA-jr5w-w6x2-84p9) |
| undici, `@electron/get` optional downloader | 7.29.1 | 7.30.1 | Existing `^7.24.4` range; no major override |
| undici, node-gyp build chain | 6.29.0 | 6.29.1 | Existing `^6.25.0` range; no major override |
| fast-uri, ajv build-schema chain | 3.1.8 | 3.1.9 | Existing `^3.0.1` range; no major override |

Undici upstream patches cover [EventSource memory exhaustion](https://github.com/advisories/GHSA-4qv8-2p9j-2685),
[subresource integrity parsing](https://github.com/advisories/GHSA-f72v-6w45-q472)
and [excessive content encodings](https://github.com/advisories/GHSA-xjj6-f33q-929c).
Fast-uri's [3.1.9 patches](https://github.com/fastify/fast-uri/releases/tag/v3.1.9)
address URI interpretation and normalization advisories reported in the baseline audit.

All affected lock nodes are development/build dependencies. A production-only
baseline audit was clean, but Electron supplies the shipped runtime, so that alone
was insufficient. Builder 26.17.0, updater 6.8.9, notarize 3.1.2, the scoped proxy
override and application version 2026.10.1401 remain unchanged. No forced audit
upgrade was used. The lockfile changes only these four dependency nodes and the
root Electron declaration, including registry integrity values.

The weekly scan now captures JSON even after earlier validation fails. It retains
the full desktop check and high/critical threshold, validates audit JSON, refuses
registry/invalid-report errors and uploads the report through the existing bounded
artifact step. Seven offline cases execute the actual workflow shell block to
exercise clean, moderate/high, registry, malformed-report and exit-status behavior.
These cases run in the mandatory security contract.

## Release drift

[Drift run 40264817461](https://github.com/SteveKinzey/claude-code-tools-installer/actions/runs/40264817461)
reported two unpublished staging candidates. See
[staging governance](release-staging-governance.md) for immutable source/evidence
bindings, replacement requirements and protected-PR activation. Both manual and
scheduled checks fetch the complete paginated release inventory. Tags, drafts,
public assets and publication/signing workflows are preserved.

## Validation scope

Validate a clean locked install, the complete native desktop suite, downloader
proxy/TLS behavior, unchanged packaging configuration, dependency audits, audit
report failure fixtures and drift regressions. Compare all 29 dated tags against
the same release snapshot: baseline fails only .02/.00, candidate recognizes those
as superseded staging and retains the other 27 verified states. Removal/corruption
of replacement assets, draft/prerelease replacements, moved refs, changed source,
missing ancestry and unrecognized old tags must still fail.

Local desktop testing does not prove native Windows/Linux packaging or sign a new
release. The PR records exact commit CI outcomes and remaining release boundaries;
this source repair does not update already-published installer bytes.
