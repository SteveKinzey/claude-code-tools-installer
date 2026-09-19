#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const macWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release-macos-signed-notarized.yml'), 'utf8');
const windowsWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release-windows-portable-zip.yml'), 'utf8');
const sourceBuilder = fs.readFileSync(path.join(root, 'scripts', 'build-source-releases.sh'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

assert.match(macWorkflow, /gh release create .*--draft/, 'macOS publishing must begin with a draft release');
assert.match(macWorkflow, /Verify draft release inventory before publication/, 'macOS publishing must verify the draft inventory');
assert.match(macWorkflow, /Release must remain a draft until final inventory verification succeeds/, 'macOS inventory verification must fail closed');
assert.match(macWorkflow, /Publish the verified draft release/, 'macOS publishing must occur only after verification');
assert.match(macWorkflow, /Refusing to modify an already-public release/, 'macOS automation must not replace assets on an existing public release');
assert.match(macWorkflow, /checkout "\$TAG" -- desktop setup-my-claude\.sh setup-my-claude-linux\.sh setup-my-claude\.ps1/, 'macOS releases must package the desktop runtime from the immutable tag.');
assert.doesNotMatch(macWorkflow, /checkout "\$TAG" -- desktop scripts/, 'macOS releases must retain current release-policy validators rather than restoring stale tag scripts.');
assert.match(macWorkflow, /--json databaseId --jq '\.databaseId'/, 'macOS publication must request GitHub\'s numeric release databaseId for the REST PATCH endpoint');
assert.match(macWorkflow, /release_database_id.*=~ \^\[0-9\]\+\$/, 'macOS publication must reject a missing or non-numeric release databaseId');
assert.match(macWorkflow, /releases\/\$\{release_database_id\}/, 'macOS publication must PATCH the numeric release databaseId rather than the GraphQL node ID');
assert.match(macWorkflow, /releases\/\$release_database_id\/assets\?per_page=100/, 'macOS draft retries must list assets through the release-assets REST endpoint.');
assert.match(macWorkflow, /release_asset_database_id.*=~ \^\[0-9\]\+\$/, 'macOS draft retries must reject a missing or non-numeric release asset database ID.');
assert.match(macWorkflow, /releases\/assets\/\$release_asset_database_id/, 'macOS draft retries must delete assets by numeric REST database ID rather than GraphQL node ID.');
assert.doesNotMatch(windowsWorkflow, /gh release upload/i, 'the unsigned Windows workflow must not upload public artifacts');
assert.doesNotMatch(windowsWorkflow, /dist:win:zip/i, 'the unsigned Windows workflow must not build a publishable portable ZIP');
assert.match(windowsWorkflow, /contents: read/, 'the blocked Windows workflow must not retain release write permission');
assert.match(windowsWorkflow, /Windows portable ZIP release blocked/, 'the Windows workflow must state the fail-closed boundary');
assert.match(sourceBuilder, /git archive --format=zip/, 'source bundles must derive from the complete committed tree');
assert.match(sourceBuilder, /git diff --quiet && git diff --cached --quiet/, 'source bundles must reject an uncommitted worktree');
assert.match(sourceBuilder, /source-only archives/, 'source bundles must not be described as platform artifacts');
assert.doesNotMatch(readme, /current public release is \[v2026\.08\.12\]/i, 'README must not hard-code a stale current release');
assert.match(readme, /derived from the \[GitHub Releases record\]/, 'README must describe API-driven release truth');

console.log('Release workflow safety tests passed.');
