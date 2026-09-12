#!/usr/bin/env node
const assert = require('node:assert/strict');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const tempRoot = path.join(os.tmpdir(), 'ccti-update-services-test');
const handlers = new Map();
const sentEvents = [];
const openedUrls = [];
let readyCallback;
let fetchCalls = 0;

const electronStub = {
  app: {
    getPath: (name) => name === 'home' ? tempRoot : tempRoot,
    getVersion: () => '2026.8.26',
    isPackaged: false,
    whenReady: () => ({ then: (callback) => { readyCallback = callback; } }),
    on: () => {},
    quit: () => {},
  },
  BrowserWindow: class {
    static getAllWindows() { return []; }
    constructor() { this.webContents = { send: (channel, payload) => sentEvents.push({ channel, payload }) }; }
    async loadFile() {}
    isDestroyed() { return false; }
  },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true, filePath: '' }) },
  Notification: class { static isSupported() { return false; } },
  shell: { openExternal: async (url) => openedUrls.push(url) },
  ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
};

const originalLoad = Module._load;
const originalFetch = global.fetch;
const originalSetInterval = global.setInterval;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') return electronStub;
  return originalLoad.call(this, request, parent, isMain);
};
global.setInterval = () => ({ unref() {} });
global.fetch = async (url) => {
  fetchCalls += 1;
  assert.equal(url, 'https://api.github.com/repos/SteveKinzey/claude-code-tools-installer/releases?per_page=100');
  return {
    ok: true,
    status: 200,
    json: async () => [
      {
        // A newer source-only record must never displace a verified executable release.
        tag_name: 'v2026.09.11',
        html_url: 'https://github.com/SteveKinzey/claude-code-tools-installer/releases/tag/v2026.09.11',
        assets: [{ name: 'CCTI-v2026.09.11-SHA256SUMS.txt', size: 711, state: 'uploaded', digest: `sha256:${'b'.repeat(64)}` }],
      },
      {
        tag_name: 'v2026.09.01',
        html_url: 'https://github.com/SteveKinzey/claude-code-tools-installer/releases/tag/v2026.09.01',
        assets: [
          { name: 'ccti-macos.dmg', size: 2048, state: 'uploaded', digest: `sha256:${'a'.repeat(64)}` },
          { name: 'ccti-windows.zip', size: 2048, state: 'uploaded' },
        ],
      },
    ],
  };
};

async function run() {
  try {
    require(path.join(root, 'desktop', 'src', 'main.js'));
    await readyCallback();

    const getStatus = handlers.get('updates:get-status');
    const check = handlers.get('updates:check');
    const openRelease = handlers.get('updates:open-release');
    assert.ok(getStatus && check && openRelease, 'all update handlers must be registered');

    const status = await check();
    assert.equal(status.state, 'available');
    assert.equal(status.currentVersion, '2026.8.26');
    assert.equal(status.latestVersion, '2026.09.01');
    assert.match(status.message, /Review the release before downloading/i);
    assert.deepEqual(status.artifactDigestSummary, { total: 2, verified: 1, missing: ['ccti-windows.zip'] });
    assert.equal(status.digestAlert?.count, 1, 'the update status must flag a published artifact that lacks a SHA-256 digest');
    assert.match(status.digestAlert?.message || '', /missing a SHA-256 digest/i);
    assert.ok(fetchCalls >= 1, 'a public release check must run in the background');
    assert.ok(sentEvents.some((event) => event.channel === 'updates:status' && event.payload.state === 'available'), 'the renderer must receive update availability status');

    const opened = await openRelease();
    assert.deepEqual(opened, { ok: true });
    assert.deepEqual(openedUrls, ['https://github.com/SteveKinzey/claude-code-tools-installer/releases/tag/v2026.09.01']);
    assert.equal((await getStatus()).state, 'available');

    console.log('Desktop update behavior passed: the newest verified executable release is selected even when GitHub latest metadata is stale, and no artifact is downloaded or installed.');
  } finally {
    Module._load = originalLoad;
    global.fetch = originalFetch;
    global.setInterval = originalSetInterval;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
