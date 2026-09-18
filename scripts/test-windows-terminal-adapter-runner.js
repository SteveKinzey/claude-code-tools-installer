#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (process.platform !== 'win32') throw new Error('This test must run on a Windows host.');

const root = path.resolve(__dirname, '..');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccti-windows-terminal-adapter-'));
const home = path.join(fixtureRoot, 'home');
const appData = path.join(fixtureRoot, 'appdata');
const localAppData = path.join(fixtureRoot, 'localappdata');
const project = path.join(fixtureRoot, 'selected project with spaces');
const marker = path.join(fixtureRoot, 'claude-marker.txt');
const fakeClaude = path.join(appData, 'npm', 'claude.cmd');
const evidencePath = process.env.CCTI_TERMINAL_EVIDENCE_PATH || '';
const handlers = new Map();
let readyPromise = Promise.resolve();

const originalLoad = Module._load;
const originalAppData = process.env.APPDATA;
const originalLocalAppData = process.env.LOCALAPPDATA;
const originalMarker = process.env.CCTI_TERMINAL_MARKER;
const originalFetch = global.fetch;
const originalSetInterval = global.setInterval;

const electronStub = {
  app: {
    getPath: (name) => name === 'home' ? home : path.join(fixtureRoot, 'ccti-state'),
    getVersion: () => '0.0.0-fixture',
    isPackaged: false,
    whenReady: () => ({
      then: (callback) => {
        readyPromise = Promise.resolve().then(callback);
        return readyPromise;
      },
    }),
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

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function executableProbe(command) {
  const inheritedPath = process.env.PATH || process.env.Path || '';
  const resolvedPath = [path.join(appData, 'npm'), inheritedPath].filter(Boolean).join(path.delimiter);
  const result = spawnSync('where.exe', [command], {
    cwd: home,
    encoding: 'utf8',
    env: { ...process.env, PATH: resolvedPath, Path: resolvedPath },
  });
  return {
    command,
    status: result.status,
    stdout: String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean).map((entry) => path.basename(entry)),
    stderr: String(result.stderr || '').trim(),
  };
}

async function waitForMarker(label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const launchedFrom = (await fsp.readFile(marker, 'utf8')).trim();
      assert.equal(path.normalize(launchedFrom).toLowerCase(), path.normalize(project).toLowerCase(), `${label} must run Claude from the selected project directory`);
      return;
    } catch (error) {
      if (error.code && error.code !== 'ENOENT') throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`${label} did not run the verified Claude fixture within ${timeoutMs / 1000} seconds.`);
}

async function run() {
  try {
    process.env.APPDATA = appData;
    process.env.LOCALAPPDATA = localAppData;
    process.env.CCTI_TERMINAL_MARKER = marker;
    await Promise.all([fsp.mkdir(home, { recursive: true }), fsp.mkdir(path.dirname(fakeClaude), { recursive: true }), fsp.mkdir(project, { recursive: true })]);
    await fsp.writeFile(fakeClaude, [
      '@echo off',
      'if "%~1"=="--version" (',
      '  echo claude fixture 1.0.0',
      '  exit /b 0',
      ')',
      '> "%CCTI_TERMINAL_MARKER%" echo %CD%',
      'exit /b 0',
      '',
    ].join('\r\n'), { encoding: 'utf8' });

    Module._load = function patchedLoad(request, parent, isMain) {
      if (request === 'electron') return electronStub;
      return originalLoad.call(this, request, parent, isMain);
    };
    global.fetch = async () => ({ ok: false, status: 503, json: async () => [] });
    global.setInterval = () => ({ unref() {} });

    require(path.join(root, 'desktop', 'src', 'main.js'));
    await readyPromise;

    const getPreference = handlers.get('terminal:get-preference');
    const setPreference = handlers.get('terminal:set-preference');
    const runClaude = handlers.get('claude:run');
    assert.ok(getPreference && setPreference && runClaude, 'CCTI must expose terminal preference and Claude launch handlers.');

    const initial = await getPreference();
    const availableIds = initial.options.filter((option) => option.available).map((option) => option.id);
    if (availableIds.length !== 2) {
      console.error(JSON.stringify({
        diagnostic: 'windows-terminal-discovery',
        availableIds,
        pathKeys: { PATH: Boolean(process.env.PATH), Path: Boolean(process.env.Path) },
        probes: ['powershell.exe', 'wt.exe', 'claude'].map(executableProbe),
      }));
    }
    assert.deepEqual(availableIds, ['default', 'windows-terminal'], 'fresh Windows runner must expose PowerShell and Windows Terminal choices.');

    const evidence = { ok: true, platform: 'win32', adapters: [] };
    for (const expected of [
      { id: 'default', label: 'PowerShell' },
      { id: 'windows-terminal', label: 'Windows Terminal' },
    ]) {
      await fsp.rm(marker, { force: true });
      const selected = await setPreference(null, { terminalId: expected.id });
      assert.equal(selected.ok, true, `${expected.label} must be selectable.`);
      const launched = await runClaude(null, { projectPath: project });
      assert.equal(launched.ok, true, launched.error);
      assert.match(launched.message, new RegExp(expected.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      await waitForMarker(expected.label);
      evidence.adapters.push({ id: expected.id, label: expected.label, selected: true, verifiedFixtureExecuted: true, selectedProjectDirectoryUsed: true });
    }

    if (evidencePath) await fsp.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(evidence));
  } finally {
    Module._load = originalLoad;
    global.fetch = originalFetch;
    global.setInterval = originalSetInterval;
    restoreEnv('APPDATA', originalAppData);
    restoreEnv('LOCALAPPDATA', originalLocalAppData);
    restoreEnv('CCTI_TERMINAL_MARKER', originalMarker);
    await fsp.rm(fixtureRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
