#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile() && /\.(?:js|cjs|mjs)$/.test(entry.name)) files.push(file);
  }
}
for (const directory of ['desktop/src', 'desktop/build', 'scripts']) walk(path.join(root, directory));
assert.ok(files.length > 50, 'The syntax gate must cover the source tree, not a small allowlist');
for (const file of files.sort()) cp.execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
for (const file of ['setup-my-claude.sh', 'setup-my-claude-linux.sh']) {
  cp.execFileSync('bash', ['-n', path.join(root, file)], { stdio: 'pipe' });
}
console.log(`PASS complete source syntax: ${files.length} JavaScript files and both POSIX adapters; no files executed.`);
