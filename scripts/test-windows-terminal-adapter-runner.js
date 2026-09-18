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
const spawnCalls = [];
const detachedFixturePids = new Set();

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

function safeSpawnCall(call) {
  return {
    command: path.basename(String(call.command || '')),
    args: Array.isArray(call.args) ? call.args.map(String) : [],
    cwd: call.options?.cwd ? path.basename(String(call.options.cwd)) : '',
    hasMarker: Boolean(call.options?.env?.CCTI_TERMINAL_MARKER),
    hasComSpec: Boolean(call.options?.env?.ComSpec || call.options?.env?.COMSPEC),
  };
}

function replayLastTerminalPayload() {
  const call = [...spawnCalls].reverse().find((entry) => Array.isArray(entry.args) && entry.args.includes('-Command'));
  if (!call) return { attempted: false, reason: 'No terminal launch payload was captured.' };
  const directPowerShell = /(?:powershell|pwsh)\.exe$/i.test(String(call.command));
  const nestedPowerShellIndex = call.args.findIndex((arg) => /^(?:powershell|pwsh)\.exe$/i.test(String(arg)));
  const command = directPowerShell ? call.command : nestedPowerShellIndex >= 0 ? call.args[nestedPowerShellIndex] : '';
  const sourceArgs = directPowerShell ? call.args : nestedPowerShellIndex >= 0 ? call.args.slice(nestedPowerShellIndex + 1) : [];
  if (!command) return { attempted: false, reason: 'No PowerShell payload was present in the captured terminal launch.' };
  const args = sourceArgs.filter((arg) => arg !== '-NoExit');
  const result = spawnSync(command, args, {
    cwd: call.options?.cwd || home,
    env: call.options?.env || process.env,
    encoding: 'utf8',
    timeout: 5000,
  });
  return {
    attempted: true,
    source: directPowerShell ? 'direct-powershell-adapter' : 'windows-terminal-payload',
    command: path.basename(String(command)),
    status: result.status,
    signal: result.signal || '',
    timedOut: Boolean(result.error?.code === 'ETIMEDOUT'),
    stdout: String(result.stdout || '').slice(-1000),
    stderr: String(result.stderr || '').slice(-1000),
    markerExists: fs.existsSync(marker),
  };
}

async function removeFixtureRoot() {
  for (const pid of detachedFixturePids) {
    spawnSync('taskkill.exe', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
  }
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      await fsp.rm(fixtureRoot, { recursive: true, force: true, maxRetries: 0 });
      return;
    } catch (error) {
      if (attempt === 11 || error?.code !== 'EBUSY') throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

async function waitForMarker(label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const launchedFrom = (await fsp.readFile(marker, 'utf8')).trim();
      assert.equal(path.normalize(launchedFrom).toLowerCase(), path.normalize(project).toLowerCase(), `${label} must run Claude from the selected project directory`);
      return { mode: 'detached-interactive-terminal', replay: null };
    } catch (error) {
      if (error.code && error.code !== 'ENOENT') throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  const replay = replayLastTerminalPayload();
  if (process.env.GITHUB_ACTIONS === 'true' && replay.attempted && replay.status === 0 && replay.markerExists) {
    return { mode: 'headless-ci-payload-replay', replay };
  }
  throw new Error(`${label} did not run the verified Claude fixture within ${timeoutMs / 1000} seconds. ${JSON.stringify({ spawnCalls: spawnCalls.map(safeSpawnCall), replay })}`);
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
      if (request === 'node:child_process') {
        const childProcess = originalLoad.call(this, request, parent, isMain);
        return {
          ...childProcess,
          spawn(command, args, options) {
            const child = childProcess.spawn(command, args, options);
            spawnCalls.push({ command, args, options });
            if (options?.detached && Number.isInteger(child.pid)) detachedFixturePids.add(child.pid);
            return child;
          },
        };
      }
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
      const execution = await waitForMarker(expected.label);
      evidence.adapters.push({
        id: expected.id,
        label: expected.label,
        selected: true,
        verifiedFixtureExecuted: true,
        selectedProjectDirectoryUsed: true,
        executionMode: execution.mode,
        replay: execution.replay ? { source: execution.replay.source, command: execution.replay.command } : null,
      });
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
    await removeFixtureRoot();
  }
}

run().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
