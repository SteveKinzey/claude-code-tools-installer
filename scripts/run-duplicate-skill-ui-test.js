#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const desktop = path.join(root, 'desktop');
const testPath = path.join(root, 'scripts', 'test-duplicate-skill-ui.js');
const electron = require(require.resolve('electron', { paths: [desktop] }));
const electronArgs = process.platform === 'linux'
  ? ['--no-sandbox', testPath]
  : [testPath];
const command = process.platform === 'linux' ? 'xvfb-run' : electron;
const args = process.platform === 'linux'
  ? ['--auto-servernum', '--server-args=-screen 0 1280x1024x24', electron, ...electronArgs]
  : electronArgs;
const resultPath = path.join(os.tmpdir(), `ccti-duplicate-skill-ui-result-${process.pid}.json`);

fs.rmSync(resultPath, { force: true });
const result = spawnSync(command, args, { cwd: desktop, stdio: 'inherit', env: { ...process.env, CCTI_DUPLICATE_UI_REPORT_PATH: resultPath } });
if (result.error) {
  console.error(`Could not start the duplicate-skill UI test: ${result.error.message}`);
  process.exit(1);
}
let fixtureResult = null;
try {
  fixtureResult = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
} catch {
  console.error('The duplicate-skill UI fixture did not emit a completion result.');
}
fs.rmSync(resultPath, { force: true });
if (result.status !== 0 || !fixtureResult?.ok) {
  if (fixtureResult?.error) console.error(`Duplicate-skill UI fixture failed: ${fixtureResult.error}`);
  process.exit(1);
}
