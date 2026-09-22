#!/usr/bin/env node
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const macWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release-macos-signed-notarized.yml'), 'utf8');
const windowsWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release-windows-portable-zip.yml'), 'utf8');
const signedWindowsWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release-windows-signed.yml'), 'utf8');
const publisherWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'publish-verified-release.yml'), 'utf8');
const linuxWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release-linux-signed.yml'), 'utf8');
const sourceBuilder = fs.readFileSync(path.join(root, 'scripts', 'build-source-releases.sh'), 'utf8');
const releaseDesktopCheck = fs.readFileSync(path.join(root, 'scripts', 'run-release-desktop-check.sh'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

assert.match(macWorkflow, /gh release create .*--draft/, 'macOS publishing must begin with a draft release');
assert.match(macWorkflow, /Verify draft macOS asset inventory before cross-platform handoff/, 'macOS staging must verify the draft asset inventory');
assert.match(macWorkflow, /Release must remain a draft until final inventory verification succeeds/, 'macOS inventory verification must fail closed');
assert.match(macWorkflow, /Leave verified macOS assets on the draft release/, 'macOS assets must remain staged for cross-platform verification');
assert.match(macWorkflow, /Release must remain a draft until Linux assets and cross-platform verification succeed/, 'macOS automation must fail closed until the shared publisher verifies Linux assets');
assert.doesNotMatch(macWorkflow, /-f draft=false/, 'macOS asset staging must not publish the shared release');
assert.match(macWorkflow, /Refusing to modify an already-public release/, 'macOS automation must not replace assets on an existing public release');
assert.match(macWorkflow, /checkout "\$TAG" -- desktop setup-my-claude\.sh setup-my-claude-linux\.sh setup-my-claude\.ps1/, 'macOS releases must package the desktop runtime from the immutable tag.');
assert.doesNotMatch(macWorkflow, /checkout "\$TAG" -- desktop scripts/, 'macOS releases must retain current release-policy validators rather than restoring stale tag scripts.');
assert.match(macWorkflow, /bash \.\.\/scripts\/run-release-desktop-check\.sh/, 'macOS releases must use the resilient release-specific audit gate.');
for (const [name, workflow] of [['macOS', macWorkflow], ['Linux', linuxWorkflow], ['Windows', signedWindowsWorkflow], ['publisher', publisherWorkflow]]) {
  assert.match(workflow, /release-identity\.js/, `${name} releases must centralize public tag to package version validation.`);
  assert.match(workflow, /--require-daily-revision/, `${name} releases must require a daily revision identity.`);
}
assert.match(macWorkflow, /--json databaseId --jq '\.databaseId'/, 'macOS publication must request GitHub\'s numeric release databaseId for the REST PATCH endpoint');
assert.match(macWorkflow, /release_database_id.*=~ \^\[0-9\]\+\$/, 'macOS publication must reject a missing or non-numeric release databaseId');
assert.match(macWorkflow, /releases\/\$release_database_id\/assets/, 'macOS staging must use the numeric GitHub release databaseId for asset inventory.');
assert.match(macWorkflow, /releases\/\$release_database_id\/assets\?per_page=100/, 'macOS draft retries must list assets through the release-assets REST endpoint.');
assert.match(macWorkflow, /release_asset_database_id.*=~ \^\[0-9\]\+\$/, 'macOS draft retries must reject a missing or non-numeric release asset database ID.');
assert.match(macWorkflow, /releases\/assets\/\$release_asset_database_id/, 'macOS draft retries must delete assets by numeric REST database ID rather than GraphQL node ID.');
assert.doesNotMatch(windowsWorkflow, /gh release upload/i, 'the unsigned Windows workflow must not upload public artifacts');
assert.doesNotMatch(windowsWorkflow, /dist:win:zip/i, 'the unsigned Windows workflow must not build a publishable portable ZIP');
assert.match(windowsWorkflow, /contents: read/, 'the blocked Windows workflow must not retain release write permission');
assert.match(windowsWorkflow, /Windows portable ZIP release blocked/, 'the Windows workflow must state the fail-closed boundary');
assert.match(signedWindowsWorkflow, /environment: windows-release/, 'signed Windows release staging must require the protected Windows environment');
assert.match(signedWindowsWorkflow, /id-token: write/, 'signed Windows staging must use short-lived GitHub OIDC credentials');
assert.match(signedWindowsWorkflow, /azure\/login@/, 'signed Windows staging must authenticate through Azure OIDC');
assert.match(signedWindowsWorkflow, /dist:win:signed:x64/, 'signed Windows staging must build only the dedicated x64 NSIS target');
assert.match(signedWindowsWorkflow, /Get-AuthenticodeSignature/, 'signed Windows staging must verify Authenticode before upload');
assert.match(signedWindowsWorkflow, /TimeStamperCertificate/, 'signed Windows staging must require an RFC3161 timestamp');
assert.match(signedWindowsWorkflow, /latest\.yml/, 'signed Windows staging must retain native updater metadata');
assert.match(signedWindowsWorkflow, /Windows signing only stages assets on a draft release/, 'signed Windows staging must not publish the shared release');
assert.match(publisherWorkflow, /signed Windows x64 installer/, 'the shared publisher must verify a signed Windows installer before publication');
assert.match(publisherWorkflow, /Windows checksum sidecar does not match the staged signed installer/, 'the shared publisher must validate the Windows checksum sidecar');
assert.match(publisherWorkflow, /Windows latest\.yml does not reference the signed installer/, 'the shared publisher must validate the Windows updater feed');
assert.match(publisherWorkflow, /-f draft=false -f make_latest=true/, 'the shared publisher must advance GitHub\'s latest-release pointer when publishing a verified release.');
assert.match(publisherWorkflow, /X-GitHub-Api-Version: 2026-03-10/, 'the shared publisher must use the documented GitHub API version when assigning the latest release pointer.');
assert.match(publisherWorkflow, /releases\/latest" --jq '\.tag_name'/, 'the shared publisher must verify that GitHub\'s latest-release pointer resolves to the published tag.');
execFileSync('bash', [path.join(root, 'scripts', 'test-publish-latest-pointer-workflow.sh'), root], { stdio: 'inherit' });
assert.match(sourceBuilder, /git archive --format=zip/, 'source bundles must derive from the complete committed tree');
assert.match(sourceBuilder, /git diff --quiet && git diff --cached --quiet/, 'source bundles must reject an uncommitted worktree');
assert.match(sourceBuilder, /source-only archives/, 'source bundles must not be described as platform artifacts');
assert.match(releaseDesktopCheck, /check_without_network_audit/, 'release audit gate must run the package-defined quality suite without only its network audit clause.');
assert.match(releaseDesktopCheck, /validate-security-remediation\.js/, 'release audit gate must retain the security policy contract.');
assert.match(releaseDesktopCheck, /npm@11\.6\.2/, 'release audit gate must use the pinned npm bulk-advisory client.');
assert.match(releaseDesktopCheck, /503 Service Unavailable\|429 Too Many Requests\|performing maintenance/, 'release audit gate must retry only transient registry conditions.');
assert.match(releaseDesktopCheck, /Dependency audit failed; refusing to continue the release/, 'release audit gate must fail closed for vulnerabilities or unexpected audit errors.');
assert.doesNotMatch(readme, /current public release is \[v2026\.08\.12\]/i, 'README must not hard-code a stale current release');
assert.match(readme, /derived from the \[GitHub Releases record\]/, 'README must describe API-driven release truth');

console.log('Release workflow safety tests passed.');
