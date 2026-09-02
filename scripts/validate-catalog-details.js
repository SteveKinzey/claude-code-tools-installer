#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const desktop = path.join(root, 'desktop');
const tools = JSON.parse(fs.readFileSync(path.join(desktop, 'catalog.json'), 'utf8'));
const components = JSON.parse(fs.readFileSync(path.join(desktop, 'convex-components.json'), 'utf8'));
const details = JSON.parse(fs.readFileSync(path.join(desktop, 'catalog-details.json'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'), 'utf8'));
const expected = [...tools.map((item) => ({ id: item.id, name: item.name, scope: 'This computer' })), ...components.components.map((item) => ({ id: item.id, name: item.name, scope: 'This project' }))];
const byId = new Map(details.items.map((item) => [item.id, item]));

assert.equal(details.schemaVersion, 1);
assert.equal(details.catalogCounts.tools, 35);
assert.equal(details.catalogCounts.components, 145);
assert.equal(details.items.length, expected.length);
assert.equal(byId.size, expected.length, 'detail IDs must be unique');
assert.ok(packageJson.build.extraResources.some((resource) => resource.to === 'catalog-details.json'), 'the detail dataset must ship with packaged builds');

for (const item of expected) {
  const detail = byId.get(item.id);
  assert.ok(detail, `missing detail record for ${item.id}`);
  assert.equal(detail.scope, item.scope, `${item.id} has an incorrect scope`);
  assert.equal(String(detail.name).trim(), String(item.name).trim(), `${item.id} has an incorrect name`);
  for (const field of ['plainPurpose', 'chooseWhen', 'example', 'cctiAction', 'userAction']) {
    assert.ok(typeof detail[field] === 'string' && detail[field].trim().length >= 8, `${item.id} needs ${field}`);
  }
  assert.ok(detail.chooseWhen.startsWith('Choose this when'), `${item.id} needs plain decision guidance`);
  assert.ok(detail.example.startsWith('Example:'), `${item.id} needs a plain example`);
  assert.ok(detail.cctiAction.startsWith('After you approve, CCTI '), `${item.id} must clearly state CCTI’s reviewed action`);
  assert.ok(!/npm install|CCTI(?:'s|’) (?:environment|workspace|assistant|AI)|installs? .+ into CCTI/i.test([detail.plainPurpose, detail.chooseWhen, detail.example, detail.cctiAction].join(' ')), `${item.id} has technical or misleading catalog wording`);
  if (detail.scope === 'This project') assert.match(detail.cctiAction, /selected project|project folder/i, `${item.id} must state that it belongs in the chosen project`);
}

console.log(`Catalog details passed: ${details.items.length} plain-language records cover 35 computer tools and 145 project components.`);
