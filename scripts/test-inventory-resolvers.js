#!/usr/bin/env node
const assert = require('node:assert/strict');
const { planResolution, groupFingerprint } = require('../desktop/src/inventory/resolvers');

// Identical copies at home-local and user: keep the user copy (applies everywhere) and remove
// the narrower local copy, so behavior is unchanged everywhere.
const mcp = { kind: 'mcp', key: 'playwright', name: 'playwright', keeper: 1, needsChoice: false, identical: true, informational: false, reason: '', copies: [
  { name: 'Playwright', scope: 'local', projectPath: '/Users/me', fingerprint: 'a', label: 'Only you, in this folder' },
  { name: 'playwright', scope: 'user', projectPath: '', fingerprint: 'a', label: 'Just you, everywhere' },
] };
const plan = planResolution(mcp);
assert.equal(plan.ok, true);
assert.equal(plan.keep.scope, 'user', 'the broadest-reach copy is kept');
assert.deepEqual(plan.changes.map((c) => c.args), [['mcp', 'remove', 'Playwright', '--scope', 'local']], 'only the narrower copy is removed, by its own name, always with --scope');
assert.match(plan.changes[0].label, /Only you, in this folder/);
assert.equal(plan.changes[0].undo, 'The same connection is still saved for Just you, everywhere, so nothing stops working.');
assert.deepEqual(planResolution(mcp, { keep: 0 }), { ok: false, reason: 'invalid-choice' }, 'CCTI never removes the copy it keeps');
assert.equal(planResolution(mcp, { keep: 1 }).ok, true);
for (const reason of ['different-setup', 'team-shared', 'different-reach']) {
  assert.deepEqual(planResolution({ ...mcp, keeper: null, informational: true, reason }), { ok: false, reason: 'informational' }, `${reason} groups never produce changes`);
  assert.deepEqual(planResolution({ ...mcp, keeper: null, informational: true, reason }, { keep: 0 }), { ok: false, reason: 'informational' });
}

const plugin = { kind: 'plugin', key: 'foo', name: 'foo', keeper: null, needsChoice: true, identical: false, copies: [
  { id: 'foo@market-a', originalId: 'Foo@market-a', scope: 'user', projectPath: '', marketplace: 'market-a', label: 'market-a (Just you)' },
  { id: 'foo@market-b', scope: 'project', projectPath: '/work/app', marketplace: 'market-b', label: 'market-b (This project)' },
] };
assert.deepEqual(planResolution(plugin), { ok: false, reason: 'needs-choice' }, 'no documented rule: the user must choose');
const chosen = planResolution(plugin, { keep: 1 });
assert.equal(chosen.ok, true);
assert.deepEqual(chosen.changes.map((c) => c.args), [['plugin', 'disable', 'Foo@market-a', '--scope', 'user']], 'the other copy is disabled by its original id, never uninstalled');
assert.match(chosen.changes[0].undo, /turn it back on/i);
assert.deepEqual(planResolution(plugin, { keep: 5 }), { ok: false, reason: 'invalid-choice' });
assert.deepEqual(planResolution({ ...mcp, copies: [mcp.copies[0]] }), { ok: false, reason: 'nothing-to-do' });
assert.deepEqual(planResolution({ ...plugin, needsChoice: false, informational: true, reason: 'project-unknown' }, { keep: 1 }), { ok: false, reason: 'informational' }, 'a project add-on copy with no known folder is never changed');
// Defensive: even a (malformed) resolvable group never turns off a copy with the keeper's id.
const sameIdTwice = { kind: 'plugin', key: 'foo', name: 'foo', keeper: null, needsChoice: true, identical: false, informational: false, reason: '', copies: [
  { id: 'foo@a', originalId: 'Foo@a', scope: 'user', projectPath: '', marketplace: 'a', label: 'a (Just you)' },
  { id: 'foo@a', originalId: 'foo@a', scope: 'local', projectPath: '/work/app', marketplace: 'a', label: 'a (Only you in this project)' },
  { id: 'foo@b', scope: 'user', projectPath: '', marketplace: 'b', label: 'b (Just you)' },
] };
const keptA = planResolution(sameIdTwice, { keep: 0 });
assert.deepEqual(keptA.changes.map((c) => c.args), [['plugin', 'disable', 'foo@b', '--scope', 'user']], 'the keeper id is never disabled at another scope');
assert.equal(keptA.changes[0].copy, sameIdTwice.copies[2], 'each change carries the copy it targets');
assert.deepEqual(planResolution({ ...sameIdTwice, copies: sameIdTwice.copies.slice(0, 2) }, { keep: 0 }), { ok: false, reason: 'nothing-to-do' }, 'only the keeper id left: nothing to do');

assert.equal(groupFingerprint(mcp), groupFingerprint(JSON.parse(JSON.stringify(mcp))), 'fingerprints are stable');
assert.notEqual(groupFingerprint(mcp), groupFingerprint({ ...mcp, copies: [...mcp.copies, { scope: 'project', projectPath: '/x', fingerprint: 'b', label: 'x' }] }), 'a new copy changes the fingerprint');
assert.equal(chosen.fingerprint, groupFingerprint(plugin));
for (const change of [...plan.changes, ...chosen.changes]) {
  assert.doesNotMatch(change.label, /claude |--scope|\//, 'labels are plain language, never a command or path');
}
console.log('Inventory resolvers passed: keep the broadest identical copy, informational when different or team-shared, ask when undocumented, reversible add-on changes.');
