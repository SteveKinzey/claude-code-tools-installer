#!/usr/bin/env node
const assert = require('node:assert/strict');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const tempRoot = path.join(os.tmpdir(), `ccti-live-update-test-${process.pid}`);
const handlers = new Map();
const emitted = [];
let readyCallback;
let nativeChecks = 0;

const autoUpdaterStub = {
  autoDownload: true,
  autoInstallOnAppQuit: true,
  on: () => {},
  checkForUpdates: async () => { nativeChecks += 1; return { updateInfo: { version: '2026.9.15' } }; },
  downloadUpdate: async () => {},
  quitAndInstall: () => {},
};
const electronStub = {
  app: {
    getPath: () => tempRoot,
    getVersion: () => '2026.9.11',
    isPackaged: true,
    whenReady: () => ({ then: (callback) => { readyCallback = callback; } }),
    on: () => {},
    quit: () => {},
  },
  BrowserWindow: class {
    static getAllWindows() { return []; }
    constructor() { this.webContents = { send: (channel, payload) => emitted.push({ channel, payload }) }; }
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
  if (request === 'electron-updater') return { autoUpdater: autoUpdaterStub };
  return originalLoad.call(this, request, parent, isMain);
};
global.setInterval = () => ({ unref() {} });

async function run() {
  try {
    require(path.join(root, 'desktop', 'src', 'main.js'));
    await readyCallback();
    const check = handlers.get('updates:check');
    assert.ok(check, 'the in-app update check handler must be registered');
    const status = await check();
    assert.equal(status.state, 'available');
    assert.equal(status.currentVersion, '2026.9.11');
    assert.equal(status.latestVersion, '2026.09.15');
    assert.equal(status.canDownload, true);
    assert.match(status.releaseUrl, /releases\/tag\/v2026\.09\.15$/);
    assert.ok(status.artifactDigestSummary.verified >= 3, 'the live release must expose verified native artifacts and checksum evidence');
    assert.equal(nativeChecks, 0, 'metadata discovery must never auto-download or invoke the native updater');
    assert.ok(emitted.some((event) => event.channel === 'updates:status' && event.payload.latestVersion === '2026.09.15'), 'the renderer must receive the live update availability state');
    console.log(JSON.stringify({
      ok: true,
      currentVersion: status.currentVersion,
      latestVersion: status.latestVersion,
      releaseUrl: status.releaseUrl,
      verifiedAssets: status.artifactDigestSummary.verified,
      nativeUpdaterInvokedDuringCheck: nativeChecks,
    }));
  } finally {
    Module._load = originalLoad;
    global.setInterval = originalSetInterval;
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
