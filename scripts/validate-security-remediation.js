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
const macCandidateWorkflowPath = path.join(root, '.github', 'workflows', 'build-macos-signed-notarized-test.yml');
const macCandidateWorkflow = readWorkflowText(macCandidateWorkflowPath);
const historicalSourceInstallFallback = /if \[\[ -f package-lock\.json \]\]; then\n\s+npm ci\n\s+else\n\s+echo "No package-lock\.json exists in the requested historical source; resolving dependencies for this test-only build\."\n\s+npm install --no-audit --no-fund --package-lock=false\n\s+fi/;
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
assert.match(packageJson.devDependencies?.electron || '', /^44\.\d+\.\d+$/, 'Desktop dependency must be exactly pinned on the supported Electron 44 release line.');
for (const section of ['dependencies', 'devDependencies']) {
  for (const [name, version] of Object.entries(packageJson[section] || {})) {
    assert.match(version, /^\d+\.\d+\.\d+$/, `${name} must use an exact reviewed version, not a floating range.`);
    assert.equal(lockfile.packages?.['']?.[section]?.[name], version, `${name} lockfile declaration must match the manifest.`);
    assert.equal(lockfile.packages?.[`node_modules/${name}`]?.version, version, `${name} locked version must match the exact declaration.`);
  }
}
assert.equal(packageJson.overrides?.['@electron/get']?.['global-agent'], '4.1.3', 'Downloader override must stay scoped and pinned to the validated proxy parent.');
for (const name of Object.keys(lockfile.packages || {})) {
  assert.doesNotMatch(name, /(?:^|\/)node_modules\/(?:sprintf-js|roarr)$/, 'The vulnerable proxy logging chain must not be reintroduced.');
}
assert.ok(isAtLeast(lockfile.packages?.['node_modules/electron']?.version, '44.9.3'), 'Lockfile must resolve Electron 44.9.3 or later.');
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
    if (reference.trim() === 'uses: ./.github/workflows/macos-isolated-sign.yml') {
      assert.ok(fs.existsSync(path.join(root, '.github/workflows/macos-isolated-sign.yml')), 'Local reusable workflow is resolved from this exact controller commit.');
    } else {
      assert.match(reference, /@[0-9a-f]{40}\b/, `${filename} must pin every external GitHub Action to a full commit SHA.`);
    }
  }
  const checkoutReferences = contents.match(/actions\/checkout@[0-9a-f]{40}\b/g) || [];
  const disabledCredentialPersistence = contents.match(/persist-credentials:\s*false/g) || [];
  assert.equal(disabledCredentialPersistence.length, checkoutReferences.length, `${filename} must disable persisted credentials for every checkout action.`);
}

