# Guardian installation and release boundary remediation

These source changes address the six candidates from the Guardian review of
`72dbdb33354411dbd9fc6836076f5dd1616a52e7`. They preserve the subsequent
`electron-updater` patch on main, the package version, existing quality checks,
the Electron sandbox, and intentionally unsigned Windows distribution policy.

## Changes and acceptance evidence

| Finding | Enforcement change | Required regression |
| --- | --- | --- |
| G-01: signing credentials shared with build hooks | Separate read-only unsigned build, fixed native signer, and fresh attestor jobs; both macOS release and signed-test paths use the same reusable workflow | Workflow authority separation; fake-key native-tool orchestration; credential cleanup on failure; both notary auth modes; real managed signing remains a release gate |
| G-02: release mutation during publication | All five staging/publishing writers share `ccti-release-<tag>`; retrying mutators recheck draft state; publisher compares release and asset IDs, sizes, and digests before publication and before latest promotion | Same-lock contract; changed/missing/replaced/added asset rejection; actual final publish shell block with fake GitHub CLI |
| G-03: custom skill destination escape/overwrite | Plain destination ancestors, exclusive directory reservation, per-destination and main-process mutation locks, descriptor-bound reviewed bytes, exclusive file creation, SKILL.md last, owned partial-directory cleanup | Normal nested copy; linked ancestors/junctions; existing or concurrently created destination; source edits; write failures; existing sentinels unchanged |
| G-04: timeout releases setup authority early | Dedicated POSIX process group or Windows tree termination; escalation; retained mutation lock until root close and owned tree exit; truthful partial/fresh timeout message | Failed kills, delayed descendant exit, escalation, main-handler retry refusal/release, real disposable parent/descendant writer fixture |
| G-05: macOS checksums without source/signing binding | Signed predicate binds exact DMG/ZIP/update metadata hashes, source/controller commit, package version, architecture, signing identity and native verification; publisher requires fresh cryptographic verification output | Wrong source/version/signer, missing native evidence, changed bytes or metadata, recalculated sidecar with stale signed predicate, missing verified subjects |
| G-06: inaccurate bootstrap assurance | Security policy explicitly identifies the live vendor shell/PowerShell installer and its mutable trust dependency | Policy-to-adapter endpoint and assurance comparison |

`npm --prefix desktop run check` retains all existing gates and includes
`guardian:check`. Python fixtures use only fake signing keys and mocked Apple
commands. The local process-tree test launches only disposable test processes;
it does not run the installer, install tools, remove real Claude data, contact
Apple, or use a real release. Native Windows exercises the taskkill path when
the same mandatory suite runs on that platform.

## macOS source and credential boundaries

Release dispatch must use the exact daily tag. Before signing is possible, the
tag commit must equal the controller commit and be reachable from freshly fetched
main. Signed-test dispatch must run from main and select a full reachable commit.
The reusable builder repeats source reachability validation and checks package
identity. It runs the complete release desktop audit gate and produces an
unsigned arm64 app. No signing/notary secrets or OIDC write authority are exposed
to product/dependency code in that job.

The signer checks out only the reviewed fixed controller, downloads the producing
run's exact artifact ID, validates its SHA-256 and archive members, and rejects
escaping links, traversal, duplicate entries, hard links and special files before
extraction. It runs only Python's standard library and Apple's system tools. It
does not run npm, electron-builder, application binaries, afterSign hooks, or
artifact-supplied code. Fixed entitlements preserve the JIT requirements without
accepting artifact-supplied signing policy. Private temporary credentials and the
temporary keychain are destroyed even when signing/notarization fails.

The app is signed and notarized, its ticket stapled and Gatekeeper checked before
final ZIP creation. The final DMG is signed, notarized and stapled. Metadata and
checksums describe the final bytes. A fresh runner validates the receipt before
attesting all three artifact hashes. Staging and publication independently use
`gh attestation verify` with the exact reusable workflow, controller/source digest,
predicate type and hosted-runner requirement, then compare the verified statement
with the local receipt and bytes. A recalculated unsigned checksum is insufficient.

The `macos-release` environment must be configured with the owner's protection
rules. Merely referencing it in YAML does not establish required reviewers,
protected refs, or account permissions. Existing certificate common-name secrets
are supported. A real key-bearing managed run and native output verification
remain necessary before calling a release ready.

## Failure, concurrency and rollback

A failed build cannot access signing material. A failed sign leaves no usable
success receipt and performs credential cleanup. Missing/invalid attestation or
an inventory change stops staging/publication or latest promotion. Keep a failed
candidate draft and preserve the prior public release. Do not replace public
bytes, move a public tag, or automatically demote an existing release.

The shared workflow lock excludes maintained release writers. Immediate inventory
checks detect external/manual asset changes, but are not a claim that GitHub
objects are physically immutable or that arbitrary repository administrators
obey this lock. Branch/tag/environment rules remain account-level evidence.

Skill installation refuses linked scope ancestors and never merges into an
existing directory. Failure cleanup rechecks the identity of the exclusively
created directory before deleting it. Filesystem checks are conservative local
safeguards, not a security boundary against a process already able to rewrite
the user's entire home. Previously installed skills and linked layouts remain
unchanged when addition is refused.

A timed-out setup cannot permit another overlapping mutation until its owned
process tree is known to have stopped. An unverifiable Windows tree termination
keeps the lock rather than guessing. POSIX process-group supervision covers
descendants that remain in the owned group; it does not claim control over an
independently reparented/session-detached program. Reconcile partial state before
retry. Start fresh is still irreversible and has no automatic backup; the timeout
message no longer promises that no configuration was removed.

These are proposed/revalidated source changes within each test's scope. Local
fixtures and a passing local desktop suite do not certify native Windows/Linux
CI, Apple signing/notarization, protected-main parity, or a published artifact.
