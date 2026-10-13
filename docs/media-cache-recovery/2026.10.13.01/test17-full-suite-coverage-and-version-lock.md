# Media cache recovery — full suites, measured coverage and version freeze

## Frozen scope

Skill snapshot: **`ccti-bundled-media-cache-recovery` version `2026.10.13.01`**.

Portal source checkpoint: **`b976550dee668a83a3f5d13b866db3f87c1f4df8`**.

The snapshot contains the exact 60-file skill, the exact 26-file portal source archive, and all 16 generated output identities. Full SHA-256 manifests and deterministic ZIP metadata anchor these versions. The skill adds its version and portal checkpoint under the supported nested `metadata` field. Executable code, tests and templates remain unchanged.

This is a source/skill freeze, not a new desktop binary version, account-security lock or new website deployment. A tag and hash receipt anchor a snapshot but cannot make a mutable filesystem or all Git refs physically immutable. Future modifications should use a new snapshot version; never move this tag to different bytes.

## Test #17: exact assertion review

Source: `verification-site/tests/portal.test.mjs`, case 17 at line 33.

```js
test('build is deterministic and independent ofGit', async () => {
  const before = digest(await readFile('dist/index.html'));
  const result = spawnSync(process.execPath, ['scripts/build.mjs'], {
    encoding: 'utf8',
    env: { ...process.env, GIT_DIR: '/missing' }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(digest(await readFile('dist/index.html')), before);
});
```

Module setup already builds once. This test obtains the current HTML digest, rebuilds with `GIT_DIR` pointing to a missing directory, requires exit zero, and compares the new **HTML digest only**.

### What passed in this fresh run

- The actual 21-case portal suite passed in an isolated exact-source copy.
- Case 17 passed with unchanged HTML bytes and a missing `GIT_DIR`.
- No portal test or build ran in the real website's output directory.

### What it does not assert

- Complete cross-build byte parity for all 16 files.
- Exactly nine primary release-manifest entries or all aliases/root entries.
- Child import resolution or propagation under mutation.
- Removal of all Git inputs or independence from every environment variable.
- Public cache HIT, current deployment, browser captions or host privacy.

Case 16 separately checks byte length/full digest/prefix for entries present in the primary manifest. It does not require every output file. The earlier six-experiment audit adds complete inventory/mutation evidence but is not part of these 21 cases and was not rerun as a new suite here.

## Full test execution

| Suite | Fresh result | Execution boundary |
| --- | --- | --- |
| Python skill suite | **130 passed, 0 failed** | All 20 fixture modules; disposable loopback HTTP and offline helpers; subprocess instrumentation enabled. |
| Optional Node prototype | **36 passed, 0 failed** | Express 5.2.1 fixture, local HTTP and construction/model checks. |
| Portal suite | **21 passed, 0 failed** | Exact 26-source isolated copy; local preview/build only. |
| Portal source check | Passed | Node syntax, JSON parsing and selected client capability patterns. |
| Portal build | Passed | Isolated static output; all 16 identities recorded. |
| Skill metadata | See final validated receipt | Nested metadata version/portal identity supported; no change to trigger description. |

These suite counts are not coverage percentages. No native LSP/typecheck result is claimed where that capability is unavailable. No public traffic or analytics replay was needed for this run.

## Measured coverage

### Python skill implementation

Coverage.py 7.10.7 measures the 17 implementation `.py` files, excluding `test_*.py` from the implementation denominator. Python `sitecustomize` starts collection in child CLI processes as well as the parent test process. Parallel subprocess data is combined once after the suite.

- **Lines:** 1,110 / 1,391 statements = **79.80%**.
- **Branches:** 386 / 490 = **78.78%**.
- **Combined line/branch metric:** **79.53%**; the console rounds this to 80%.
- **281 missing lines**, **104 missing branches**, **72 partial branches**.

Unexecuted optional browser helpers remain in the denominator. This avoids hiding missing coverage by reporting only imported files.

Important gaps:

- `verify_caption_browser.py`: **0%**, not executed by this suite.
- `verify_staging_isolation.py`: **0%**, not executed by this suite.
- `verify_renderer_journeys.py`: browser journey body largely unexecuted; helper/formula portions contribute partial coverage.
- Public-network orchestration, selected error paths and bounded recheck CLIs retain missing lines/branches.

