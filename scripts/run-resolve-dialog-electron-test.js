#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const desktop = path.join(root, 'desktop');
const testPath = path.join(root, 'scripts', 'test-resolve-dialog-electron.js');
const electron = require(require.resolve('electron', { paths: [desktop] }));
const electronArgs = process.platform === 'linux'
  ? ['--no-sandbox', testPath]
  : [testPath];
const command = process.platform === 'linux' ? 'xvfb-run' : electron;
const args = process.platform === 'linux'
  ? ['--auto-servernum', '--server-args=-screen 0 1280x1024x24', electron, ...electronArgs]
  : electronArgs;
const callerReportPath = process.env.CCTI_RESOLVE_DIALOG_REPORT_PATH ? path.resolve(process.env.CCTI_RESOLVE_DIALOG_REPORT_PATH) : '';
const reportPath = callerReportPath || path.join(os.tmpdir(), `ccti-resolve-dialog-result-${process.pid}.json`);

if (!callerReportPath) fs.rmSync(reportPath, { force: true });
const result = spawnSync(command, args, { cwd: desktop, stdio: 'inherit', env: { ...process.env, CCTI_RESOLVE_DIALOG_REPORT_PATH: reportPath } });
if (result.error) {
  console.error(`Could not start the Resolve dialog Electron test: ${result.error.message}`);
  process.exit(1);
}
let testResult = null;
try {
  testResult = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
} catch {
  console.error('The Resolve dialog Electron test did not emit a completion result.');
}
if (!callerReportPath) fs.rmSync(reportPath, { force: true });
if (result.status !== 0 || !testResult?.ok) {
  if (testResult?.error) console.error(`Resolve dialog Electron test failed: ${testResult.error}`);
  process.exit(1);
}
