#!/usr/bin/env node
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccti-terminal-preference-test-'));
const home = path.join(tempRoot, 'home');
const fakeClaudePath = path.join(home, '.local', 'bin', 'claude');
const fakeItermBundle = path.join(home, 'Applications', 'iTerm.app');
const handlers = new Map();
const osascriptCalls = [];
let readyCallback;

function fakeSpawn(command, args) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  process.nextTick(() => {
    if (command === 'which' && args[0] === 'claude') {
      child.stdout.emit('data', `${fakeClaudePath}\n`);
      child.emit('close', 0);
      return;
    }
    if (command === fakeClaudePath && args[0] === '--version') {
      child.stdout.emit('data', 'claude 1.0.0\n');
      child.emit('close', 0);
      return;
    }
    if (command === 'osascript') {
      osascriptCalls.push(args);
      child.emit('close', 0);
      return;
    }
    child.stderr.emit('data', `Unexpected command: ${command}`);
    child.emit('close', 1);
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
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true, filePath: '' }) },
  Notification: class { static isSupported() { return false; } },
  shell: { openExternal: async () => {} },
  ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
};

const originalLoad = Module._load;
const originalPlatform = process.platform;
const originalSetInterval = global.setInterval;
const originalTerminalPreferenceTest = process.env.CCTI_TERMINAL_PREFERENCE_TEST;
const originalItermBundlePath = process.env.CCTI_TEST_ITERM2_BUNDLE_PATH;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') return electronStub;
  if (request === 'node:child_process') return { spawn: fakeSpawn };
  return originalLoad.call(this, request, parent, isMain);
};
global.setInterval = () => ({ unref() {} });
Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
process.env.CCTI_TERMINAL_PREFERENCE_TEST = '1';
process.env.CCTI_TEST_ITERM2_BUNDLE_PATH = fakeItermBundle;

async function run() {
  try {
    await fsp.mkdir(path.dirname(fakeClaudePath), { recursive: true });
    await fsp.writeFile(fakeClaudePath, '#!/bin/sh\n', { mode: 0o755 });
    await fsp.mkdir(fakeItermBundle, { recursive: true });

    require(path.join(root, 'desktop', 'src', 'main.js'));
    await readyCallback();

    const getPreference = handlers.get('terminal:get-preference');
    const setPreference = handlers.get('terminal:set-preference');
    const runClaude = handlers.get('claude:run');
    assert.ok(getPreference && setPreference && runClaude, 'terminal preference and Claude launch handlers must be registered');

    const initial = await getPreference();
    assert.equal(initial.ok, true);
    assert.equal(initial.selectedId, 'default');
    assert.deepEqual(initial.options.map((option) => [option.id, option.available]), [['default', true], ['iterm2', true]]);

    const rejected = await setPreference(null, { terminalId: '/Applications/Untrusted.app' });
    assert.equal(rejected.ok, false, 'arbitrary terminal paths must be rejected');
    assert.match(rejected.error, /Custom terminal commands are not accepted/i);

    const saved = await setPreference(null, { terminalId: 'iterm2' });
    assert.equal(saved.ok, true);
    assert.equal(saved.selectedId, 'iterm2');
    const preferencePath = path.join(tempRoot, 'terminal-preference.json');
    const persisted = JSON.parse(await fsp.readFile(preferencePath, 'utf8'));
    assert.equal(persisted.terminalId, 'iterm2', 'the selected terminal must persist in CCTI-only preferences');
    assert.equal((await fsp.stat(preferencePath)).mode & 0o077, 0, 'terminal preference must not be group or world readable');

    const iTermLaunch = await runClaude(null, {});
    assert.equal(iTermLaunch.ok, true);
    assert.match(iTermLaunch.message, /iTerm2/);
    assert.equal(osascriptCalls.length, 1);
    assert.match(osascriptCalls[0][1], /tell application id "com\.googlecode\.iterm2"/);
    assert.match(osascriptCalls[0][1], /write text/);
    assert.match(osascriptCalls[0][1], /\.local/);

    await fsp.rm(fakeItermBundle, { recursive: true, force: true });
    const fallback = await getPreference();
    assert.equal(fallback.selectedId, 'default', 'a removed preferred terminal must fall back to Default Terminal');
    assert.equal(fallback.storedId, 'iterm2');
    assert.match(fallback.message, /not installed/i);

    const defaultLaunch = await runClaude(null, {});
    assert.equal(defaultLaunch.ok, true);
    assert.match(defaultLaunch.message, /Default Terminal/);
    assert.match(defaultLaunch.message, /saved iTerm2 preference is unavailable/i);
    assert.match(osascriptCalls[1][1], /tell application id "com\.apple\.Terminal"/);

    console.log('Terminal preference behavior passed: iTerm2 selection is persisted safely, arbitrary commands are blocked, and unavailable iTerm2 falls back to Default Terminal.');
  } finally {
    Module._load = originalLoad;
    global.setInterval = originalSetInterval;
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    if (originalTerminalPreferenceTest === undefined) delete process.env.CCTI_TERMINAL_PREFERENCE_TEST;
    else process.env.CCTI_TERMINAL_PREFERENCE_TEST = originalTerminalPreferenceTest;
    if (originalItermBundlePath === undefined) delete process.env.CCTI_TEST_ITERM2_BUNDLE_PATH;
    else process.env.CCTI_TEST_ITERM2_BUNDLE_PATH = originalItermBundlePath;
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
