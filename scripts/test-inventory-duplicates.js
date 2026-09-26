#!/usr/bin/env node
const assert = require('node:assert/strict');
const { MCP_SCOPE_PRECEDENCE, mcpDuplicateGroups, pluginDuplicateGroups, compareSkillKeeper } = require('../desktop/src/inventory/duplicates');

assert.deepEqual(MCP_SCOPE_PRECEDENCE, ['local', 'project', 'user']);
const home = '/Users/me';
const defs = [
  { name: 'playwright', key: 'playwright', scope: 'user', projectPath: '', fingerprint: 'a' },
  { name: 'playwright', key: 'playwright', scope: 'local', projectPath: home, fingerprint: 'a' },
  { name: 'docs', key: 'docs', scope: 'user', projectPath: '', fingerprint: 'x' },
  { name: 'docs', key: 'docs', scope: 'project', projectPath: '/work/app', fingerprint: 'y' },
  { name: 'Docs', key: 'docs', scope: 'local', projectPath: '/work/app', fingerprint: 'z' },
  { name: 'solo', key: 'solo', scope: 'user', projectPath: '', fingerprint: 's' },
];
const groups = mcpDuplicateGroups(defs, { homePath: home });
assert.deepEqual(groups.map((g) => g.key).sort(), ['docs', 'playwright'], 'single definitions are not duplicates');
const pw = groups.find((g) => g.key === 'playwright');
assert.deepEqual(pw.copies.map((c) => c.scope), ['local', 'user'], 'copies are ordered by documented precedence');
assert.equal(pw.keeper, 0);
assert.equal(pw.needsChoice, false);
assert.equal(pw.identical, true);
assert.equal(pw.copies[0].label, 'Only you, in this folder');
assert.equal(pw.copies[1].label, 'Just you, everywhere');
const docs = groups.find((g) => g.key === 'docs');
assert.deepEqual(docs.copies.map((c) => c.scope), ['local', 'project', 'user']);
assert.equal(docs.copies[0].label, 'Only you, in this project');
assert.equal(docs.copies[1].label, 'Everyone on this project');
assert.equal(docs.identical, false);

const installs = [
  { id: 'foo@market-a', name: 'foo', marketplace: 'market-a', scope: 'user', enabled: true, projectPath: '' },
  { id: 'foo@market-b', name: 'foo', marketplace: 'market-b', scope: 'project', enabled: true, projectPath: '/work/app' },
  { id: 'bar@one', name: 'bar', marketplace: 'one', scope: 'user', enabled: true, projectPath: '' },
  { id: 'bar@two', name: 'bar', marketplace: 'two', scope: 'user', enabled: false, projectPath: '' },
  { id: 'baz@m', name: 'baz', marketplace: 'm', scope: 'user', enabled: true, projectPath: '' },
  { id: 'baz@m', name: 'baz', marketplace: 'm', scope: 'project', enabled: true, projectPath: '/work/app' },
];
const pgroups = pluginDuplicateGroups(installs);
assert.deepEqual(pgroups.map((g) => g.key), ['foo'], 'only enabled installs from two marketplaces are duplicates; one id at two scopes is not');
assert.equal(pgroups[0].needsChoice, true, 'there is no documented rule, so the user chooses');
assert.equal(pgroups[0].keeper, null);
assert.deepEqual(pgroups[0].copies.map((c) => c.label), ['market-a (Just you)', 'market-b (This project)']);

const personal = { scope: 'Just you', updatedAt: '2026-01-01T00:00:00Z', path: '/h/s' };
const projectNewer = { scope: 'This project', updatedAt: '2026-09-01T00:00:00Z', path: '/p/s' };
assert.ok(compareSkillKeeper(personal, projectNewer) < 0, 'personal beats project even when the project copy is newer');
const older = { scope: 'Just you', updatedAt: '2026-01-01T00:00:00Z', path: '/h/b' };
const newer = { scope: 'Just you', updatedAt: '2026-05-01T00:00:00Z', path: '/h/a' };
assert.ok(compareSkillKeeper(newer, older) < 0, 'within one scope the newer copy comes first');

assert.deepEqual(mcpDuplicateGroups([]), []);
assert.deepEqual(pluginDuplicateGroups(undefined), []);
console.log('Inventory duplicates passed: documented MCP precedence, add-on choice, and the personal-first skill keeper.');
