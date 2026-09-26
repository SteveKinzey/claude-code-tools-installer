const assert = require('node:assert/strict');
const { manageSections } = require('../desktop/src/inventory/manage-view');

const base = { key: 'k', scope: 'Just you', origin: 'local', installedAt: '', installedByCcti: false, copies: [], resolvable: false, reinstall: null, uncheckedReason: '' };
const row = (rowId, kind, state, extra = {}) => ({ ...base, rowId, kind, name: rowId, state, ...extra });
const inventory = {
  historyStatus: 'ok',
  rows: [
    row('planning', 'skill', 'installed', { installedAt: '2026-09-14T10:22:31Z', installedByCcti: true }),
    row('ponytail', 'skill', 'missing', { installedByCcti: true, reinstall: { id: 'ponytail', available: true, changed: false, message: '' } }),
    row('retired', 'skill', 'missing', { installedByCcti: true, reinstall: { id: 'retired', available: false, changed: false, message: 'retired is no longer offered by CCTI, so it can’t be reinstalled from here.' } }),
    row('graphify', 'skill', 'duplicate', { resolvable: true, copies: [{ scope: 'Just you', path: '/Users/me/.claude/skills/graphify' }, { scope: 'This project', path: '/work/.claude/skills/graphify' }] }),
    row('notes', 'skill', 'duplicate', { copies: [{ scope: 'Just you', path: '/a' }, { scope: 'This project', path: '/b' }] }),
    row('ops', 'plugin', 'external', { origin: 'claude.ai' }),
    row('mine', 'plugin', 'external'),
    row('repomix', 'mcp', 'missing', { installedByCcti: true, reinstall: { id: 'repomix', available: true, changed: true, message: 'CCTI now installs Repomix differently than when you first installed it. Reinstall uses the current steps.' } }),
    row('playwright', 'mcp', 'unchecked', { uncheckedReason: 'claude-code' }),
    row('proj', 'skill', 'unchecked', { uncheckedReason: 'project' }),
  ],
};
const view = manageSections(inventory);
const allRows = (v) => v.sections.flatMap((section) => [...section.rows, ...section.foldedRows]);
const find = (id) => allRows(view).find((item) => item.rowId === id);

assert.deepEqual(view.sections.map((section) => section.title), ['Skills', 'Add-ons', 'Connections'], 'one list grouped by kind');
assert.equal(find('planning').badge, 'Installed by CCTI · 2026-09-14');
assert.equal(find('planning').action, null);
assert.deepEqual(find('ponytail').action, { type: 'reinstall', label: 'Reinstall', id: 'ponytail', note: '' });
assert.equal(find('ponytail').badge, 'Missing');
assert.equal(find('retired').action, null, 'no Reinstall for an item CCTI no longer offers');
assert.match(find('retired').detail, /no longer offered/);
assert.match(find('repomix').action.note, /differently/, 'a changed catalog entry is said before acting');
assert.deepEqual(find('graphify').action, { type: 'resolve', label: 'Resolve' });
assert.equal(find('graphify').badge, '2 copies');
assert.equal(find('notes').action, null, 'unverified duplicates are informational');
assert.equal(find('ops').badge, 'From your Claude.ai account');
assert.equal(find('mine').badge, 'Found on this computer');
assert.equal(find('mine').action, null, 'external items are never auto-touched');
assert.equal(find('playwright').badge, 'Not checked');
assert.equal(find('playwright').action, null);
assert.match(find('proj').detail, /Also check a project/);
assert.equal(view.notice, null);
assert.match(view.summary, /10 items/);
assert.match(view.summary, /3 missing/);

// No terminal surface: details never show a path or a command.
for (const item of allRows(view)) {
  assert.doesNotMatch(item.detail, /[\\/]|claude (?:mcp|plugin)|\.json/, `${item.rowId} detail must not expose a path or command`);
  assert.ok(item.detail.length > 0, `${item.rowId} must explain itself`);
}

const plugins = view.sections.find((section) => section.kind === 'plugin');
assert.deepEqual(plugins.rows, [], 'external add-ons are folded');
assert.equal(plugins.foldedRows.length, 2);
assert.equal(plugins.foldedLabel, 'Show 2 more you already had');
const skills = view.sections.find((section) => section.kind === 'skill');
assert.ok(skills.rows.some((item) => item.rowId === 'ponytail'), 'missing rows stay visible');
assert.equal(skills.foldedLabel, '', 'nothing folded when there are no external rows');

const addOnView = manageSections({ historyStatus: 'ok', rows: [row('plugin:brand-voice:box', 'mcp', 'external', { origin: 'plugin', addOn: 'brand-voice' })] });
const addOnRow = addOnView.sections[0].foldedRows[0];
assert.equal(addOnRow.badge, 'Part of an add-on');
assert.equal(addOnRow.detail, 'Comes with the brand-voice add-on. Manage it through that add-on.');

const noAddOnView = manageSections({ historyStatus: 'ok', rows: [row('plugin:unknown:server', 'mcp', 'external', { origin: 'plugin', addOn: '' })] });
const noAddOnRow = noAddOnView.sections[0].foldedRows[0];
assert.equal(noAddOnRow.badge, 'Part of an add-on');
assert.equal(noAddOnRow.detail, 'Comes with an add-on. Manage it through that add-on.', 'no grammatically wrong "the an add-on" when addOn is empty');

const unavailableView = manageSections({ historyStatus: 'unavailable', rows: [] });
assert.equal(unavailableView.notice.action, null, 'no reset is offered for a temporary problem');
assert.match(unavailableView.notice.text, /check again/i);

// Review Focus 2: an unreadable record offers a fresh start and still lists everything.
const corrupt = manageSections({ historyStatus: 'corrupt', rows: [row('mine', 'plugin', 'external')] });
assert.deepEqual(corrupt.notice.action, { type: 'reset-history', label: 'Start a fresh record' });
assert.match(corrupt.notice.text, /still works/);
assert.equal(manageSections({ historyStatus: 'missing', rows: [] }).notice, null, 'a first run is not an error');

const empty = manageSections({ historyStatus: 'ok', rows: [] });
assert.deepEqual(empty.sections, []);
assert.match(empty.summary, /No skills, add-ons, or connections/);
assert.doesNotThrow(() => manageSections(undefined));

console.log('Inventory manage view passed: badges, one action per row, plain-language detail, and the fresh-record offer.');
