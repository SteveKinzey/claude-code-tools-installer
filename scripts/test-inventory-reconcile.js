#!/usr/bin/env node
const assert = require('node:assert/strict');
const { reconcileInventory } = require('../desktop/src/inventory/reconcile');

const tracked = {
  'planning-with-files': { kind: 'skill', key: 'planning-with-files' },
  graphify: { kind: 'skill', key: 'graphify' },
  ponytail: { kind: 'skill', key: 'ponytail' },
  'claude-hud': { kind: 'plugin', key: 'claude-hud' },
  'playwright-mcp': { kind: 'mcp', key: 'playwright' },
  repomix: { kind: 'mcp', key: 'repomix' },
};
const catalog = [
  { id: 'planning-with-files', name: 'Planning with Files', action: 'Install with npx skills' },
  { id: 'graphify', name: 'Graphify', action: 'Install with npx skills' },
  { id: 'ponytail', name: 'Ponytail', action: 'Install with npx skills' },
  { id: 'claude-hud', name: 'Claude HUD', action: 'Install selected plugin in CCTI' },
  { id: 'playwright-mcp', name: 'Playwright MCP', action: 'Register MCP server' },
  { id: 'repomix', name: 'Repomix', action: 'Install CLI and register MCP server' },
];
const entry = (id, kind, key, extra = {}) => ({ id, kind, key, name: catalog.find((item) => item.id === id)?.name || id, scope: 'user', projectPath: '', installedAt: '2026-09-14T10:00:00.000Z', source: 'ccti-catalog', catalogAction: catalog.find((item) => item.id === id)?.action || 'Old action', ...extra });
const skill = (key, scope, contentHash = 'h1', path = `/${scope}/${key}`) => ({ kind: 'skill', key, name: key, scope, origin: 'local', path, contentHash });
const scan = (items, extra = {}) => ({ projectPath: '', observed: { skill: true, plugin: true, mcp: true }, unreadableSkillScopes: [], items, ...extra });
const rowFor = (result, key) => result.rows.find((row) => row.key === key);

const ledger = {
  schemaVersion: 1,
  entries: [
    entry('planning-with-files', 'skill', 'planning-with-files'),
    entry('claude-hud', 'plugin', 'claude-hud'),
    entry('playwright-mcp', 'mcp', 'playwright'),
    entry('repomix', 'mcp', 'repomix', { catalogAction: 'Install the old way' }),
    entry('retired-tool', 'skill', 'retired-tool'),
  ],
  resolutions: [],
};
const items = [
  skill('planning-with-files', 'Just you'),
  { kind: 'plugin', key: 'claude-hud@claude-hud', name: 'claude-hud@claude-hud', scope: 'Just you', origin: 'local', path: '', contentHash: '' },
  { kind: 'plugin', key: 'operations@synced', name: 'operations@synced', scope: 'Your Claude.ai account', origin: 'claude.ai', path: '', contentHash: '' },
  skill('graphify', 'Just you', 'same'),
  skill('graphify', 'This project', 'same'),
  skill('notes', 'Just you', 'a'),
  skill('notes', 'This project', 'b'),
];
const result = reconcileInventory({ scan: scan(items, { projectPath: '/work' }), ledger, ledgerStatus: 'ok', catalog, tracked });

assert.equal(result.historyStatus, 'ok');
assert.equal(rowFor(result, 'planning-with-files').state, 'installed');
assert.equal(rowFor(result, 'planning-with-files').installedAt, '2026-09-14T10:00:00.000Z');
assert.equal(rowFor(result, 'claude-hud@claude-hud').state, 'installed', 'a plugin installed by short name matches its listed marketplace id');
assert.equal(rowFor(result, 'claude-hud@claude-hud').name, 'Claude HUD', 'rows CCTI installed use the catalog name');
assert.equal(rowFor(result, 'operations@synced').state, 'external');
assert.equal(rowFor(result, 'operations@synced').origin, 'claude.ai');

