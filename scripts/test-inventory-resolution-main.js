#!/usr/bin/env node
// Main-process wiring for add-on and connection duplicates: discovery builds the groups
// from Claude Code's own config files and `plugin list --json`, review plans a resolution
// without letting CLI arguments leave the main process, and apply re-reads the current
// state (check-then-act) before running exactly the reviewed `claude` commands.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccti-resolution-main-'));
const home = path.join(tempRoot, 'home');
const ledgerFile = path.join(tempRoot, 'inventory.json');
const fakeState = path.join(tempRoot, 'fake-claude-state.json');
// Discovery runs several `claude` calls at once, so calls go to an append-only log rather
// than the state file, which only changes on a mutation.
const fakeLog = path.join(tempRoot, 'fake-claude-calls.log');
const claudeJson = path.join(home, '.claude.json');
const handlers = new Map();
let readyCallback;
const originalAppData = process.env.APPDATA;
const originalLocalAppData = process.env.LOCALAPPDATA;
const originalLoad = Module._load;
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

// A Node-based fake `claude`. It keeps MCP definitions and add-on installs in a state file
// and rewrites ~/.claude.json from that state after every change, the way Claude Code does:
// user servers at the top level, local servers under projects[home].
const fakeClaudeScript = `
const fs = require('node:fs');
const statePath = ${JSON.stringify(fakeState)};
const logPath = ${JSON.stringify(fakeLog)};
const claudeJsonPath = ${JSON.stringify(claudeJson)};
const homePath = ${JSON.stringify(home)};
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const argv = process.argv.slice(2);
const [a, b, c] = argv;
function save(mutated) {
  fs.writeFileSync(statePath, JSON.stringify(state));
  if (mutated) fs.writeFileSync(claudeJsonPath, JSON.stringify({ mcpServers: state.userMcp, projects: { [homePath]: { mcpServers: state.localMcp } } }));
}
function scopeArg() {
  const index = argv.indexOf('--scope');
  return index === -1 ? '' : argv[index + 1];
}
fs.appendFileSync(logPath, JSON.stringify({ args: argv.join(' '), cwd: process.cwd() }) + '\\n');
if (a === '--version') { console.log('claude test'); process.exit(0); }
if (a === 'plugin' && b === 'list') {
  if (argv.includes('--json')) {
    if (state.pluginJsonFails) { console.error('json list failed'); process.exit(1); }
    console.log(JSON.stringify(state.plugins.map((p) => ({ id: p.id, version: '1.0.0', scope: p.scope, enabled: p.enabled, installPath: '/cache/' + p.id, projectPath: p.projectPath }))));
    process.exit(0);
  }
  console.log('Installed plugins:\\n');
  for (const p of state.plugins) console.log('  \\u276f ' + p.id + '\\n    Version: 1.0.0\\n    Scope: ' + p.scope + '\\n    Status: ' + (p.enabled ? '\\u2714 enabled' : '\\u2718 disabled') + '\\n');
  process.exit(0);
}
if (a === 'plugin' && b === 'disable') {
  const target = state.plugins.find((p) => p.id === c && p.scope === scopeArg());
  if (!target) { console.error('not installed at that scope'); process.exit(1); }
  target.enabled = false;
  save(true);
  process.exit(0);
}
if (a === 'mcp' && b === 'list') {
  console.log('Checking MCP server health\\u2026\\n');
  for (const name of [...new Set([...Object.keys(state.localMcp), ...Object.keys(state.userMcp)])]) console.log(name + ': npx example - \\u2714 Connected');
  process.exit(0);
}
if (a === 'mcp' && b === 'get') process.exit(state.userMcp[c] || state.localMcp[c] ? 0 : 1);
if (a === 'mcp' && b === 'remove') {
  if (state.mcpRemoveFails) { console.error('Injected remove failure for ' + c); process.exit(1); }
  const scope = scopeArg();
  const bucket = scope === 'user' ? state.userMcp : scope === 'local' && process.cwd() === homePath ? state.localMcp : null;
  if (!bucket || !bucket[c]) { console.error('No MCP server named ' + c + ' at scope ' + scope); process.exit(1); }
  delete bucket[c];
  save(true);
  process.exit(0);
}
process.exit(0);
`;

