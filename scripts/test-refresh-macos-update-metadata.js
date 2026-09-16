#!/usr/bin/env node
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = require(path.join(__dirname, '..', 'desktop', 'node_modules', 'js-yaml'));

const root = path.resolve(__dirname, '..');
const refreshScript = path.join(root, 'scripts', 'refresh-macos-update-metadata.js');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccti-update-metadata-'));
try {
  const dmgPath = path.join(tempRoot, 'Claude-Code-Tools-Installer-2026.9.17-mac-arm64.dmg');
  const zipPath = path.join(tempRoot, 'Claude-Code-Tools-Installer-2026.9.17-mac-arm64.zip');
  const metadataPath = path.join(tempRoot, 'latest-mac.yml');
  const digest = (value) => crypto.createHash('sha512').update(value).digest('base64');
  const preStapleDmg = Buffer.from('dmg-before-stapling');
  const zip = Buffer.from('updater-zip-is-not-modified-after-notarization');
  fs.writeFileSync(dmgPath, preStapleDmg);
  fs.writeFileSync(zipPath, zip);
  fs.writeFileSync(metadataPath, yaml.dump({
    version: '2026.9.17',
    files: [
      { url: path.basename(zipPath), sha512: digest(zip), size: zip.length },
      { url: path.basename(dmgPath), sha512: digest(preStapleDmg), size: preStapleDmg.length },
    ],
    path: path.basename(zipPath),
    sha512: digest(zip),
    releaseDate: '2026-09-16T08:00:00.000Z',
  }, { lineWidth: -1, noRefs: true }));

  // Stapling adds the ticket to the DMG, so release metadata must be refreshed.
  fs.appendFileSync(dmgPath, Buffer.from('-stapled-ticket'));
  childProcess.execFileSync(process.execPath, [refreshScript, metadataPath, dmgPath], { stdio: 'inherit' });

  const updated = yaml.load(fs.readFileSync(metadataPath, 'utf8'));
  const updatedDmg = updated.files.find((file) => file.url === path.basename(dmgPath));
  const unchangedZip = updated.files.find((file) => file.url === path.basename(zipPath));
  assert.equal(updatedDmg.size, fs.statSync(dmgPath).size, 'DMG size must describe the stapled release artifact');
  assert.equal(updatedDmg.sha512, digest(fs.readFileSync(dmgPath)), 'DMG SHA-512 must describe the stapled release artifact');
  assert.equal(unchangedZip.size, zip.length, 'ZIP metadata must remain unchanged');
  assert.equal(unchangedZip.sha512, digest(zip), 'ZIP SHA-512 must remain unchanged');
  assert.equal(updated.path, path.basename(zipPath), 'Legacy path must continue to choose the updater ZIP');
  assert.equal(updated.sha512, digest(zip), 'Legacy SHA-512 must continue to match the updater ZIP');
  console.log('Post-stapling latest-mac.yml refresh passed: final DMG metadata is accurate and native updater ZIP metadata is unchanged.');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
