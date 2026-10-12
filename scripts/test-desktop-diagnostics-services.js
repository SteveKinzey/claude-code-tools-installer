#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const tempRoot = path.join(os.tmpdir(), `ccti-diagnostics-test-${process.pid}`);
const handlers = new Map();
let readyCallback;
let saveDialogResult = { canceled: true, filePath: '' };
let preloadApi;
const shellOpenCalls = [];

const electronStub = {
  app: {
    getPath: () => tempRoot,
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
    showSaveDialog: async () => saveDialogResult,
  },
  Notification: class { static isSupported() { return false; } },
  shell: { openExternal: async (target) => { shellOpenCalls.push(target); } },
  ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
  contextBridge: { exposeInMainWorld: (_name, api) => { preloadApi = api; } },
  ipcRenderer: {
    invoke: async (channel, payload) => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
      return handler(null, payload);
    },
  },
  webUtils: { getPathForFile: () => '' },
};

const originalLoad = Module._load;
const originalSetInterval = global.setInterval;
const originalSetTimeout = global.setTimeout;
const originalClearTimeout = global.clearTimeout;
const originalPath = process.env.PATH;
const diagnosticCleanupCallbacks = [];
let clearedDiagnosticCleanupTimers = 0;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') return electronStub;
  return originalLoad.call(this, request, parent, isMain);
};
global.setInterval = () => ({ unref() {} });
global.setTimeout = (callback, timeout, ...args) => {
  if (timeout === 10 * 60 * 1000) {
    diagnosticCleanupCallbacks.push(() => callback(...args));
    return { diagnosticCleanup: true, unref() {} };
  }
  return originalSetTimeout(callback, timeout, ...args);
};
global.clearTimeout = (timer) => {
  if (timer?.diagnosticCleanup) clearedDiagnosticCleanupTimers += 1;
  else originalClearTimeout(timer);
};

