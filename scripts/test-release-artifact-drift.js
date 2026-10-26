#!/usr/bin/env node
const assert = require("node:assert/strict");
const path = require("node:path");
const { classifyArtifact, evaluateReleaseArtifactState, getCoverage, isReleaseTag } = require("./check-release-artifact-drift");

const fixture = (name) => require(path.join(__dirname, "fixtures", "release-artifact-drift", name));
const NOW = "2026-09-20T12:00:00Z";

function stateFor(release, overrides = {}) {
  return evaluateReleaseArtifactState({
    tag: release?.tag_name || "v2026.09.15",
    release,
    createdAt: release?.published_at || "2026-09-15T12:00:00Z",
    now: NOW,
    graceHours: 24,
    ...overrides,
  });
}

const verified = fixture("verified-release.json");
const sourceOnly = fixture("source-only-release.json");
const invalidDigest = fixture("invalid-digest-release.json");

assert.equal(isReleaseTag("v2026.09.12"), true);
assert.equal(isReleaseTag("2026.9.12"), true);
assert.equal(isReleaseTag("v2026.09.12.01"), true);
assert.equal(isReleaseTag("v2026.02.29.01"), false);
assert.equal(isReleaseTag("release-candidate"), false);

for (const asset of [
  'claude-code-tools-installer-macos-v2026.09.20.dmg.sha256',
  'Claude.Code.Tools.Installer-2026.09.20-windows-portable-x64.zip.sha256',
  'latest-mac.yml',
  'source.tar.gz',
]) {
  assert.equal(classifyArtifact(asset), null, `${asset} must not count as a platform executable`);
}

assert.equal(stateFor(verified).state, "verified");
assert.deepEqual(Object.keys(getCoverage(verified)).sort(), ["linux", "macos", "windows"]);
assert.equal(stateFor(sourceOnly).state, "drift");
assert.equal(stateFor(invalidDigest).state, "drift");
assert.equal(stateFor(null, { tag: "v2026.09.15", createdAt: "2026-09-15T12:00:00Z" }).state, "drift");
assert.equal(stateFor(sourceOnly, { now: "2026-09-13T18:00:00Z" }).state, "grace");
assert.equal(stateFor(null, { tag: "docs-only", createdAt: NOW }).state, "ignored");

console.log("Release artifact drift tests passed.");

// Approved superseded staging is distinct from a verified binary release.
const { validateDispositions } = require('./check-release-artifact-drift');
const dispositionDocument = require('../docs/release-staging-dispositions.json');
const dispositions = validateDispositions(dispositionDocument);
const candidate = dispositions[0];
const successor = { ...verified, tag_name: candidate.supersededBy };
const git = {
  resolveTag: (tag) => tag === candidate.tag
    ? { object: candidate.tagObject, commit: candidate.commit }
    : { object: 'f'.repeat(40), commit: candidate.supersedingCommit },
  isAncestor: () => true,
};
const staged = { tag_name: candidate.tag, draft: true, assets: verified.assets };
const stagingState = (overrides = {}) => stateFor(staged, {
  tag: candidate.tag, releases: [successor], dispositions, git, ...overrides,
});
assert.equal(stagingState().state, 'superseded');
assert.deepEqual(stagingState().coverage, {}, 'unpublished staging must never count as executable coverage');
assert.equal(stagingState({ release: null }).state, 'superseded', 'public tokens may not see retained private drafts');
assert.equal(stagingState({ dispositions: [] }).state, 'drift', 'draft binaries alone do not satisfy the gate');
assert.equal(stagingState({ tag: 'v2026.10.03.00', release: null }).state, 'drift', 'unknown dated tags remain subject to the gate');
for (const replacement of [null, { ...successor, draft: true }, { ...successor, prerelease: true },
  { ...successor, tag_name: 'v2026.10.03.00' }, { ...successor, assets: [] },
  { ...successor, assets: invalidDigest.assets }, { ...successor, assets: sourceOnly.assets },
  { ...successor, assets: verified.assets.map((asset) => ({ ...asset, size: 0 })) }]) {
  assert.equal(stagingState({ releases: replacement ? [replacement] : [] }).state, 'drift');
}
for (const alteredGit of [
  { ...git, resolveTag: (tag) => ({ ...git.resolveTag(tag), commit: 'a'.repeat(40) }) },
  { ...git, resolveTag: (tag) => ({ ...git.resolveTag(tag), object: 'b'.repeat(40) }) },
  { ...git, isAncestor: () => false },
]) assert.equal(stagingState({ git: alteredGit }).state, 'drift', 'changed source or ancestry must fail closed');
assert.throws(() => stagingState({ git: { ...git, resolveTag: () => { throw new Error('missing tag'); } } }), /missing tag/);
assert.equal(stagingState({ release: { ...staged, draft: false, assets: [] } }).state, 'drift', 'a published source record cannot use the staging exception');
assert.equal(stagingState({ release: { ...staged, draft: false } }).state, 'verified', 'a valid public binary takes the ordinary gate');
for (const document of [null, { schemaVersion: 2, candidates: [] },
  { ...dispositionDocument, candidates: [...dispositions, candidate] },
  ...['status', 'tag', 'tagObject', 'commit', 'supersedingCommit', 'supersededBy', 'reason', 'evidence'].map((key) => ({
    schemaVersion: 1, candidates: [{ ...candidate, [key]: null }],
  })),
  { schemaVersion: 1, candidates: [{ ...candidate, supersededBy: candidate.tag }] },
]) assert.throws(() => validateDispositions(document), /Invalid/);

