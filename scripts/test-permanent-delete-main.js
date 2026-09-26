#!/usr/bin/env node
// Main-process wiring for permanently deleting turned-off copies: discovery lists add-ons
// Claude Code reports as installed but turned off, and CCTI's skill backups; review stores
// a server-side plan; apply refuses anything but the typed word DELETE, takes the shared
// action lock, re-checks every item (check-then-act), and only then removes a backup folder
// from disk or runs `claude plugin uninstall <id> --scope <scope>` (never --prune).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccti-permanent-delete-main-'));
const home = path.join(tempRoot, 'home');
const project = path.join(tempRoot, 'project');
const outside = path.join(tempRoot, 'outside');
const backupRoot = path.join(home, '.setup-my-claude', 'disabled-skills');
const fakeState = path.join(tempRoot, 'fake-claude-state.json');
const fakeLog = path.join(tempRoot, 'fake-claude-calls.log');
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

// A Node-based fake `claude` that keeps add-on installs in a state file. Like the real CLI,
// a project or local install can only be changed from its own folder, and `uninstall`
// honours --scope. `enableOnList` turns an add-on back on the next time the list is read,
// to simulate someone turning it on between the review and the delete.
const fakeClaudeScript = `
const fs = require('node:fs');
const statePath = ${JSON.stringify(fakeState)};
const logPath = ${JSON.stringify(fakeLog)};
const here = fs.realpathSync(process.cwd());
const inFolder = (folder) => Boolean(folder) && fs.realpathSync(folder) === here;
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const argv = process.argv.slice(2);
const [a, b, c] = argv;
const save = () => fs.writeFileSync(statePath, JSON.stringify(state));
function scopeArg() {
  const index = argv.indexOf('--scope');
  return index === -1 ? 'user' : argv[index + 1];
}
const visible = (p) => p.scope === 'user' || inFolder(p.folder);
fs.appendFileSync(logPath, JSON.stringify({ args: argv.join(' '), cwd: process.cwd() }) + '\\n');
if (a === '--version') { console.log('claude test'); process.exit(0); }
if (a === 'plugin' && b === 'list') {
  if (argv.includes('--json')) {
    if (state.enableOnList) {
      const target = state.plugins.find((p) => p.id === state.enableOnList);
      if (target) target.enabled = true;
      state.enableOnList = '';
      save();
    }
    console.log(JSON.stringify(state.plugins.filter(visible).map((p) => ({ enabled: p.enabled, id: p.id, installPath: '/cache/' + p.id, installedAt: '2026-09-01T00:00:00.000Z', lastUpdated: '2026-09-01T00:00:00.000Z', scope: p.scope, version: '1.0.0' }))));
    process.exit(0);
  }
  console.log('Installed plugins:\\n');
  process.exit(0);
}
if (a === 'plugin' && (b === 'uninstall' || b === 'remove')) {
  const scope = scopeArg();
  const index = state.plugins.findIndex((p) => p.id === c && p.scope === scope && visible(p));
  if (index === -1) { console.error('Plugin ' + c + ' is not installed at scope ' + scope); process.exit(1); }
  state.plugins.splice(index, 1);
  save();
  console.log('Uninstalled ' + c);
  process.exit(0);
}
if (a === 'plugin' && b === 'disable') process.exit(0);
if (a === 'mcp' && b === 'list') { console.log('No MCP servers configured.'); process.exit(0); }
process.exit(0);
`;

async function setFakeClaude(state) {
  await fsp.writeFile(fakeLog, '', 'utf8');
  await fsp.writeFile(fakeState, JSON.stringify({ plugins: [], enableOnList: '', ...state }), 'utf8');
}

async function fakeState_() {
  return JSON.parse(await fsp.readFile(fakeState, 'utf8'));
}

