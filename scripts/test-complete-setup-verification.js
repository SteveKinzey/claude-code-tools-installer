#!/usr/bin/env node
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const tempRoot = path.join(os.tmpdir(), `ccti-complete-setup-${process.pid}`);
const home = path.join(tempRoot, 'home');
const handlers = new Map();
const spawns = [];
const pluginIds = new Set();
const marketplaces = new Set();
let readyCallback;

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

function spawnStub(command, args = []) {
  const child = childProcess();
  spawns.push({ command, args: [...args] });
  const requested = args[0] || '';
  if (command === 'which') {
    const locations = {
      claude: path.join(home, '.local', 'bin', 'claude'),
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
  if (command === path.join(home, '.local', 'bin', 'claude')) {
    if (args[0] === '--version') finish(child, { stdout: '2.1.276 (Claude Code)\n' });
    else if (args[0] === 'mcp' && args[1] === 'list') finish(child, { stdout: 'repomix\nplaywright\n' });
    else if (args[0] === 'plugin' && args[1] === 'list') finish(child, { stdout: `${[...pluginIds].join('\n')}\n` });
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
  if (command === 'bash' && args.includes('--complete')) {
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
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true, filePath: '' }) },
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

async function run() {
  try {
    await fs.mkdir(home, { recursive: true });
    await Promise.all([
      writeFixture('.local/bin/claude'),
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
    assert.ok(completeSetup && verifySetup, 'Complete setup and the read-only setup verifier must be available through narrow IPC handlers');

    const setupResult = await completeSetup(null, { fresh: false });
    assert.equal(setupResult.ok, true, 'Complete setup must only succeed after its in-app verification is ready');
    assert.equal(setupResult.verification.ready, true);
    assert.match(setupResult.verification.summary, /everything ccti can install/i);

    const installerSpawn = spawns.find((entry) => entry.command === 'bash' && entry.args.includes('--complete'));
    assert.ok(installerSpawn, 'Complete setup must use the trusted installer adapter');
    assert.ok(installerSpawn.args.includes('--app-managed-plugins'), 'Complete setup must tell the adapter that plugin installation stays inside CCTI');
    assert.ok(spawns.some((entry) => entry.args[0] === 'plugin' && entry.args[1] === 'install' && entry.args[2] === 'superpowers@superpowers-marketplace'), 'Complete setup must install Superpowers in CCTI');
    assert.ok(spawns.some((entry) => entry.args[0] === 'plugin' && entry.args[1] === 'install' && entry.args[2] === 'claude-hud'), 'Complete setup must install Claude HUD in CCTI');
    assert.ok(marketplaces.has('anthropics/skills'), 'Complete setup must add the Anthropic Skills marketplace in CCTI');

    const verification = await verifySetup();
    assert.equal(verification.ok, true);
    assert.equal(verification.ready, true, 'The setup verification button must identify a completed recommended setup without a terminal command');
    assert.ok(verification.checks.every((check) => check.state === 'ready'), 'All recommended setup checks must report a plain ready state in this fixture');

    console.log('Complete setup verification passed: supported plugins install inside CCTI and the read-only readiness check reports every recommended item.');
  } finally {
    Module._load = originalLoad;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
