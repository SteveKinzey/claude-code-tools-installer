#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccti-inventory-main-'));
const home = path.join(tempRoot, 'home');
const project = path.join(tempRoot, 'project');
const ledgerFile = path.join(tempRoot, 'inventory.json');
const fakeState = path.join(tempRoot, 'fake-claude-state.json');
const handlers = new Map();
let readyCallback;
const originalAppData = process.env.APPDATA;
const originalLocalAppData = process.env.LOCALAPPDATA;

const electronStub = {
  app: {
    getPath: (name) => (name === 'home' ? home : tempRoot),
    isPackaged: false,
    whenReady: () => ({ then: (callback) => { readyCallback = callback; } }),
    on: () => {},
    quit: () => {},
  },
  BrowserWindow: class {
    static getAllWindows() { return []; }
    constructor() { this.webContents = { send: () => {}, setWindowOpenHandler: () => {}, on: () => {} }; }
    async loadFile() {}
    isDestroyed() { return false; }
  },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true, filePath: '' }) },
  shell: { showItemInFolder: () => true, openPath: async () => '', openExternal: async () => {} },
  Notification: class { static isSupported() { return false; } },
  ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
};

// Prints real Claude Code output shapes; plugin installs change what `plugin list` shows.
const fakeClaudeScript = `
const fs = require('node:fs');
const statePath = ${JSON.stringify(fakeState)};
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const [a, b, c] = process.argv.slice(2);
if (a === '--version') {
  if (state.versionHangsOnce) {
    // Outlasts claudeStatus's 4s version check once, like a slow first launch.
    state.versionHangsOnce = false;
    fs.writeFileSync(statePath, JSON.stringify(state));
    setTimeout(() => process.exit(0), 5000);
  } else {
    console.log('claude test');
    process.exit(0);
  }
}
else {
if (a === 'plugin' && b === 'list') {
  if (state.pluginListFailsOnce) {
    state.pluginListFailsOnce = false;
    fs.writeFileSync(statePath, JSON.stringify(state));
    process.exit(1);
  }
  console.log('Installed plugins:\\n');
  for (const id of state.plugins) console.log('  \\u276f ' + id + '\\n    Version: 1.0.0\\n    Scope: user\\n    Status: \\u2714 enabled\\n');
  process.exit(0);
}
if (a === 'plugin' && b === 'install') {
  state.plugins.push(c.includes('@') ? c : c + '@' + c);
  fs.writeFileSync(statePath, JSON.stringify(state));
  process.exit(0);
}
if (a === 'plugin' && b === 'marketplace') process.exit(0);
if (a === 'mcp' && b === 'list') {
  if (state.mcpFails) process.exit(1);
  console.log('Checking MCP server health\\u2026\\n');
  for (const name of state.mcp) console.log(name + ': npx example - \\u2714 Connected');
  process.exit(0);
}
if (a === 'mcp' && b === 'get') process.exit(state.mcp.includes(c) ? 0 : 1);
if (a === 'mcp' && b === 'remove') {
  if ((state.mcpRemoveFails || []).includes(c)) { console.error('could not remove ' + c); process.exit(1); }
  state.mcp = state.mcp.filter((name) => name !== c);
  fs.writeFileSync(statePath, JSON.stringify(state));
  process.exit(0);
}
process.exit(0);
}
`;

async function writeSkill(folder, body = '# Skill\n') {
  await fsp.mkdir(folder, { recursive: true });
  await fsp.writeFile(path.join(folder, 'SKILL.md'), body, 'utf8');
}

async function setFakeClaude(state) {
  await fsp.writeFile(fakeState, JSON.stringify({ plugins: [], mcp: [], mcpFails: false, pluginListFailsOnce: false, versionHangsOnce: false, mcpRemoveFails: [], ...state }), 'utf8');
}