These are remaining test gaps, not observed application defects. Existing Mac Python/LibreSSL warnings do not invalidate local fixture assertions, but this runtime is not certified for fresh public HTTPS acceptance by those passes.

### Node caption prototype implementation

Actual measured file: `caption_route_prototype.mjs`.

- **Line coverage: 100.00%**.
- **Branch coverage: 88.37%**.
- **Function coverage: 100.00%**.

Do not use the combined implementation-plus-test total of 92.55% branches as the prototype's branch metric. Do not call 100% line execution 100% assertion or behavior coverage.

The first V8 include-filter attempt selected no files and misleadingly printed 100% totals. That result is **invalid coverage evidence**, preserved in its original log. A corrected collection ran from the prototype directory, produced the implementation file row and was reconciled against raw V8 data.

### Portal loaded-file coverage

- Lines: **81.23%**.
- Branches: **89.19%**.
- Functions: **89.74%**.
- `scripts/build.mjs` and the server-rendered section helpers show 100% execution in this run.
- The actual filter/clipboard DOM-control wiring is largely not executed by helper-level tests.
- `src/client/main.mjs` is not executed by this Node unit suite; it is not present in the loaded-file denominator.
- `scripts/check.mjs` runs separately, outside the portal test coverage collector.

This is **loaded-module coverage**, not a complete source-wide browser coverage percentage. Full build line execution does not expand test #17 beyond HTML-only determinism. Runtime browser acceptance remains separate evidence.

## Safe branch reconciliation

The standalone portal's own Managed Git contains only `main`; no portal feature branch is outstanding. Its published checkpoint/source stays unchanged.

Relevant earlier installer branches for curated pins, lock refresh, Pages migration and Linux layout fixes are already ancestors of current main; there is no unique work left to merge from them. No branch deletion or force push is needed.

The installer is a separate product repository with unrelated open PRs and historical/build-only branches. They are not silently merged into the skill freeze. A clarification was sent because these changes alter desktop behavior/dependencies. Unanswered clarification is not approval.

The requested new snapshot is prepared as a **docs-only** branch in an isolated worktree. Its source/skill packages, sanitized coverage summary, test report and version lock are committed under `docs/media-cache-recovery/2026.10.13.01/`. Main's required CI is preserved. Exact-head PR merge and a non-product annotated source tag follow only after required checks accept that tree.

A docs-only required desktop check may be intentionally skipped by the existing workflow's changed-path detector. That is not a new native desktop test run and is not used to certify binaries. No desktop package/version, signing job, updater metadata or release assets are changed.

## Reusable workflow refinement

The installed recovery skill remains authoritative. This version adds concise guidance for:

1. Measuring child-process coverage without excluding untouched browser helpers.
2. Rejecting empty V8 filter reports.
3. Keeping loaded-module, fixture, branch and assertion coverage distinct.
4. Freezing exact metadata/checkpoint/file identities.
5. Pushing a dedicated source branch, verifying exact-head CI and preserving unrelated/historical work.
6. Never moving tags, bypassing protection or confusing this freeze with binary publication.

Original reports and source receipts remain preserved. The full local coverage JSON and logs stay in the evidence package; the repository snapshot includes a sanitized summary with script basenames rather than private execution paths.

## Files and integrity

- `coverage-summary.json`: scoped percentages, per-script missing lines/branches and suite boundaries.
- `python-coverage.txt` / `python-coverage.json`: complete local Python measurement.
- `full-node-tests-and-coverage-corrected.log`: real prototype measurement, plus retained invalid-filter log.
- `full-portal-tests-and-coverage.log`: 21-case result and loaded-file V8 summary.
- `version-lock.json`: complete skill/source/output identities and deterministic archive digests.
- `bundled-media-cache-recovery-2026.10.13.01.skill`: frozen reusable skill.
- `verification-portal-source-b976550d.zip`: exact portal source snapshot; not a live publication.

Record PR/main/tag and final installed validation outcomes in a separate follow-up receipt outside this frozen version directory, only after successful operations. Do not append them to or otherwise modify this report after the snapshot is accepted and tagged. This report does not claim a merge, tag or deployment from a local commit alone.
