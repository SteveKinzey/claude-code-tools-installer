#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepare, validateFeed, digest } = require('./prepare-windows-unsigned-artifact.cjs');
const root = path.resolve(__dirname, '..');
const yamlPath = require.resolve('js-yaml', { paths: [path.join(root, 'desktop')] });
const yaml = require(yamlPath);
const tag = 'v2026.10.12.00';
const version = '2026.10.1200';
const name = `Claude-Code-Tools-Installer-${version}-win-x64.exe`;
const bytes = Buffer.from('MZfixture-installer');
const hash = digest(bytes, 'sha512', 'base64');
const valid = { version, path: name, sha512: hash, files: [{ url: name, sha512: hash, size: bytes.length }] };
let cases = 0;

function test(label, fn) {
  fn();
  cases += 1;
  console.log(`PASS ${label}`);
}

function withFixture(fn, identities = {}) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ccti-unsigned-preparation-'));
  const controller = path.join(fixture, 'controller');
  const source = path.join(fixture, 'source');
  const artifacts = path.join(fixture, 'artifacts');
  const git = (...args) => cp.execFileSync('git', [
    '-C', controller, '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false',
    '-c', 'user.name=CCTI test fixture', '-c', 'user.email=fixture@example.invalid', ...args,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    for (const directory of [controller, source, artifacts]) fs.mkdirSync(directory);
    const files = {
      'desktop/package.json': JSON.stringify({ name: 'fixture', version: identities.packageVersion || version }),
      'desktop/package-lock.json': JSON.stringify({ version: identities.lockVersion || version, packages: { '': { version: identities.lockRootVersion || version } } }),
      'desktop/src/main.js': "'use strict';\n// inert fixture\n",
      'setup-my-claude.ps1': '# inert Windows adapter fixture\n',
      'setup-my-claude.sh': '# inert macOS adapter fixture\n',
      'setup-my-claude-linux.sh': '# inert Linux adapter fixture\n',
      'fixture.txt': 'tagged-content\n',
    };
    for (const [file, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(controller, file)), { recursive: true });
      fs.writeFileSync(path.join(controller, file), content);
    }
    git('init', '-q');
    git('add', '.');
    git('commit', '-qm', 'inert preparation fixture');
    git('tag', tag);
    const commit = git('rev-parse', 'HEAD');
    for (const file of Object.keys(files)) {
      fs.mkdirSync(path.dirname(path.join(source, file)), { recursive: true });
      fs.writeFileSync(path.join(source, file), cp.execFileSync('git', ['-C', controller, 'cat-file', 'blob', `${tag}:${file}`]));
    }
    // Resolve the already-installed parser without links or Windows symlink privileges.
    const parser = path.join(source, 'desktop/node_modules/js-yaml/index.js');
    fs.mkdirSync(path.dirname(parser), { recursive: true });
    fs.writeFileSync(parser, `module.exports = require(${JSON.stringify(yamlPath)});\n`);
    fs.writeFileSync(path.join(artifacts, name), bytes);
    fs.writeFileSync(path.join(artifacts, 'latest.yml'), yaml.dump(valid));
    const options = { source, controller, artifacts, tag, expectedCommit: commit, controllerSha: commit, runUrl: 'https://example.invalid/actions/runs/1' };
    fn({ ...options, options, git });
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

function rejects(label, mutate, expected, identities) {
  test(label, () => withFixture((fixture) => {
    mutate(fixture);
    assert.throws(() => prepare(fixture.options), expected);
    for (const output of [`${name}.sha256`, 'windows-unsigned-source.json', 'windows-unsigned-source-predicate.json']) {
      assert.equal(fs.existsSync(path.join(fixture.artifacts, output)), false, 'Failed validation must publish no receipt');
    }
  }, identities));
}

test('valid updater feed', () => validateFeed(valid, name, bytes, version));
for (const [label, mutate] of [
  ['version', (feed) => { feed.version = 'old'; }],
  ['path', (feed) => { feed.path = 'wrong.exe'; }],
  ['root digest', (feed) => { feed.sha512 = 'wrong'; }],
  ['duplicate file', (feed) => { feed.files.push(feed.files[0]); }],
  ['file URL', (feed) => { feed.files[0].url = '../wrong.exe'; }],
  ['size', (feed) => { feed.files[0].size += 1; }],
  ['file digest', (feed) => { feed.files[0].sha512 = 'wrong'; }],
]) {
  test(`updater refuses ${label}`, () => {
    const feed = JSON.parse(JSON.stringify(valid));
    mutate(feed);
    assert.throws(() => validateFeed(feed, name, bytes, version));
  });
}
test('updater refuses same-size installer tampering', () => assert.throws(() => validateFeed(valid, name, Buffer.from('MZfixture-installeR'), version)));

test('prepare generates exact source, checksum and dual receipts', () => withFixture((fixture) => {
  const receipt = prepare(fixture.options);
  assert.equal(receipt.source_commit, fixture.expectedCommit);
  assert.equal(receipt.controller_commit, fixture.controllerSha);
  assert.equal(receipt.source_tree, fixture.git('rev-parse', `${tag}^{tree}`));
  assert.equal(receipt.version, version);
  assert.equal(receipt.installer.sha256, digest(bytes));
  assert.equal(receipt.installer.sha512, hash);
  assert.equal(receipt.installer.size, bytes.length);
  assert.equal(receipt.updater_sha256, digest(fs.readFileSync(path.join(fixture.artifacts, 'latest.yml'))));
  assert.equal(receipt.lock_sha256, digest(fs.readFileSync(path.join(fixture.source, 'desktop/package-lock.json'))));
  assert.equal(receipt.tagged_runtime_sha256['desktop/src/main.js'], digest(fs.readFileSync(path.join(fixture.source, 'desktop/src/main.js'))));
  assert.equal(fs.readFileSync(path.join(fixture.artifacts, `${name}.sha256`), 'utf8'), `${digest(bytes)}  ${name}\n`);
  for (const file of ['windows-unsigned-source.json', 'windows-unsigned-source-predicate.json']) {
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(fixture.artifacts, file), 'utf8')), receipt);
  }
}));
test('staged verification binds installer, updater and immutable source', () => withFixture((fixture) => {
  const receipt = prepare(fixture.options);
  for (const bundle of ['windows-build-provenance.sigstore.json', 'windows-source-binding.sigstore.json']) {
    fs.writeFileSync(path.join(fixture.artifacts, bundle), '{}'); // Structural fixture only; signature trust is independent.
  }
  const { verify } = require('./verify-windows-staged-artifact.cjs');
  const verifiedPath = path.join(fixture.source, 'verified-attestation-output.json');
  fs.writeFileSync(verifiedPath, JSON.stringify([{ verificationResult: { statement: {
    predicateType: 'https://claudetool.app/attestations/windows-unsigned-source/v1',
    predicate: receipt, subject: [{ name, digest: { sha256: receipt.installer.sha256 } }],
  } } }])); // Structural verification output fixture, not a cryptographic pass claim.
  const check = (commit = fixture.expectedCommit) => verify(fixture.artifacts, tag, commit, verifiedPath);
  assert.equal(check().passed, true);
  const feedPath = path.join(fixture.artifacts, 'latest.yml');
  const original = fs.readFileSync(feedPath);
  fs.writeFileSync(feedPath, 'tampered updater');
  assert.throws(() => check(), /Staged updater bytes mismatch/);
  const forged = { ...receipt, updater_sha256: digest(Buffer.from('tampered updater')) };
  for (const file of ['windows-unsigned-source.json', 'windows-unsigned-source-predicate.json']) {
    fs.writeFileSync(path.join(fixture.artifacts, file), JSON.stringify(forged));
  }
  assert.throws(() => check(), /Signed source predicate must equal downloaded receipt/, 'Mutually consistent receipt/feed tampering must still be refused');
  for (const file of ['windows-unsigned-source.json', 'windows-unsigned-source-predicate.json']) {
    fs.writeFileSync(path.join(fixture.artifacts, file), JSON.stringify(receipt));
  }
  fs.writeFileSync(feedPath, original);
  assert.throws(() => check('0'.repeat(40)), /Staged source commit mismatch/);
  fs.writeFileSync(path.join(fixture.artifacts, name), 'MZfixture-installeR');
  assert.throws(() => check(), /Verified source subject must bind exact installer bytes/);
}));
rejects('prepare refuses same-size tagged source tampering', (f) => fs.writeFileSync(path.join(f.source, 'fixture.txt'), 'tagged-contenT\n'), /Exported tagged source mismatch/);
rejects('prepare refuses missing tagged source', (f) => fs.unlinkSync(path.join(f.source, 'fixture.txt')), /ENOENT/);
rejects('prepare refuses impossible calendar tag', (f) => {
  const impossibleTag = 'v2026.02.30.00';
  const impossibleVersion = '2026.2.3000';
  const impossibleName = `Claude-Code-Tools-Installer-${impossibleVersion}-win-x64.exe`;
  f.git('tag', impossibleTag);
  f.options.tag = impossibleTag;
  fs.renameSync(path.join(f.artifacts, name), path.join(f.artifacts, impossibleName));
  fs.writeFileSync(path.join(f.artifacts, 'latest.yml'), yaml.dump({
    ...valid, version: impossibleVersion, path: impossibleName,
    files: [{ ...valid.files[0], url: impossibleName }],
  }));
}, /valid immutable daily release tag/, {
  packageVersion: '2026.2.3000', lockVersion: '2026.2.3000', lockRootVersion: '2026.2.3000',
});
rejects('prepare refuses changed tag commit', (f) => { f.options.expectedCommit = '0'.repeat(40); }, /Remote tag commit must remain exact/);
rejects('prepare refuses changed controller commit', (f) => { f.options.controllerSha = '0'.repeat(40); }, /Controller identity mismatch/);
rejects('prepare refuses tagged package version mismatch', () => {}, /Tagged package identity mismatch/, { packageVersion: '2026.10.1201' });
rejects('prepare refuses tagged lockfile version mismatch', () => {}, /Tagged lockfile identity mismatch/, { lockVersion: '2026.10.1201' });
rejects('prepare refuses tagged lock root version mismatch', () => {}, /Tagged lockfile root identity mismatch/, { lockRootVersion: '2026.10.1201' });
rejects('prepare refuses missing installer', (f) => fs.unlinkSync(path.join(f.artifacts, name)), /Require one x64 NSIS installer/);
rejects('prepare refuses duplicate installers', (f) => fs.writeFileSync(path.join(f.artifacts, 'extra-win-x64.exe'), bytes), /Require one x64 NSIS installer/);
rejects('prepare refuses wrong installer filename', (f) => fs.renameSync(path.join(f.artifacts, name), path.join(f.artifacts, 'wrong-win-x64.exe')), /Installer filename identity mismatch/);
rejects('prepare refuses empty installer', (f) => fs.writeFileSync(path.join(f.artifacts, name), ''), /Require nonempty installer/);
rejects('prepare refuses non-PE installer', (f) => fs.writeFileSync(path.join(f.artifacts, name), 'ZZfixture-installer'), /Require PE executable/);
rejects('prepare refuses same-size installer tampering', (f) => fs.writeFileSync(path.join(f.artifacts, name), 'MZfixture-installeR'), /Updater root SHA-512/);
rejects('prepare refuses corrupted updater metadata', (f) => fs.writeFileSync(path.join(f.artifacts, 'latest.yml'), yaml.dump({ ...valid, version: 'old' })), /Updater version/);

