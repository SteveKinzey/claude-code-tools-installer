#!/usr/bin/env node
/**
 * Release-blocking verifier for Electron Builder's latest-mac.yml.
 *
 * Run this after the DMG has been stapled and after refresh-macos-update-metadata
 * has updated the DMG descriptor, but before checksums and GitHub Release upload.
 *
 * Usage:
 *   node verify-macos-update-metadata.js /path/latest-mac.yml /path/final.dmg /path/updater.zip
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function usage() {
  console.error('Usage: node verify-macos-update-metadata.js /path/latest-mac.yml /path/final.dmg /path/updater.zip');
  process.exit(2);
}

function fail(message) {
  throw new Error(`latest-mac.yml integrity check failed: ${message}`);
}

function sha512Base64(filePath) {
  return crypto.createHash('sha512').update(fs.readFileSync(filePath)).digest('base64');
}

function validSha512(value) {
  if (typeof value !== 'string') return false;
  try {
    const decoded = Buffer.from(value, 'base64');
    return decoded.length === 64 && decoded.toString('base64') === value;
  } catch {
    return false;
  }
}

const [metadataPath, dmgPath, zipPath] = process.argv.slice(2);
if (!metadataPath || !dmgPath || !zipPath) usage();
for (const filePath of [metadataPath, dmgPath, zipPath]) {
  if (!fs.existsSync(filePath)) fail(`required file is missing: ${filePath}`);
}

const yaml = require(path.join(__dirname, '..', 'desktop', 'node_modules', 'js-yaml'));
const updateInfo = yaml.load(fs.readFileSync(metadataPath, 'utf8'));
if (!updateInfo || !Array.isArray(updateInfo.files)) fail('files[] is required.');

const artifacts = [dmgPath, zipPath].map((filePath) => ({
  filePath,
  name: path.basename(filePath),
  size: fs.statSync(filePath).size,
  sha512: sha512Base64(filePath),
}));

for (const artifact of artifacts) {
  const entries = updateInfo.files.filter((file) => file && file.url === artifact.name);
  if (entries.length !== 1) fail(`expected exactly one files[] entry for ${artifact.name}; found ${entries.length}.`);
  const entry = entries[0];
  if (!Number.isSafeInteger(entry.size) || entry.size < 0) fail(`${artifact.name} has an invalid size value.`);
  if (entry.size !== artifact.size) fail(`${artifact.name} size mismatch: metadata=${entry.size}, artifact=${artifact.size}.`);
  if (!validSha512(entry.sha512)) fail(`${artifact.name} has an invalid SHA-512 value.`);
  if (entry.sha512 !== artifact.sha512) fail(`${artifact.name} SHA-512 mismatch.`);
}

const zip = artifacts.find((artifact) => artifact.filePath === zipPath);
const zipEntry = updateInfo.files.find((file) => file && file.url === zip.name);
if (updateInfo.path !== zip.name) fail(`legacy path must select ${zip.name}; got ${String(updateInfo.path)}.`);
if (updateInfo.sha512 !== zipEntry.sha512) fail(`legacy SHA-512 must match the ${zip.name} files[] entry.`);

console.log(`latest-mac.yml integrity passed: ${artifacts.map((artifact) => `${artifact.name} (${artifact.size} bytes)`).join(', ')}.`);
