#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const yaml = require('../desktop/node_modules/js-yaml');
const { inventory, save, compare } = require('./release-inventory.cjs');

// An alternate source root lets the same workflow assertions characterize the baseline.
const root = process.argv[2] || path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const workflow = (name) => yaml.load(read(`.github/workflows/${name}.yml`));
let assertions = 0;
const check = (test) => { test(); assertions += 1; };
const release = workflow('release-macos-signed-notarized');
const signedTest = workflow('build-macos-signed-notarized-test');

// No job with signing secrets may install dependencies, validate product source,
// invoke electron-builder, or execute a package script. This fails on the old jobs.
for (const name of ['release-macos-signed-notarized', 'build-macos-signed-notarized-test', ...(fs.existsSync(path.join(root, '.github/workflows/macos-isolated-sign.yml')) ? ['macos-isolated-sign'] : [])]) {
  for (const [jobName, job] of Object.entries(workflow(name).jobs)) {
    if (!JSON.stringify(job).includes('secrets.')) continue;
    check(() => assert.doesNotMatch((job.steps || []).map((s) => s.run || '').join('\n'), /\b(?:npm|npx)\s|electron-builder|run-release-desktop-check/, `${name}/${jobName}: product code must not share signing authority`));
    check(() => assert.equal(job.permissions?.contents, 'read', `${name}/${jobName}: secret-bearing signer must not mutate releases`));
  }
}
const isolated = workflow('macos-isolated-sign');
check(() => assert.equal(release.jobs.package.uses, './.github/workflows/macos-isolated-sign.yml'));
check(() => assert.equal(signedTest.jobs.package.uses, './.github/workflows/macos-isolated-sign.yml'));
check(() => assert.deepEqual(isolated.jobs.build.permissions, { contents: 'read' }));
check(() => assert.equal(isolated.jobs.sign.environment, 'macos-release'));
check(() => assert.equal(isolated.jobs.sign.needs, 'build'));
check(() => assert.equal(isolated.jobs.attest.needs, 'sign'));
check(() => assert.equal(isolated.jobs.sign.steps.find((s) => s.uses?.startsWith('actions/checkout@')).with['sparse-checkout'], 'scripts/macos-release-controller.py'));
check(() => assert.equal(isolated.jobs.sign.steps.find((s) => s.uses?.startsWith('actions/download-artifact@')).with['artifact-ids'], '${{ needs.build.outputs.artifact_id }}'));
check(() => assert.equal(isolated.jobs.attest.steps.find((s) => s.uses?.startsWith('actions/download-artifact@')).with['artifact-ids'], '${{ needs.sign.outputs.artifact_id }}'));
for (const name of ['release-macos-signed-notarized', 'release-linux-signed', 'release-windows-unsigned', 'release-windows-signed', 'publish-verified-release']) {
  check(() => assert.equal(workflow(name).concurrency.group, 'ccti-release-${{ inputs.tag }}', `${name} must exclude all other release writers`));
  check(() => assert.equal(workflow(name).concurrency['cancel-in-progress'], false));
}
const publisher = read('.github/workflows/publish-verified-release.yml');
for (const required of ['macos-source-binding.sigstore.json', '--signer-workflow', '--signer-digest', '--source-digest', '--deny-self-hosted-runners', 'macos-release-controller.py verify', "--pattern '*-mac-arm64.dmg'", "--pattern '*-mac-arm64.zip'", "--pattern 'latest-mac.yml'"]) {
  check(() => assert.ok(publisher.includes(required), `Publisher must require ${required}`));
}
check(() => assert.ok(publisher.indexOf('release-inventory.cjs draft') < publisher.indexOf('-f draft=false')));
check(() => assert.ok(publisher.indexOf('release-inventory.cjs public') < publisher.indexOf('-f make_latest=true')));
const policy = read('SECURITY.md');
check(() => assert.doesNotMatch(policy, /There is no `curl \| bash`/));
for (const endpoint of ['https://claude.ai/install.sh', 'https://claude.ai/install.ps1']) check(() => assert.ok(policy.includes(endpoint)));
check(() => assert.match(policy, /mutable.*not pinned/));

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccti-release-inventory-'));
try {
  const fixture = { databaseId: 42, isDraft: true, isPrerelease: false, assets: [
    { id: 'asset-1', name: 'fixture.dmg', size: 10, state: 'uploaded', digest: `sha256:${'a'.repeat(64)}` },
    { id: 'asset-2', name: 'fixture.zip', size: 20, state: 'uploaded', digest: `sha256:${'b'.repeat(64)}` },
  ] };
  const snapshot = path.join(temp, 'inventory.json');
  save(snapshot, fixture);
  check(() => compare(snapshot, fixture, true));
  check(() => compare(snapshot, { ...fixture, isDraft: false }, false));
  check(() => assert.throws(() => save(snapshot, fixture), /EEXIST/));
  const mutations = [
    (r) => { r.assets[0].id = 'replacement-asset'; },
    (r) => { r.assets[0].digest = `sha256:${'c'.repeat(64)}`; },
    (r) => { r.assets[0].size += 1; },
    (r) => { r.assets.pop(); },
    (r) => { r.assets.push({ ...r.assets[0], id: 'extra', name: 'extra.dmg' }); },
    (r) => { r.databaseId = 99; },
    (r) => { r.isDraft = false; },
    (r) => { r.isPrerelease = true; },
    (r) => { r.assets[0].state = 'new'; },
    (r) => { delete r.assets[0].id; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(fixture);
    mutate(changed);
    check(() => assert.throws(() => compare(snapshot, changed, true), undefined, 'Stale inventory must stop publication'));
  }
  check(() => assert.throws(() => inventory({ ...fixture, assets: [fixture.assets[0], fixture.assets[0]] }), /unique/));
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
console.log(`Guardian release boundaries passed: ${assertions} checks for credential isolation, shared locks, exact artifact evidence, inventory mutation refusal, and truthful bootstrap policy.`);