test('workflow keeps build execution outside privileged attestation', () => {
  const workflowText = fs.readFileSync(path.join(root, '.github/workflows/build-windows-zip-test-artifact.yml'), 'utf8');
  const workflow = yaml.load(workflowText);
  const build = workflow.jobs.unsigned;
  const attest = workflow.jobs['attest-unsigned'];
  assert.deepEqual(build.permissions, { contents: 'read' });
  assert.equal(attest.needs, 'unsigned');
  assert.deepEqual(attest.permissions, { contents: 'read', 'id-token': 'write', attestations: 'write' });
  const buildRuns = build.steps.map((step) => step.run || '').join('\n');
  assert.match(buildRuns, /git -c core\.autocrlf=false archive --format=tar/);
  assert.match(buildRuns, /node scripts\/release-identity\.js --tag/);
  assert.doesNotMatch(buildRuns, /node product\/scripts\/release-identity\.js/);
  assert.match(buildRuns, /npm run check/);
  assert.match(buildRuns, /npm run dist:win:unsigned:x64/);
  assert.match(buildRuns, /Status -ne 'NotSigned'/);
  assert.ok(build.steps.every((step) => !String(step.uses || '').includes('attest-build-provenance')));
  const attestRuns = attest.steps.map((step) => step.run || '').join('\n');
  assert.doesNotMatch(attestRuns, /npm |node |product\/|gh release|azure\/login/);
  assert.match(attestRuns, /source_tag -ne \$env:SOURCE_TAG/);
  assert.match(attestRuns, /source_commit -ne \$env:SOURCE_COMMIT/);
  assert.match(attestRuns, /controller_commit -ne \$env:GITHUB_SHA/);
  assert.match(attestRuns, /Get-FileHash -Algorithm SHA256/);
  const download = attest.steps.find((step) => String(step.uses || '').startsWith('actions/download-artifact@'));
  assert.equal(download.with['artifact-ids'], '${{ needs.unsigned.outputs.artifact_id }}');
  assert.equal(download.with['merge-multiple'], true);
  assert.equal(attest.steps.filter((step) => String(step.uses || '').startsWith('actions/attest-build-provenance@')).length, 2);
  assert.match(workflowText, /predicate-path: attestation-inputs\/windows-unsigned-source-predicate\.json/);
  assert.match(workflowText, /windows-build-provenance\.sigstore\.json/);
  assert.match(workflowText, /windows-source-binding\.sigstore\.json/);
  assert.doesNotMatch(workflowText, /contents: write|gh release|azure\/login|AZURE_CODESIGN/);
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps) if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/, 'Every external action remains immutably pinned');
  }
});
test('final unsigned release isolates build, attestation and draft staging', () => {
  const text = fs.readFileSync(path.join(root, '.github/workflows/release-windows-unsigned.yml'), 'utf8');
  const release = yaml.load(text);
  const build = release.jobs.unsigned;
  const attest = release.jobs['attest-unsigned'];
  const stage = release.jobs.stage;
  assert.deepEqual(build.permissions, { contents: 'read' });
  assert.deepEqual(attest.permissions, { contents: 'read', 'id-token': 'write', attestations: 'write' });
  assert.deepEqual(stage.permissions, { contents: 'write' });
  assert.equal(build.if, "github.ref_type == 'tag' && github.ref_name == inputs.tag");
  assert.equal(build.env.SOURCE_COMMIT, '${{ github.sha }}');
  assert.equal(build.environment, 'windows-release');
  assert.equal(attest.needs, 'unsigned');
  assert.equal(stage.needs, 'attest-unsigned');
  assert.match(text, /test-windows-nsis-lifecycle\.ps1/);
  const privilegedRuns = [...attest.steps, ...stage.steps].map((step) => step.run || '').join('\n');
  assert.doesNotMatch(privilegedRuns, /npm |product\//);
  const staging = stage.steps.map((step) => step.run || '').join('\n');
  assert.match(staging, /verify-windows-staged-artifact\.cjs/);
  assert.match(staging, /Refusing to modify an already-public release/);
  assert.match(staging, /gh release create.*--draft/);
  assert.equal((staging.match(/gh attestation verify/g) || []).length, 2);
  assert.match(staging, /--format json/);
  assert.ok(staging.indexOf('--format json') < staging.indexOf('node scripts/verify-windows-staged-artifact.cjs'), 'Authenticate signed statement before trusting receipt');
  assert.match(staging, /gh api -X DELETE/);
  assert.match(staging, /draft during each asset retry/);
  assert.doesNotMatch(staging, /--clobber/);
  assert.doesNotMatch(text, /azure\/login|AZURE_CODESIGN|draft=false/);
  for (const job of Object.values(release.jobs)) {
    for (const step of job.steps) if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
  }
});
require('./test-windows-unsigned-retries.cjs')(root);
require('./test-windows-lifecycle-wrapper.cjs')(root);
console.log(`PASS ${cases} unsigned preparation groups; inert disposable repositories/artifacts only, no installer execution or publication.`);
