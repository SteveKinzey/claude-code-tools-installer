#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

function inventory(release) {
  assert.match(String(release.databaseId), /^\d+$/, 'Require numeric release identity');
  assert.equal(release.isPrerelease, false, 'Do not promote a prerelease');
  assert.ok(Array.isArray(release.assets) && release.assets.length, 'Require a complete asset set');
  const names = new Set();
  const assets = release.assets.map((asset) => {
    assert.ok(asset.name && !names.has(asset.name), 'Asset names must be unique');
    names.add(asset.name);
    assert.equal(asset.state, 'uploaded', 'Every asset must be fully uploaded');
    assert.match(asset.digest, /^sha256:[a-f0-9]{64}$/i, 'Every asset must have a SHA-256 digest');
    assert.ok(Number.isSafeInteger(asset.size) && asset.size > 0, 'Every asset must be nonempty');
    const id = asset.apiUrl || asset.id;
    assert.ok(id, 'Require immutable asset identity');
    return { id, name: asset.name, size: asset.size, digest: asset.digest.toLowerCase() };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return { releaseId: String(release.databaseId), assets };
}

function save(file, release) {
  assert.equal(release.isDraft, true, 'Verification must begin on a draft');
  fs.writeFileSync(file, JSON.stringify(inventory(release)), { flag: 'wx', mode: 0o600 });
}

function compare(file, release, expectedDraft) {
  assert.equal(release.isDraft, expectedDraft, 'Unexpected release publication state');
  assert.deepEqual(inventory(release), JSON.parse(fs.readFileSync(file, 'utf8')), 'Verified asset inventory changed; refusing promotion');
}

if (require.main === module) {
  const [mode, file, json] = process.argv.slice(2);
  const release = JSON.parse(json);
  if (mode === 'save') save(file, release);
  else if (mode === 'draft') compare(file, release, true);
  else if (mode === 'public') compare(file, release, false);
  else throw new Error('Usage: release-inventory.cjs save|draft|public SNAPSHOT RELEASE_JSON');
}
module.exports = { inventory, save, compare };
