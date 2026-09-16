#!/usr/bin/env node
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, writeFile, rm, readFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const appSource = process.argv[2];
if (process.platform !== 'linux') throw new Error('This smoke test must run on Linux.');
if (!appSource || !path.isAbsolute(appSource)) throw new Error('Usage: node scripts/test-packaged-linux-terminal-adapter.js <absolute-packaged-app-source-dir>');

const handlers = new Map();
let readyCallback;
let root = '';
let home = '';
let userData = '';
let project = '';
let marker = '';
let claudePath = '';
const electronStub = {
  app: {
    getPath: (name) => name === 'home' ? home : userData,
    isPackaged: true,
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
const originalSetInterval = global.setInterval;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') return electronStub;
  return originalLoad.call(this, request, parent, isMain);
};
global.setInterval = () => ({ unref() {} });

async function waitForMarker(timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { return await readFile(marker, 'utf8'); } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  throw new Error('The packaged Linux terminal adapter did not execute Claude Code within 12 seconds.');
}

async function run() {
  try {
    root = await mkdtemp(path.join(os.tmpdir(), 'ccti-packaged-linux-terminal-'));
    home = path.join(root, 'home');
    userData = path.join(root, 'state');
    project = path.join(root, 'project');
    marker = path.join(root, 'fixed-adapter-ran.txt');
    claudePath = path.join(home, '.local', 'bin', 'claude');
    await Promise.all([mkdir(path.dirname(claudePath), { recursive: true }), mkdir(project, { recursive: true })]);
  await writeFile(claudePath, `#!/bin/sh\nif [ "${'$'}{1:-}" = '--version' ]; then echo 'claude 1.0.0'; exit 0; fi\nprintf 'packaged Linux terminal adapter executed\\n' > ${JSON.stringify(marker)}\n`, { mode: 0o755 });
  require(path.join(appSource, 'src', 'main.js'));
  await readyCallback();
  const getPreference = handlers.get('terminal:get-preference');
  const runClaude = handlers.get('claude:run');
  assert.ok(getPreference && runClaude, 'the packaged app must expose terminal preference and Claude launch handlers');
  const preference = await getPreference();
  assert.equal(preference.selectedId, 'default');
  assert.ok(preference.options.some((option) => option.id === 'default' && option.available), 'the packaged Linux app must detect the default X terminal adapter');
  const result = await runClaude(null, { projectPath: project });
  assert.equal(result.ok, true, result.error);
  assert.match(result.message, /Default system terminal/);
  assert.equal(await waitForMarker(), 'packaged Linux terminal adapter executed\n');
    console.log(JSON.stringify({ ok: true, packageSource: '<linux-app-asar>', selectedTerminal: 'default', adapter: 'x-terminal-emulator', commandReachedClaude: true }));
  } finally {
    Module._load = originalLoad;
    global.setInterval = originalSetInterval;
    if (root) await rm(root, { recursive: true, force: true });
  }
}
run().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