// Exercise the CLI with real disposable Git refs; never touch repository tags.
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccti-drift-'));
try {
  for (const directory of ['scripts', 'desktop/src', 'docs']) fs.mkdirSync(path.join(temp, directory), { recursive: true });
  for (const file of ['scripts/check-release-artifact-drift.js', 'desktop/src/release-identity.js']) {
    fs.copyFileSync(path.join(__dirname, '..', file), path.join(temp, file));
  }
  const runGit = (...args) => execFileSync('git', args, { cwd: temp, encoding: 'utf8' }).trim();
  runGit('init', '--quiet');
  runGit('add', '.');
  const commit = (message) => runGit('-c', 'user.name=CCTI fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--allow-empty', '-m', message);
  commit('staging');
  const oldCommit = runGit('rev-parse', 'HEAD');
  runGit('-c', 'user.name=CCTI fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'tag.gpgsign=false', 'tag', '-a', candidate.tag, '-m', 'staging');
  const oldObject = runGit('rev-parse', `refs/tags/${candidate.tag}`);
  commit('replacement');
  const newCommit = runGit('rev-parse', 'HEAD');
  runGit('-c', 'tag.gpgsign=false', 'tag', candidate.supersededBy);
  fs.writeFileSync(path.join(temp, 'docs/release-staging-dispositions.json'), JSON.stringify({ schemaVersion: 1, candidates: [{ ...candidate, commit: oldCommit, tagObject: oldObject, supersedingCommit: newCommit }] }));
  fs.writeFileSync(path.join(temp, 'release.json'), JSON.stringify(staged));
  const inventoryPath = path.join(temp, 'releases.json');
  fs.writeFileSync(inventoryPath, JSON.stringify([successor]));
  const args = [path.join(temp, 'scripts/check-release-artifact-drift.js'), '--tag', candidate.tag, '--release-file', path.join(temp, 'release.json'), '--releases-file', inventoryPath];
  const invoke = () => spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } });
  assert.equal(invoke().status, 0);
  fs.writeFileSync(inventoryPath, '[]');
  assert.equal(invoke().status, 1, 'disappearing public replacement must fail CLI');
  fs.writeFileSync(inventoryPath, JSON.stringify([successor]));
  // Simulate a moved staging ref inside this disposable repository only.
  runGit('update-ref', `refs/tags/${candidate.tag}`, newCommit, oldObject);
  assert.equal(invoke().status, 1, 'moved staging ref must fail CLI');
  runGit('update-ref', '-d', `refs/tags/${candidate.tag}`, newCommit);
  const listed = execFileSync(process.execPath, [args[0], '--list-audit-tags'], { encoding: 'utf8' }).trim().split(/\r?\n/);
  assert.ok(listed.includes(candidate.tag), 'scheduled enumeration must retain a registered original absent from Git tags');
  assert.ok(listed.includes(candidate.supersededBy), 'ordinary existing release tags remain enumerated');
  assert.equal(invoke().status, 1, 'absent original must fail pinned-ref evaluation');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log('Superseded staging tests passed: schema, source binding, ancestry, live replacement assets and CLI refusals.');

const workflowText = fs.readFileSync(path.join(__dirname, '../.github/workflows/release-artifact-drift.yml'), 'utf8').replace(/\r\n/g, '\n');
assert.equal((workflowText.match(/gh api --paginate --slurp/g) || []).length, 2, 'both workflow routes need complete live release inventory');
assert.equal((workflowText.match(/--releases-file/g) || []).length, 2, 'both workflow routes must validate the superseding release');
assert.equal((workflowText.match(/--grace-hours 24/g) || []).length, 2, 'both workflow routes retain the existing grace period');
assert.match(fs.readFileSync(path.join(__dirname, '../.github/workflows/desktop-validation.yml'), 'utf8'), /docs\/release-staging-dispositions\.json\|/, 'manifest-only PR changes must run required desktop checks');

assert.match(workflowText, /--list-audit-tags > "\$RUNNER_TEMP\/dated-tags\.txt"/, 'scheduled audit must use the union of existing and registered tags');
assert.match(workflowText, /done < "\$RUNNER_TEMP\/dated-tags\.txt"/, 'the audit loop must consume the checked enumeration');
