#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const desktopPath = path.join(root, 'desktop');
const readWorkflowText = (filePath) => fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
const packageJson = JSON.parse(fs.readFileSync(path.join(desktopPath, 'package.json'), 'utf8'));
const lockfile = JSON.parse(fs.readFileSync(path.join(desktopPath, 'package-lock.json'), 'utf8'));
const dependabotConfig = readWorkflowText(path.join(root, '.github', 'dependabot.yml'));
const dependencyReviewWorkflow = readWorkflowText(path.join(root, '.github', 'workflows', 'dependency-review.yml'));
const storeBundleWorkflow = readWorkflowText(path.join(root, '.github', 'workflows', 'build-windows-store-msix.yml'));
const storeWindowsTestWorkflow = readWorkflowText(path.join(root, '.github', 'workflows', 'test-windows-msix-clean-install.yml'));
const pagesWorkflow = readWorkflowText(path.join(root, '.github', 'workflows', 'deploy-field-guide-pages.yml'));
const fieldGuideHealthWorkflow = readWorkflowText(path.join(root, '.github', 'workflows', 'field-guide-health-check.yml'));
const macReleaseWorkflow = readWorkflowText(path.join(root, '.github', 'workflows', 'release-macos-signed-notarized.yml'));
const weeklySecurityWorkflow = readWorkflowText(path.join(root, '.github', 'workflows', 'weekly-dependency-security.yml'));
const codeqlWorkflow = readWorkflowText(path.join(root, '.github', 'workflows', 'codeql.yml'));
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
const desktopWorkflows = workflows.filter((workflowPath) => readWorkflowText(workflowPath).includes('working-directory: desktop'));
assert.ok(desktopWorkflows.length > 0, 'At least one desktop CI workflow must exist.');

const checkoutWorkflows = workflows.filter((workflowPath) => readWorkflowText(workflowPath).includes('actions/checkout@'));
assert.ok(checkoutWorkflows.length > 0, 'At least one workflow must check out repository source.');
for (const workflowPath of workflows) {
  const contents = readWorkflowText(workflowPath);
  const filename = path.basename(workflowPath);
  const actionReferences = contents.match(/^\s*uses:\s+[^\s]+/gm) || [];
  for (const reference of actionReferences) {
    assert.match(reference, /@[0-9a-f]{40}\b/, `${filename} must pin every GitHub Action to a full commit SHA.`);
  }
  const checkoutReferences = contents.match(/actions\/checkout@[0-9a-f]{40}\b/g) || [];
  const disabledCredentialPersistence = contents.match(/persist-credentials:\s*false/g) || [];
  assert.equal(disabledCredentialPersistence.length, checkoutReferences.length, `${filename} must disable persisted credentials for every checkout action.`);
}