const playwright = rowFor(result, 'playwright');
assert.equal(playwright.state, 'missing');
assert.deepEqual(playwright.reinstall, { id: 'playwright-mcp', available: true, changed: false, message: '' });
const repomix = rowFor(result, 'repomix');
assert.equal(repomix.state, 'missing');
assert.equal(repomix.reinstall.changed, true, 'a changed catalog entry is flagged before reinstalling');
assert.match(repomix.reinstall.message, /differently/);
const retired = rowFor(result, 'retired-tool');
assert.equal(retired.reinstall.available, false, 'an id no longer in the catalog cannot be reinstalled');
assert.equal(retired.reinstall.message, 'retired-tool is no longer offered by CCTI, so it can’t be reinstalled from here.');

const graphify = rowFor(result, 'graphify');
assert.equal(graphify.state, 'duplicate');
assert.equal(graphify.copies.length, 2);
assert.equal(graphify.resolvable, true, 'identical copies can be resolved');
assert.equal(rowFor(result, 'notes').resolvable, false, 'same name with different content is informational only');
assert.equal(reconcileInventory({ scan: scan([skill('x', 'Just you', ''), skill('x', 'This project', '')]), ledger: { entries: [], resolutions: [] }, catalog, tracked }).rows[0].resolvable, false, 'unverified content is never resolvable');

assert.deepEqual(result.rows.map((row) => row.kind), [...result.rows.map((row) => row.kind)].sort((a, b) => ['skill', 'plugin', 'mcp'].indexOf(a) - ['skill', 'plugin', 'mcp'].indexOf(b)), 'rows are grouped by kind');
assert.equal(result.rows.filter((row) => row.kind === 'skill')[0].state, 'missing', 'within a kind, missing rows come first');

// Review Focus 1: unobserved kinds are "unchecked", never "missing".
const blind = reconcileInventory({ scan: scan([], { observed: { skill: true, plugin: false, mcp: false } }), ledger, catalog, tracked });
for (const key of ['claude-hud', 'playwright', 'repomix']) {
  assert.equal(rowFor(blind, key).state, 'unchecked', `${key} must not be called missing when Claude Code could not be asked`);
  assert.equal(rowFor(blind, key).reinstall, null);
  assert.equal(rowFor(blind, key).uncheckedReason, 'claude-code');
}

// Project skills are only judged when that project was checked; unreadable folders are not judged.
const projectLedger = { entries: [entry('ponytail', 'skill', 'ponytail', { scope: 'project', projectPath: '/work' })], resolutions: [] };
assert.equal(rowFor(reconcileInventory({ scan: scan([]), ledger: projectLedger, catalog, tracked }), 'ponytail').uncheckedReason, 'project');
assert.equal(rowFor(reconcileInventory({ scan: scan([], { projectPath: '/other' }), ledger: projectLedger, catalog, tracked }), 'ponytail').state, 'unchecked');
const missingProjectSkill = rowFor(reconcileInventory({ scan: scan([], { projectPath: '/work' }), ledger: projectLedger, catalog, tracked }), 'ponytail');
assert.equal(missingProjectSkill.state, 'missing');
// Final review, finding 3: Reinstall installs skills for the user, so a project skill is not offered it.
assert.deepEqual(missingProjectSkill.reinstall, { id: 'ponytail', available: false, changed: false, message: 'Ponytail was installed into a project. Run Complete setup for that project to put it back.' });
assert.equal(rowFor(reconcileInventory({ scan: scan([skill('ponytail', 'This project')], { projectPath: '/work' }), ledger: projectLedger, catalog, tracked }), 'ponytail').state, 'installed');
const otherScope = reconcileInventory({ scan: scan([skill('ponytail', 'Just you')], { projectPath: '/work' }), ledger: projectLedger, catalog, tracked });
assert.deepEqual(otherScope.rows.map((row) => row.state).sort(), ['external', 'missing'], 'a same-named skill in another scope is not the one CCTI installed');
const unreadable = reconcileInventory({ scan: scan([], { projectPath: '/work', unreadableSkillScopes: ['This project'] }), ledger: projectLedger, catalog, tracked });
assert.equal(rowFor(unreadable, 'ponytail').uncheckedReason, 'folder');

