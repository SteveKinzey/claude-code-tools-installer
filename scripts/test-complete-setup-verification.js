#!/usr/bin/env node
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';
const tempRoot = path.join(os.tmpdir(), `ccti-complete-setup-${process.pid}`);
const home = path.join(tempRoot, 'home');
const project = path.join(tempRoot, 'project');
const fakeClaudePath = path.join(home, '.local', 'bin', isWindows ? 'claude.exe' : 'claude');
const commandLocator = isWindows ? 'where.exe' : 'which';
const installerCommand = isWindows ? 'pwsh.exe' : 'bash';
const completeFlag = isWindows ? '-Complete' : '--complete';
const noLaunchFlag = isWindows ? '-NoLaunch' : '--no-launch';
const appManagedPluginsFlag = isWindows ? '-AppManagedPlugins' : '--app-managed-plugins';
const skillScopeFlag = isWindows ? '-SkillScope' : '--skill-scope';
const handlers = new Map();
const spawns = [];
const pluginIds = new Set();
const marketplaces = new Set();
let openDialogResult = { canceled: true, filePaths: [] };
let saveDialogResult = { canceled: true, filePath: '' };
let readyCallback;
let hangNextCompleteSetup = false;

function childProcess() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  return child;
}

function finish(child, { code = 0, stdout = '', stderr = '' } = {}) {
  queueMicrotask(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    child.emit('close', code);
  });
}

function spawnStub(command, args = [], options = {}) {
  const child = childProcess();
  spawns.push({ command, args: [...args], options: { ...options } });
  const requested = args[0] || '';
  if (command === commandLocator) {
    const locations = {
      claude: fakeClaudePath,
      bun: path.join(home, '.bun', 'bin', 'bun'),
      repomix: path.join(home, '.npm-global', 'bin', 'repomix'),
    };
    finish(child, locations[requested] ? { stdout: `${locations[requested]}\n` } : { code: 1 });
    return child;
  }
  if (command === 'bun') {
    finish(child, { stdout: '1.4.0\n' });
    return child;
  }
  if (command === 'repomix') {
    finish(child, { stdout: 'repomix 1.0.0\n' });
    return child;
  }
  if (command === fakeClaudePath) {
    if (args[0] === '--version') finish(child, { stdout: '2.1.276 (Claude Code)\n' });
    else if (args[0] === 'mcp' && args[1] === 'get' && ['repomix', 'playwright'].includes(args[2])) finish(child, { stdout: `${args[2]}: local command\n` });
    else if (args[0] === "plugin" && args[1] === "list") finish(child, { stdout: "Installed plugins:\n  ❯ " + [...pluginIds].join("\n  ❯ ") + "\n" });
    else if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'list') finish(child, { stdout: `${[...marketplaces].join('\n')}\n` });
    else if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'add') {
      marketplaces.add(String(args[3] || ''));
      finish(child, { stdout: 'Marketplace added\n' });
    } else if (args[0] === 'plugin' && args[1] === 'install') {
      pluginIds.add(String(args[2] || ''));
      finish(child, { stdout: 'Plugin installed\n' });
    } else finish(child, { code: 1, stderr: 'Unexpected Claude command\n' });
    return child;
  }
  if (command === installerCommand && args.includes(completeFlag)) {
    if (hangNextCompleteSetup) {
      hangNextCompleteSetup = false;
      return child;
    }
    finish(child, { stdout: 'Installer completed\n' });
    return child;
  }
  finish(child, { code: 1, stderr: `Unexpected command: ${command}\n` });
  return child;
}

const electronStub = {
  app: {
    getPath: (name) => name === 'home' ? home : tempRoot,
    isPackaged: false,
    whenReady: () => ({ then: (callback) => { readyCallback = callback; } }),
    on: () => {},
    quit: () => {},
  },
  BrowserWindow: class {
    static getAllWindows() { return []; }
    constructor() {
      this.webContents = {
        send: () => {},
        setWindowOpenHandler: () => {},
        on: () => {},
      };
    }
    async loadFile() {}
    isDestroyed() { return false; }
  },
  dialog: { showOpenDialog: async () => openDialogResult, showSaveDialog: async () => saveDialogResult },
  Notification: class { static isSupported() { return false; } },
  shell: { openExternal: async () => {} },
  ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') return electronStub;
  if (request === 'node:child_process') return { ...originalLoad.call(this, request, parent, isMain), spawn: spawnStub };
  return originalLoad.call(this, request, parent, isMain);
};