for (const workflowPath of desktopWorkflows) {
  const contents = readWorkflowText(workflowPath);
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
assert.doesNotMatch(dependencyReviewWorkflow, /pull_request_target:/, 'Dependency review must not execute with pull_request_target privileges.');
assert.match(dependencyReviewWorkflow, /actions\/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294/, 'Dependency review must use the pinned GitHub dependency review action.');
assert.match(dependencyReviewWorkflow, /fail-on-severity:\s*high/, 'Dependency review must block new high or critical vulnerabilities.');
assert.match(dependencyReviewWorkflow, /fail-on-scopes:\s*development, runtime, unknown/, 'Dependency review must cover development, runtime, and unknown scopes.');
assert.doesNotMatch(fieldGuideHealthWorkflow, /workflow_run:/, 'Health checks must not execute repository scripts from a workflow_run trigger.');
assert.match(fieldGuideHealthWorkflow, /cron:\s*'17 9 \* \* 1'/, 'Field Guide health checks must retain their Monday schedule.');
assert.doesNotMatch(pagesWorkflow, /^  (pages|id-token): write$/m, 'Pages write and OIDC permissions must not be granted at workflow scope.');
assert.match(pagesWorkflow, /build:[\s\S]*?permissions:\n\s+contents: read\n\s+pages: write\n\s+id-token: write/, 'The Pages build job must declare only its required permissions.');
assert.match(pagesWorkflow, /deploy:[\s\S]*?permissions:\n\s+pages: write\n\s+id-token: write/, 'The Pages deploy job must declare only its required permissions.');
assert.doesNotMatch(macReleaseWorkflow, /\n  push:\n[\s\S]*?tags:/, 'The privileged macOS release workflow must not run automatically on tag pushes.');
assert.match(macReleaseWorkflow, /workflow_dispatch:/, 'The privileged macOS release workflow must require manual dispatch.');
assert.doesNotMatch(macReleaseWorkflow, /\n    env:\n(?:      [^\n]*\n)*      [^:\n]+:\s*\$\{\{ secrets\./, 'macOS release secrets must be scoped to consuming steps instead of the job.');
assert.match(macReleaseWorkflow, /notary_auth=api_key/, 'macOS release workflow must support a complete App Store Connect API-key notarization set.');
assert.match(macReleaseWorkflow, /notary_auth=apple_id/, 'macOS release workflow must support the managed Apple ID notarization secret set.');
assert.match(macReleaseWorkflow, /APPLE_NOTARY_APP_PASSWORD/, 'macOS release workflow must scope the Apple ID notarization password to consuming steps.');
assert.match(macReleaseWorkflow, /steps\.checksums\.outputs\.dmg_checksum/, 'macOS release workflow must publish a detached DMG SHA-256 checksum.');
assert.match(macReleaseWorkflow, /steps\.checksums\.outputs\.zip_checksum/, 'macOS release workflow must publish a detached ZIP SHA-256 checksum.');
assert.doesNotMatch(storeBundleWorkflow, /\n    env:\n(?:      [^\n]*\n)*      [^:\n]+:\s*\$\{\{ secrets\./, 'Store bundle secrets must be scoped to consuming steps instead of the job.');
assert.doesNotMatch(storeWindowsTestWorkflow, /\n    env:\n(?:      [^\n]*\n)*      [^:\n]+:\s*\$\{\{ secrets\./, 'Store lifecycle test secrets must be scoped to consuming steps instead of the job.');
assert.match(weeklySecurityWorkflow, /cron:\s*'23 8 \* \* 1'/, 'Weekly dependency security scanning must run every Monday.');
assert.match(weeklySecurityWorkflow, /npm ci --ignore-scripts/, 'Weekly dependency security scanning must not execute lifecycle scripts.');
assert.match(weeklySecurityWorkflow, /npm audit --audit-level=high/, 'Weekly dependency security scanning must fail on high or critical findings.');
assert.match(weeklySecurityWorkflow, /retention-days:\s*30/, 'Weekly vulnerability reports must have bounded retention.');
assert.match(weeklySecurityWorkflow, /contents: read/, 'Weekly security scanning must use a read-only token.');
assert.match(codeqlWorkflow, /pull_request:/, 'CodeQL must scan pull requests before merge.');
assert.match(codeqlWorkflow, /cron:\s*'41 8 \* \* 1'/, 'CodeQL must run on the established weekly schedule.');
assert.match(codeqlWorkflow, /github\/codeql-action\/init@b96794f015dfd88f77b49b1c93e0fa7110f94c63/, 'CodeQL initialization must use the pinned reviewed action revision.');
assert.match(codeqlWorkflow, /github\/codeql-action\/analyze@b96794f015dfd88f77b49b1c93e0fa7110f94c63/, 'CodeQL analysis must use the pinned reviewed action revision.');
assert.match(codeqlWorkflow, /security-events: write/, 'CodeQL must have only the security-events write permission required to upload findings.');
assert.match(codeqlWorkflow, /languages:\s*\$\{\{ matrix\.language \}\}/, 'CodeQL must analyze the configured JavaScript and TypeScript language matrix.');
assert.match(storeBundleWorkflow, /test_mode:/, 'Store bundle workflow must offer a non-production CI test mode.');
assert.match(storeBundleWorkflow, /source_tag:/, 'Store bundle workflow must support building an existing immutable source tag.');
assert.match(storeBundleWorkflow, /ref:\s*\$\{\{ inputs\.source_tag \|\| github\.ref \}\}/, 'Store bundle workflow must check out the requested source tag when one is provided.');
assert.match(storeBundleWorkflow, /git describe --exact-match --tags HEAD/, 'Store bundle workflow must verify the requested source tag resolves to the checked-out commit.');
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
assert.match(storeWindowsTestWorkflow, /source_tag:/, 'Clean-Windows workflow must support testing an existing immutable source tag.');
assert.match(storeWindowsTestWorkflow, /ref:\s*\$\{\{ inputs\.source_tag \|\| github\.ref \}\}/, 'Clean-Windows workflow must check out the requested source tag when one is provided.');
assert.match(storeWindowsTestWorkflow, /git describe --exact-match --tags HEAD/, 'Clean-Windows workflow must verify the requested source tag resolves to the checked-out commit.');
assert.match(storeWindowsTestWorkflow, /CCTI\.LocalValidation/, 'Clean-Windows test mode must use a non-production fixture identity.');
assert.match(storeWindowsTestWorkflow, /secrets\.CCTI_APPX_IDENTITY_NAME/, 'Clean-Windows workflow must retain protected identity secrets for final candidates.');
assert.doesNotMatch(storeWindowsTestWorkflow, /inputs\.(identity_name|publisher|publisher_display_name)/, 'Clean-Windows workflow must not accept Partner Center identity values through workflow dispatch.');
assert.match(storeWindowsTestWorkflow, /npm run msix:prepare/, 'Store MSIX test workflow must prepare the guarded Store configuration.');
assert.match(storeWindowsTestWorkflow, /npm run dist:win:store:x64/, 'Store MSIX test workflow must build an x64 Store package.');
assert.match(storeWindowsTestWorkflow, /npm run dist:win:store:arm64/, 'Store MSIX test workflow must build an ARM64 Store package.');
assert.match(storeWindowsTestWorkflow, /Add-AppxPackage/, 'Store MSIX test workflow must validate package installation.');
assert.match(storeWindowsTestWorkflow, /Remove-AppxPackage/, 'Store MSIX test workflow must validate package removal.');
assert.ok(!workflows.some((workflowPath) => /build-windows-signed-/i.test(path.basename(workflowPath))), 'Obsolete alternate Windows distribution workflows must not be present.');

console.log(`Dependency security contract passed: Electron ${lockfile.packages['node_modules/electron'].version}, no vulnerable extract-zip, ${desktopWorkflows.length} desktop CI workflows pinned to Node ${minimumNode}, Dependabot policy, pull-request dependency review, CodeQL scanning, and Microsoft Store MSIX clean-install verification.`);
