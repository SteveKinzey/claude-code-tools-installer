#!/usr/bin/env node
// Focused main-process regression fixture. All commands are stubbed; temporary homes only.
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { cmdQuote } = require('../desktop/src/windows-command');
delete require.cache[require.resolve('../desktop/src/windows-command')];

const root = path.resolve(__dirname, '..');
const fixtureRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccti-desktop-hardening-')));
const home = path.join(fixtureRoot, 'home');
const project = path.join(fixtureRoot, 'project');
const outside = path.join(fixtureRoot, 'outside');
const skillRoot = path.join(home, '.claude', 'skills');
const backupRoot = path.join(home, '.setup-my-claude', 'disabled-skills');
const handlers = new Map();
const spawns = [];
const emitted = [];
let readyCallback;
let npmBehavior = 'bounded-output';
let lastNpmChild = null;
const originalLoad = Module._load;
const originalPath = process.env.PATH;
const originalNpmConfig = process.env.NPM_CONFIG_UNSAFE_FIXTURE;

function childProcess() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.killSignals = [];
  child.kill = (signal) => {
    child.killed = true;
    child.killSignals.push(signal);
    if (npmBehavior === 'timeout-force-close' && signal === 'SIGKILL') {
      queueMicrotask(() => child.emit('close', -1));
    }
    if (npmBehavior === 'timeout-kill-error' || npmBehavior === 'timeout-error-later-close') {
      queueMicrotask(() => child.emit('error', new Error(`fixture ${signal} failed`)));
      if (npmBehavior === 'timeout-error-later-close' && signal === 'SIGKILL') {
        queueMicrotask(() => child.emit('close', -1));
      }
      return false;
    }
    return true;
  };
  return child;
}

function spawnStub(command, args = [], options = {}) {
  const child = childProcess();
  spawns.push({ command, args, options, child });
  const isNpm = /npm(?:\.cmd)?$/i.test(path.basename(String(command))) || (options.shell === true && /^"[^"]+[\\/]npm\.cmd"\s/i.test(String(command)));
  if (!isNpm) {
    queueMicrotask(() => child.emit('close', 0));
    return child;
  }
  lastNpmChild = child;
  if (npmBehavior === 'bounded-output') {
    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.alloc(300 * 1024, 'x'));
      child.emit('close', 0);
    });
  } else if (npmBehavior === 'unicode-output') {
    queueMicrotask(() => {
      const character = Buffer.from('€');
      child.stdout.emit('data', character.subarray(0, 1));
      child.stderr.emit('data', Buffer.from('ñ'));
      child.stdout.emit('data', character.subarray(1));
      child.stdout.emit('data', Buffer.alloc(256 * 1024 - 6, 'x'));
      child.stdout.emit('data', character);
      child.stdout.emit('end');
      child.stderr.emit('end');
      child.emit('close', 0);
    });
  } else if (npmBehavior === 'success') {
    queueMicrotask(() => child.emit('close', 0));
  }
  return child;
}

const electronStub = {
  app: {
    getPath: (name) => name === 'home' ? home : fixtureRoot,
    getVersion: () => '0.0.0-test',
    isPackaged: false,
    whenReady: () => ({ then: (callback) => { readyCallback = callback; } }),
    on: () => {},
    quit: () => {},
  },
  BrowserWindow: class {
    static getAllWindows() { return []; }
    constructor() {
      this.webContents = { send: (channel, payload) => emitted.push({ channel, payload }), setWindowOpenHandler: () => {}, on: () => {} };
    }
    async loadFile() {}
    isDestroyed() { return false; }
  },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true, filePath: '' }) },
  shell: { openExternal: async () => {}, openPath: async () => '', showItemInFolder: () => true },
  Notification: class { static isSupported() { return false; } },
  ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
};

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') return electronStub;
  if (request === 'node:child_process') return { ...originalLoad.call(this, request, parent, isMain), spawn: spawnStub };
  return originalLoad.call(this, request, parent, isMain);
};

async function writeSkill(folder, name) {
  await fsp.mkdir(folder, { recursive: true });
  await fsp.writeFile(path.join(folder, 'SKILL.md'), `# ${name}\n`, 'utf8');
}

async function replaceWithLink(folder, movedFolder) {
  await fsp.rename(folder, movedFolder);
  await fsp.symlink(movedFolder, folder, process.platform === 'win32' ? 'junction' : 'dir');
}

async function restoreLinkedFolder(folder, movedFolder) {
  await fsp.rm(folder, { recursive: true, force: true });
  await fsp.rename(movedFolder, folder);
}