const playwrightUser = { command: 'npx', args: ['@playwright/mcp'] };
const playwrightLocal = { command: 'npx', args: ['@playwright/mcp@latest'] };
// Mirrors this machine: repomix and playwright at local scope for the home folder, MCP_DOCKER at user scope.
const realWorldLocal = { repomix: { command: 'npx', args: ['-y', 'repomix', '--mcp'] }, playwright: playwrightLocal };
const realWorldUser = { MCP_DOCKER: { command: 'docker', args: ['mcp', 'gateway', 'run'] }, playwright: playwrightUser };

async function setFakeClaude(state) {
  const full = { userMcp: {}, localMcp: {}, plugins: [], pluginJsonFails: false, mcpRemoveFails: false, ...state };
  await fsp.writeFile(fakeLog, '', 'utf8');
  await fsp.writeFile(fakeState, JSON.stringify(full), 'utf8');
  await fsp.writeFile(claudeJson, JSON.stringify({ mcpServers: full.userMcp, projects: { [home]: { mcpServers: full.localMcp } } }), 'utf8');
}

async function updateFakeClaude(change) {
  const state = JSON.parse(await fsp.readFile(fakeState, 'utf8'));
  change(state);
  await fsp.writeFile(fakeState, JSON.stringify(state), 'utf8');
  await fsp.writeFile(claudeJson, JSON.stringify({ mcpServers: state.userMcp, projects: { [home]: { mcpServers: state.localMcp } } }), 'utf8');
}

async function fakeState_() {
  return JSON.parse(await fsp.readFile(fakeState, 'utf8'));
}

