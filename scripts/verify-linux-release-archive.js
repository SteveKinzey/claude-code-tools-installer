#!/usr/bin/env node
/**
 * Verify a Linux release archive before or after GitHub Release upload.
 * Usage: node scripts/verify-linux-release-archive.js ARCHIVE ARCHIVE.sha256 ARCHIVE.sigstore.json
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const [archivePath, checksumPath, bundlePath] = process.argv.slice(2);
if (!archivePath || !checksumPath || !bundlePath) {
  console.error('Usage: node scripts/verify-linux-release-archive.js ARCHIVE ARCHIVE.sha256 ARCHIVE.sigstore.json');
  process.exit(2);
}
for (const filePath of [archivePath, checksumPath, bundlePath]) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size <= 0) throw new Error(`Required release file is missing or empty: ${filePath}`);
}
if (!/linux-x64\.tar\.gz$/i.test(path.basename(archivePath))) {
  throw new Error(`Expected a linux-x64.tar.gz archive; got ${path.basename(archivePath)}.`);
}
const checksum = fs.readFileSync(checksumPath, 'utf8').trim();
const match = /^([a-f0-9]{64})\s{2}([^\r\n]+)$/i.exec(checksum);
if (!match) throw new Error('Checksum sidecar must contain one conventional SHA-256 line: <digest><two spaces><filename>.');
if (match[2] !== path.basename(archivePath)) {
  throw new Error(`Checksum sidecar targets ${match[2]}, not ${path.basename(archivePath)}.`);
}
const actualDigest = crypto.createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex');
if (actualDigest.toLowerCase() !== match[1].toLowerCase()) {
  throw new Error(`SHA-256 mismatch for ${path.basename(archivePath)}.`);
}
try {
  const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
  if (!bundle || typeof bundle !== 'object') throw new Error('not an object');
} catch (error) {
  throw new Error(`Sigstore bundle is not valid JSON: ${error.message}`);
}
console.log(`Linux archive integrity passed: ${path.basename(archivePath)} (${fs.statSync(archivePath).size} bytes, sha256 ${actualDigest}).`);
