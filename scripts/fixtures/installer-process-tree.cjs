'use strict';
// Disposable test processes only. The caller sets a private temporary cwd; no
// source text or paths are interpolated into executable code.
const { spawn } = require('node:child_process');
const fs = require('node:fs');

process.on('SIGTERM', () => {});
if (process.argv[2] === 'writer') {
  setInterval(() => fs.appendFileSync('writer', '.'), 10);
} else if (process.argv[2] === 'parent') {
  const child = spawn(process.execPath, [__filename, 'writer'], { stdio: 'inherit' });
  child.once('spawn', () => console.log('ready'));
  child.once('error', () => process.exit(1));
  setInterval(() => {}, 1000);
} else {
  throw new Error('Use this fixture only with parent or writer mode in a private temporary folder.');
}
