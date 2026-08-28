#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const desktop = path.join(root, 'desktop');
const packageJson = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'), 'utf8'));
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
expect(packageJson.build.mac?.entitlements === 'build/entitlements.mac.plist', 'Main macOS entitlement path is incorrect.');
expect(packageJson.build.mac?.entitlementsInherit === 'build/entitlements.mac.inherit.plist', 'Helper entitlement path is incorrect.');
expect(packageJson.scripts?.['dist:mac:signed']?.includes('forceCodeSigning=true'), 'Signed-only build must require a signing identity.');
expect(packageJson.scripts?.['dist:mac:release']?.includes('NOTARIZE=1'), 'Release build must enable the notarization hook.');
expect(packageJson.scripts?.['dist:mac:release']?.includes('forceCodeSigning=true'), 'Release build must require a signing identity.');
expect(Boolean(packageJson.devDependencies?.['@electron/notarize']), 'Missing @electron/notarize development dependency.');

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

console.log('macOS release configuration passed: signing gate, hardened runtime, entitlements, and notarization hook are present.');
