#!/usr/bin/env node
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const realFs = require('node:fs/promises');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const tempRoot = path.join(os.tmpdir(), `ccti-claude-fallback-test-${process.pid}`);
const home = path.join(tempRoot, 'home');
const inaccessibleLauncher = path.join(home, '.local', 'bin', 'claude');
const approvedFallback = '/opt/homebrew/bin/claude';
const handlers = new Map();
const launches = [];
let readyCallback;

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.unref = () => {};
  child.kill = () => {};
  return child;
}

function fakeSpawn(command, args) {
  const child = fakeChild();
  process.nextTick(() => {
    if (command === 'which' && args[0] === 'claude') {
      child.stdout.emit('data', `${inaccessibleLauncher}\n`);
      child.emit('close', 0);
      return;
    }
    if (command === inaccessibleLauncher && args[0] === '--version') {
      const error = new Error('permission denied');
      error.code = 'EACCES';
      child.emit('error', error);
      return;
    }
    if (command === approvedFallback && args[0] === '--version') {
      child.stdout.emit('data', 'Claude Code 2.1.278\n');
      child.emit('close', 0);
      return;
    }
    if (command === 'osascript') {
      launches.push({ command, args });
      child.emit('close', 0);
      return;
    }
    const error = new Error(`Unexpected command: ${command} ${args.join(' ')}`);
    error.code = 'ENOENT';
    child.emit('error', error);
  });
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
    constructor() { this.webContents = { send: () => {} }; }
    async loadFile() {}
    isDestroyed() { return false; }
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true, filePath: '' }),
  },
  Notification: class { static isSupported() { return false; } },
  shell: { openExternal: async () => {} },
  ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
};

const originalLoad = Module._load;
const originalPlatform = process.platform;
const originalPath = process.env.PATH;
const originalGetVersion = electronStub.app.getVersion;

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') return electronStub;
  if (request === 'node:child_process') return { spawn: fakeSpawn };
  if (request === 'node:fs/promises') {
    return {
      ...realFs,
      lstat: async (target) => {
        if (target === inaccessibleLauncher || target === approvedFallback) return { isFile: () => true };
        return realFs.lstat(target);
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

async function run() {
  if (originalPlatform === 'win32') {
    // The scenario is a POSIX file-permission failure on ~/.local/bin/claude with a
    // Homebrew fallback; it has no Windows equivalent and uses POSIX PATH syntax.
    console.log('Claude fallback ladder: POSIX EACCES scenario skipped on Windows.');
    return;
  }
  try {
    await realFs.mkdir(path.dirname(inaccessibleLauncher), { recursive: true });
    await realFs.writeFile(inaccessibleLauncher, '#!/bin/sh\n', { mode: 0o644 });
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    process.env.PATH = `${path.dirname(inaccessibleLauncher)}:${path.dirname(approvedFallback)}`;

    require(path.join(root, 'desktop', 'src', 'main.js'));
    await readyCallback();
    const getClaudeStatus = handlers.get('claude:status');
    const runClaude = handlers.get('claude:run');
    assert.ok(getClaudeStatus && runClaude, 'Claude status and terminal launch handlers must be registered');

    const status = await getClaudeStatus();
    assert.deepEqual(status, {
      installed: true,
      version: 'Claude Code 2.1.278',
      path: approvedFallback,
      timedOut: false,
      fallbackUsed: true,
      fallbackReason: 'permission-denied',
      reason: '',
    }, 'EACCES on ~/.local/bin/claude must continue only to the next approved verified candidate.');

    const launched = await runClaude(null, { projectPath: home });
    assert.equal(launched.ok, true, 'the verified fallback must be used for the terminal launch');
    assert.equal(launches.length, 1, 'exactly one verified terminal launch is expected');
    assert.match(launches[0].args[1], new RegExp(approvedFallback.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(launches[0].args[1], new RegExp(inaccessibleLauncher.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    console.log(JSON.stringify({
      ok: true,
      scenario: 'EACCES local Claude launcher',
      attempted: inaccessibleLauncher,
      verifiedFallback: approvedFallback,
      terminalLaunchUsedFallback: true,
    }));
  } finally {
    Module._load = originalLoad;
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (originalGetVersion === undefined) delete electronStub.app.getVersion;
    else electronStub.app.getVersion = originalGetVersion;
    await realFs.rm(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
