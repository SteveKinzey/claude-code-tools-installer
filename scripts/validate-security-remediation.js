#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const desktopPath = path.join(root, 'desktop');
const packageJson = JSON.parse(fs.readFileSync(path.join(desktopPath, 'package.json'), 'utf8'));
const lockfile = JSON.parse(fs.readFileSync(path.join(desktopPath, 'package-lock.json'), 'utf8'));
const dependabotConfig = fs.readFileSync(path.join(root, '.github', 'dependabot.yml'), 'utf8');
const dependencyReviewWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'dependency-review.yml'), 'utf8');
const storeBundleWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'build-windows-store-msix.yml'), 'utf8');
const storeWindowsTestWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'test-windows-msix-clean-install.yml'), 'utf8');
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

const checkoutWorkflows = workflows.filter((workflowPath) => fs.readFileSync(workflowPath, 'utf8').includes('actions/checkout@'));
assert.ok(checkoutWorkflows.length > 0, 'At least one workflow must check out repository source.');
for (const workflowPath of checkoutWorkflows) {
  const contents = fs.readFileSync(workflowPath, 'utf8');
  const filename = path.basename(workflowPath);
  assert.doesNotMatch(contents, /actions\/checkout@v[1-5]\b/, `${filename} must not use a deprecated Node 20 checkout action.`);
  assert.match(contents, /actions\/checkout@v6\b/, `${filename} must use actions/checkout@v6.`);
}

for (const workflowPath of desktopWorkflows) {
  const contents = fs.readFileSync(workflowPath, 'utf8');
  const filename = path.basename(workflowPath);
  assert.match(contents, /node-version:\s*['"]?22\.12\.0['"]?/, `${filename} must pin Node ${minimumNode}.`);
  assert.doesNotMatch(contents, /npm install/, `${filename} must use lockfile-deterministic npm ci instead of npm install.`);
  assert.match(contents, /npm ci/, `${filename} must install dependencies with npm ci.`);
  assert.match(contents, /npm run check/, `${filename} must execute the complete desktop check, including the high-severity audit gate.`);
}

assert.match(dependabotConfig, /^version:\s*2\s*$/m, 'Dependabot configuration must use version 2.');
assert.match(dependabotConfig, /package-ecosystem:\s*npm[\s\S]*directory:\s*\/desktop[\s\S]*interval:\s*daily/, 'Dependabot must check desktop npm dependencies daily.');
assert.match(dependabotConfig, /package-ecosystem:\s*github-actions[\s\S]*directory:\s*\/[\s\S]*interval:\s*weekly/, 'Dependabot must check GitHub Actions dependencies weekly.');
assert.match(dependabotConfig, /electron-release-line:[\s\S]*electron-builder/, 'Dependabot must group Electron and packaging dependencies for compatible review.');
assert.match(dependencyReviewWorkflow, /pull_request:/, 'Dependency review must run on pull requests.');
assert.match(dependencyReviewWorkflow, /actions\/dependency-review-action@v4/, 'Dependency review must use the GitHub dependency review action.');
assert.match(dependencyReviewWorkflow, /fail-on-severity:\s*high/, 'Dependency review must block new high or critical vulnerabilities.');
assert.match(dependencyReviewWorkflow, /fail-on-scopes:\s*development, runtime, unknown/, 'Dependency review must cover development, runtime, and unknown scopes.');
assert.match(storeBundleWorkflow, /test_mode:/, 'Store bundle workflow must offer a non-production CI test mode.');
assert.match(storeBundleWorkflow, /CCTI\.LocalValidation/, 'Store bundle test mode must use a non-production fixture identity.');
assert.match(storeBundleWorkflow, /store-test/, 'Store bundle test mode must label its artifact as a test artifact.');
assert.match(storeBundleWorkflow, /secrets\.CCTI_APPX_IDENTITY_NAME/, 'Store bundle workflow must retain protected identity secrets for final candidates.');
assert.doesNotMatch(storeBundleWorkflow, /inputs\.(identity_name|publisher|publisher_display_name)/, 'Store bundle workflow must not accept Partner Center identity values through workflow dispatch.');
assert.match(packageJson.scripts?.['dist:win:store:x64'] || '', /electron-builder --win appx --x64/, 'Store x64 script must explicitly pass --x64 to electron-builder.');
assert.match(packageJson.scripts?.['dist:win:store:arm64'] || '', /electron-builder --win appx --arm64/, 'Store ARM64 script must explicitly pass --arm64 to electron-builder.');
assert.match(storeBundleWorkflow, /npm run dist:win:store:x64/, 'Store bundle workflow must use the explicit x64 build script.');
assert.match(storeBundleWorkflow, /npm run dist:win:store:arm64/, 'Store bundle workflow must use the explicit ARM64 build script.');
assert.match(storeWindowsTestWorkflow, /workflow_dispatch:/, 'Store MSIX test workflow must be manually dispatched.');
assert.match(storeWindowsTestWorkflow, /test_mode:/, 'Clean-Windows workflow must offer a non-production CI test mode.');
assert.match(storeWindowsTestWorkflow, /CCTI\.LocalValidation/, 'Clean-Windows test mode must use a non-production fixture identity.');
assert.match(storeWindowsTestWorkflow, /secrets\.CCTI_APPX_IDENTITY_NAME/, 'Clean-Windows workflow must retain protected identity secrets for final candidates.');
assert.doesNotMatch(storeWindowsTestWorkflow, /inputs\.(identity_name|publisher|publisher_display_name)/, 'Clean-Windows workflow must not accept Partner Center identity values through workflow dispatch.');
assert.match(storeWindowsTestWorkflow, /npm run msix:prepare/, 'Store MSIX test workflow must prepare the guarded Store configuration.');
assert.match(storeWindowsTestWorkflow, /npm run dist:win:store:x64/, 'Store MSIX test workflow must build an x64 Store package.');
assert.match(storeWindowsTestWorkflow, /npm run dist:win:store:arm64/, 'Store MSIX test workflow must build an ARM64 Store package.');
assert.match(storeWindowsTestWorkflow, /Add-AppxPackage/, 'Store MSIX test workflow must validate package installation.');
assert.match(storeWindowsTestWorkflow, /Remove-AppxPackage/, 'Store MSIX test workflow must validate package removal.');
assert.ok(!workflows.some((workflowPath) => /build-windows-signed-/i.test(path.basename(workflowPath))), 'Obsolete alternate Windows distribution workflows must not be present.');

console.log(`Dependency security contract passed: Electron ${lockfile.packages['node_modules/electron'].version}, no vulnerable extract-zip, ${desktopWorkflows.length} desktop CI workflows pinned to Node ${minimumNode}, Dependabot policy, pull-request dependency review, and Microsoft Store MSIX clean-install verification.`);
