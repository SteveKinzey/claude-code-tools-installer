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
const pagesWorkflow = readWorkflowText(path.join(root, '.github', 'workflows', 'deploy-field-guide-pages.yml'));
const fieldGuideHealthWorkflow = readWorkflowText(path.join(root, '.github', 'workflows', 'field-guide-health-check.yml'));
const macReleaseWorkflow = readWorkflowText(path.join(root, '.github', 'workflows', 'release-macos-signed-notarized.yml'));
const weeklySecurityWorkflow = readWorkflowText(path.join(root, '.github', 'workflows', 'weekly-dependency-security.yml'));
const codeqlWorkflow = readWorkflowText(path.join(root, '.github', 'workflows', 'codeql.yml'));
const macCandidateWorkflow = readWorkflowText(path.join(root, '.github', 'workflows', 'build-macos-signed-notarized-test.yml'));
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
const fullDesktopValidationWorkflows = desktopWorkflows.filter((workflowPath) => readWorkflowText(workflowPath).includes('npm run check'));
assert.ok(fullDesktopValidationWorkflows.length > 0, 'At least one desktop CI workflow must run the complete validation gate.');

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
}

for (const workflowPath of fullDesktopValidationWorkflows) {
  const contents = readWorkflowText(workflowPath);
  const filename = path.basename(workflowPath);
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
assert.match(macReleaseWorkflow, /printf '%s  %s\\n' "\$dmg_digest" "\$\(basename "\$DMG"\)"/, 'macOS release workflow must write portable SHA-256 checksum filenames.');
assert.match(macReleaseWorkflow, /notarytool submit \"\$ZIP\"/, 'macOS native update ZIP must be notarized before release upload.');
assert.match(macReleaseWorkflow, /refresh-macos-update-metadata\.js \"\$METADATA\" \"\$DMG\"/, 'macOS release workflow must refresh latest-mac.yml after stapling changes final DMG bytes.');
assert.match(macReleaseWorkflow, /verify-macos-update-metadata\.js \"\$METADATA\" \"\$DMG\" \"\$ZIP\"/, 'macOS release workflow must verify every final latest-mac.yml descriptor before release upload.');
const refreshMetadataIndex = macReleaseWorkflow.indexOf('refresh-macos-update-metadata.js "$METADATA" "$DMG"');
const verifyMetadataIndex = macReleaseWorkflow.indexOf('verify-macos-update-metadata.js "$METADATA" "$DMG" "$ZIP"');
const checksumCreationIndex = macReleaseWorkflow.indexOf('name: Create SHA-256 checksums');
assert.ok(refreshMetadataIndex >= 0 && verifyMetadataIndex > refreshMetadataIndex && checksumCreationIndex > verifyMetadataIndex, 'Final latest-mac.yml verification must run after metadata refresh and before checksums or release upload.');
assert.match(macReleaseWorkflow, /for artifact in "\$DMG" "\$ZIP" "\$METADATA" "\$DMG_CHECKSUM" "\$ZIP_CHECKSUM"; do/, 'macOS release workflow must upload each notarized release asset in a deterministic order.');
assert.match(macReleaseWorkflow, /upload_release_asset "\$artifact"/, 'macOS release upload retries must use its per-asset retry helper without concurrent upload races.');
assert.match(macReleaseWorkflow, /gh api -X DELETE "repos\/\$GITHUB_REPOSITORY\/releases\/assets\/\$release_asset_database_id"/, 'macOS release upload retries must remove only the matching conflicting asset by numeric REST database ID before retrying.');
assert.match(macReleaseWorkflow, /if gh release upload "\$TAG" "\$artifact"; then/, 'macOS release upload retries must upload each asset individually.');
assert.match(macReleaseWorkflow, /gh release create "\$TAG" --target "\$SOURCE_COMMIT" --title "\$TAG" --generate-notes --draft/, 'macOS release publication must start from a private draft.');
assert.match(macReleaseWorkflow, /Verify draft macOS asset inventory before cross-platform handoff/, 'macOS releases must verify the complete draft asset inventory before cross-platform handoff.');
assert.match(macReleaseWorkflow, /gh release view "\$TAG" --json databaseId --jq '\.databaseId'/, 'macOS release publication must resolve the numeric GitHub release databaseId.');
assert.match(macReleaseWorkflow, /release_database_id.*=~ \^\[0-9\]\+\$/, 'macOS release publication must reject a missing or non-numeric release databaseId.');
assert.match(macReleaseWorkflow, /releases\/\$release_database_id\/assets/, 'macOS staging must use the numeric release databaseId for draft asset inventory.');
assert.match(macReleaseWorkflow, /releases\/\$release_database_id\/assets\?per_page=100/, 'macOS draft retries must list release assets through the numeric release REST endpoint.');
assert.match(macReleaseWorkflow, /release_asset_database_id.*=~ \^\[0-9\]\+\$/, 'macOS draft retries must reject a missing or non-numeric release asset database ID.');
assert.match(macReleaseWorkflow, /releases\/assets\/\$release_asset_database_id/, 'macOS draft retries must delete assets by numeric REST database ID.');
assert.match(macCandidateWorkflow, /source_tag:/, 'macOS candidate workflow must support building an existing immutable source tag.');
assert.match(macCandidateWorkflow, /git -C "\$GITHUB_WORKSPACE" checkout "\$SOURCE_TAG" -- desktop setup-my-claude\.sh setup-my-claude-linux\.sh setup-my-claude\.ps1/, 'macOS candidate workflow must copy runtime files from the requested source tag at repository root.');
assert.match(macCandidateWorkflow, /git -C "\$GITHUB_WORKSPACE" diff --quiet "\$SOURCE_TAG" -- desktop setup-my-claude\.sh setup-my-claude-linux\.sh setup-my-claude\.ps1/, 'macOS candidate workflow must verify runtime files exactly match the requested source tag at repository root.');
assert.match(weeklySecurityWorkflow, /cron:\s*'23 8 \* \* 1'/, 'Weekly dependency security scanning must run every Monday.');
assert.match(weeklySecurityWorkflow, /npm ci --ignore-scripts/, 'Weekly dependency security scanning must not execute lifecycle scripts.');
assert.match(weeklySecurityWorkflow, /sudo apt-get install --yes xvfb/, 'Weekly dependency security scanning must provide a virtual display for the Electron renderer integration test.');
assert.match(weeklySecurityWorkflow, /npm audit --audit-level=high/, 'Weekly dependency security scanning must fail on high or critical findings.');
assert.match(weeklySecurityWorkflow, /retention-days:\s*30/, 'Weekly vulnerability reports must have bounded retention.');
assert.match(weeklySecurityWorkflow, /contents: read/, 'Weekly security scanning must use a read-only token.');
assert.match(codeqlWorkflow, /pull_request:/, 'CodeQL must scan pull requests before merge.');
assert.match(codeqlWorkflow, /cron:\s*'41 8 \* \* 1'/, 'CodeQL must run on the established weekly schedule.');
assert.match(codeqlWorkflow, /github\/codeql-action\/init@b96794f015dfd88f77b49b1c93e0fa7110f94c63/, 'CodeQL initialization must use the pinned reviewed action revision.');
assert.match(codeqlWorkflow, /github\/codeql-action\/analyze@b96794f015dfd88f77b49b1c93e0fa7110f94c63/, 'CodeQL analysis must use the pinned reviewed action revision.');
assert.match(codeqlWorkflow, /security-events: write/, 'CodeQL must have only the security-events write permission required to upload findings.');
assert.match(codeqlWorkflow, /languages:\s*\$\{\{ matrix\.language \}\}/, 'CodeQL must analyze the configured JavaScript and TypeScript language matrix.');
assert.ok(!workflows.some((workflowPath) => /build-windows-signed-/i.test(path.basename(workflowPath))), 'Obsolete alternate Windows distribution workflows must not be present.');

console.log(`Dependency security contract passed: Electron ${lockfile.packages['node_modules/electron'].version}, no vulnerable extract-zip, ${desktopWorkflows.length} desktop CI workflows pinned to Node ${minimumNode}, Dependabot policy, pull-request dependency review, and CodeQL scanning.`);
