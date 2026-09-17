#!/usr/bin/env node
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const verifier = path.join(root, 'scripts', 'verify-macos-update-metadata.js');
const yaml = require(path.join(root, 'desktop', 'node_modules', 'js-yaml'));
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccti-update-metadata-verify-'));

function digest(value) {
  return crypto.createHash('sha512').update(value).digest('base64');
}

function runVerifier(metadataPath, dmgPath, zipPath) {
  return childProcess.spawnSync(process.execPath, [verifier, metadataPath, dmgPath, zipPath], { encoding: 'utf8' });
}

try {
  const dmgPath = path.join(tempRoot, 'Claude-Code-Tools-Installer-2026.9.20-mac-arm64.dmg');
  const zipPath = path.join(tempRoot, 'Claude-Code-Tools-Installer-2026.9.20-mac-arm64.zip');
  const metadataPath = path.join(tempRoot, 'latest-mac.yml');
  const dmg = Buffer.from('dmg-after-stapling');
  const zip = Buffer.from('native-updater-zip');
  fs.writeFileSync(dmgPath, dmg);
  fs.writeFileSync(zipPath, zip);

  const matchingMetadata = {
    version: '2026.9.20',
    files: [
      { url: path.basename(zipPath), sha512: digest(zip), size: zip.length },
      { url: path.basename(dmgPath), sha512: digest(dmg), size: dmg.length },
    ],
    path: path.basename(zipPath),
    sha512: digest(zip),
  };
  fs.writeFileSync(metadataPath, yaml.dump(matchingMetadata, { lineWidth: -1, noRefs: true }));

  let result = runVerifier(metadataPath, dmgPath, zipPath);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /integrity passed/i);

  const staleDmgMetadata = { ...matchingMetadata, files: matchingMetadata.files.map((entry) => ({ ...entry })) };
  const dmgEntry = staleDmgMetadata.files.find((entry) => entry.url === path.basename(dmgPath));
  dmgEntry.size -= 1;
  dmgEntry.sha512 = digest(Buffer.from('dmg-before-stapling'));
  fs.writeFileSync(metadataPath, yaml.dump(staleDmgMetadata, { lineWidth: -1, noRefs: true }));

  result = runVerifier(metadataPath, dmgPath, zipPath);
  assert.notEqual(result.status, 0, 'A stale post-stapling DMG descriptor must block the release.');
  assert.match(result.stderr, /size mismatch|SHA-512 mismatch/i);

  fs.writeFileSync(metadataPath, yaml.dump(matchingMetadata, { lineWidth: -1, noRefs: true }));
  const invalidLegacyMetadata = { ...matchingMetadata, path: path.basename(dmgPath) };
  fs.writeFileSync(metadataPath, yaml.dump(invalidLegacyMetadata, { lineWidth: -1, noRefs: true }));

  result = runVerifier(metadataPath, dmgPath, zipPath);
  assert.notEqual(result.status, 0, 'A legacy updater path that points at the DMG must block the release.');
  assert.match(result.stderr, /legacy path/i);

  console.log('Post-stapling latest-mac.yml verifier passed: matching artifacts are accepted and stale DMG metadata or an invalid legacy updater path blocks release upload.');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
