#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const desktopPath = path.join(root, 'desktop');
const packageJson = JSON.parse(fs.readFileSync(path.join(desktopPath, 'package.json'), 'utf8'));
const lockfile = JSON.parse(fs.readFileSync(path.join(desktopPath, 'package-lock.json'), 'utf8'));
const minimumNode = '22.12.0';

function versionParts(version) {
  return String(version || '').replace(/^[^\d]*/, '').split('.').slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
}

function isAtLeast(version, required) {
  const actualParts = versionParts(version);
  const requiredParts = versionParts(required);
  return actualParts.every((part, index) => {
    if (actualParts.slice(0, index).some((prior, priorIndex) => prior !== requiredParts[priorIndex])) return true;
    return part >= requiredParts[index];
  });
}

assert.equal(packageJson.engines?.node, `>=${minimumNode}`, `Desktop package engine must require Node ${minimumNode} or later.`);
assert.match(packageJson.devDependencies?.electron || '', /^\^44\./, 'Desktop dependency must stay on the supported Electron 44 release line.');
assert.ok(isAtLeast(lockfile.packages?.['node_modules/electron']?.version, '44.3.0'), 'Lockfile must resolve Electron 44.3.0 or later.');
assert.equal(lockfile.packages?.['node_modules/extract-zip'], undefined, 'Vulnerable extract-zip must not be present in the resolved dependency tree.');
assert.match(packageJson.scripts?.['security:check'] || '', /validate-security-remediation\.js/, 'Security check must validate the package, lockfile, and CI contract.');
assert.match(packageJson.scripts?.['security:check'] || '', /npm audit --audit-level=high/, 'Security check must block high or critical npm audit findings.');

const workflows = fs.readdirSync(path.join(root, '.github', 'workflows'))
  .filter((name) => /\.ya?ml$/i.test(name))
  .map((name) => path.join(root, '.github', 'workflows', name));
const desktopWorkflows = workflows.filter((workflowPath) => fs.readFileSync(workflowPath, 'utf8').includes('working-directory: desktop'));
assert.ok(desktopWorkflows.length > 0, 'At least one desktop CI workflow must exist.');

for (const workflowPath of desktopWorkflows) {
  const contents = fs.readFileSync(workflowPath, 'utf8');
  const filename = path.basename(workflowPath);
  assert.match(contents, /node-version:\s*['"]?22\.12\.0['"]?/, `${filename} must pin Node ${minimumNode}.`);
  assert.doesNotMatch(contents, /npm install/, `${filename} must use lockfile-deterministic npm ci instead of npm install.`);
  assert.match(contents, /npm ci/, `${filename} must install dependencies with npm ci.`);
  assert.match(contents, /npm run check/, `${filename} must execute the complete desktop check, including the high-severity audit gate.`);
}

console.log(`Dependency security contract passed: Electron ${lockfile.packages['node_modules/electron'].version}, no vulnerable extract-zip, ${desktopWorkflows.length} desktop CI workflows pinned to Node ${minimumNode}.`);
