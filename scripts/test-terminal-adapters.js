#!/usr/bin/env node
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const platform = process.argv[2];
if (!['darwin', 'win32', 'linux'].includes(platform)) throw new Error('Usage: node scripts/test-terminal-adapters.js <darwin|win32|linux>');

const root = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ccti-${platform}-terminal-adapter-test-`));
const home = path.join(tempRoot, 'home');
const fakeClaudePath = platform === 'win32'
  ? path.join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd')
  : path.join(home, '.local', 'bin', 'claude');
const windowsTerminalPackage = path.join(home, 'WindowsTerminal-package');
const handlers = new Map();
const launches = [];
let readyCallback;

const macBundles = Object.fromEntries(['iTerm.app', 'Ghostty.app', 'WezTerm.app', 'Alacritty.app', 'kitty.app'].map((bundle) => [bundle, path.join(home, 'Applications', bundle)]));
const commandLocations = {
  claude: fakeClaudePath,
  'pwsh.exe': 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
  'powershell.exe': 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  'wt.exe': 'C:\\Users\\fixture\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe',
  'WindowsTerminal.exe': path.join(windowsTerminalPackage, 'WindowsTerminal.exe'),
  'x-terminal-emulator': '/usr/bin/x-terminal-emulator',
  'gnome-terminal': '/usr/bin/gnome-terminal',
  konsole: '/usr/bin/konsole',
  xterm: '/usr/bin/xterm',
  kitty: '/usr/bin/kitty',
  alacritty: '/usr/bin/alacritty',
};

function child() {
  const result = new EventEmitter();
  result.stdout = new EventEmitter();
  result.stderr = new EventEmitter();
  result.unref = () => {};
  return result;
}

function fakeSpawn(command, args, options = {}) {
  const result = child();
  process.nextTick(() => {
    if (command === 'which' || command === 'where.exe') {
      if (platform === 'win32') assert.match(options.env?.Path || '', /Windows\\System32/, 'Windows command discovery must preserve a mixed-case inherited Path variable');
      const located = commandLocations[args[0]] || '';
      if (located) {
        result.stdout.emit('data', `${located}\n`);
        result.emit('close', 0);
      } else {
        result.emit('close', 1);
      }
      return;
    }
    if (command === 'powershell.exe' && args.some((arg) => String(arg).includes('Get-AppxPackage'))) {
      result.stdout.emit('data', `${windowsTerminalPackage}\n`);
      result.emit('close', 0);
      return;
    }
    if (command === fakeClaudePath && args[0] === '--version') {
      result.stdout.emit('data', 'claude 1.0.0\n');
      result.emit('close', 0);
      return;
    }
    launches.push({ command, args, options: null });
    if (command === 'osascript') {
      result.emit('close', 0);
      return;
    }
    result.emit('spawn');
  });
  return result;
}

const electronStub = {
  app: {
    getPath: (name) => name === 'home' ? home : tempRoot,
    isPackaged: false,
    whenReady: () => ({ then: (callback) => { readyCallback = callback; } }),
    on: () => {},
    quit: () => {},
  },
  BrowserWindow: class { static getAllWindows() { return []; } constructor() { this.webContents = { send: () => {} }; } async loadFile() {} isDestroyed() { return false; } },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true, filePath: '' }) },
  Notification: class { static isSupported() { return false; } },
  shell: { openExternal: async () => {} },
  ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
};

const originalLoad = Module._load;
const originalPlatform = process.platform;
const originalSetInterval = global.setInterval;
const originalPreferenceTest = process.env.CCTI_TERMINAL_PREFERENCE_TEST;
const originalBundlePaths = process.env.CCTI_TEST_TERMINAL_BUNDLE_PATHS;
const originalPath = process.env.PATH;
const originalWindowsPath = process.env.Path;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') return electronStub;
  if (request === 'node:child_process') return { spawn: fakeSpawn };
  return originalLoad.call(this, request, parent, isMain);
};
global.setInterval = () => ({ unref() {} });
Object.defineProperty(process, 'platform', { value: platform, configurable: true });
process.env.CCTI_TERMINAL_PREFERENCE_TEST = '1';
process.env.CCTI_TEST_TERMINAL_BUNDLE_PATHS = JSON.stringify(macBundles);
if (platform === 'win32') {
  delete process.env.PATH;
  process.env.Path = 'C:\\Windows\\System32';
}

async function select(setPreference, terminalId) {
  const result = await setPreference(null, { terminalId });
  assert.equal(result.ok, true, `${terminalId} must be selectable when detected`);
  assert.equal(result.selectedId, terminalId);
}

async function run() {
  try {
    await fsp.mkdir(path.dirname(fakeClaudePath), { recursive: true });
    await fsp.writeFile(fakeClaudePath, platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n', { mode: 0o755 });
    if (platform === 'darwin') await Promise.all(Object.values(macBundles).map((bundle) => fsp.mkdir(bundle, { recursive: true })));

    require(path.join(root, 'desktop', 'src', 'main.js'));
    await readyCallback();
    const getPreference = handlers.get('terminal:get-preference');
    const setPreference = handlers.get('terminal:set-preference');
    const runClaude = handlers.get('claude:run');
    const testTerminal = handlers.get('terminal:test-preference');
    assert.ok(getPreference && setPreference && runClaude && testTerminal, 'all terminal preference handlers must be registered');

    const initial = await getPreference();
    assert.ok(initial.options.length >= 2, `${platform} must expose a real terminal choice when supported terminal apps are detected`);
    assert.ok(initial.options.every((option) => option.available), `${platform} fixture terminal options must be available`);

    if (platform === 'darwin') {
      assert.deepEqual(initial.options.map((option) => option.id), ['default', 'iterm2', 'ghostty', 'wezterm', 'alacritty', 'kitty']);
      await select(setPreference, 'ghostty');
      const ghostty = await runClaude(null, { projectPath: home });
      assert.equal(ghostty.ok, true);
      assert.match(ghostty.message, /Ghostty/);
      assert.deepEqual(launches.at(-1).args, ['-e', 'bash', '-lc', `cd '${home}'; exec '${fakeClaudePath}'`]);
      assert.match(launches.at(-1).command.replace(/\\/g, '/'), /Ghostty\.app\/Contents\/MacOS\/ghostty$/);
      await select(setPreference, 'iterm2');
      const test = await testTerminal();
      assert.equal(test.ok, true);
      assert.match(test.message, /iTerm2/);
      assert.equal(launches.at(-1).command, 'osascript');
      assert.match(launches.at(-1).args[1], /CCTI terminal launch test passed/);
      assert.match(launches.at(-1).args[1], /tell application id "com\.googlecode\.iterm2"/);
    } else if (platform === 'win32') {
      assert.deepEqual(initial.options.map((option) => option.id), ['default', 'windows-terminal']);
      await select(setPreference, 'windows-terminal');
      const launched = await runClaude(null, { projectPath: home });
      assert.equal(launched.ok, true);
      assert.match(launched.message, /Windows Terminal/);
      assert.equal(launches.at(-1).command, commandLocations['wt.exe']);
      assert.deepEqual(launches.at(-1).args.slice(0, 6), ['-d', home, 'powershell.exe', '-NoLogo', '-NoProfile', '-NoExit']);
      assert.match(launches.at(-1).args.at(-1), /Set-Location -LiteralPath/);
      assert.match(launches.at(-1).args.at(-1), /ComSpec/);
      assert.match(launches.at(-1).args.at(-1), /claude\.cmd/);
      delete commandLocations['wt.exe'];
      const packageExecutable = commandLocations['WindowsTerminal.exe'];
      await fsp.mkdir(path.dirname(packageExecutable), { recursive: true });
      await fsp.writeFile(packageExecutable, 'fixture');
      const packageFallback = await getPreference();
      assert.equal(packageFallback.options.find((option) => option.id === 'windows-terminal')?.available, true, 'registered Windows Terminal packages must remain available when the wt.exe alias is absent');
      await select(setPreference, 'windows-terminal');
      const packageLaunch = await runClaude(null, { projectPath: home });
      assert.equal(packageLaunch.ok, true);
      assert.equal(launches.at(-1).command, packageExecutable);
    } else {
      assert.deepEqual(initial.options.map((option) => option.id), ['default', 'gnome-terminal', 'konsole', 'xterm', 'kitty', 'alacritty']);
      await select(setPreference, 'kitty');
      const launched = await runClaude(null, { projectPath: home });
      assert.equal(launched.ok, true);
      assert.match(launched.message, /Kitty/);
      assert.equal(launches.at(-1).command, commandLocations.kitty);
      assert.deepEqual(launches.at(-1).args, ['--directory', home, 'bash', '-lc', `cd '${home}'; exec '${fakeClaudePath}'`]);
    }

    console.log(JSON.stringify({ ok: true, platform, availableChoices: initial.options.map((option) => option.id), checkedLaunches: launches.length }));
  } finally {
    Module._load = originalLoad;
    global.setInterval = originalSetInterval;
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    if (originalPreferenceTest === undefined) delete process.env.CCTI_TERMINAL_PREFERENCE_TEST;
    else process.env.CCTI_TERMINAL_PREFERENCE_TEST = originalPreferenceTest;
    if (originalBundlePaths === undefined) delete process.env.CCTI_TEST_TERMINAL_BUNDLE_PATHS;
    else process.env.CCTI_TEST_TERMINAL_BUNDLE_PATHS = originalBundlePaths;
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (originalWindowsPath === undefined) delete process.env.Path;
    else process.env.Path = originalWindowsPath;
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}
run().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
