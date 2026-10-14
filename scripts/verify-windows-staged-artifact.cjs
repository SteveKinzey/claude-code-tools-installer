#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { parseReleaseIdentity } = require('../desktop/src/release-identity');
const digest = (bytes, algorithm = 'sha256', encoding = 'hex') => crypto.createHash(algorithm).update(bytes).digest(encoding);

// Cryptographic trust verification of both bundles is a separate mandatory
// publisher step. This helper verifies data/bytes only and executes no package.
function verify(directory, tag, commit) {
  const identity = parseReleaseIdentity(tag);
  assert.ok(identity && !identity.isLegacy && identity.tag === tag, 'Require canonical daily release identity');
  assert.match(commit, /^[0-9a-f]{40}$/);
  const files = fs.readdirSync(directory).filter((file) => /-win-x64\.exe$/i.test(file));
  assert.equal(files.length, 1, 'Require one staged Windows installer');
  const name = files[0];
  assert.equal(name, `Claude-Code-Tools-Installer-${identity.packageVersion}-win-x64.exe`);
  const bytes = fs.readFileSync(path.join(directory, name));
  const sha256 = digest(bytes);
  assert.equal(bytes.toString('ascii', 0, 2), 'MZ', 'Require PE bytes');
  const receipt = JSON.parse(fs.readFileSync(path.join(directory, 'windows-unsigned-source-predicate.json'), 'utf8'));
  assert.equal(receipt.source_tag, tag, 'Staged source tag mismatch');
  assert.equal(receipt.source_commit, commit, 'Staged source commit mismatch');
  assert.equal(receipt.controller_commit, commit, 'Final release controller must be exact immutable source');
  assert.equal(receipt.version, identity.packageVersion, 'Staged package version mismatch');
  assert.equal(receipt.architecture, 'x64');
  assert.equal(receipt.installer.name, name);
  assert.equal(receipt.installer.size, bytes.length);
  assert.equal(receipt.installer.sha256, sha256, 'Staged SHA-256 mismatch');
  assert.equal(receipt.installer.sha512, digest(bytes, 'sha512', 'base64'), 'Staged SHA-512 mismatch');
  assert.equal(fs.readFileSync(path.join(directory, `${name}.sha256`), 'utf8').trim(), `${sha256}  ${name}`, 'Staged checksum sidecar mismatch');
  assert.equal(receipt.updater_sha256, digest(fs.readFileSync(path.join(directory, 'latest.yml'))), 'Staged updater bytes mismatch');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'windows-unsigned-source.json'), 'utf8')), receipt, 'Staged source receipts differ');
  for (const bundle of ['windows-build-provenance.sigstore.json', 'windows-source-binding.sigstore.json']) {
    assert.ok(fs.statSync(path.join(directory, bundle)).size > 0, 'Missing trust bundle');
    JSON.parse(fs.readFileSync(path.join(directory, bundle), 'utf8'));
  }
  return { passed: true, tag, commit, name, size: bytes.length, sha256, scope: 'staged byte/source/updater integrity; both attestation signatures must independently verify' };
}

if (require.main === module) {
  const [directory, tag, commit] = process.argv.slice(2);
  console.log(JSON.stringify(verify(directory, tag, commit), null, 2));
}
module.exports = { verify };