// Review Focus 5: a skill the user backed up after CCTI installed it is expected absence.
const backedUp = { entries: [entry('graphify', 'skill', 'graphify')], resolutions: [{ kind: 'skill', key: 'graphify', scope: 'user', projectPath: '', resolvedAt: '2026-09-20T00:00:00.000Z', action: 'backup' }] };
assert.equal(rowFor(reconcileInventory({ scan: scan([]), ledger: backedUp, catalog, tracked }), 'graphify'), undefined, 'no Missing row after a backup');
assert.equal(rowFor(reconcileInventory({ scan: scan([skill('graphify', 'This project')], { projectPath: '/work' }), ledger: backedUp, catalog, tracked }), 'graphify').state, 'external', 'the surviving copy still shows');
const reinstalledAfter = { entries: [entry('graphify', 'skill', 'graphify', { installedAt: '2026-09-25T00:00:00.000Z' })], resolutions: backedUp.resolutions };
assert.equal(rowFor(reconcileInventory({ scan: scan([]), ledger: reinstalledAfter, catalog, tracked }), 'graphify').state, 'missing', 'a backup from before the latest install does not excuse a later loss');

// Final review, finding 2: removing CCTI's extras records a 'remove' resolution, so the
// deliberately removed connection does not come back as Missing.
const removedMcp = { entries: [entry('playwright-mcp', 'mcp', 'playwright')], resolutions: [{ kind: 'mcp', key: 'playwright', scope: 'user', projectPath: '', resolvedAt: '2026-09-20T00:00:00.000Z', action: 'remove' }] };
assert.equal(rowFor(reconcileInventory({ scan: scan([]), ledger: removedMcp, catalog, tracked }), 'playwright'), undefined, 'no Missing row after a deliberate removal');
const removedThenReinstalled = { entries: [entry('playwright-mcp', 'mcp', 'playwright', { installedAt: '2026-09-25T00:00:00.000Z' })], resolutions: removedMcp.resolutions };
assert.equal(rowFor(reconcileInventory({ scan: scan([]), ledger: removedThenReinstalled, catalog, tracked }), 'playwright').state, 'missing', 'a removal from before the latest install does not excuse a later loss');

// Review Focus 2: an unreadable record degrades to "found on this computer".
const corrupt = reconcileInventory({ scan: scan(items), ledger, ledgerStatus: 'corrupt', catalog, tracked });
assert.equal(corrupt.historyStatus, 'corrupt');
assert.ok(corrupt.rows.every((row) => ['external', 'duplicate'].includes(row.state) && !row.installedByCcti), 'nothing is claimed as CCTI-installed or missing');

assert.doesNotThrow(() => reconcileInventory());
assert.deepEqual(reconcileInventory().rows, []);

const unavailable = reconcileInventory({ scan: scan(items), ledger, ledgerStatus: 'unavailable', catalog, tracked });
assert.equal(unavailable.historyStatus, 'unavailable');
assert.ok(unavailable.rows.every((row) => !row.installedByCcti && row.state !== 'missing'), 'an unavailable record claims nothing and reports nothing missing');