for (const workflowPath of desktopWorkflows) {
  const contents = readWorkflowText(workflowPath);
  const filename = path.basename(workflowPath);
  let checkedContents = contents;
  if (workflowPath === macCandidateWorkflowPath) {
    checkedContents = contents.replace(historicalSourceInstallFallback, '');
    assert.notEqual(checkedContents, contents, `${filename} must limit npm install to the lockfile-free historical-source fallback.`);
  }
  assert.match(contents, /node-version:\s*['"]?22\.12\.0['"]?/, `${filename} must pin Node ${minimumNode}.`);
  assert.doesNotMatch(checkedContents, /npm install/, `${filename} must use lockfile-deterministic npm ci except for the guarded historical-source fallback.`);
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
// Native signing, notarization, final metadata and source evidence now live in a
// separate fixed controller. The mandatory behavioral suite covers both auth modes,
// final-byte metadata, rejection paths, and credential cleanup without real secrets.
assert.match(macReleaseWorkflow, /uses: \.\/\.github\/workflows\/macos-isolated-sign\.yml/, 'macOS release must use the isolated signing workflow.');
const guardianRelease = require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, 'test-guardian-release-boundaries.js')], { stdio: 'inherit' });
assert.equal(guardianRelease.status, 0, 'Credential isolation, source binding and shared release lock contracts must pass.');
assert.match(macCandidateWorkflow, /source_ref:/, 'macOS candidate workflow must support an optional trusted full commit SHA.');
assert.match(macCandidateWorkflow, /rev-parse --verify --quiet --end-of-options "\$\{SOURCE_REF\}\^\{commit\}"/, 'macOS candidate workflow must resolve the requested SHA without option injection.');
assert.match(macCandidateWorkflow, /test "\$GITHUB_REF" = refs\/heads\/main/, 'macOS signing controller must run from protected main.');
assert.match(macCandidateWorkflow, /merge-base --is-ancestor "\$source_commit" refs\/remotes\/origin\/main/, 'macOS signing source must be reachable from fetched protected main.');
assert.doesNotMatch(macCandidateWorkflow, /if: inputs\.source_ref != ''/, 'Default signing source must pass the same trust gate.');
assert.match(macCandidateWorkflow, /checkout --detach --force "\$source_commit"/, 'macOS candidate workflow must check out the resolved source commit without retargeting the workflow.');
assert.match(macCandidateWorkflow, /diff --quiet "\$source_commit"/, 'macOS candidate workflow must verify the workspace matches the resolved source commit.');
assert.match(macCandidateWorkflow, /test -z "\$\(git -C "\$GITHUB_WORKSPACE" status --porcelain\)"/, 'macOS candidate workflow must reject a dirty resolved source workspace.');
assert.match(weeklySecurityWorkflow, /cron:\s*'23 8 \* \* 1'/, 'Weekly dependency security scanning must run every Monday.');
assert.match(weeklySecurityWorkflow, /npm ci --ignore-scripts/, 'Weekly dependency security scanning must not execute lifecycle scripts.');
assert.match(weeklySecurityWorkflow, /sudo apt-get install --yes xvfb/, 'Weekly dependency security scanning must provide a virtual display for the Electron renderer integration test.');
assert.match(weeklySecurityWorkflow, /npm audit --audit-level=high/, 'Weekly dependency security scanning must fail on high or critical findings.');
assert.match(weeklySecurityWorkflow, /name: Scan dependency vulnerabilities\n(?:[^\n]*\n)*?\s+if: \$\{\{ always\(\) && !cancelled\(\) \}\}/, 'Audit evidence must still be captured when complete validation fails.');
assert.doesNotMatch(weeklySecurityWorkflow, /npm audit --json[^\n]*\|\| true/, 'Audit execution errors must not be silently suppressed.');
assert.match(weeklySecurityWorkflow, /retention-days:\s*30/, 'Weekly vulnerability reports must have bounded retention.');
assert.match(weeklySecurityWorkflow, /contents: read/, 'Weekly security scanning must use a read-only token.');
assert.match(codeqlWorkflow, /pull_request:/, 'CodeQL must scan pull requests before merge.');
assert.match(codeqlWorkflow, /cron:\s*'41 8 \* \* 1'/, 'CodeQL must run on the established weekly schedule.');
// GuardRails mistakes these public action commit IDs for GitHub keys. Limit its
// line-specific exception to the two exact upstream references and comments;
// an extra value, changed revision or additional ignored line must fail this gate.
const approvedCodeqlReferences = ['init', 'analyze'].map((action) =>
  `        uses: github/codeql-action/${action}@24c54180a607b1449ed407dd24f251e4e9147c8d # v4.38.3; guardrails-disable-line: public upstream commit SHA, not a credential.`);
const codeqlReferences = codeqlWorkflow.split('\n').filter((line) => /github\/codeql-action\/(?:init|analyze)@|guardrails-disable-line/.test(line));
assert.ok(codeqlReferences.length === approvedCodeqlReferences.length
  && codeqlReferences.every((line, index) => line === approvedCodeqlReferences[index]),
'CodeQL initialization/analysis and false-positive exceptions must contain only the two exact reviewed public references.');
assert.match(codeqlWorkflow, /security-events: write/, 'CodeQL must have only the security-events write permission required to upload findings.');
assert.match(codeqlWorkflow, /languages:\s*\$\{\{ matrix\.language \}\}/, 'CodeQL must analyze the configured JavaScript and TypeScript language matrix.');
assert.ok(!workflows.some((workflowPath) => /build-windows-signed-/i.test(path.basename(workflowPath))), 'Obsolete alternate Windows distribution workflows must not be present.');

const reportFixtures = require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, 'test-weekly-security-report.js')], { stdio: 'inherit' });
assert.equal(reportFixtures.status, 0, 'Weekly audit report capture and failure semantics must pass.');

const sourceTrust = require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, 'test-macos-source-trust.js')], { stdio: 'inherit' });
assert.equal(sourceTrust.status, 0, 'macOS signing-source positive and negative regressions must pass.');
console.log(`Dependency security contract passed: Electron ${lockfile.packages['node_modules/electron'].version}, no vulnerable extract-zip, ${desktopWorkflows.length} desktop CI workflows pinned to Node ${minimumNode}, Dependabot policy, pull-request dependency review, and CodeQL scanning.`);
