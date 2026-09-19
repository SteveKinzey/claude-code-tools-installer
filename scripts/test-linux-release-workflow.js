#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const linuxWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release-linux-signed.yml'), 'utf8');
const publishWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'publish-verified-release.yml'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'desktop', 'package.json'), 'utf8'));

assert.match(linuxWorkflow, /workflow_dispatch:/, 'Linux signing must require an explicit workflow dispatch.');
assert.match(linuxWorkflow, /contents:\s*write/, 'Linux signing needs contents: write only to stage draft release assets.');
assert.match(linuxWorkflow, /id-token:\s*write/, 'Linux signing requires GitHub OIDC for keyless signing.');
assert.match(linuxWorkflow, /github\.ref_type == 'tag' && github\.ref_name == inputs\.tag/, 'Linux signing must run from the selected immutable tag.');
assert.match(linuxWorkflow, /actions\/checkout@[a-f0-9]{40}/, 'Linux signing must pin checkout to a full commit SHA.');
assert.match(linuxWorkflow, /actions\/setup-node@[a-f0-9]{40}/, 'Linux signing must pin setup-node to a full commit SHA.');
assert.match(linuxWorkflow, /sigstore\/cosign-installer@[a-f0-9]{40}/, 'Linux signing must pin Cosign installer to a full commit SHA.');
assert.match(linuxWorkflow, /actions\/upload-artifact@[a-f0-9]{40}/, 'Linux signing must pin artifact upload to a full commit SHA.');
assert.match(linuxWorkflow, /npm ci/, 'Linux signing must use the lockfile.');
assert.match(linuxWorkflow, /bash \.\.\/scripts\/run-release-desktop-check\.sh/, 'Linux signing must run the release desktop gate.');
assert.match(linuxWorkflow, /npm run dist:linux/, 'Linux signing must produce the Linux archive.');
assert.match(linuxWorkflow, /resources\/app\.asar/, 'Linux signing must inspect the packaged app payload.');
assert.match(linuxWorkflow, /xvfb-run -a dbus-run-session -- node \.\.\/scripts\/test-packaged-linux-terminal-adapter\.js/, 'Linux signing must execute the packaged adapter smoke test.');
assert.match(linuxWorkflow, /printf '%s  %s\\n'/, 'Linux signing must write a portable checksum sidecar with the archive basename.');
assert.match(linuxWorkflow, /verify-linux-release-archive\.js/, 'Linux signing must validate its archive checksum sidecar.');
assert.match(linuxWorkflow, /cosign sign-blob/, 'Linux signing must create a keyless signature.');
assert.match(linuxWorkflow, /cosign verify-blob/, 'Linux signing must verify its keyless signature before upload.');
assert.match(linuxWorkflow, /certificate-identity.*release-linux-signed\.yml@refs\/tags/, 'Linux signing must bind bundle verification to the exact workflow and tag.');
assert.match(linuxWorkflow, /gh release create .*--draft/, 'Linux signing must stage to a draft release.');
assert.match(linuxWorkflow, /Refusing to modify an already-public release/, 'Linux signing must fail closed for public releases.');
assert.match(linuxWorkflow, /Verify draft Linux asset inventory/, 'Linux signing must check GitHub upload inventory before handoff.');
assert.doesNotMatch(linuxWorkflow, /draft=false|--draft=false|gh release edit .*--draft=false/, 'Linux signing must not publish a release itself.');
assert.match(publishWorkflow, /workflow_dispatch:/, 'Release publication must be explicitly dispatched.');
assert.match(publishWorkflow, /contents:\s*write/, 'Release publication requires contents: write.');
assert.match(publishWorkflow, /github\.ref_type == 'tag' && github\.ref_name == inputs\.tag/, 'Publication must run from the selected immutable tag.');
assert.match(publishWorkflow, /Verify Linux assets staged on draft release/, 'Publication must independently verify staged Linux assets.');
assert.match(publishWorkflow, /verify-linux-release-archive\.js/, 'Publication must check the uploaded Linux checksum sidecar.');
assert.match(publishWorkflow, /cosign verify-blob/, 'Publication must re-verify the uploaded Linux Sigstore bundle.');
assert.match(publishWorkflow, /Publish verified draft release/, 'Publication must have a final explicit publishing gate.');
assert.match(publishWorkflow, /releases\/\$release_database_id/, 'Publication must PATCH GitHub’s numeric release database ID.');
assert.ok(packageJson.scripts['linux-release:verify'], 'Desktop package scripts must expose Linux archive verification.');

console.log('Linux release workflow contract tests passed.');
