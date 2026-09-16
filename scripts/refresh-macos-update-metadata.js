#!/usr/bin/env node
/**
 * Refresh the DMG descriptor in Electron Builder's latest-mac.yml after
 * stapling changes the final DMG bytes. The native updater selects the ZIP,
 * but metadata must describe every released artifact truthfully.
 *
 * Usage: node refresh-macos-update-metadata.js /path/latest-mac.yml /path/final.dmg
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function usage() {
  console.error('Usage: node refresh-macos-update-metadata.js /path/latest-mac.yml /path/final.dmg');
  process.exit(2);
}

const [metadataPath, dmgPath] = process.argv.slice(2);
if (!metadataPath || !dmgPath) usage();
if (!fs.existsSync(metadataPath)) throw new Error(`Update metadata not found: ${metadataPath}`);
if (!fs.existsSync(dmgPath)) throw new Error(`Final DMG not found: ${dmgPath}`);

const yaml = require(path.join(__dirname, '..', 'desktop', 'node_modules', 'js-yaml'));
const updateInfo = yaml.load(fs.readFileSync(metadataPath, 'utf8'));
if (!updateInfo || !Array.isArray(updateInfo.files)) {
  throw new Error('latest-mac.yml must contain a files array.');
}

const dmgName = path.basename(dmgPath);
const dmgInfo = updateInfo.files.find((file) => file && file.url === dmgName);
if (!dmgInfo) throw new Error(`latest-mac.yml does not reference the final DMG: ${dmgName}`);

const hash = crypto.createHash('sha512');
const input = fs.createReadStream(dmgPath);
input.on('error', (error) => { throw error; });
input.on('data', (chunk) => hash.update(chunk));
input.on('end', () => {
  dmgInfo.size = fs.statSync(dmgPath).size;
  dmgInfo.sha512 = hash.digest('base64');
  fs.writeFileSync(metadataPath, yaml.dump(updateInfo, { lineWidth: -1, noRefs: true }));
  console.log(`Refreshed latest-mac.yml metadata for ${dmgName} (${dmgInfo.size} bytes).`);
});
