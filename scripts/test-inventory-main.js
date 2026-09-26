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
// Fix round 1, item 3(c): captures every emit() the main process sends to the renderer
// (mainWindow.webContents.send), so a test can confirm raw stderr reaches installer:output
// even though the returned error is a plain-language message.
const emittedEvents = [];

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
    constructor() { this.webContents = { send: (channel, payload) => emittedEvents.push({ channel, payload }), setWindowOpenHandler: () => {}, on: () => {} }; }
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
if (a === 'plugin' && (b === 'enable' || b === 'disable')) {
  // Fix round 1, item 3(c): logs every attempted enable/disable so a test can prove the CLI
  // was actually invoked, independent of whether it then succeeds or is made to fail.
  state.pluginActionCalls = state.pluginActionCalls || [];
  state.pluginActionCalls.push({ action: b, name: c });
  fs.writeFileSync(statePath, JSON.stringify(state));
  if (state.pluginActionFails) {
    console.error('Injected plugin ' + b + ' failure for ' + c);
    process.exit(1);
  }
  if (b === 'enable' && !state.plugins.includes(c)) state.plugins.push(c);
  if (b === 'disable') state.plugins = state.plugins.filter((id) => id !== c);
  fs.writeFileSync(statePath, JSON.stringify(state));
  process.exit(0);
}
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
  await fsp.writeFile(fakeState, JSON.stringify({ plugins: [], mcp: [], mcpFails: false, pluginListFailsOnce: false, versionHangsOnce: false, mcpRemoveFails: [], pluginActionFails: false, pluginActionCalls: [], ...state }), 'utf8');
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

  // Task 4, Step 1.1: Claude Code's documented rule is personal over project. Even when the
  // project copy is the newer file, the personal (home) copy is the one Claude Code resolves,
  // so bulk cleanup must keep the home copy and back up the project copy, not the newest one.
  await writeSkill(path.join(home, '.claude', 'skills', 'keeper-check'), '# Keeper check\n');
  await writeSkill(path.join(project, '.claude', 'skills', 'keeper-check'), '# Keeper check\n');
  await fsp.utimes(path.join(project, '.claude', 'skills', 'keeper-check', 'SKILL.md'), new Date('2030-01-01T00:00:00.000Z'), new Date('2030-01-01T00:00:00.000Z'));
  report = await discover(null, { projectPath: project });
  const keeperReview = await handlers.get('setup-manager:review-all-duplicates')(null, { discoveryId: report.discoveryId });
  assert.equal(keeperReview.ok, true, keeperReview.error);
  const keeperApplied = await handlers.get('setup-manager:apply-all-duplicates')(null, { reviewId: keeperReview.reviewId });
  assert.equal(keeperApplied.ok, true, keeperApplied.error);
  await fsp.access(path.join(home, '.claude', 'skills', 'keeper-check', 'SKILL.md'));
  await assert.rejects(
    fsp.access(path.join(project, '.claude', 'skills', 'keeper-check')),
    'the newer project copy must be backed up while the personal copy stays, per Claude Code\'s documented personal-over-project precedence'
  );

  // Task 4, Step 1.2: a review left open past the old 10-minute window must still apply,
  // because apply re-verifies the current file content instead of rejecting on age alone.
  await writeSkill(path.join(home, '.claude', 'skills', 'stale-review-check'), '# Stale review check\n');
  report = await discover(null, { projectPath: project });
  const staleFinding = report.findings.find((item) => item.type === 'skill' && item.name === 'stale-review-check');
  assert.ok(staleFinding, 'discovery must report the newly written stale-review-check skill');
  const staleReview = await handlers.get('setup-manager:review-cleanup')(null, { discoveryId: report.discoveryId, findingId: staleFinding.id });
  assert.equal(staleReview.ok, true, staleReview.error);
  const originalDateNowForStaleReview = Date.now;
  Date.now = () => originalDateNowForStaleReview() + 11 * 60 * 1000;
  let staleApplied;
  try {
    staleApplied = await handlers.get('setup-manager:apply-cleanup')(null, { reviewId: staleReview.reviewId });
  } finally {
    Date.now = originalDateNowForStaleReview;
  }
  assert.equal(staleApplied.ok, true, staleApplied.error, 'apply must succeed once re-verification passes, even though the review is over 10 minutes old');
  await assert.rejects(fsp.access(staleFinding.path), 'the skill should have moved to backup even though the review was over 10 minutes old');
  await fsp.access(path.join(staleReview.destination, 'SKILL.md'));

  // Coordinator fix round 1, item 3(a): applyCleanup must refuse when the reviewed skill's
  // content changed after review, leaving the skill in place and creating no backup.
  await writeSkill(path.join(home, '.claude', 'skills', 'content-changed-check'), '# Content changed check\n');
  report = await discover(null, { projectPath: project });
  const contentChangedFinding = report.findings.find((item) => item.type === 'skill' && item.name === 'content-changed-check');
  assert.ok(contentChangedFinding, 'discovery must report the newly written content-changed-check skill');
  const contentChangedReview = await handlers.get('setup-manager:review-cleanup')(null, { discoveryId: report.discoveryId, findingId: contentChangedFinding.id });
  assert.equal(contentChangedReview.ok, true, contentChangedReview.error);
  await fsp.writeFile(path.join(home, '.claude', 'skills', 'content-changed-check', 'SKILL.md'), '# Content changed check (edited)\n', 'utf8');
  const contentChangedApplied = await handlers.get('setup-manager:apply-cleanup')(null, { reviewId: contentChangedReview.reviewId });
  assert.equal(contentChangedApplied.ok, false, 'apply must refuse when the reviewed skill changed after review');
  assert.match(contentChangedApplied.error, /changed after you looked at it/i);
  await fsp.access(contentChangedFinding.path);
  await assert.rejects(fsp.access(contentChangedReview.destination), 'no backup should be created when the reviewed content no longer matches');

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

  // Final fix wave: a ledger read that fails with EBUSY (locked, not missing or corrupt) must
  // surface as the LEDGER_UNAVAILABLE message, never a generic failure or a silent reset.
  {
    const originalReadFile = fsp.readFile;
    fsp.readFile = async (target, ...rest) => {
      if (target === ledgerFile) throw Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' });
      return originalReadFile.call(fsp, target, ...rest);
    };
    try {
      const busyReset = await reset(null);
      assert.equal(busyReset.ok, false, 'a locked ledger must not report success');
      assert.match(busyReset.error, /CCTI could not open its record right now/, 'a locked ledger must surface the LEDGER_UNAVAILABLE message');
    } finally {
      fsp.readFile = originalReadFile;
    }
  }

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

  // Coordinator fix round 1, items 3(b) and 3(c): applyPluginChange must re-verify the add-on
  // is still installed (by asking Claude Code directly, not trusting the stale review), and it
  // must never show raw CLI stderr as the returned error.
  await fsp.mkdir(path.join(home, '.claude'), { recursive: true });
  await fsp.writeFile(path.join(home, '.claude', 'settings.json'), JSON.stringify({
    enabledPlugins: { 'sample-addon@sample-marketplace': true, 'superpowers@superpowers-marketplace': true },
  }), 'utf8');
  await setFakeClaude({ plugins: ['superpowers@superpowers-marketplace'], mcp: ['repomix'] });
  report = await discover(null, {});
  const sampleAddonFinding = report.findings.find((item) => item.type === 'plugin' && item.scope === 'Just you' && item.name === 'sample-addon@sample-marketplace');
  assert.ok(sampleAddonFinding, 'the settings.json-only plugin should be discovered as a manageable, user-scope add-on');
  const installedAddonFinding = report.findings.find((item) => item.type === 'plugin' && item.scope === 'Just you' && item.name === 'superpowers@superpowers-marketplace');
  assert.ok(installedAddonFinding, 'the settings.json plugin that Claude Code also reports installed should be discovered as a manageable, user-scope add-on');

  // 3(b): sample-addon is declared in settings.json but never shows up on Claude Code's own
  // `plugin list`, so apply must refuse without running any enable/disable command.
  const missingAddonReview = await handlers.get('setup-manager:review-plugin-change')(null, { discoveryId: report.discoveryId, findingId: sampleAddonFinding.id, action: 'disable' });
  assert.equal(missingAddonReview.ok, true, missingAddonReview.error);
  const missingAddonApplied = await handlers.get('setup-manager:apply-plugin-change')(null, { reviewId: missingAddonReview.reviewId });
  assert.equal(missingAddonApplied.ok, false, 'apply must refuse an add-on that is not on the current plugin list');
  assert.match(missingAddonApplied.error, /no longer installed/i);
  assert.deepEqual(JSON.parse(await fsp.readFile(fakeState, 'utf8')).pluginActionCalls, [], 'no enable/disable command should run for an add-on that is no longer installed');

  // 3(c): superpowers IS on the plugin list, so apply proceeds to call the CLI, which is made
  // to fail. The returned error must be a plain next-action message, never the raw CLI stderr;
  // the stderr itself must still reach the activity log via installer:output.
  const installedAddonReview = await handlers.get('setup-manager:review-plugin-change')(null, { discoveryId: report.discoveryId, findingId: installedAddonFinding.id, action: 'disable' });
  assert.equal(installedAddonReview.ok, true, installedAddonReview.error);
  await setFakeClaude({ plugins: ['superpowers@superpowers-marketplace'], mcp: ['repomix'], pluginActionFails: true });
  const emittedBeforeFailure = emittedEvents.length;
  const installedAddonApplied = await handlers.get('setup-manager:apply-plugin-change')(null, { reviewId: installedAddonReview.reviewId });
  assert.equal(installedAddonApplied.ok, false, 'apply must report failure when the CLI enable/disable command fails');
  assert.match(installedAddonApplied.error, /could not disable this add-on/i);
  assert.doesNotMatch(installedAddonApplied.error, /Injected plugin/i, 'the returned error must never be the raw CLI stderr');
  const stderrEvents = emittedEvents.slice(emittedBeforeFailure).filter((event) => event.channel === 'installer:output' && event.payload?.stream === 'stderr');
  assert.ok(stderrEvents.some((event) => /Injected plugin disable failure/.test(event.payload.text)), 'the raw stderr must still reach the activity log via installer:output');
  const stateAfterFailure = JSON.parse(await fsp.readFile(fakeState, 'utf8'));
  assert.deepEqual(stateAfterFailure.pluginActionCalls, [{ action: 'disable', name: 'superpowers@superpowers-marketplace' }], 'the CLI enable/disable command must actually run once the add-on is confirmed installed');
  await setFakeClaude({ plugins: ['superpowers@superpowers-marketplace'], mcp: ['repomix'] });

  // Item 5: when `claude plugin list` itself fails, apply must not claim the add-on is "no
  // longer installed" (detection failed, it is not proof of absence) and must not run enable
  // or disable.
  const listFailureReview = await handlers.get('setup-manager:review-plugin-change')(null, { discoveryId: report.discoveryId, findingId: installedAddonFinding.id, action: 'disable' });
  assert.equal(listFailureReview.ok, true, listFailureReview.error);
  await setFakeClaude({ plugins: ['superpowers@superpowers-marketplace'], mcp: ['repomix'], pluginListFailsOnce: true });
  const listFailureApplied = await handlers.get('setup-manager:apply-plugin-change')(null, { reviewId: listFailureReview.reviewId });
  assert.equal(listFailureApplied.ok, false, 'apply must refuse when Claude Code cannot be asked whether the add-on is installed');
  assert.match(listFailureApplied.error, /couldn.t check your add-ons/i);
  assert.doesNotMatch(listFailureApplied.error, /no longer installed/i, 'a failed list call must never be reported as "no longer installed"');
  assert.deepEqual(JSON.parse(await fsp.readFile(fakeState, 'utf8')).pluginActionCalls, [], 'no enable/disable command should run when the list check itself failed');
  await setFakeClaude({ plugins: ['superpowers@superpowers-marketplace'], mcp: ['repomix'] });

  // PR review (security): the older add-on on/off change takes its name from settings files and
  // doesn't go through duplicate grouping, so its own guard is its only protection. An installed
  // add-on whose id contains shell characters is refused and nothing reaches the CLI.
  await fsp.writeFile(path.join(home, '.claude', 'settings.json'), JSON.stringify({
    enabledPlugins: { 'foo@x&calc': true },
  }), 'utf8');
  await setFakeClaude({ plugins: ['foo@x&calc'], mcp: ['repomix'] });
  report = await discover(null, {});
  const unsafeAddonFinding = report.findings.find((item) => item.type === 'plugin' && item.scope === 'Just you' && item.name === 'foo@x&calc');
  assert.ok(unsafeAddonFinding, 'the unsafe-named add-on is still listed');
  const unsafeAddonReview = await handlers.get('setup-manager:review-plugin-change')(null, { discoveryId: report.discoveryId, findingId: unsafeAddonFinding.id, action: 'disable' });
  assert.equal(unsafeAddonReview.ok, true, unsafeAddonReview.error);
  const unsafeAddonApplied = await handlers.get('setup-manager:apply-plugin-change')(null, { reviewId: unsafeAddonReview.reviewId });
  assert.equal(unsafeAddonApplied.ok, false);
  assert.match(unsafeAddonApplied.error, /can’t safely pass to Claude Code/);
  assert.deepEqual(JSON.parse(await fsp.readFile(fakeState, 'utf8')).pluginActionCalls, [], 'no enable/disable command runs for an unsafe add-on id');
  await setFakeClaude({ plugins: ['superpowers@superpowers-marketplace'], mcp: ['repomix'] });

  console.log('Inventory main wiring passed: discovery rows, unobserved connections, backup resolutions, verified install recording, record reset, extras removal, and unsafe add-on ids refused.');
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
