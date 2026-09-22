#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const desktop = path.join(root, 'desktop');
const testPath = path.join(root, 'scripts', 'test-setup-verification-controls.js');
const electron = require(require.resolve('electron', { paths: [desktop] }));
const electronArgs = process.platform === 'linux'
  ? ['--no-sandbox', testPath]
  : [testPath];
const command = process.platform === 'linux' ? 'xvfb-run' : electron;
const args = process.platform === 'linux'
  ? ['--auto-servernum', '--server-args=-screen 0 1280x1024x24', electron, ...electronArgs]
  : electronArgs;
const result = spawnSync(command, args, { cwd: desktop, stdio: 'inherit' });

if (result.error) {
  console.error(`Could not start the setup verification controls test: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