async function loggedCalls() {
  return (await fsp.readFile(fakeLog, 'utf8')).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

async function changingCalls() {
  return (await loggedCalls()).map((call) => call.args).filter((args) => /^plugin (disable|enable|uninstall|remove|install)\b/.test(args));
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

let backupCounter = 0;
async function makeSkillBackup(name, rootFolder = backupRoot) {
  backupCounter += 1;
  const folder = path.join(rootFolder, `${name}-${String(1760000000000 + backupCounter)}-abcdef${String(backupCounter).padStart(2, '0')}`);
  await fsp.mkdir(folder, { recursive: true });
  await fsp.writeFile(path.join(folder, 'SKILL.md'), `---\nname: ${name}\ndescription: test\n---\n`, 'utf8');
  return folder;
}

const noLeaks = (payload) => {
  const text = JSON.stringify(payload);
  assert.doesNotMatch(text, /--scope|plugin uninstall|"args"/, `no CLI arguments may leave the main process: ${text}`);
  assert.ok(!text.includes(tempRoot), `no paths may leave the main process: ${text}`);
};

async function run() {
  await fsp.mkdir(home, { recursive: true });
  await fsp.mkdir(project, { recursive: true });
  await fsp.mkdir(outside, { recursive: true });
  await installFakeClaude();
  await setFakeClaude({});

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require(path.join(root, 'desktop', 'src', 'main.js'));
  await readyCallback();
  const discover = handlers.get('setup-manager:discover');
  const review = handlers.get('setup-manager:review-permanent-delete');
  const apply = handlers.get('setup-manager:apply-permanent-delete');
  assert.equal(typeof review, 'function', 'setup-manager:review-permanent-delete is handled');
  assert.equal(typeof apply, 'function', 'setup-manager:apply-permanent-delete is handled');

  // Case 1: discovery lists turned-off user, project, and local add-ons (a project was
  // checked), never an enabled one, a synced one, or a managed one.
  await setFakeClaude({ plugins: [
    { id: 'Foo@market-a', scope: 'user', enabled: false },
    { id: 'on@market-a', scope: 'user', enabled: true },
    { id: 'figma@synced', scope: 'synced', enabled: false },
    { id: 'policy@corp', scope: 'managed', enabled: false },
    { id: 'team@m', scope: 'project', enabled: false, folder: project },
    { id: 'mine@m', scope: 'local', enabled: false, folder: project },
  ] });
  let report = await discover(null, { projectPath: project });
  assert.deepEqual(report.turnedOff.addOns.map(({ name, marketplace, scopeLabel }) => ({ name, marketplace, scopeLabel })), [
    { name: 'foo', marketplace: 'market-a', scopeLabel: 'Just you' },
    { name: 'team', marketplace: 'm', scopeLabel: 'This project' },
    { name: 'mine', marketplace: 'm', scopeLabel: 'Only you in this project' },
  ]);
  assert.deepEqual(report.turnedOff.skillBackups, []);
  noLeaks(report.turnedOff);

  // Case 1b: with no project checked, project and local installs have no known folder, so
  // they are not offered.
  report = await discover(null, {});
  assert.deepEqual(report.turnedOff.addOns.map((item) => item.name), ['foo']);

  // Case 2: typed confirmation other than DELETE changes nothing and runs no command; the
  // review is still usable afterwards.
  let fooItem = report.turnedOff.addOns[0];
  let reviewed = await review(null, { discoveryId: report.discoveryId, items: [{ kind: 'add-on', findingId: fooItem.findingId }] });
  assert.equal(reviewed.ok, true, reviewed.error);
  noLeaks(reviewed);
  assert.deepEqual(reviewed.items, [{ label: 'Add-on foo from market-a (Just you)' }]);
  assert.match(reviewed.warning, /cannot be undone/);
  for (const confirmation of ['delete', '', 'DELETE ', ' DELETE', 'Delete', undefined, 'UNINSTALL CCTI']) {
    const refused = await apply(null, { reviewId: reviewed.reviewId, confirmation });
    assert.deepEqual(refused, { ok: false, error: 'Type DELETE in capital letters to confirm. Nothing was deleted.' }, `confirmation ${JSON.stringify(confirmation)} is refused`);
  }
  assert.deepEqual(await changingCalls(), [], 'no command runs without DELETE');
  assert.ok((await fakeState_()).plugins.some((p) => p.id === 'Foo@market-a'), 'the add-on is still installed');

  // Case 3: review + apply with DELETE uninstalls the turned-off add-on by its original-case
  // id at its own scope, from the home folder, with no --prune; afterwards it is gone.
  let applied = await apply(null, { reviewId: reviewed.reviewId, confirmation: 'DELETE' });
  assert.equal(applied.ok, true, applied.error);
  noLeaks(applied);
  assert.equal(applied.message, 'Permanently deleted 1 turned-off copy.');
  assert.deepEqual(await changingCalls(), ['plugin uninstall Foo@market-a --scope user']);
  assert.ok(!(await loggedCalls()).some((call) => /--prune/.test(call.args)), 'never --prune');
  const uninstallCall = (await loggedCalls()).find((call) => /^plugin uninstall/.test(call.args));
  assert.equal(fs.realpathSync(uninstallCall.cwd), fs.realpathSync(home));
  assert.equal((await fakeState_()).plugins.some((p) => p.id === 'Foo@market-a'), false, 'the add-on is gone');
  assert.ok((await fakeState_()).plugins.some((p) => p.id === 'on@market-a'), 'the enabled add-on is untouched');
  assert.ok(emittedEvents.some((event) => event.channel === 'installer:output' && /claude plugin uninstall Foo@market-a --scope user/.test(event.payload?.text || '')), 'the exact command reaches the activity log');

  // Case 4: a review applies once.
  assert.deepEqual(await apply(null, { reviewId: reviewed.reviewId, confirmation: 'DELETE' }), { ok: false, error: 'This review is no longer available, so nothing was deleted. Check this computer again, then review the turned-off copies again.' });
  assert.deepEqual(await changingCalls(), ['plugin uninstall Foo@market-a --scope user']);

  // Case 5: a local add-on in the checked project is uninstalled from that project folder.
  report = await discover(null, { projectPath: project });
  const mineItem = report.turnedOff.addOns.find((item) => item.name === 'mine');
  await fsp.writeFile(fakeLog, '', 'utf8');
  reviewed = await review(null, { discoveryId: report.discoveryId, items: [{ kind: 'add-on', findingId: mineItem.findingId }] });
  applied = await apply(null, { reviewId: reviewed.reviewId, confirmation: 'DELETE' });
  assert.equal(applied.ok, true, applied.error);
  assert.deepEqual(await changingCalls(), ['plugin uninstall mine@m --scope local']);
  assert.equal(fs.realpathSync((await loggedCalls()).find((call) => /^plugin uninstall/.test(call.args)).cwd), fs.realpathSync(project));
  assert.equal((await fakeState_()).plugins.some((p) => p.id === 'mine@m'), false);

  // Case 6: an add-on turned back on between review and apply is NOT uninstalled.
  await setFakeClaude({ plugins: [{ id: 'bar@m', scope: 'user', enabled: false }] });
  report = await discover(null, {});
  reviewed = await review(null, { discoveryId: report.discoveryId, items: [{ kind: 'add-on', findingId: report.turnedOff.addOns[0].findingId }] });
  await fsp.writeFile(fakeState, JSON.stringify({ ...(await fakeState_()), enableOnList: 'bar@m' }), 'utf8');
  applied = await apply(null, { reviewId: reviewed.reviewId, confirmation: 'DELETE' });
  assert.equal(applied.ok, true, applied.error);
  assert.match(applied.message, /^Nothing was deleted\. Add-on bar from m \(Just you\) was turned back on, so CCTI left it installed\.$/);
  assert.deepEqual(await changingCalls(), [], 'an enabled add-on is never uninstalled');
  assert.equal((await fakeState_()).plugins[0].enabled, true);

  // Case 7: an unsafe add-on id never reaches the CLI. It is not offered, and a review that
  // guesses its id is refused.
  await setFakeClaude({ plugins: [{ id: 'evil@m&calc', scope: 'user', enabled: false }] });
  report = await discover(null, {});
  assert.deepEqual(report.turnedOff.addOns, [], 'an unsafe id is not offered');
  const guessed = await review(null, { discoveryId: report.discoveryId, items: [{ kind: 'add-on', findingId: 'add-on-off:user:evil@m&calc' }] });
  assert.equal(guessed.ok, false);
  assert.match(guessed.error, /Check this computer again/);
  assert.deepEqual(await changingCalls(), [], 'no uninstall ran for an unsafe id');

  // Case 8: a skill backup folder is deleted from disk.
  await setFakeClaude({});
  const keepBackup = await makeSkillBackup('keep-me');
  const doomedBackup = await makeSkillBackup('old-helper');
  report = await discover(null, {});
  const backupNames = report.turnedOff.skillBackups.map((item) => item.name).sort();
  assert.deepEqual(backupNames, ['keep-me', 'old-helper']);
  assert.ok(report.turnedOff.skillBackups.every((item) => item.scopeLabel === 'Just you'));
  // A backup's finding id is the same id the existing backup rows already carry; nothing else
  // about the path is added.
  assert.deepEqual(Object.keys(report.turnedOff.skillBackups[0]).sort(), ['findingId', 'name', 'scopeLabel']);
  assert.ok(report.turnedOff.skillBackups.every((item) => report.findings.some((finding) => finding.id === item.findingId && finding.type === 'skill-backup')));
  let doomed = report.turnedOff.skillBackups.find((item) => item.name === 'old-helper');
  reviewed = await review(null, { discoveryId: report.discoveryId, items: [{ kind: 'skill-backup', findingId: doomed.findingId }] });
  assert.equal(reviewed.ok, true, reviewed.error);
  noLeaks(reviewed);
  assert.deepEqual(reviewed.items, [{ label: 'Skill backup old-helper (Just you)' }]);
  applied = await apply(null, { reviewId: reviewed.reviewId, confirmation: 'DELETE' });
  assert.equal(applied.ok, true, applied.error);
  assert.equal(fs.existsSync(doomedBackup), false, 'the backup folder is gone');
  assert.equal(fs.existsSync(keepBackup), true, 'the other backup is untouched');
  report = await discover(null, {});
  assert.deepEqual(report.turnedOff.skillBackups.map((item) => item.name), ['keep-me']);

  // Case 9: a backup replaced by a symlink after review is refused, and its target survives.
  const linkedBackup = await makeSkillBackup('linked');
  report = await discover(null, {});
  doomed = report.turnedOff.skillBackups.find((item) => item.name === 'linked');
  reviewed = await review(null, { discoveryId: report.discoveryId, items: [{ kind: 'skill-backup', findingId: doomed.findingId }] });
  await fsp.rm(linkedBackup, { recursive: true });
  const outsideTarget = path.join(outside, 'precious');
  await fsp.mkdir(outsideTarget, { recursive: true });
  await fsp.writeFile(path.join(outsideTarget, 'keep.txt'), 'keep', 'utf8');
  await fsp.symlink(outsideTarget, linkedBackup, process.platform === 'win32' ? 'junction' : 'dir');
  applied = await apply(null, { reviewId: reviewed.reviewId, confirmation: 'DELETE' });
  assert.equal(applied.ok, false);
  assert.match(applied.error, /not a plain folder inside CCTI’s backup folder/);
  noLeaks(applied);
  assert.equal(fs.existsSync(path.join(outsideTarget, 'keep.txt')), true, 'the symlink target is untouched');
  assert.equal(fs.lstatSync(linkedBackup).isSymbolicLink(), true, 'the symlink itself is left alone');
  await fsp.rm(linkedBackup);

  // Case 10: the backup root itself is swapped for a link to another folder after review, so
  // the reviewed path now resolves outside CCTI's backup folder. It is refused.
  const outsideBackup = await makeSkillBackup('elsewhere');
  report = await discover(null, {});
  doomed = report.turnedOff.skillBackups.find((item) => item.name === 'elsewhere');
  reviewed = await review(null, { discoveryId: report.discoveryId, items: [{ kind: 'skill-backup', findingId: doomed.findingId }] });
  const movedRoot = path.join(outside, 'moved-root');
  await fsp.rename(backupRoot, movedRoot);
  await fsp.symlink(movedRoot, backupRoot, process.platform === 'win32' ? 'junction' : 'dir');
  applied = await apply(null, { reviewId: reviewed.reviewId, confirmation: 'DELETE' });
  assert.equal(applied.ok, false, 'a path outside the backup root is refused');
  assert.match(applied.error, /not a plain folder inside CCTI’s backup folder/);
  assert.equal(fs.existsSync(path.join(movedRoot, path.basename(outsideBackup), 'SKILL.md')), true, 'the folder outside the backup root is untouched');
  await fsp.rm(backupRoot);
  await fsp.rename(movedRoot, backupRoot);

  // Case 11: items run one by one and stop at the first failure, reporting what was done.
  await setFakeClaude({ plugins: [{ id: 'first@m', scope: 'user', enabled: false }] });
  const brokenBackup = await makeSkillBackup('broken');
  report = await discover(null, {});
  const firstAddOn = report.turnedOff.addOns[0];
  const broken = report.turnedOff.skillBackups.find((item) => item.name === 'broken');
  const kept = report.turnedOff.skillBackups.find((item) => item.name === 'keep-me');
  reviewed = await review(null, { discoveryId: report.discoveryId, items: [
    { kind: 'add-on', findingId: firstAddOn.findingId },
    { kind: 'skill-backup', findingId: broken.findingId },
    { kind: 'skill-backup', findingId: kept.findingId },
  ] });
  assert.equal(reviewed.items.length, 3);
  await fsp.rm(brokenBackup, { recursive: true });
  applied = await apply(null, { reviewId: reviewed.reviewId, confirmation: 'DELETE' });
  assert.equal(applied.ok, false);
  assert.deepEqual(applied.completed, ['Add-on first from m (Just you)']);
  assert.match(applied.error, /no longer where CCTI found it.*1 of 3 copies were deleted before CCTI stopped\./);
  assert.equal(fs.existsSync(keepBackup), true, 'nothing after the failure is deleted');

  // Case 12: the action lock blocks a concurrent apply, and only the first apply runs.
  await setFakeClaude({ plugins: [{ id: 'locked@m', scope: 'user', enabled: false }] });
  report = await discover(null, {});
  reviewed = await review(null, { discoveryId: report.discoveryId, items: [{ kind: 'add-on', findingId: report.turnedOff.addOns[0].findingId }] });
  const second = await review(null, { discoveryId: report.discoveryId, items: [{ kind: 'skill-backup', findingId: kept.findingId }] });
  const first = apply(null, { reviewId: reviewed.reviewId, confirmation: 'DELETE' });
  const blocked = await apply(null, { reviewId: second.reviewId, confirmation: 'DELETE' });
  assert.deepEqual(blocked, { ok: false, error: 'Another CCTI action is running. Wait for it to finish, then try again.' });
  assert.equal((await first).ok, true);
  assert.deepEqual(await changingCalls(), ['plugin uninstall locked@m --scope user']);
  assert.equal(fs.existsSync(keepBackup), true, 'the blocked apply deleted nothing');
  const afterLock = await apply(null, { reviewId: second.reviewId, confirmation: 'DELETE' });
  assert.equal(afterLock.ok, true, 'the blocked review can run once the lock is released');
  assert.equal(fs.existsSync(keepBackup), false);

  // Case 13: review refuses unknown items and an unknown discovery.
  assert.equal((await review(null, { discoveryId: 'nope', items: [{ kind: 'add-on', findingId: 'x' }] })).ok, false);
  assert.equal((await review(null, { discoveryId: report.discoveryId, items: [] })).ok, false);
  assert.equal((await review(null, { discoveryId: report.discoveryId, items: [{ kind: 'mcp', findingId: 'x' }] })).ok, false);

  console.log('Permanent delete main wiring passed: turned-off add-ons listed by scope, typed DELETE enforced in the main process, uninstall without --prune from the right folder, turned-back-on add-ons skipped, unsafe ids kept from the CLI, backup folders deleted, symlinks and paths outside the backup root refused, stop at first failure, a review applies once, and the action lock.');
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
