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

async function run() {
  try {
    await fs.mkdir(tempRoot, { recursive: true });
    require(path.join(root, 'desktop', 'src', 'main.js'));
    await readyCallback();

    const runDiagnostics = handlers.get('diagnostics:run');
    const exportDiagnostics = handlers.get('diagnostics:export');
    assert.ok(runDiagnostics && exportDiagnostics, 'diagnostic run and export handlers must be registered');

    const diagnostic = await runDiagnostics();
    assert.equal(diagnostic.ok, true);
    assert.match(diagnostic.diagnosticId, /^[a-f0-9-]{36}$/i);
    assert.match(diagnostic.report, /CCTI DIAGNOSTICS — local only/i);
    assert.match(diagnostic.report, /PATH used by CCTI/i);

    const canceled = await exportDiagnostics(null, { diagnosticId: diagnostic.diagnosticId });
    assert.deepEqual(canceled, { ok: true, canceled: true });

    const exportedFile = path.join(tempRoot, 'ccti-diagnostics.txt');
    saveDialogResult = { canceled: false, filePath: exportedFile };
    const saved = await exportDiagnostics(null, { diagnosticId: diagnostic.diagnosticId });
    assert.deepEqual(saved, { ok: true, canceled: false, filename: 'ccti-diagnostics.txt' });
    assert.equal(await fs.readFile(exportedFile, 'utf8'), `${diagnostic.report}\n`);

    const expired = await exportDiagnostics(null, { diagnosticId: 'missing-report' });
    assert.equal(expired.ok, false);
    assert.match(expired.error, /Run Diagnostics again/i);

    console.log('Desktop diagnostics behavior passed: local reports can be copied by the renderer and exported as user-selected text files.');
  } finally {
    Module._load = originalLoad;
    global.setInterval = originalSetInterval;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