async function writeFixture(relative, content = '') {
  const destination = path.join(home, relative);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, content);
}

async function writeProjectFixture(relative, content = '') {
  const destination = path.join(project, relative);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, content);
}

async function run() {
  try {
    await Promise.all([
      fs.mkdir(home, { recursive: true }),
      fs.mkdir(project, { recursive: true }),
    ]);
    await Promise.all([
      fs.mkdir(path.dirname(fakeClaudePath), { recursive: true }).then(() => fs.writeFile(fakeClaudePath, '')),
      writeFixture('.bun/bin/bun'),
      writeFixture('.npm-global/bin/repomix'),
      writeFixture('.claude/skills/gstack/setup'),
      writeFixture('.claude/skills/gstack/VERSION', '1.0.0\n'),
      writeFixture('.claude/skills/gstack/browse/dist/browse'),
      writeFixture('.claude/skills/health/SKILL.md', '# health\n'),
      writeFixture('.claude/skills/design-taste-frontend/SKILL.md', '# taste\n'),
      writeFixture('.claude/skills/planning-with-files/SKILL.md', '# planning\n'),
    ]);

    require(path.join(root, 'desktop', 'src', 'main.js'));
    await readyCallback();

    const completeSetup = handlers.get('setup:complete');
    const verifySetup = handlers.get('setup:verify');
    const chooseProject = handlers.get('setup:choose-project');
    assert.ok(completeSetup && verifySetup && chooseProject, 'Complete setup, scope picker, and the read-only setup verifier must be available through narrow IPC handlers');

    openDialogResult = { canceled: false, filePaths: [project] };
    const existingProject = await chooseProject(null, { createNew: false });
    assert.equal(existingProject.projectPath, project, 'Existing-project selection must validate a native picker result before returning it to the renderer');
    const createdProjectPath = path.join(tempRoot, 'created-project');
    saveDialogResult = { canceled: false, filePath: createdProjectPath };
    const createdProject = await chooseProject(null, { createNew: true });
    assert.equal(createdProject.projectPath, createdProjectPath, 'New-project selection must create the exact native-dialog folder before returning it to the renderer');
    assert.equal((await fs.stat(createdProjectPath)).isDirectory(), true, 'New-project selection must create a directory rather than a placeholder file');

    const setupResult = await completeSetup(null, { fresh: false, skillScope: 'global' });
    assert.equal(setupResult.ok, true, 'Complete setup must only succeed after its in-app verification is ready');
    assert.equal(setupResult.verification.ready, true);
    assert.match(setupResult.verification.summary, /everything ccti can install/i);
    assert.equal(setupResult.skillScope, 'global');
    assert.equal(setupResult.projectPath, '');

    const installerSpawn = spawns.find((entry) => entry.command === installerCommand && entry.args.includes(completeFlag));
    assert.ok(installerSpawn, 'Complete setup must use the trusted installer adapter');
    assert.ok(installerSpawn.args.includes(noLaunchFlag), 'Complete setup must not open a terminal and bypass the saved terminal preference.');
    assert.ok(installerSpawn.args.includes(appManagedPluginsFlag), 'Complete setup must tell the adapter that plugin installation stays inside CCTI');
    assert.deepEqual(installerSpawn.args.slice(-2), [skillScopeFlag, 'global'], 'Global setup must state its noninteractive skill scope to the trusted adapter');
    assert.equal(installerSpawn.options.cwd, home, 'Global setup must keep the installer working directory at the user home folder');
    assert.ok(spawns.some((entry) => entry.args[0] === 'plugin' && entry.args[1] === 'install' && entry.args[2] === 'superpowers@superpowers-marketplace'), 'Complete setup must install Superpowers in CCTI');

    const pluginInstalls = spawns.filter((entry) => entry.args[0] === 'plugin' && entry.args[1] === 'install');
    assert.ok(pluginInstalls.length >= 2 && pluginInstalls.every((entry) => entry.args.includes('--yes')), 'Every CCTI plugin install must include Claude CLI noninteractive acceptance after the in-app review confirmation.');
    assert.equal(pluginInstalls.some((entry) => entry.args[2] === 'productivity'), false, 'CCTI must never try to install Productivity because Claude.ai manages synced plugins.');
    assert.ok(marketplaces.has('anthropics/skills'), 'Complete setup must add the Anthropic Skills marketplace in CCTI');

    const verification = await verifySetup(null, { skillScope: 'global' });
    assert.equal(verification.ok, true);
    assert.equal(verification.ready, true, 'The setup verification button must identify a completed recommended setup without a terminal command');
    assert.equal(verification.checks.find((check) => check.id === 'productivity')?.state, 'optional', 'Missing Productivity must remain optional because Claude.ai account sync controls it.');
    assert.ok(verification.checks.every((check) => check.state === 'ready' || check.state === 'unavailable' || check.state === 'optional'), 'Every setup check must be ready, explicitly unavailable, or an account-managed optional sync in this fixture.');
    if (isWindows) {
      assert.deepEqual(verification.checks.find((check) => check.id === 'gstack')?.state, 'unavailable', 'Windows must report gstack as explicitly unavailable rather than as an actionable setup gap.');
    } else {
      assert.ok(verification.checks.every((check) => check.state === 'ready' || check.state === 'optional'), 'Non-Windows fixtures must report all required setup checks as ready and account-managed sync as optional.');
    }
    assert.ok(spawns.some((entry) => entry.args[0] === 'mcp' && entry.args[1] === 'get' && entry.args[2] === 'repomix'), 'Setup verification must directly query the Repomix registration.');
    assert.ok(spawns.some((entry) => entry.args[0] === 'mcp' && entry.args[1] === 'get' && entry.args[2] === 'playwright'), 'Setup verification must directly query the Playwright registration.');
    assert.equal(spawns.some((entry) => entry.args[0] === 'mcp' && entry.args[1] === 'list'), false, 'Setup verification must not health-check unrelated MCP servers.');

    await Promise.all([
      writeProjectFixture('.claude/skills/design-taste-frontend/SKILL.md', '# project taste\n'),
      writeProjectFixture('.claude/skills/planning-with-files/SKILL.md', '# project planning\n'),
    ]);
    const projectResult = await completeSetup(null, { fresh: false, skillScope: 'project', projectPath: project });
    assert.equal(projectResult.ok, true, 'Project scope must also verify the selected project skills before reporting setup success');
    assert.equal(projectResult.skillScope, 'project', 'Project scope must be preserved in the complete-setup result');
    assert.equal(projectResult.projectPath, project, 'Project scope must report the reviewed project folder');
    const projectInstallerSpawn = spawns.filter((entry) => entry.command === installerCommand && entry.args.includes(completeFlag)).at(-1);
    assert.deepEqual(projectInstallerSpawn.args.slice(-2), [skillScopeFlag, 'project'], 'Project setup must state its noninteractive skill scope to the trusted adapter');
    assert.equal(projectInstallerSpawn.options.cwd, project, 'Project setup must run skills commands from the selected project folder');

    const invalidScope = await completeSetup(null, { fresh: false, skillScope: 'project', projectPath: path.join(tempRoot, 'missing-project') });
    assert.equal(invalidScope.ok, false, 'Project setup must reject an unreviewed or missing project folder before starting the installer');
    assert.match(invalidScope.error, /choose a valid project folder/i);

    const originalSetTimeout = global.setTimeout;
    global.setTimeout = (callback, delay, ...args) => originalSetTimeout(callback, Math.min(delay, 5), ...args);
    try {
      hangNextCompleteSetup = true;
      const timeoutResult = await completeSetup(null, { fresh: false, skillScope: 'global' });
      assert.equal(timeoutResult.ok, false, 'A hung Complete setup child must not leave CCTI in a running state.');
      assert.equal(timeoutResult.timedOut, undefined, 'The IPC response should preserve the documented setup response surface.');
      assert.equal(timeoutResult.code, -1, 'A hung Complete setup child must return a deterministic timeout code.');
      assert.match(timeoutResult.error, /timed out after 10 minutes/i, 'CCTI must explain that it stopped waiting without removing existing configuration.');
      const retryAfterTimeout = await completeSetup(null, { fresh: false, skillScope: 'global' });
      assert.notEqual(retryAfterTimeout.error, 'An installation is already running.', 'A timed-out Complete setup must clear its lock and permit a retry.');
    } finally {
      global.setTimeout = originalSetTimeout;
    }

    console.log('Complete setup verification passed: supported plugins install inside CCTI, skill scope stays explicit, and the read-only readiness check reports every recommended item.');
  } finally {
    Module._load = originalLoad;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
