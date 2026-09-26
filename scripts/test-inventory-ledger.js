#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { SCHEMA_VERSION, emptyLedger, parseLedger, newlyInstalledEntries, skillBackupResolutions, createLedgerStore } = require('../desktop/src/inventory/ledger');

const tracked = {
  'planning-with-files': { kind: 'skill', key: 'planning-with-files' },
  'claude-hud': { kind: 'plugin', key: 'claude-hud' },
  'playwright-mcp': { kind: 'mcp', key: 'playwright' },
};
const catalog = [
  { id: 'planning-with-files', name: 'Planning with Files', action: 'Install with npx skills' },
  { id: 'claude-hud', name: 'Claude HUD', action: 'Install selected plugin in CCTI' },
  { id: 'playwright-mcp', name: 'Playwright MCP', action: 'Register MCP server' },
];
const now = new Date('2026-09-26T10:00:00.000Z');

async function run() {
  // Pure helpers.
  assert.deepEqual(emptyLedger(), { schemaVersion: SCHEMA_VERSION, entries: [], resolutions: [] });
  for (const bad of ['{not json', '', '[]', 'null', '{"schemaVersion":2,"entries":[],"resolutions":[]}', '{"schemaVersion":1,"entries":{},"resolutions":[]}', '{"schemaVersion":1,"entries":[]']) {
    assert.equal(parseLedger(bad).status, 'corrupt', `${JSON.stringify(bad)} must read as unreadable`);
    assert.deepEqual(parseLedger(bad).ledger, emptyLedger());
  }
  const mixed = parseLedger(JSON.stringify({ schemaVersion: 1, entries: [{ id: 'a', kind: 'skill', key: 'a', installedAt: now.toISOString() }, { id: 'b' }, null], resolutions: [{ kind: 'skill', key: 'a', resolvedAt: now.toISOString() }, 7] }));
  assert.equal(mixed.status, 'ok');
  assert.deepEqual(mixed.ledger.entries.map((entry) => entry.id), ['a'], 'malformed entries are dropped, not fatal');
  assert.equal(mixed.ledger.resolutions.length, 1);

  // Review Focus 4: only items absent before and present after are CCTI installs.
  const entries = newlyInstalledEntries(
    ['planning-with-files', 'claude-hud', 'playwright-mcp', 'playwright-mcp', 'learn-claude-code', 'constructor'],
    new Set(['claude-hud']),
    new Set(['planning-with-files', 'claude-hud']),
    { tracked, catalog, skillScope: 'project', projectPath: '/work/app', now },
  );
  assert.deepEqual(entries, [{
    id: 'planning-with-files', kind: 'skill', key: 'planning-with-files', name: 'Planning with Files',
    scope: 'project', projectPath: '/work/app', installedAt: now.toISOString(), source: 'ccti-catalog', catalogAction: 'Install with npx skills',
  }], 'already-present, failed, untracked, and prototype-named ids are not recorded');
  const plugin = newlyInstalledEntries(['claude-hud'], new Set(), new Set(['claude-hud']), { tracked, catalog, skillScope: 'project', projectPath: '/work/app', now })[0];
  assert.equal(plugin.scope, 'user', 'plugins and connections are recorded at user scope');
  assert.equal(plugin.projectPath, '');

  assert.deepEqual(skillBackupResolutions([
    { name: 'Planning With Files', scope: 'This project', source: '/work/app/.claude/skills/planning-with-files', destination: '/backup/planning-with-files' },
    { name: 'graphify', scope: 'Just you', source: '/h/.claude/skills/graphify', destination: '/backup/graphify' },
  ], { projectPath: '/work/app', now }), [
    { kind: 'skill', key: 'planning-with-files', scope: 'project', projectPath: '/work/app', resolvedAt: now.toISOString(), action: 'backup', movedFrom: '/work/app/.claude/skills/planning-with-files', movedTo: '/backup/planning-with-files' },
    { kind: 'skill', key: 'graphify', scope: 'user', projectPath: '', resolvedAt: now.toISOString(), action: 'backup', movedFrom: '/h/.claude/skills/graphify', movedTo: '/backup/graphify' },
  ]);

  // Store.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ccti-ledger-test-'));
  try {
    const file = path.join(dir, 'user-data', 'inventory.json');
    const store = createLedgerStore(file, { now: () => now });
    assert.deepEqual(await store.read(), { status: 'missing', ledger: emptyLedger() }, 'no file yet is a normal first run');

    await store.recordInstalls(entries);
    const first = await store.read();
    assert.equal(first.status, 'ok');
    assert.equal(first.ledger.entries.length, 1);

    const later = { ...entries[0], installedAt: '2026-09-27T00:00:00.000Z' };
    await store.recordInstalls([later]);
    assert.deepEqual((await store.read()).ledger.entries, [later], 'reinstalling the same id at the same scope replaces its entry');

    await Promise.all([store.recordInstalls([plugin]), store.recordResolutions(skillBackupResolutions([{ name: 'graphify', scope: 'Just you', source: 's', destination: 'd' }], { now }))]);
    const both = await store.read();
    assert.equal(both.ledger.entries.length, 2, 'concurrent writes must not lose an update');
    assert.equal(both.ledger.resolutions.length, 1);

    assert.deepEqual(await store.reset(), { ok: true, preservedAs: '', unchanged: true }, 'reset must never wipe a readable record');
    assert.equal((await store.read()).ledger.entries.length, 2);

    // Review Focus 2: an unreadable record is kept aside and recording carries on.
    await fs.writeFile(file, '{"schemaVersion":1,"entr', 'utf8');
    assert.equal((await store.read()).status, 'corrupt');
    const recovered = await store.recordInstalls([plugin]);
    assert.ok(recovered.preservedAs, 'the unreadable file must be kept');
    assert.equal(await fs.readFile(recovered.preservedAs, 'utf8'), '{"schemaVersion":1,"entr', 'the kept copy is byte-for-byte the old file');
    assert.deepEqual((await store.read()).ledger.entries, [plugin]);

    await fs.writeFile(file, 'garbage', 'utf8');
    const reset = await store.reset();
    assert.ok(reset.preservedAs);
    assert.deepEqual(await store.read(), { status: 'ok', ledger: emptyLedger() });

    await fs.rm(file);
    await fs.mkdir(file);
    await fs.writeFile(path.join(file, 'stray.txt'), 'x', 'utf8');
    assert.equal((await store.read()).status, 'corrupt', 'a directory where the file should be is unreadable, not fatal');
    const fromDirectory = await store.recordInstalls([plugin]);
    assert.ok(fromDirectory.preservedAs);
    assert.equal((await store.read()).status, 'ok');

    // A failed write rejects, and the next write still works.
    const blocked = path.join(dir, 'blocked');
    await fs.writeFile(blocked, 'not a folder', 'utf8');
    const blockedStore = createLedgerStore(path.join(blocked, 'inventory.json'), { now: () => now });
    await assert.rejects(blockedStore.recordInstalls([plugin]));
    await fs.rm(blocked);
    await blockedStore.recordInstalls([plugin]);
    assert.equal((await blockedStore.read()).ledger.entries.length, 1, 'one failed write must not poison later writes');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
  console.log('Inventory ledger passed: verified-install recording, safe concurrent writes, and unreadable records kept aside without blocking.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
