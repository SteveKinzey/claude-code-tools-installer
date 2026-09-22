#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const desktop = path.join(root, 'desktop');
const packageJson = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'), 'utf8'));
const releaseWorkflowPath = path.join(root, '.github', 'workflows', 'release-macos-signed-notarized.yml');
const entitlementPaths = [
  path.join(desktop, 'build', 'entitlements.mac.plist'),
  path.join(desktop, 'build', 'entitlements.mac.inherit.plist'),
];
const errors = [];

function expect(condition, message) {
  if (!condition) errors.push(message);
}

expect(packageJson.build.afterSign === 'build/notarize.js', 'Missing Electron Builder afterSign notarization hook.');
expect(packageJson.build.mac?.hardenedRuntime === true, 'mac.hardenedRuntime must be true.');
expect(packageJson.build.mac?.icon === 'build/icon.icns', 'mac.icon must use the custom build/icon.icns asset.');
expect(fs.existsSync(path.join(desktop, 'build', 'icon.icns')), 'Missing custom macOS icon: desktop/build/icon.icns.');
expect(packageJson.build.mac?.entitlements === 'build/entitlements.mac.plist', 'Main macOS entitlement path is incorrect.');
expect(packageJson.build.mac?.entitlementsInherit === 'build/entitlements.mac.inherit.plist', 'Helper entitlement path is incorrect.');
expect(packageJson.scripts?.['dist:mac:signed']?.includes('forceCodeSigning=true'), 'Signed-only build must require a signing identity.');
expect(packageJson.scripts?.['dist:mac:release']?.includes('NOTARIZE=1'), 'Release build must enable the notarization hook.');
expect(packageJson.scripts?.['dist:mac:release']?.includes('forceCodeSigning=true'), 'Release build must require a signing identity.');
expect(Boolean(packageJson.devDependencies?.['@electron/notarize']), 'Missing @electron/notarize development dependency.');
expect(packageJson.dependencies?.['electron-updater'], 'Missing electron-updater production dependency.');
expect(packageJson.build?.publish?.provider === 'github' && packageJson.build.publish.owner === 'SteveKinzey' && packageJson.build.publish.repo === 'claude-code-tools-installer', 'Native updater must use the verified public GitHub Releases feed.');
expect(packageJson.build?.artifactName === 'Claude-Code-Tools-Installer-${version}-${os}-${arch}.${ext}', 'macOS native update metadata needs space-free artifact names.');
expect(fs.existsSync(releaseWorkflowPath), 'Missing signed macOS release workflow.');

if (fs.existsSync(releaseWorkflowPath)) {
  const releaseWorkflow = fs.readFileSync(releaseWorkflowPath, 'utf8');
  expect(releaseWorkflow.includes('scripts/release-identity.js'), 'Release tag validation must use the centralized release identity validator.');
  expect(releaseWorkflow.includes('--require-daily-revision'), 'New macOS releases must require a canonical daily revision tag.');
  expect(releaseWorkflow.includes('checkout "$TAG" -- desktop setup-my-claude.sh'), 'Release workflow must restore the tagged desktop runtime before validation.');
  expect(!releaseWorkflow.includes('checkout "$TAG" -- desktop scripts'), 'Release workflow must retain current release-policy validators instead of restoring stale tag scripts.');
  expect(releaseWorkflow.includes('for artifact in "$DMG" "$ZIP" "$METADATA" "$DMG_CHECKSUM" "$ZIP_CHECKSUM"; do'), 'Release workflow must upload macOS assets sequentially to avoid GitHub asset-name races.');
  expect(releaseWorkflow.includes('upload_release_asset() {'), 'Release workflow must use a dedicated GitHub Release asset uploader.');
  expect(releaseWorkflow.includes('for attempt in 1 2 3; do'), 'Release workflow must retry macOS release asset uploads before failing.');
  expect(releaseWorkflow.includes('gh api -X DELETE "repos/$GITHUB_REPOSITORY/releases/assets/$release_asset_database_id"'), 'Release workflow must remove any pre-existing asset by numeric REST database ID before uploading a replacement.');
  expect(releaseWorkflow.includes('if gh release upload "$TAG" "$artifact"; then'), 'Release workflow must upload each release asset individually after pre-deleting duplicates.');
}

for (const entitlementPath of entitlementPaths) {
  expect(fs.existsSync(entitlementPath), `Missing entitlement file: ${path.relative(root, entitlementPath)}.`);
  if (!fs.existsSync(entitlementPath)) continue;
  const contents = fs.readFileSync(entitlementPath, 'utf8');
  expect(contents.includes('com.apple.security.cs.allow-jit'), `Missing JIT entitlement in ${path.basename(entitlementPath)}.`);
  expect(contents.includes('com.apple.security.cs.allow-unsigned-executable-memory'), `Missing unsigned executable memory entitlement in ${path.basename(entitlementPath)}.`);
}

const notarizeHook = path.join(desktop, 'build', 'notarize.js');
expect(fs.existsSync(notarizeHook), 'Missing notarization hook file.');

if (errors.length) {
  console.error('macOS release configuration failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('macOS release configuration passed: custom icon, signing gate, hardened runtime, entitlements, and notarization hook are present.');