async function run() {
  try {
    await Promise.all([fsp.mkdir(home, { recursive: true }), fsp.mkdir(project, { recursive: true }), fsp.mkdir(outside, { recursive: true })]);
    await fsp.writeFile(path.join(project, 'package.json'), JSON.stringify({ name: 'untrusted-project', scripts: { preinstall: 'touch SHOULD-NOT-RUN', postinstall: 'touch SHOULD-NOT-RUN' } }), 'utf8');
    await fsp.writeFile(path.join(project, '.npmrc'), 'global=true\nprefix=/tmp/not-ccti\nignore-scripts=false\n', 'utf8');
    process.env.PATH = `.${path.delimiter}${originalPath || ''}`;
    process.env.NPM_CONFIG_UNSAFE_FIXTURE = 'must-not-reach-component-npm';

    require(path.join(root, 'desktop', 'src', 'main.js'));
    await readyCallback();
    const preview = handlers.get('components:preview');
    const install = handlers.get('components:install');
    const runtimePaths = handlers.get('diagnostics:get-runtime-paths');
    const discover = handlers.get('setup-manager:discover');
    const reviewCleanup = handlers.get('setup-manager:review-cleanup');
    const applyCleanup = handlers.get('setup-manager:apply-cleanup');
    const reviewRestore = handlers.get('setup-manager:review-all-skill-backups');
    const applyRestore = handlers.get('setup-manager:apply-all-skill-backups');
    const reviewReplacement = handlers.get('setup-manager:review-skill-backup-replacement');
    const applyReplacement = handlers.get('setup-manager:apply-skill-backup-replacement');
    assert.ok(preview && install && runtimePaths && discover && reviewCleanup && applyCleanup && reviewRestore && applyRestore && reviewReplacement && applyReplacement, 'all focused handlers are registered');

    const componentId = JSON.parse(await fsp.readFile(path.join(root, 'desktop', 'convex-components.json'), 'utf8')).components[0].id;
    const hostilePreview = await preview(null, { projectPath: project, componentIds: [componentId] });
    assert.equal(hostilePreview.ok, false);
    assert.match(hostilePreview.error, /\.npmrc configuration file/);
    const beforeBlocked = spawns.length;
    const hostileInstall = await install(null, { projectPath: project, componentIds: [componentId], dryRun: false });
    assert.equal(hostileInstall.ok, false);
    assert.equal(spawns.length, beforeBlocked, 'project npmrc refusal occurs before any prerequisite or npm launch');
    assert.equal(await fsp.readFile(path.join(project, '.npmrc'), 'utf8'), 'global=true\nprefix=/tmp/not-ccti\nignore-scripts=false\n');
    await fsp.rm(path.join(project, '.npmrc'));
    const planned = await preview(null, { projectPath: project, componentIds: [componentId] });
    assert.equal(planned.ok, true, planned.error);
    assert.match(planned.command, /--prefix/);
    assert.match(planned.command, /--global=false/);
    assert.match(planned.command, /--ignore-scripts/);
    assert.match(planned.command, /--userconfig/);
    assert.match(planned.command, /--cache/);
    const previewQuote = (value) => process.platform === 'win32' ? `"${value}"` : `'${value.replaceAll("'", "'\"'\"'")}'`;
    assert.ok(planned.command.includes(`--prefix ${previewQuote(project)}`), 'the selected project path is quoted in the reviewed npm command');
    assert.ok(planned.command.includes(`--userconfig ${previewQuote(path.join(home, '.setup-my-claude', 'component-npm', 'npmrc'))}`), 'the CCTI-owned user config path is quoted in the reviewed npm command');
    assert.match(planned.note, /lifecycle scripts disabled/i);
    assert.match(planned.note, /global installs disabled/i);

    const paths = await runtimePaths();
    assert.equal(paths.cctiCommandPath.split(path.delimiter).includes('.'), false, 'relative POSIX PATH entries are removed before process launch');

    const installed = await install(null, { projectPath: project, componentIds: [componentId], dryRun: false });
    assert.equal(installed.ok, true, installed.error);
    const npmSpawn = spawns.findLast((entry) => entry.child === lastNpmChild);
    assert.ok(npmSpawn, 'the fixture recognizes both direct npm and the safe Windows shell wrapper');
    const expectedArgs = ['--prefix', project, '--global=false', '--ignore-scripts', '--userconfig', path.join(home, '.setup-my-claude', 'component-npm', 'npmrc'), '--cache', path.join(home, '.setup-my-claude', 'component-npm', 'cache'), 'install'];
    if (process.platform === 'win32') {
      assert.equal(npmSpawn.options.shell, true);
      const executable = npmSpawn.command.match(/^"([^"]+)" /)?.[1];
      assert.ok(executable && path.isAbsolute(executable), 'Windows npm wrapper starts a vetted absolute npm.cmd');
      assert.ok(npmSpawn.command.startsWith(`${cmdQuote(executable)} ${expectedArgs.map(cmdQuote).join(' ')}`));
      assert.deepEqual(npmSpawn.args, []);
    } else {
      assert.ok(path.isAbsolute(npmSpawn.command), 'component npm resolves to an absolute executable');
      assert.deepEqual(npmSpawn.args.slice(0, 9), expectedArgs);
    }
    assert.equal(Object.keys(npmSpawn.options.env).some((key) => key.toLowerCase().startsWith('npm_config_')), false, 'inherited npm policy does not reach component npm');
    assert.equal(await fsp.readFile(path.join(home, '.setup-my-claude', 'component-npm', 'npmrc'), 'utf8'), '', 'the CCTI npm user config is empty for the run');
    assert.equal(fs.existsSync(path.join(project, 'SHOULD-NOT-RUN')), false, 'fixture lifecycle markers never run');
    const componentOutput = emitted.filter((entry) => entry.channel === 'component:output').map((entry) => String(entry.payload?.text || '')).join('');
    assert.ok(Buffer.byteLength(componentOutput, 'utf8') <= 256 * 1024 + 200, 'component output is bounded with a short truncation notice');
    assert.match(componentOutput, /output was truncated/i);

    const beforeUnicode = emitted.length;
    npmBehavior = 'unicode-output';
    assert.equal((await install(null, { projectPath: project, componentIds: [componentId], dryRun: false })).ok, true);
    const unicodeEvents = emitted.slice(beforeUnicode).filter((entry) => entry.channel === 'component:output');
    const unicodeText = unicodeEvents.map((entry) => entry.payload.text).join('');
    assert.match(unicodeText, /€/);
    assert.match(unicodeText, /ñ/);
    assert.doesNotMatch(unicodeText, /\uFFFD/, 'split stream chunks and cap boundaries must preserve complete UTF-8 characters');
    assert.ok(Buffer.byteLength(unicodeText, 'utf8') <= 256 * 1024 + 200);

    // No write/chmod may follow a planted npmrc inode. Existing valid config is atomically reset.
    npmBehavior = 'success';
    const configRoot = path.join(home, '.setup-my-claude', 'component-npm');
    const configFile = path.join(configRoot, 'npmrc');
    const configCache = path.join(configRoot, 'cache');
    const sentinel = path.join(outside, 'npmrc-sentinel');
    await fsp.writeFile(sentinel, 'must not be truncated');
    const sentinelMode = (await fsp.stat(sentinel)).mode;
    const assertConfigRefused = async (label) => {
      const previousChild = lastNpmChild;
      const result = await install(null, { projectPath: project, componentIds: [componentId], dryRun: false });
      assert.equal(result.ok, false, label);
      assert.equal(lastNpmChild, previousChild, `${label}: npm must not start`);
      assert.equal(await fsp.readFile(sentinel, 'utf8'), 'must not be truncated', `${label}: sentinel content preserved`);
      assert.equal((await fsp.stat(sentinel)).mode, sentinelMode, `${label}: sentinel mode preserved`);
    };
    await fsp.unlink(configFile);
    await fsp.link(sentinel, configFile);
    await assertConfigRefused('hard-linked npmrc');
    await fsp.unlink(configFile);
    if (process.platform !== 'win32') {
      await fsp.symlink(sentinel, configFile);
      await assertConfigRefused('symlinked npmrc');
      await fsp.unlink(configFile);
    }
    for (const folder of [configRoot, configCache, path.dirname(configRoot)]) {
      const moved = path.join(outside, `linked-config-${path.basename(folder)}`);
      await replaceWithLink(folder, moved);
      await assertConfigRefused(`linked config ancestor/cache ${folder}`);
      await restoreLinkedFolder(folder, moved);
    }
    await fsp.writeFile(configFile, 'unreviewed saved policy');
    const oldConfig = await fsp.stat(configFile);
    assert.equal((await install(null, { projectPath: project, componentIds: [componentId], dryRun: false })).ok, true);
    assert.equal(await fsp.readFile(configFile, 'utf8'), '');
    assert.notEqual((await fsp.stat(configFile)).ino, oldConfig.ino, 'config reset publishes a new inode rather than truncating the old file');
    if (process.platform !== 'win32') assert.equal((await fsp.stat(configFile)).mode & 0o777, 0o600);

    // Inject a destination hard link after exclusive temp creation but before publication.
    const originalOpen = fsp.open;
    let swappedConfig = false;
    fsp.open = async (file, ...args) => {
      const handle = await originalOpen(file, ...args);
      if (path.dirname(file) === configRoot && path.basename(file).startsWith('.npmrc-')) {
        swappedConfig = true;
        await fsp.unlink(configFile);
        await fsp.link(sentinel, configFile);
      }
      return handle;
    };
    try { await assertConfigRefused('npmrc swapped to hard link during preparation'); }
    finally { fsp.open = originalOpen; }
    assert.equal(swappedConfig, true, 'race fixture reached exclusive config creation');
    await fsp.unlink(configFile);
    assert.deepEqual((await fsp.readdir(configRoot)).filter(name => name.endsWith('.tmp')), [], 'failed config preparation cleans its own temporary file');

    // Inject a parent junction/symlink after creation; identity checks must stop before rename.
    const movedRaceRoot = path.join(outside, 'config-root-race');
    let swappedRoot = false;
    fsp.open = async (file, ...args) => {
      const handle = await originalOpen(file, ...args);
      if (path.dirname(file) === configRoot && path.basename(file).startsWith('.npmrc-')) {
        swappedRoot = true;
        await replaceWithLink(configRoot, movedRaceRoot);
      }
      return handle;
    };
    try { await assertConfigRefused('config root swapped during preparation'); }
    finally { fsp.open = originalOpen; if (swappedRoot) await restoreLinkedFolder(configRoot, movedRaceRoot); }
    assert.equal(swappedRoot, true);
    // Changed-ancestor cleanup deliberately leaves the harmless empty temp rather than following it.
    for (const name of await fsp.readdir(configRoot)) if (name.endsWith('.tmp')) await fsp.unlink(path.join(configRoot, name));

    npmBehavior = 'timeout-kill-error';
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = (callback, delay, ...args) => [10 * 60 * 1000, 5_000, 1_000].includes(delay)
      ? originalSetTimeout(callback, 5, ...args)
      : originalSetTimeout(callback, delay, ...args);
    let timedOut;
    try {
      timedOut = await install(null, { projectPath: project, componentIds: [componentId], dryRun: false });
    } finally {
      global.setTimeout = originalSetTimeout;
    }
    assert.equal(timedOut.ok, false);
    assert.match(timedOut.error, /timed out after 10 minutes/i);
    assert.match(timedOut.error, /lock remains active/i, 'a non-exited npm child keeps the component lock');
    assert.match(timedOut.error, /lock remains active/i, 'failed SIGTERM and SIGKILL errors never release the lock before close');
    assert.equal(lastNpmChild.killed, true, 'the timed-out component child receives termination');
    assert.deepEqual(lastNpmChild.killSignals, ['SIGTERM', 'SIGKILL'], 'the timeout gives npm a minimal graceful stop window before SIGKILL');
    const stillRunningNpmChild = lastNpmChild;
    const blockedAfterTimeout = await install(null, { projectPath: project, componentIds: [componentId], dryRun: false });
    assert.equal(blockedAfterTimeout.ok, false, 'a still-running timed-out npm child cannot be overlapped by another install');
    assert.match(blockedAfterTimeout.error, /already running/i);
    stillRunningNpmChild.emit('close', -1);
    await new Promise((resolve) => setImmediate(resolve));
    npmBehavior = 'success';
    const afterTimeout = await install(null, { projectPath: project, componentIds: [componentId], dryRun: false });
    assert.equal(afterTimeout.ok, true, 'the component lock is released only after the old npm child closes');

    npmBehavior = 'timeout-error-later-close';
    global.setTimeout = (callback, delay, ...args) => [10 * 60 * 1000, 5_000, 1_000].includes(delay)
      ? originalSetTimeout(callback, 5, ...args) : originalSetTimeout(callback, delay, ...args);
    let closedTimeout;
    try { closedTimeout = await install(null, { projectPath: project, componentIds: [componentId], dryRun: false }); }
    finally { global.setTimeout = originalSetTimeout; }
    assert.equal(closedTimeout.ok, false);
    if (process.platform === 'win32') {
      assert.match(closedTimeout.error, /Windows command wrapper/);
      assert.match(closedTimeout.error, /npm may still be running/);
      assert.doesNotMatch(closedTimeout.error, /CCTI stopped npm/);
    } else {
      assert.match(closedTimeout.error, /CCTI stopped npm/);
    }
    assert.deepEqual(lastNpmChild.killSignals, ['SIGTERM', 'SIGKILL'], 'post-timeout error does not cancel escalation before later close');
    npmBehavior = 'success';
    assert.equal((await install(null, { projectPath: project, componentIds: [componentId], dryRun: false })).ok, true, 'later close unlocks a retry after failed termination signals');

    // Cleanup destination root: a CCTI backup folder swapped to a link after review is refused.
    await writeSkill(path.join(skillRoot, 'cleanup-skill'), 'cleanup');
    await fsp.mkdir(backupRoot, { recursive: true });
    let report = await discover(null, {});
    const cleanupFinding = report.findings.find((item) => item.type === 'skill' && item.name === 'cleanup-skill');
    const cleanupPlan = await reviewCleanup(null, { discoveryId: report.discoveryId, findingId: cleanupFinding.id });
    const movedBackupRoot = path.join(outside, 'cleanup-backup-root');
    await replaceWithLink(backupRoot, movedBackupRoot);
    const cleanupResult = await applyCleanup(null, { reviewId: cleanupPlan.reviewId });
    assert.equal(cleanupResult.ok, false, 'cleanup refuses a linked backup root');
    assert.equal(fs.existsSync(path.join(skillRoot, 'cleanup-skill', 'SKILL.md')), true, 'cleanup leaves the active skill in place');
    await restoreLinkedFolder(backupRoot, movedBackupRoot);

    // Restore source root: a selected backup swapped to a link after review is refused.
    const restoreBackup = path.join(backupRoot, 'restore-skill-1760000000001-abcdef12');
    await writeSkill(restoreBackup, 'restore');
    report = await discover(null, {});
    const restorePlan = await reviewRestore(null, { discoveryId: report.discoveryId });
    const movedRestoreBackup = path.join(outside, 'restore-backup');
    await fsp.rename(restoreBackup, movedRestoreBackup);
    await fsp.symlink(movedRestoreBackup, restoreBackup, process.platform === 'win32' ? 'junction' : 'dir');
    const restoreResult = await applyRestore(null, { reviewId: restorePlan.reviewId });
    assert.equal(restoreResult.ok, false, 'restore refuses a backup source swapped to a link');
    assert.equal(fs.existsSync(path.join(movedRestoreBackup, 'SKILL.md')), true, 'restore does not follow the linked backup target');
    await fsp.rm(restoreBackup);
    await fsp.rename(movedRestoreBackup, restoreBackup);

    // Replacement source/destination roots: a skills root swapped to a link is refused before
    // either rename, preserving both the active and saved copies.
    const activeReplace = path.join(skillRoot, 'replace-skill');
    const replaceBackup = path.join(backupRoot, 'replace-skill-1760000000002-abcdef13');
    await Promise.all([writeSkill(activeReplace, 'active replacement'), writeSkill(replaceBackup, 'saved replacement')]);
    report = await discover(null, {});
    const replacementBackup = report.findings.find((item) => item.type === 'skill-backup' && item.path === replaceBackup);
    const replacementPlan = await reviewReplacement(null, { discoveryId: report.discoveryId, backupId: replacementBackup.id });
    assert.equal(replacementPlan.ok, true, replacementPlan.error);
    const movedSkillRoot = path.join(outside, 'replacement-skill-root');
    await replaceWithLink(skillRoot, movedSkillRoot);
    const replacementResult = await applyReplacement(null, { reviewId: replacementPlan.reviewId });
    assert.equal(replacementResult.ok, false, 'replacement refuses a linked active-skill root');
    assert.equal(fs.existsSync(path.join(movedSkillRoot, 'replace-skill', 'SKILL.md')), true, 'replacement leaves active data untouched');
    assert.equal(fs.existsSync(path.join(replaceBackup, 'SKILL.md')), true, 'replacement leaves the backup untouched');
    await restoreLinkedFolder(skillRoot, movedSkillRoot);

    console.log('Desktop hardening passed: isolated component npm policy, quoted preview, bounded output, conservative timeout/SIGKILL lock recovery, relative PATH removal, and cleanup/restore/replacement symlink-root refusals are enforced.');
  } finally {
    Module._load = originalLoad;
    process.env.PATH = originalPath;
    if (originalNpmConfig === undefined) delete process.env.NPM_CONFIG_UNSAFE_FIXTURE;
    else process.env.NPM_CONFIG_UNSAFE_FIXTURE = originalNpmConfig;
    await fsp.rm(fixtureRoot, { recursive: true, force: true });
  }
}

run().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