async function run() {
  try {
    await fs.mkdir(tempRoot, { recursive: true });
    require(path.join(root, 'desktop', 'src', 'main.js'));
    await readyCallback();
    require(path.join(root, 'desktop', 'src', 'preload.js'));

    const runDiagnostics = handlers.get('diagnostics:run');
    const getRuntimePaths = handlers.get('diagnostics:get-runtime-paths');
    const exportDiagnostics = handlers.get('diagnostics:export');
    const saveTesterFeedback = handlers.get('tester-feedback:save-local');
    const openTesterFeedbackEmail = handlers.get('tester-feedback:open-email');
    assert.ok(runDiagnostics && getRuntimePaths && exportDiagnostics && saveTesterFeedback && openTesterFeedbackEmail, 'diagnostic and tester feedback handlers must be registered');
    assert.ok(preloadApi?.getRuntimePaths, 'the preload bridge must expose only the fixed runtime path diagnostic method');
    assert.ok(preloadApi?.saveTesterFeedback && preloadApi?.openTesterFeedbackEmail, 'the preload bridge must expose narrow tester feedback choices');

    const mainPaths = await getRuntimePaths();
    assert.equal(mainPaths.ok, true);
    assert.equal(mainPaths.mainProcessPath, process.env.PATH || process.env.Path || '');
    // Windows resolves Claude from %APPDATA%\npm; macOS and Linux use ~/.local/bin.
    assert.match(mainPaths.cctiCommandPath, process.platform === 'win32' ? /[\\/]npm(?:;|$)/i : /\.local[\\/]bin/);
    assert.equal(typeof mainPaths.mainProcessPathEntryCount, 'number');
    assert.equal(typeof mainPaths.cctiCommandPathEntryCount, 'number');
    assert.equal(mainPaths.cctiIncludesNativeClaudeBin, true);
    assert.equal(mainPaths.cctiIncludesManagedNodeBin, true);
    assert.equal(typeof mainPaths.electronExecPath, 'string');
    assert.equal(typeof mainPaths.electronVersion, 'string');
    assert.equal(typeof mainPaths.embeddedNodeVersion, 'string');

    const bridgedPaths = await preloadApi.getRuntimePaths();
    assert.equal(bridgedPaths.ok, true);
    assert.equal(bridgedPaths.rendererProcess.path, process.env.PATH || process.env.Path || '');
    assert.equal(bridgedPaths.rendererProcess.processType, 'renderer');
    assert.equal(typeof bridgedPaths.rendererProcess.sandboxed, 'boolean');
    assert.equal(typeof bridgedPaths.rendererProcess.contextIsolated, 'boolean');

    const diagnostic = await runDiagnostics();
    assert.equal(diagnostic.ok, true);
    assert.match(diagnostic.diagnosticId, /^[a-f0-9-]{36}$/i);
    assert.match(diagnostic.report, /CCTI DIAGNOSTICS — local only/i);
    assert.match(diagnostic.report, /PATH used by CCTI/i);
    assert.equal(typeof diagnostic.claudeFallback, 'boolean');
    assert.equal(typeof diagnostic.claudeFallbackReason, 'string');

    const canceled = await exportDiagnostics(null, { diagnosticId: diagnostic.diagnosticId });
    assert.deepEqual(canceled, { ok: true, canceled: true });

    const exportedFile = path.join(tempRoot, 'ccti-diagnostics.txt');
    saveDialogResult = { canceled: false, filePath: exportedFile };
    const saved = await exportDiagnostics(null, { diagnosticId: diagnostic.diagnosticId });
    assert.deepEqual(saved, { ok: true, canceled: false, filename: 'ccti-diagnostics.txt' });
    assert.equal(await fs.readFile(exportedFile, 'utf8'), `${diagnostic.report}\n`);
    if (process.platform !== 'win32') {
      assert.equal((await fs.stat(exportedFile)).mode & 0o077, 0, 'a newly created diagnostics export is owner-only');
    }
    const existing = await exportDiagnostics(null, { diagnosticId: diagnostic.diagnosticId });
    assert.equal(existing.ok, false, 'CCTI does not replace an existing diagnostics export');
    assert.match(existing.error, /Choose a new filename/i);
    assert.equal(await fs.readFile(exportedFile, 'utf8'), `${diagnostic.report}\n`, 'the existing diagnostics file remains unchanged');
    saveDialogResult = { canceled: true, filePath: '' };

    assert.equal(diagnosticCleanupCallbacks.length, 1, 'each report must schedule one expiry cleanup');
    diagnosticCleanupCallbacks[0]();
    const expiredByTimer = await exportDiagnostics(null, { diagnosticId: diagnostic.diagnosticId });
    assert.equal(expiredByTimer.ok, false);
    assert.match(expiredByTimer.error, /Run Diagnostics again/i);

    const retainedReports = [];
    for (let index = 0; index < 6; index += 1) retainedReports.push(await runDiagnostics());
    assert.ok(clearedDiagnosticCleanupTimers >= 1, 'evicting an over-capacity report must clear its cleanup timer');
    const evictedByCapacity = await exportDiagnostics(null, { diagnosticId: retainedReports[0].diagnosticId });
    assert.equal(evictedByCapacity.ok, false);
    const newestIsRetained = await exportDiagnostics(null, { diagnosticId: retainedReports.at(-1).diagnosticId });
    assert.equal(newestIsRetained.ok, true);

    process.env.PATH = Array.from({ length: 5000 }, (_value, index) => process.platform === 'win32' ? `C:\\diagnostics-test-path-${index}` : `/diagnostics-test-path-${index}`).join(path.delimiter);
    const oversizedDiagnostic = await runDiagnostics();
    assert.ok(Buffer.byteLength(oversizedDiagnostic.report, 'utf8') <= 64 * 1024, 'each retained report must stay within the 64 KiB byte limit');
    assert.match(oversizedDiagnostic.report, /Report truncated at 64 KiB/i);
    process.env.PATH = originalPath;

    const expired = await exportDiagnostics(null, { diagnosticId: 'missing-report' });
    assert.equal(expired.ok, false);
    assert.match(expired.error, /Run Diagnostics again/i);

    const missingTesterFeedback = await saveTesterFeedback(null, { area: '', expected: '', actual: '' });
    assert.equal(missingTesterFeedback.ok, false, 'tester feedback requires the reviewed fields');
    assert.match(missingTesterFeedback.error, /Choose an area/i);
    const testerFeedback = {
      area: 'Tool details or References',
      expected: 'The Details explanation should open without changing a tool choice.',
      actual: 'The sample issue did not show the explanation.',
      steps: 'Open Details, then read the explanation.',
    };
    saveDialogResult = { canceled: true, filePath: '' };
    assert.deepEqual(await saveTesterFeedback(null, testerFeedback), { ok: true, canceled: true }, 'canceling tester feedback save leaves all data local');
    const feedbackFile = path.join(tempRoot, 'ccti-tester-feedback.txt');
    saveDialogResult = { canceled: false, filePath: feedbackFile };
    const savedFeedback = await saveTesterFeedback(null, testerFeedback);
    assert.deepEqual(savedFeedback, { ok: true, canceled: false, filename: 'ccti-tester-feedback.txt' });
    const savedFeedbackText = await fs.readFile(feedbackFile, 'utf8');
    assert.match(savedFeedbackText, /CCTI TESTER FEEDBACK — local draft/);
    assert.match(savedFeedbackText, /This file is created only on this computer/);
    assert.match(savedFeedbackText, /The sample issue did not show the explanation/);
    assert.doesNotMatch(savedFeedbackText, /fixture-home/, 'the generated feedback template does not add local paths or secrets');
    const emailDraft = await openTesterFeedbackEmail(null, testerFeedback);
    assert.equal(emailDraft.ok, true, 'opening a tester email draft succeeds through the native shell only');
    assert.match(emailDraft.message, /Nothing was sent by CCTI/i);
    assert.equal(shellOpenCalls.length, 1);
    assert.match(shellOpenCalls[0], /^mailto:support@sk-america\.com\?subject=/);
    assert.match(decodeURIComponent(shellOpenCalls[0]), /The sample issue did not show the explanation/);

    console.log('Desktop diagnostics and tester feedback behavior passed: local reports and feedback drafts are saved only by explicit user choice.');
  } finally {
    Module._load = originalLoad;
    global.setInterval = originalSetInterval;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    process.env.PATH = originalPath;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
