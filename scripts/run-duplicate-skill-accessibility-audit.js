#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const desktop = path.join(root, 'desktop');
const auditPath = path.join(root, 'scripts', 'audit-duplicate-skill-accessibility.js');
const electron = require(require.resolve('electron', { paths: [desktop] }));
const electronArgs = process.platform === 'linux'
  ? ['--no-sandbox', auditPath]
  : [auditPath];
const command = process.platform === 'linux' ? 'xvfb-run' : electron;
const args = process.platform === 'linux'
  ? ['--auto-servernum', '--server-args=-screen 0 1280x1024x24', electron, ...electronArgs]
  : electronArgs;
const reportPath = path.join(os.tmpdir(), `ccti-duplicate-a11y-result-${process.pid}.json`);

fs.rmSync(reportPath, { force: true });
const result = spawnSync(command, args, { cwd: desktop, stdio: 'inherit', env: { ...process.env, CCTI_A11Y_REPORT_PATH: reportPath } });
if (result.error) {
  console.error(`Could not start the duplicate-skill accessibility audit: ${result.error.message}`);
  process.exit(1);
}
let auditResult = null;
try {
  auditResult = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
} catch {
  console.error('The duplicate-skill accessibility audit did not emit a completion result.');
}
fs.rmSync(reportPath, { force: true });
if (result.status !== 0 || !auditResult?.ok) {
  if (auditResult?.error) console.error(`Duplicate-skill accessibility audit failed: ${auditResult.error}`);
  process.exit(1);
}
