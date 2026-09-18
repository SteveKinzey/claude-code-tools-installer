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
const updaterListeners = new Map();
let readyCallback;
let fetchCalls = 0;
let updaterChecks = 0;
let updaterDownloads = 0;
let updaterInstalls = 0;
let incompleteDownloadAttempts = 0;

const autoUpdaterStub = {
  autoDownload: true,
  autoInstallOnAppQuit: true,
  on: (event, callback) => updaterListeners.set(event, callback),
  checkForUpdates: async () => {
    updaterChecks += 1;
    return { updateInfo: { version: '2026.9.11' } };
  },
  downloadUpdate: async () => {
    updaterDownloads += 1;
    updaterListeners.get('download-progress')?.({ percent: 47.6 });
    incompleteDownloadAttempts += 1;
    if (incompleteDownloadAttempts === 1) {
      const error = new Error('Downloaded update file is incomplete.');
      updaterListeners.get('error')?.(error);
      throw error;
    }
    updaterListeners.get('update-downloaded')?.({ version: '2026.9.11' });
  },
  quitAndInstall: () => { updaterInstalls += 1; },
};
const electronStub = {
  app: {
    getPath: () => tempRoot,
    getVersion: () => '2026.8.26',
    isPackaged: true,
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
const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
Object.defineProperty(process, 'platform', { ...originalPlatformDescriptor, value: 'darwin' });
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') return electronStub;
  if (request === 'electron-updater') return { autoUpdater: autoUpdaterStub };
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
        tag_name: 'v2026.09.12',
        html_url: 'https://github.com/SteveKinzey/claude-code-tools-installer/releases/tag/v2026.09.12',
        assets: [{ name: 'CCTI-v2026.09.12-SHA256SUMS.txt', size: 711, state: 'uploaded', digest: `sha256:${'b'.repeat(64)}` }],
      },
      {
        tag_name: 'v2026.09.11',
        html_url: 'https://github.com/SteveKinzey/claude-code-tools-installer/releases/tag/v2026.09.11',
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
    const download = handlers.get('updates:download');
    const install = handlers.get('updates:install');
    const openRelease = handlers.get('updates:open-release');
    assert.ok(getStatus && check && download && install && openRelease, 'all narrow update handlers must be registered');

    const status = await check();
    assert.equal(status.state, 'available');
    assert.equal(status.currentVersion, '2026.8.26');
    assert.equal(status.latestVersion, '2026.09.11');
    assert.equal(status.canDownload, true);
    assert.match(status.message, /download the signed update/i);
    assert.deepEqual(status.artifactDigestSummary, { total: 2, verified: 1, missing: ['ccti-windows.zip'] });
    assert.equal(status.digestAlert?.count, 1, 'the update status must flag a published artifact that lacks a SHA-256 digest');
    assert.ok(fetchCalls >= 1, 'a public release check must run in the background');
    assert.ok(sentEvents.some((event) => event.channel === 'updates:status' && event.payload.state === 'available'), 'the renderer must receive update availability status');

    const incomplete = await download();
    assert.equal(updaterChecks, 1, 'the native updater must read the signed GitHub update feed once');
    assert.equal(updaterDownloads, 1, 'the native updater must download the signed package after a user action');
    assert.equal(incomplete.state, 'available');
    assert.equal(incomplete.canDownload, true);
    assert.equal(incomplete.canInstall, false);
    assert.match(incomplete.message, /did not complete or verify/i);
    assert.match(incomplete.message, /current CCTI app was not changed/i);
    assert.match(incomplete.message, /retry/i);
    assert.equal(autoUpdaterStub.autoDownload, false, 'the updater must never download during background checks');
    assert.equal(autoUpdaterStub.autoInstallOnAppQuit, false, 'a downloaded update must never install merely because the app exits');
    assert.ok(sentEvents.some((event) => event.channel === 'updates:status' && event.payload.state === 'available' && /current CCTI app was not changed/i.test(event.payload.message)), 'an incomplete update must restore a retryable available state for the renderer');
    assert.deepEqual(await install(), { ok: false, error: 'No downloaded CCTI update is ready to install.' }, 'an incomplete download must not expose restart-and-install');
    assert.equal(updaterInstalls, 0, 'an incomplete download must never install or restart the current app');

    const downloaded = await download();
    assert.equal(updaterChecks, 2, 'retry must ask the native updater for metadata again');
    assert.equal(updaterDownloads, 2, 'retry must request a fresh signed package');
    assert.equal(downloaded.state, 'downloaded');
    assert.equal(downloaded.canInstall, true);
    assert.match(downloaded.message, /downloaded and verified/i);
    assert.ok(sentEvents.some((event) => event.channel === 'updates:status' && event.payload.state === 'downloading'), 'the renderer must receive download progress');
    assert.ok(sentEvents.some((event) => event.channel === 'updates:status' && event.payload.state === 'downloaded'), 'the renderer must receive a verified download state');

    assert.deepEqual(await install(), { ok: true });
    assert.equal(updaterInstalls, 1, 'restart-and-install must require the explicit renderer action');
    const opened = await openRelease();
    assert.deepEqual(opened, { ok: true });
    assert.deepEqual(openedUrls, ['https://github.com/SteveKinzey/claude-code-tools-installer/releases/tag/v2026.09.11']);
    assert.equal((await getStatus()).state, 'downloaded');
    console.log('Desktop update behavior passed: source-only releases are skipped, an incomplete signed update leaves the current app unchanged and retryable, and restart-to-install stays explicit after a verified retry.');
  } finally {
    Module._load = originalLoad;
    global.fetch = originalFetch;
    global.setInterval = originalSetInterval;
    Object.defineProperty(process, 'platform', originalPlatformDescriptor);
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