// Plan 3, Task 5: add-on and connection duplicate groups become one resolvable row each.
const mcpGroup = {
  kind: 'mcp', key: 'playwright', name: 'playwright',
  copies: [
    { name: 'playwright', scope: 'local', projectPath: '/home/me', fingerprint: 'a', label: 'Only you, in this folder' },
    { name: 'playwright', scope: 'user', projectPath: '', fingerprint: 'a', label: 'Just you, everywhere' },
  ],
  keeper: 1, needsChoice: false, identical: true, informational: false, reason: '',
};
const pluginGroup = {
  kind: 'plugin', key: 'foo', name: 'foo',
  copies: [
    { id: 'foo@market-a', scope: 'user', projectPath: '', marketplace: 'market-a', label: 'market-a (Just you)' },
    { id: 'foo@market-b', scope: 'user', projectPath: '', marketplace: 'market-b', label: 'market-b (Just you)' },
  ],
  keeper: null, needsChoice: true, identical: false, informational: false, reason: '',
};
const pluginItem = (id) => ({ kind: 'plugin', key: id, name: id, scope: 'Just you', origin: 'local', addOn: '', path: '', contentHash: '' });
const mcpItem = (name, extra = {}) => ({ kind: 'mcp', key: name.toLowerCase(), name, scope: 'Claude Code', origin: 'local', addOn: '', path: '', contentHash: '', ...extra });
const withGroups = reconcileInventory({
  scan: scan([mcpItem('playwright'), mcpItem('repomix'), pluginItem('foo@market-a'), pluginItem('foo@market-b')], { duplicateGroups: [mcpGroup, pluginGroup] }),
  ledger: { entries: [entry('playwright-mcp', 'mcp', 'playwright')], resolutions: [] },
  catalog,
  tracked,
});
const mcpRow = withGroups.rows.find((row) => row.rowId === 'mcp:playwright');
assert.equal(mcpRow.state, 'duplicate');
assert.deepEqual(mcpRow.copies, [{ scope: 'Only you, in this folder', path: '' }, { scope: 'Just you, everywhere', path: '' }], 'copies are labelled from the group');
assert.deepEqual(mcpRow.resolution, { groupKey: 'mcp:playwright', needsChoice: false, keeper: 1, options: ['Only you, in this folder', 'Just you, everywhere'] });
assert.equal(mcpRow.informational, undefined);
assert.equal(mcpRow.resolvable, false, 'resolvable stays skill-only');
assert.equal(mcpRow.installedByCcti, true, 'the install record still matches the duplicate row');
assert.equal(mcpRow.name, 'Playwright MCP');
assert.equal(withGroups.rows.find((row) => row.rowId === 'mcp:repomix').resolution, undefined, 'rows outside a group get no resolution');
const pluginRow = withGroups.rows.find((row) => row.rowId === 'plugin:foo');
assert.equal(pluginRow.key, 'foo');
assert.equal(pluginRow.state, 'duplicate');
assert.deepEqual(pluginRow.resolution, { groupKey: 'plugin:foo', needsChoice: true, keeper: null, options: ['market-a (Just you)', 'market-b (Just you)'] });
assert.equal(withGroups.rows.filter((row) => row.kind === 'plugin').length, 1, 'both installs fold into the one duplicate row');
assert.equal(withGroups.rows.some((row) => row.state === 'missing'), false, 'the recorded connection is present, not missing');
// A group the text lists missed (or could not read) still gets its row.
const missed = reconcileInventory({ scan: scan([], { observed: { skill: true, plugin: false, mcp: false }, duplicateGroups: [pluginGroup, mcpGroup] }), ledger: { entries: [], resolutions: [] }, catalog, tracked });
assert.deepEqual(missed.rows.map((row) => [row.rowId, row.state, row.name, row.resolution.groupKey]), [['plugin:foo', 'duplicate', 'foo', 'plugin:foo'], ['mcp:playwright', 'duplicate', 'playwright', 'mcp:playwright']]);
// A Claude.ai connector or add-on connection with the same name is not folded into the group.
const connector = reconcileInventory({ scan: scan([mcpItem('playwright'), mcpItem('plugin:tools:playwright', { origin: 'plugin', addOn: 'tools' })], { duplicateGroups: [mcpGroup] }), ledger: { entries: [], resolutions: [] }, catalog, tracked });
assert.equal(connector.rows.find((row) => row.rowId === 'mcp:plugin:tools:playwright').resolution, undefined);
assert.equal(connector.rows.find((row) => row.rowId === 'mcp:playwright').state, 'duplicate');

// Fix round 1: an informational group still shows as a duplicate, with a reason and no resolution.
for (const reason of ['different-setup', 'team-shared', 'project-unknown']) {
  const info = reconcileInventory({ scan: scan([mcpItem('playwright')], { duplicateGroups: [{ ...mcpGroup, keeper: null, informational: true, reason }] }), ledger: { entries: [], resolutions: [] }, catalog, tracked });
  const infoRow = info.rows.find((row) => row.rowId === 'mcp:playwright');
  assert.equal(infoRow.state, 'duplicate');
  assert.equal(infoRow.resolution, undefined, `${reason} groups get no resolution`);
  assert.deepEqual(infoRow.informational, { reason });
  assert.equal(infoRow.copies.length, 2);
}

console.log('Inventory reconcile passed: all states, unobserved sources, project scope, backups, and unreadable records.');