async function loggedCalls() {
  return (await fsp.readFile(fakeLog, 'utf8')).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

// Only the commands that can change something; reads (--version, list, get) are left out.
async function changingCalls() {
  return (await loggedCalls()).map((call) => call.args).filter((args) => /^(mcp (remove|add)|plugin (disable|enable|uninstall|install))\b/.test(args));
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

const rowFor = (report, rowId) => report.inventory.rows.find((row) => row.rowId === rowId);
const noCliArgs = (payload) => {
  const text = JSON.stringify(payload);
  assert.doesNotMatch(text, /--scope|"args"|mcp remove|plugin disable/, `no CLI arguments may leave the main process: ${text}`);
};

async function run() {
  await fsp.mkdir(home, { recursive: true });
  await installFakeClaude();
  await fsp.writeFile(ledgerFile, JSON.stringify({ schemaVersion: 1, entries: [], resolutions: [] }), 'utf8');
  await setFakeClaude({ userMcp: realWorldUser, localMcp: realWorldLocal });

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require(path.join(root, 'desktop', 'src', 'main.js'));
  await readyCallback();
  const discover = handlers.get('setup-manager:discover');
  const review = handlers.get('inventory:review-resolution');
  const apply = handlers.get('inventory:apply-resolution');
  assert.equal(typeof review, 'function', 'inventory:review-resolution is handled');
  assert.equal(typeof apply, 'function', 'inventory:apply-resolution is handled');

  // Case 1 (Review Focus 1): playwright at local (home) and user scope. Claude Code uses the
  // local copy, so CCTI removes only the user copy, with --scope user.
  let report = await discover(null, {});
  let row = rowFor(report, 'mcp:playwright');
  assert.ok(row, 'the playwright connection has a row');
  assert.equal(row.state, 'duplicate');
  assert.deepEqual(row.resolution, { groupKey: 'mcp:playwright', needsChoice: false, keeper: 0, options: ['Only you, in this folder', 'Just you, everywhere'] });
  assert.deepEqual(row.copies, [{ scope: 'Only you, in this folder', path: '' }, { scope: 'Just you, everywhere', path: '' }]);
  assert.equal(row.resolvable, false, 'resolvable stays skill-only');
  assert.notEqual(rowFor(report, 'mcp:repomix')?.state, 'duplicate', 'a connection defined once is not a duplicate');
  assert.notEqual(rowFor(report, 'mcp:mcp_docker')?.state, 'duplicate');
  let reviewed = await review(null, { discoveryId: report.discoveryId, groupKey: 'mcp:playwright' });
  assert.equal(reviewed.ok, true, reviewed.error);
  noCliArgs(reviewed);
  assert.equal(reviewed.name, 'playwright');
  assert.equal(reviewed.keepLabel, 'Only you, in this folder');
  assert.deepEqual(reviewed.changes.map((change) => Object.keys(change).sort()), [['label', 'undo']]);
  assert.match(reviewed.changes[0].label, /Just you, everywhere/);
  let applied = await apply(null, { reviewId: reviewed.reviewId });
  assert.equal(applied.ok, true, applied.error);
  noCliArgs(applied);
  assert.deepEqual(await changingCalls(), ['mcp remove playwright --scope user'], 'exactly the user copy is removed');
  let state = await fakeState_();
  assert.deepEqual(state.localMcp.playwright, playwrightLocal, 'the local copy Claude Code uses is untouched');
  assert.equal(state.userMcp.playwright, undefined);
  const ledger = JSON.parse(await fsp.readFile(ledgerFile, 'utf8'));
  assert.ok(ledger.resolutions.some((item) => item.kind === 'mcp' && item.key === 'playwright' && item.scope === 'user' && item.action === 'remove'), 'the removal is recorded');
  report = await discover(null, {});
  row = rowFor(report, 'mcp:playwright');
  assert.ok(row, 'playwright still has a row');
  assert.notEqual(row.state, 'duplicate', 'no duplicate after resolving');
  assert.equal(row.resolution, undefined);
  assert.equal((await apply(null, { reviewId: reviewed.reviewId })).ok, false, 'a review applies once');

  // Case 2 (Review Focus 2): the same add-on from two marketplaces, both on. No automatic
  // keeper: the user picks, and CCTI disables (never uninstalls) the other copy.
  await setFakeClaude({
    userMcp: { MCP_DOCKER: realWorldUser.MCP_DOCKER },
    localMcp: { repomix: realWorldLocal.repomix },
    plugins: [{ id: 'foo@market-a', scope: 'user', enabled: true }, { id: 'foo@market-b', scope: 'user', enabled: true }],
  });
  report = await discover(null, {});
  row = rowFor(report, 'plugin:foo');
  assert.ok(row, 'the two installs share one row');
  assert.equal(row.state, 'duplicate');
  assert.deepEqual(row.resolution, { groupKey: 'plugin:foo', needsChoice: true, keeper: null, options: ['market-a (Just you)', 'market-b (Just you)'] });
  assert.equal(report.inventory.rows.filter((item) => item.kind === 'plugin' && /^foo@/.test(item.key)).length, 0, 'the separate install rows are folded into the duplicate row');
  const noChoice = await review(null, { discoveryId: report.discoveryId, groupKey: 'plugin:foo' });
  assert.deepEqual(noChoice, { ok: false, error: 'Choose which copy to keep first.' });
  reviewed = await review(null, { discoveryId: report.discoveryId, groupKey: 'plugin:foo', keep: 1 });
  assert.equal(reviewed.ok, true, reviewed.error);
  noCliArgs(reviewed);
  assert.equal(reviewed.keepLabel, 'market-b (Just you)');
  applied = await apply(null, { reviewId: reviewed.reviewId });
  assert.equal(applied.ok, true, applied.error);
  assert.deepEqual(await changingCalls(), ['plugin disable foo@market-a --scope user']);
  assert.ok(!(await loggedCalls()).some((call) => /uninstall/.test(call.args)), 'CCTI never uninstalls');
  assert.ok(JSON.parse(await fsp.readFile(ledgerFile, 'utf8')).resolutions.some((item) => item.kind === 'plugin' && item.key === 'foo@market-a' && item.scope === 'user' && item.action === 'disable'));
  report = await discover(null, {});
  assert.equal(report.inventory.rows.some((item) => item.state === 'duplicate' && item.kind === 'plugin'), false, 'no add-on duplicate after resolving');

  // Case 3 (Review Focus 3): check-then-act. The user copy is removed in a terminal after
  // the review, so apply changes nothing and says what happened.
  await setFakeClaude({ userMcp: realWorldUser, localMcp: realWorldLocal });
  report = await discover(null, {});
  reviewed = await review(null, { discoveryId: report.discoveryId, groupKey: 'mcp:playwright' });
  assert.equal(reviewed.ok, true, reviewed.error);
  await updateFakeClaude((current) => { delete current.userMcp.playwright; });
  applied = await apply(null, { reviewId: reviewed.reviewId });
  assert.equal(applied.ok, false);
  assert.equal(applied.changed, true);
  assert.match(applied.error, /^This changed since you looked at it, so nothing was changed\./);
  assert.doesNotMatch(applied.error, /checkup/i);
  noCliArgs(applied);
  assert.deepEqual(await changingCalls(), [], 'nothing runs against a stale plan');

  // Case 3b: the user copy's definition changed after review. The group still has two
  // copies, so apply returns a fresh review with the same keeper, which then applies.
  await setFakeClaude({ userMcp: realWorldUser, localMcp: realWorldLocal });
  report = await discover(null, {});
  reviewed = await review(null, { discoveryId: report.discoveryId, groupKey: 'mcp:playwright' });
  await updateFakeClaude((current) => { current.userMcp.playwright = { command: 'npx', args: ['@playwright/mcp', '--headless'] }; });
  applied = await apply(null, { reviewId: reviewed.reviewId });
  assert.equal(applied.ok, false);
  assert.equal(applied.changed, true);
  assert.ok(applied.review && applied.review.reviewId, 'the updated review is returned');
  noCliArgs(applied);
  assert.equal(applied.review.keepLabel, 'Only you, in this folder');
  assert.deepEqual(await changingCalls(), []);
  applied = await apply(null, { reviewId: applied.review.reviewId });
  assert.equal(applied.ok, true, applied.error);
  assert.deepEqual(await changingCalls(), ['mcp remove playwright --scope user']);

  // Case 4: a keeper other than the one Claude Code uses is refused, and nothing runs.
  await setFakeClaude({ userMcp: realWorldUser, localMcp: realWorldLocal });
  report = await discover(null, {});
  const wrongKeep = await review(null, { discoveryId: report.discoveryId, groupKey: 'mcp:playwright', keep: 1 });
  assert.deepEqual(wrongKeep, { ok: false, error: 'CCTI only keeps the copy Claude Code uses for this one.' });
  assert.deepEqual(await changingCalls(), []);

  // Case 5: an unreadable ~/.claude.json never breaks discovery; there are just no
  // connection duplicate groups.
  await setFakeClaude({ userMcp: realWorldUser, localMcp: realWorldLocal });
  await fsp.writeFile(claudeJson, '{ not json', 'utf8');
  report = await discover(null, {});
  assert.ok(report.discoveryId, 'discovery still succeeds');
  assert.equal(report.inventory.rows.some((item) => item.kind === 'mcp' && item.resolution), false, 'no connection duplicate groups');
  const unknownGroup = await review(null, { discoveryId: report.discoveryId, groupKey: 'mcp:playwright' });
  assert.equal(unknownGroup.ok, false);
  assert.match(unknownGroup.error, /Check this computer again/);

  // Case 6: `plugin list --json` failing means no add-on groups, and discovery still succeeds.
  await setFakeClaude({ plugins: [{ id: 'foo@market-a', scope: 'user', enabled: true }, { id: 'foo@market-b', scope: 'user', enabled: true }], pluginJsonFails: true });
  report = await discover(null, {});
  assert.ok(report.discoveryId);
  assert.equal(report.inventory.rows.some((item) => item.kind === 'plugin' && item.resolution), false, 'no add-on groups when the list could not be read');

  // Case 7: the remove command fails. Apply stops, returns a plain next-action message
  // (never the raw stderr), logs stderr to the activity output, and records nothing.
  await setFakeClaude({ userMcp: realWorldUser, localMcp: realWorldLocal, mcpRemoveFails: true });
  const resolutionsBefore = JSON.parse(await fsp.readFile(ledgerFile, 'utf8')).resolutions.length;
  report = await discover(null, {});
  reviewed = await review(null, { discoveryId: report.discoveryId, groupKey: 'mcp:playwright' });
  const emittedBefore = emittedEvents.length;
  applied = await apply(null, { reviewId: reviewed.reviewId });
  assert.equal(applied.ok, false);
  assert.deepEqual(applied.completed, []);
  assert.doesNotMatch(applied.error, /Injected/);
  assert.match(applied.error, /try again/i);
  noCliArgs(applied);
  assert.ok(emittedEvents.slice(emittedBefore).some((event) => event.channel === 'installer:output' && /Injected remove failure/.test(event.payload?.text || '')), 'stderr reaches the activity log');
  assert.equal(JSON.parse(await fsp.readFile(ledgerFile, 'utf8')).resolutions.length, resolutionsBefore, 'a failed change is not recorded');

  // Case 8: while one apply holds the shared action lock, a second apply is refused and
  // runs nothing; the lock is released afterwards.
  await setFakeClaude({ userMcp: realWorldUser, localMcp: realWorldLocal });
  report = await discover(null, {});
  reviewed = await review(null, { discoveryId: report.discoveryId, groupKey: 'mcp:playwright' });
  const first = apply(null, { reviewId: reviewed.reviewId });
  const blocked = await apply(null, { reviewId: reviewed.reviewId });
  assert.deepEqual(blocked, { ok: false, error: 'Another CCTI action is running. Wait for it to finish, then try again.' });
  assert.equal((await first).ok, true);
  assert.deepEqual(await changingCalls(), ['mcp remove playwright --scope user'], 'only the apply that held the lock ran');
  const secondReview = await review(null, { discoveryId: (await discover(null, {})).discoveryId, groupKey: 'mcp:playwright' });
  assert.equal(secondReview.ok, false, 'nothing left to resolve');
  assert.match(secondReview.error, /Check this computer again/);

  // Case 9: Claude Code resolves connections per folder. With a project chosen, a local
  // copy saved for the home folder and the project's .mcp.json copy never meet, so they are
  // not a duplicate; the project copy and a user copy are, and the user copy is removed.
  const project = path.join(tempRoot, 'project');
  await fsp.mkdir(project, { recursive: true });
  await fsp.writeFile(path.join(project, '.mcp.json'), JSON.stringify({ mcpServers: { playwright: playwrightUser, docs: { command: 'npx', args: ['docs-mcp'] } } }), 'utf8');
  await setFakeClaude({ userMcp: { docs: { command: 'npx', args: ['docs-mcp', '--old'] } }, localMcp: { playwright: playwrightLocal } });
  report = await discover(null, { projectPath: project });
  assert.equal(rowFor(report, 'mcp:playwright')?.resolution, undefined, 'a home-folder copy and a project copy are not a duplicate');
  assert.deepEqual(rowFor(report, 'mcp:docs').resolution, { groupKey: 'mcp:docs', needsChoice: false, keeper: 0, options: ['Everyone on this project', 'Just you, everywhere'] });
  reviewed = await review(null, { discoveryId: report.discoveryId, groupKey: 'mcp:docs' });
  assert.equal(reviewed.keepLabel, 'Everyone on this project');
  applied = await apply(null, { reviewId: reviewed.reviewId });
  assert.equal(applied.ok, true, applied.error);
  const removals = (await loggedCalls()).filter((call) => /^mcp remove/.test(call.args));
  assert.deepEqual(removals.map((call) => call.args), ['mcp remove docs --scope user']);
  assert.equal(fs.realpathSync(removals[0].cwd), fs.realpathSync(home), 'a user copy is removed from the home folder');
  assert.ok(JSON.parse(await fsp.readFile(path.join(project, '.mcp.json'), 'utf8')).mcpServers.docs, 'the project copy is untouched');

  console.log('Inventory resolution main wiring passed: local-over-user connection, add-on choice and disable, check-then-act, invalid keeper, unreadable config, failed list, failed change, the action lock, and per-folder grouping.');
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    Module._load = originalLoad;
    if (originalAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = originalAppData;
    if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = originalLocalAppData;
    await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    process.exit(process.exitCode || 0);
  });