async function installFakeClaude() {
  const script = path.join(tempRoot, 'fake-claude.js');
  await fsp.writeFile(script, fakeClaudeScript, 'utf8');
  if (process.platform === 'win32') {
    process.env.APPDATA = path.join(tempRoot, 'appdata');
    process.env.LOCALAPPDATA = path.join(tempRoot, 'local-appdata');
    const launcher = path.join(process.env.APPDATA, 'npm', 'claude.cmd');
    await fsp.mkdir(path.dirname(launcher), { recursive: true });
    await fsp.writeFile(launcher, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`, 'utf8');
  } else {
    const launcher = path.join(home, '.local', 'bin', 'claude');
    await fsp.mkdir(path.dirname(launcher), { recursive: true });
    await fsp.writeFile(launcher, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  }
}

const entry = (id, kind, key, extra = {}) => ({ id, kind, key, name: id, scope: 'user', projectPath: '', installedAt: '2026-09-14T10:00:00.000Z', source: 'ccti-catalog', catalogAction: '', ...extra });
const rowFor = (report, key) => report.inventory.rows.find((row) => row.key === key);

async function run() {
  await fsp.mkdir(project, { recursive: true });
  await installFakeClaude();
  await writeSkill(path.join(home, '.claude', 'skills', 'planning-with-files'));
  await writeSkill(path.join(home, '.claude', 'skills', 'twin'), '# Same\n');
  await writeSkill(path.join(project, '.claude', 'skills', 'twin'), '# Same\n');
  await setFakeClaude({ plugins: ['superpowers@superpowers-marketplace'], mcp: ['repomix'] });
  await fsp.writeFile(ledgerFile, JSON.stringify({
    schemaVersion: 1,
    entries: [
      entry('planning-with-files', 'skill', 'planning-with-files'),
      entry('superpowers', 'plugin', 'superpowers@superpowers-marketplace'),
      entry('playwright-mcp', 'mcp', 'playwright'),
    ],
    resolutions: [],
  }), 'utf8');

  Module._load = ((originalLoad) => function patchedLoad(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  })(Module._load);
  require(path.join(root, 'desktop', 'src', 'main.js'));
  await readyCallback();
  const discover = handlers.get('setup-manager:discover');

  // Discovery carries the reconciled inventory.
  let report = await discover(null, { projectPath: project });
  assert.equal(report.inventory.historyStatus, 'ok');
  assert.equal(rowFor(report, 'planning-with-files').state, 'installed');
  assert.equal(rowFor(report, 'superpowers@superpowers-marketplace').state, 'installed');
  assert.equal(rowFor(report, 'playwright').state, 'missing');
  assert.equal(rowFor(report, 'playwright').reinstall.available, true);
  assert.equal(rowFor(report, 'repomix').state, 'external', 'a connection CCTI did not record is outside CCTI');
  assert.equal(rowFor(report, 'twin').state, 'duplicate');
  assert.equal(rowFor(report, 'twin').resolvable, true);

  // Review Focus 1: a failing `mcp list` never turns a recorded connection into Missing.
  await setFakeClaude({ plugins: ['superpowers@superpowers-marketplace'], mcp: ['repomix'], mcpFails: true });
  report = await discover(null, {});
  assert.equal(rowFor(report, 'playwright').state, 'unchecked');

  // Review Focus 5: backing up a duplicate records a resolution, so nothing reads as lost.
  await setFakeClaude({ plugins: ['superpowers@superpowers-marketplace'], mcp: ['repomix'] });
  report = await discover(null, { projectPath: project });
  const review = await handlers.get('setup-manager:review-all-duplicates')(null, { discoveryId: report.discoveryId });
  assert.equal(review.ok, true, review.error);
  const applied = await handlers.get('setup-manager:apply-all-duplicates')(null, { reviewId: review.reviewId });
  assert.equal(applied.ok, true, applied.error);
  const afterBackup = JSON.parse(await fsp.readFile(ledgerFile, 'utf8'));
  assert.ok(afterBackup.resolutions.some((item) => item.key === 'twin' && item.action === 'backup'), 'the backup is recorded as a resolution');

  // A single, non-duplicate skill can also be backed up one at a time through the same
  // review/apply pair the Manage list uses for a single row, and it is recorded the same way.
  await writeSkill(path.join(home, '.claude', 'skills', 'solo'));
  report = await discover(null, { projectPath: project });
  const soloFinding = report.findings.find((item) => item.type === 'skill' && item.name === 'solo');
  assert.ok(soloFinding, 'discovery must report the newly written solo skill');
  const soloReview = await handlers.get('setup-manager:review-cleanup')(null, { discoveryId: report.discoveryId, findingId: soloFinding.id });
  assert.equal(soloReview.ok, true, soloReview.error);
  const soloApplied = await handlers.get('setup-manager:apply-cleanup')(null, { reviewId: soloReview.reviewId });
  assert.equal(soloApplied.ok, true, soloApplied.error);
  const afterSoloBackup = JSON.parse(await fsp.readFile(ledgerFile, 'utf8'));
  assert.ok(
    afterSoloBackup.resolutions.some((item) => item.kind === 'skill' && item.key === 'solo' && item.action === 'backup'),
    'backing up a single skill records the same kind of resolution as the duplicate cleanup path'
  );

  // Fix round 1, finding 1: a before-probe that cannot reach Claude Code (the fake's
  // `plugin list` fails once) must not turn an already-present plugin into a claimed CCTI
  // install just because a later, successful after-probe sees it. The tri-state probe marks
  // it "unknown" rather than "absent", so newlyInstalledEntries never treats it as new.
  await setFakeClaude({ plugins: ['superpowers@superpowers-marketplace'], mcp: ['repomix'], pluginListFailsOnce: true });
  const beforeDegradedProbe = JSON.parse(await fsp.readFile(ledgerFile, 'utf8'));
  const degraded = await handlers.get('install:run')(null, { selectedIds: ['superpowers'], dryRun: false });
  assert.equal(degraded.ok, true, degraded.error);
  const afterDegradedProbe = JSON.parse(await fsp.readFile(ledgerFile, 'utf8'));
  assert.deepEqual(afterDegradedProbe, beforeDegradedProbe, 'a plugin already present must not be recorded just because the before-probe failed once');

  // Final review, finding 1: when Claude Code's own version check times out during the
  // before-probe, detection failed; it does not mean nothing is installed. An already-present
  // plugin is unknown, so a successful after-probe cannot claim it as a CCTI install.
  await setFakeClaude({ plugins: ['superpowers@superpowers-marketplace'], mcp: ['repomix'], versionHangsOnce: true });
  const beforeSlowClaude = JSON.parse(await fsp.readFile(ledgerFile, 'utf8'));
  const slowClaude = await handlers.get('install:run')(null, { selectedIds: ['superpowers'], dryRun: false });
  assert.equal(slowClaude.ok, true, slowClaude.error);
  assert.equal(JSON.parse(await fsp.readFile(fakeState, 'utf8')).versionHangsOnce, false, 'the slow version check was exercised');
  assert.deepEqual(JSON.parse(await fsp.readFile(ledgerFile, 'utf8')), beforeSlowClaude, 'a plugin already present must not be recorded because Claude Code was slow to answer');
  await setFakeClaude({ plugins: ['superpowers@superpowers-marketplace'], mcp: ['repomix'] });

  // Review Focus 4 and 2: install:run records only newly present tracked items, and an
  // unreadable record (a directory where the file should be) is kept aside, not fatal.
  await fsp.rm(ledgerFile, { force: true });
  await fsp.mkdir(ledgerFile);
  const result = await handlers.get('install:run')(null, { selectedIds: ['claude-hud', 'superpowers'], dryRun: false });
  assert.equal(result.ok, true, result.error);
  const recorded = JSON.parse(await fsp.readFile(ledgerFile, 'utf8'));
  assert.deepEqual(recorded.entries.map((item) => item.id), ['claude-hud'], 'superpowers was already present, so it is not claimed as a CCTI install');
  assert.equal(recorded.entries[0].key, 'claude-hud');
  assert.ok(fs.readdirSync(tempRoot).some((name) => name.startsWith('inventory.unreadable-')), 'the unreadable record was kept');

  const preview = await handlers.get('install:run')(null, { selectedIds: ['context7'], dryRun: true });
  assert.equal(preview.ok, true);
  assert.ok(!JSON.parse(await fsp.readFile(ledgerFile, 'utf8')).entries.some((item) => item.id === 'context7'), 'a preview records nothing');

  // Reset: refuses to wipe a readable record, and starts fresh from an unreadable one.
  const reset = handlers.get('inventory:reset-history');
  assert.deepEqual(await reset(null), { ok: true, preserved: false });
  assert.equal(JSON.parse(await fsp.readFile(ledgerFile, 'utf8')).entries.length, 1);
  await fsp.writeFile(ledgerFile, 'not json', 'utf8');
  report = await discover(null, {});
  assert.equal(report.inventory.historyStatus, 'corrupt');
  assert.ok(report.inventory.rows.every((row) => !row.installedByCcti), 'an unreadable record claims nothing');
  assert.deepEqual(await reset(null), { ok: true, preserved: true });
  report = await discover(null, {});
  assert.equal(report.inventory.historyStatus, 'ok');

  // Final review, finding 2: removing CCTI's extras (typed confirmation) records a 'remove'
  // resolution for each tracked skill and MCP connection it actually removed, so they do not
  // come back as Missing. A removal that stops partway records only what completed.
  const skillsRoot = path.join(home, '.claude', 'skills');
  await writeSkill(path.join(skillsRoot, 'graphify'));
  await setFakeClaude({ plugins: [], mcp: ['playwright', 'repomix'], mcpRemoveFails: ['repomix'] });
  await fsp.writeFile(ledgerFile, JSON.stringify({
    schemaVersion: 1,
    entries: [
      entry('planning-with-files', 'skill', 'planning-with-files'),
      entry('graphify', 'skill', 'graphify'),
      entry('playwright-mcp', 'mcp', 'playwright'),
      entry('repomix', 'mcp', 'repomix'),
    ],
    resolutions: [],
  }), 'utf8');
  const manifestFile = path.join(home, '.setup-my-claude', 'manifest.tsv');
  await fsp.mkdir(path.dirname(manifestFile), { recursive: true });
  await fsp.writeFile(manifestFile, [
    ['2026-09-14T10:00:00Z', 'skill', path.join(skillsRoot, 'planning-with-files'), '-', 'planning-with-files'],
    ['2026-09-14T10:00:00Z', 'mcp', 'playwright', '-', 'playwright-mcp'],
    ['2026-09-14T10:00:00Z', 'mcp', 'repomix', '-', 'repomix'],
    ['2026-09-14T10:00:00Z', 'skill', path.join(skillsRoot, 'graphify'), '-', 'graphify'],
  ].map((fields) => fields.join('\t')).join('\n') + '\n', 'utf8');
  const extrasReview = await handlers.get('setup-manager:review-managed-extras-removal')(null);
  assert.equal(extrasReview.ok, true, extrasReview.error);
  assert.equal(extrasReview.actions.length, 4);
  const extrasRemoval = await handlers.get('setup-manager:apply-managed-extras-removal')(null, { reviewId: extrasReview.reviewId, confirmation: 'REMOVE CCTI EXTRAS' });
  assert.equal(extrasRemoval.ok, false, 'the repomix removal fails, so the removal stops partway');
  assert.equal(extrasRemoval.removedCount, 2);
  const afterRemoval = JSON.parse(await fsp.readFile(ledgerFile, 'utf8'));
  assert.deepEqual(afterRemoval.resolutions.map((item) => [item.kind, item.key, item.scope, item.projectPath, item.action]), [
    ['skill', 'planning-with-files', 'user', '', 'remove'],
    ['mcp', 'playwright', 'user', '', 'remove'],
  ], 'only the removals that completed are recorded');
  report = await discover(null, {});
  assert.equal(rowFor(report, 'planning-with-files'), undefined, 'a deliberately removed skill is not Missing');
  assert.equal(rowFor(report, 'playwright'), undefined, 'a deliberately removed connection is not Missing');
  assert.equal(rowFor(report, 'repomix').state, 'installed', 'the connection that failed to remove is still there');
  assert.equal(rowFor(report, 'graphify').state, 'installed', 'the skill after the failure was never touched');

  console.log('Inventory main wiring passed: discovery rows, unobserved connections, backup resolutions, verified install recording, record reset, and extras removal.');
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (originalAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = originalAppData;
    if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = originalLocalAppData;
    await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    process.exit(process.exitCode || 0);
  });
