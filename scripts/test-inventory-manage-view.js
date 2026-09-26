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
    row('connection-dup', 'mcp', 'duplicate', {
      copies: [{ scope: 'Only you, in this folder', path: '' }, { scope: 'Just you, everywhere', path: '' }],
      resolution: { groupKey: 'mcp:connection-dup', needsChoice: false, keeper: 1, options: ['Only you, in this folder', 'Just you, everywhere'] },
    }),
    row('addon-dup', 'plugin', 'duplicate', {
      copies: [{ scope: 'market-a (Just you)', path: '' }, { scope: 'market-b (Just you)', path: '' }, { scope: 'market-c (Just you)', path: '' }],
      resolution: { groupKey: 'plugin:addon-dup', needsChoice: true, keeper: null, options: ['market-a (Just you)', 'market-b (Just you)', 'market-c (Just you)'] },
    }),
    row('info-different-setup', 'mcp', 'duplicate', {
      copies: [{ scope: 'Only you, in this folder', path: '' }, { scope: 'Just you, everywhere', path: '' }],
      informational: { reason: 'different-setup' },
    }),
    row('info-team-shared', 'mcp', 'duplicate', {
      copies: [{ scope: 'Everyone on this project', path: '' }, { scope: 'Just you, everywhere', path: '' }],
      informational: { reason: 'team-shared' },
    }),
    row('info-separate-folders', 'mcp', 'duplicate', {
      copies: [{ scope: 'Only you, in this folder', path: '' }, { scope: 'Only you, in this project', path: '' }],
      informational: { reason: 'separate-folders' },
    }),
    row('info-project-unknown', 'plugin', 'duplicate', {
      copies: [{ scope: 'm (This project)', path: '' }, { scope: 'n (Just you)', path: '' }],
      informational: { reason: 'project-unknown' },
    }),
    row('info-different-reach', 'plugin', 'duplicate', {
      copies: [{ scope: 'a (Just you)', path: '' }, { scope: 'b (Only you in this project)', path: '' }],
      informational: { reason: 'different-reach' },
    }),
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

// A resolvable connection duplicate (needsChoice false): Resolve names the keeper and says
// what happens to the rest, and the action carries everything the dialog needs.
assert.deepEqual(find('connection-dup').action, { type: 'resolve-duplicate', label: 'Resolve', groupKey: 'mcp:connection-dup', needsChoice: false, options: ['Only you, in this folder', 'Just you, everywhere'], keeper: 1 });
assert.equal(find('connection-dup').detail, 'These copies are identical. CCTI keeps the copy saved for Just you, everywhere; Resolve removes the extra copy, so nothing stops working.');

// A resolvable add-on duplicate (needsChoice true): the user must choose.
assert.deepEqual(find('addon-dup').action, { type: 'resolve-duplicate', label: 'Resolve', groupKey: 'plugin:addon-dup', needsChoice: true, options: ['market-a (Just you)', 'market-b (Just you)', 'market-c (Just you)'], keeper: null });
assert.equal(find('addon-dup').detail, 'This add-on is turned on from 3 places. Claude Code doesn’t say which one it uses, so choose the one to keep.');

// Informational duplicates get no action, and a plain sentence per reason.
assert.equal(find('info-different-setup').action, null);
assert.equal(find('info-different-setup').detail, 'These copies are set up differently, so removing either one would change how Claude Code behaves somewhere. CCTI won’t change them.');
assert.equal(find('info-team-shared').action, null);
assert.equal(find('info-team-shared').detail, 'One copy is shared with everyone on the project, so CCTI won’t change it. Ask the project owner if you want to tidy it up.');
assert.equal(find('info-separate-folders').action, null);
assert.equal(find('info-separate-folders').detail, 'These copies are in different folders and don’t overlap, so nothing needs to change.');
assert.equal(find('info-project-unknown').action, null);
assert.equal(find('info-different-reach').action, null);
assert.equal(find('info-different-reach').detail, 'These copies are saved in different places, so turning one off could remove it somewhere you still use it. CCTI won’t change them.');
assert.equal(find('info-project-unknown').detail, 'One copy is saved for a specific folder. Choose that folder with “Also check a project” so CCTI can see it, then check again.');

assert.equal(view.notice, null);
assert.match(view.summary, /17 items/);
assert.match(view.summary, /3 missing/);
assert.match(view.summary, /9 with extra copies/);

// No terminal surface: details never show a path or a command.
for (const item of allRows(view)) {
  assert.doesNotMatch(item.detail, /[\\/]|claude (?:mcp|plugin)|\.json/, `${item.rowId} detail must not expose a path or command`);
  assert.ok(item.detail.length > 0, `${item.rowId} must explain itself`);
}

const plugins = view.sections.find((section) => section.kind === 'plugin');
assert.deepEqual(plugins.rows.map((item) => item.rowId).sort(), ['addon-dup', 'info-different-reach', 'info-project-unknown'], 'external add-ons are folded, but duplicate rows stay visible');
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
assert.equal(corrupt.sections[0].foldedLabel, 'Show 1 more', 'an unreadable record cannot vouch that you already had this');
assert.equal(manageSections({ historyStatus: 'missing', rows: [] }).notice, null, 'a first run is not an error');

const empty = manageSections({ historyStatus: 'ok', rows: [] });
assert.deepEqual(empty.sections, []);
assert.match(empty.summary, /No skills, add-ons, or connections/);
assert.doesNotThrow(() => manageSections(undefined));

// A duplicate with an unsafe name is informational with a plain reason and no action.
const unusualView = manageSections({ historyStatus: 'ok', rows: [row('mcp:evil', 'mcp', 'duplicate', { copies: [{ scope: 'Just you, everywhere', path: '' }, { scope: 'Only you, in this folder', path: '' }], informational: { reason: 'unusual-name' } })] });
const unusualRow = unusualView.sections[0].rows[0];
assert.equal(unusualRow.action, null);
assert.match(unusualRow.detail, /can’t safely pass to Claude Code/);

console.log('Inventory manage view passed: badges, one action per row, plain-language detail, and the fresh-record offer.');
