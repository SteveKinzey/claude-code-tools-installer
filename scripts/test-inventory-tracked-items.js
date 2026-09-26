#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { TRACKED_ITEMS, trackedItem } = require('../desktop/src/inventory/tracked-items');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const catalogIds = new Set(require(path.join(root, 'desktop', 'catalog.json')).map((item) => item.id));
const shellAdapters = ['setup-my-claude.sh', 'setup-my-claude-linux.sh'].map((file) => [file, read(file)]);
const powershell = read('setup-my-claude.ps1');
const mainSource = read('desktop/src/main.js');

// CRLF-safe: Windows CI checks these files out with \r\n.
function shellBranch(source, id) {
  return source.match(new RegExp(`\\r?\\n\\s*${escape(id)}\\)[\\s\\S]*?\\r?\\n\\s*;;`))?.[0] || '';
}
function powershellBranch(source, id) {
  return source.match(new RegExp(`\\r?\\n\\s*"${escape(id)}"\\s*\\{[\\s\\S]*?\\r?\\n {4}\\}`))?.[0] || '';
}
function reviewedPluginInstall(id) {
  return mainSource.match(new RegExp(`\\n\\s*'?${escape(id)}'?: \\[.*'plugin', 'install', '([^']+)'`))?.[1] || '';
}

assert.ok(Object.isFrozen(TRACKED_ITEMS), 'the tracked map must not be mutable at runtime');
assert.equal(trackedItem('constructor'), null, 'prototype names must not look tracked');
assert.equal(trackedItem('learn-claude-code'), null, 'reference clones are not tracked');

for (const [id, item] of Object.entries(TRACKED_ITEMS)) {
  assert.ok(catalogIds.has(id), `${id} must be a catalog.json id`);
  assert.ok(['skill', 'plugin', 'mcp'].includes(item.kind), `${id} must have a known kind`);
  assert.equal(trackedItem(id), item);

  if (item.kind === 'skill') {
    for (const [file, source] of shellAdapters) {
      const branch = shellBranch(source, id);
      assert.ok(branch, `${file} must have an install branch for ${id}`);
      const installs = id === 'gstack'
        ? /\.claude\/skills\/gstack"/.test(branch)
        : new RegExp(`install_skill \\S+ ${escape(item.key)} "\\$id"`).test(branch);
      assert.ok(installs, `${file} must install ${id} as the skill folder "${item.key}"`);
    }
    const branch = powershellBranch(powershell, id);
    const installs = id === 'gstack'
      ? /\.claude\\skills\\gstack"/.test(branch)
      : new RegExp(`Install-Skill "[^"]+" "${escape(item.key)}" \\$Id`).test(branch);
    assert.ok(installs, `setup-my-claude.ps1 must install ${id} as the skill folder "${item.key}"`);
  }

  if (item.kind === 'mcp') {
    for (const [file, source] of shellAdapters) {
      assert.match(shellBranch(source, id), new RegExp(`install_mcp(?:_after_dashdash)? ${escape(item.key)} "\\$id"`), `${file} must register ${id} as "${item.key}"`);
    }
    assert.match(powershellBranch(powershell, id), new RegExp(`Install-Mcp(?:AfterDashDash)? "${escape(item.key)}" \\$Id`), `setup-my-claude.ps1 must register ${id} as "${item.key}"`);
  }

  if (item.kind === 'plugin') {
    assert.equal(reviewedPluginInstall(id), item.key, `reviewedPluginPlans.${id} must install "${item.key}"`);
  }
}

// No silent gaps: every plugin CCTI installs itself is tracked.
const reviewedIds = [...mainSource.matchAll(/\n\s*'?([a-z0-9-]+)'?: \[.*'plugin', 'install', '[^']+'/g)].map((match) => match[1]);
assert.ok(reviewedIds.length >= 9, 'the reviewedPluginPlans scan must find the plugin installs');
for (const id of reviewedIds) assert.equal(trackedItem(id)?.kind, 'plugin', `${id} installs a plugin inside CCTI and must be tracked`);

console.log(`Inventory tracked items passed: ${Object.keys(TRACKED_ITEMS).length} catalog items match all three adapters and the in-app plugin plans.`);
