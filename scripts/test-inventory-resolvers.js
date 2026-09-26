#!/usr/bin/env node
const assert = require('node:assert/strict');
const { planResolution, groupFingerprint } = require('../desktop/src/inventory/resolvers');

const mcp = { kind: 'mcp', key: 'playwright', name: 'playwright', keeper: 0, needsChoice: false, identical: true, copies: [
  { scope: 'local', projectPath: '/Users/me', fingerprint: 'a', label: 'Only you, in this folder' },
  { scope: 'user', projectPath: '', fingerprint: 'a', label: 'Just you, everywhere' },
] };
const plan = planResolution(mcp);
assert.equal(plan.ok, true);
assert.equal(plan.keep.scope, 'local', 'the documented winner is kept');
assert.deepEqual(plan.changes.map((c) => c.args), [['mcp', 'remove', 'playwright', '--scope', 'user']], 'only the shadowed copy is removed, always with --scope');
assert.match(plan.changes[0].label, /Just you, everywhere/);
assert.deepEqual(planResolution(mcp, { keep: 1 }), { ok: false, reason: 'invalid-choice' }, 'CCTI never removes the copy Claude Code uses');
assert.equal(planResolution(mcp, { keep: 0 }).ok, true);

const plugin = { kind: 'plugin', key: 'foo', name: 'foo', keeper: null, needsChoice: true, identical: false, copies: [
  { id: 'foo@market-a', scope: 'user', projectPath: '', marketplace: 'market-a', label: 'market-a (Just you)' },
  { id: 'foo@market-b', scope: 'project', projectPath: '/work/app', marketplace: 'market-b', label: 'market-b (This project)' },
] };
assert.deepEqual(planResolution(plugin), { ok: false, reason: 'needs-choice' }, 'no documented rule: the user must choose');
const chosen = planResolution(plugin, { keep: 1 });
assert.equal(chosen.ok, true);
assert.deepEqual(chosen.changes.map((c) => c.args), [['plugin', 'disable', 'foo@market-a', '--scope', 'user']], 'the other copy is disabled, never uninstalled');
assert.match(chosen.changes[0].undo, /turn it back on/i);
assert.deepEqual(planResolution(plugin, { keep: 5 }), { ok: false, reason: 'invalid-choice' });
assert.deepEqual(planResolution({ ...mcp, copies: [mcp.copies[0]] }), { ok: false, reason: 'nothing-to-do' });

assert.equal(groupFingerprint(mcp), groupFingerprint(JSON.parse(JSON.stringify(mcp))), 'fingerprints are stable');
assert.notEqual(groupFingerprint(mcp), groupFingerprint({ ...mcp, copies: [...mcp.copies, { scope: 'project', projectPath: '/x', fingerprint: 'b', label: 'x' }] }), 'a new copy changes the fingerprint');
assert.equal(chosen.fingerprint, groupFingerprint(plugin));
for (const change of [...plan.changes, ...chosen.changes]) {
  assert.doesNotMatch(change.label, /claude |--scope|\//, 'labels are plain language, never a command or path');
}
console.log('Inventory resolvers passed: keep the documented winner, ask when undocumented, reversible add-on changes.');
