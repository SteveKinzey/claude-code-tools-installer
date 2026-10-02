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
const windowsCommandModule = path.join(root, 'desktop', 'src', 'windows-command.js');
const { quoteCommand } = require(windowsCommandModule);
// Drop the cached copy so main.js loads it again after child_process is replaced below.
delete require.cache[require.resolve(windowsCommandModule)];
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ccti-${platform}-terminal-adapter-test-`));
const home = path.join(tempRoot, 'home');
const fakeClaudePath = platform === 'win32'
  ? path.join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd')
  : path.join(home, '.local', 'bin', 'claude');
const handlers = new Map();
const launches = [];
const externalUrls = [];
let readyCallback;

const macBundles = Object.fromEntries(['iTerm.app', 'Ghostty.app', 'WezTerm.app', 'Alacritty.app', 'kitty.app', 'Warp.app', 'Hyper.app', 'Tabby.app'].map((bundle) => [bundle, path.join(home, 'Applications', bundle)]));
const commandLocations = {
  claude: fakeClaudePath,
  'pwsh.exe': 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
  'powershell.exe': 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  'wt.exe': 'C:\\Users\\fixture\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe',
  'x-terminal-emulator': '/usr/bin/x-terminal-emulator',
  'gnome-terminal': '/usr/bin/gnome-terminal',
  konsole: '/usr/bin/konsole',
  xterm: '/usr/bin/xterm',
  kitty: '/usr/bin/kitty',
  alacritty: '/usr/bin/alacritty',
  'warp-terminal': '/usr/bin/warp-terminal',
  hyper: '/usr/bin/hyper',
  tabby: '/usr/bin/tabby',
};
// Windows terminal apps found at absolute known install folders (Hyper, Tabby, Warp) or, for
// Git Bash, next to the git.exe found on an absolute PATH entry.
const windowsApps = {
  hyper: 'C:\\Users\\fixture\\AppData\\Local\\Programs\\Hyper\\Hyper.exe',
  tabby: 'C:\\Program Files\\Tabby\\Tabby.exe',
  warp: 'C:\\Users\\fixture\\AppData\\Local\\Programs\\Warp\\warp.exe',
  git: 'D:\\Tools\\Git\\cmd\\git.exe',
  gitBash: 'D:\\Tools\\Git\\git-bash.exe',
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
    if (platform === 'win32' && command === 'where.exe') throw new Error('where.exe must be resolved to an absolute path before it is spawned');
    if (command === 'which' || command === 'C:\\Windows\\System32\\where.exe') {
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
    // On Windows CCTI runs claude.cmd through cmd.exe as one quoted command line (shell: true).
    const windowsShellVersionCheck = options.shell === true && args.length === 0 && command === `${quoteCommand(fakeClaudePath)} --version`;
    if ((command === fakeClaudePath && args[0] === '--version') || windowsShellVersionCheck) {
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
  shell: { openExternal: async (url) => { externalUrls.push(url); } },
  ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
};

const originalLoad = Module._load;
const originalPlatform = process.platform;
const originalSetInterval = global.setInterval;
const originalPreferenceTest = process.env.CCTI_TERMINAL_PREFERENCE_TEST;
const originalBundlePaths = process.env.CCTI_TEST_TERMINAL_BUNDLE_PATHS;
const originalPath = process.env.PATH;
const originalWindowsPath = process.env.Path;
const originalWindowsFolders = { LOCALAPPDATA: process.env.LOCALAPPDATA, ProgramFiles: process.env.ProgramFiles, 'ProgramFiles(x86)': process.env['ProgramFiles(x86)'] };
// On Windows CCTI resolves bare program names (where.exe, powershell.exe) to absolute paths from
// absolute PATH entries only. Simulate the Windows files those lookups probe.
const windowsFixtureFiles = new Set(['C:\\Windows\\System32\\where.exe', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ...Object.values(windowsApps)]);
const windowsFs = {
  ...fs,
  statSync(candidate, ...rest) {
    if (/^[A-Za-z]:\\/.test(String(candidate))) {
      if (windowsFixtureFiles.has(String(candidate))) return { isFile: () => true };
      const error = new Error(`ENOENT: ${candidate}`);
      error.code = 'ENOENT';
      throw error;
    }
    return fs.statSync(candidate, ...rest);
  },
  lstatSync(candidate, ...rest) {
    if (/^[A-Za-z]:\\/.test(String(candidate))) return windowsFs.statSync(candidate);
    return fs.lstatSync(candidate, ...rest);
  },
};
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') return electronStub;
  if (request === 'node:fs' && platform === 'win32') return windowsFs;
  if (request === 'node:child_process') return { spawn: fakeSpawn };
  return originalLoad.call(this, request, parent, isMain);
};
global.setInterval = () => ({ unref() {} });
Object.defineProperty(process, 'platform', { value: platform, configurable: true });
process.env.CCTI_TERMINAL_PREFERENCE_TEST = '1';
process.env.CCTI_TEST_TERMINAL_BUNDLE_PATHS = JSON.stringify(macBundles);
if (platform === 'win32') {
  delete process.env.PATH;
  process.env.Path = 'C:\\Windows\\System32;C:\\Windows\\System32\\WindowsPowerShell\\v1.0;D:\\Tools\\Git\\cmd';
  process.env.LOCALAPPDATA = 'C:\\Users\\fixture\\AppData\\Local';
  process.env.ProgramFiles = 'C:\\Program Files';
  process.env['ProgramFiles(x86)'] = 'C:\\Program Files (x86)';
}

const warpUrl = (folder) => `warp://action/new_window?path=${encodeURIComponent(folder)}`;

// Folder-only apps open the folder and say, in the status text, to type claude there.
async function assertFolderOnly(runClaude, testTerminal, label) {
  const launched = await runClaude(null, { projectPath: home });
  assert.equal(launched.ok, true, `${label} must open`);
  assert.equal(launched.manualStart, true);
  assert.equal(launched.message, `${label} opened in the selected folder. ${label} does not let CCTI start programs, so type claude in the new ${label} window and press Enter to start Claude Code.`);
  const tested = await testTerminal();
  assert.equal(tested.ok, true, `${label} must be testable`);
  assert.match(tested.message, new RegExp(`^Opened ${label} in your home folder\\. .*a new ${label} window means the test passed\\. .*type claude`));
}

// A folder-only app that disappears falls back to the default terminal exactly as before.
async function assertFallback(getPreference, terminalId, removeApp) {
  await removeApp();
  const fallback = await getPreference();
  assert.equal(fallback.storedId, terminalId);
  assert.equal(fallback.selectedId, 'default', `${terminalId} must fall back to the default terminal when it is removed`);
  assert.match(fallback.message, /not installed/);
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
      assert.deepEqual(initial.options.map((option) => option.id), ['default', 'iterm2', 'ghostty', 'wezterm', 'alacritty', 'kitty', 'warp', 'hyper', 'tabby']);
      assert.deepEqual(initial.options.filter((option) => option.runsCommand === false).map((option) => option.id), ['warp', 'hyper', 'tabby']);
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

      await select(setPreference, 'warp');
      const launchCount = launches.length;
      await assertFolderOnly(runClaude, testTerminal, 'Warp');
      assert.equal(launches.length, launchCount, 'Warp opens through its documented URI, not a spawned program');
      assert.deepEqual(externalUrls.slice(-2), [warpUrl(home), warpUrl(home)]);

      await select(setPreference, 'hyper');
      await assertFolderOnly(runClaude, testTerminal, 'Hyper');
      assert.deepEqual(launches.at(-2), { command: '/usr/bin/open', args: ['-a', macBundles['Hyper.app'], home], options: null });

      await select(setPreference, 'tabby');
      await assertFolderOnly(runClaude, testTerminal, 'Tabby');
      assert.match(launches.at(-2).command.replace(/\\/g, '/'), /Tabby\.app\/Contents\/MacOS\/Tabby$/);
      assert.deepEqual(launches.at(-2).args, ['open', home]);

      await assertFallback(getPreference, 'tabby', () => fsp.rm(macBundles['Tabby.app'], { recursive: true, force: true }));
      const fallbackLaunch = await runClaude(null, { projectPath: home });
      assert.match(fallbackLaunch.message, /^Claude Code opened in Default Terminal .*saved Tabby preference is unavailable/);
      assert.match(launches.at(-1).args[1], /tell application id "com\.apple\.Terminal"/);
    } else if (platform === 'win32') {
      assert.deepEqual(initial.options.map((option) => option.id), ['default', 'windows-terminal', 'git-bash', 'warp', 'hyper', 'tabby']);
      await select(setPreference, 'windows-terminal');
      const launched = await runClaude(null, { projectPath: home });
      assert.equal(launched.ok, true);
      assert.match(launched.message, /Windows Terminal/);
      assert.equal(launches.at(-1).command, commandLocations['wt.exe']);
      assert.deepEqual(launches.at(-1).args.slice(0, 6), ['-d', home, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', '-NoLogo', '-NoProfile', '-NoExit'], 'Windows Terminal must receive PowerShell as an absolute path, never a bare name it could find in the project folder');
      // A bare program name that is not on an absolute PATH entry fails instead of being searched
      // for in the project folder.
      const savedPath = process.env.Path;
      process.env.Path = 'C:\\Windows\\System32';
      const refused = await runClaude(null, { projectPath: home });
      process.env.Path = savedPath;
      assert.equal(refused.ok, false, 'an unresolvable powershell.exe must stop the launch');
      assert.equal(launches.at(-1).args[2], 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', 'nothing new may be launched when powershell.exe cannot be resolved');
      assert.match(launches.at(-1).args.at(-1), /Set-Location -LiteralPath/);
      assert.match(launches.at(-1).args.at(-1), /ComSpec/);
      assert.match(launches.at(-1).args.at(-1), /claude\.cmd/);

      await select(setPreference, 'git-bash');
      await assertFolderOnly(runClaude, testTerminal, 'Git Bash');
      assert.deepEqual(launches.at(-2), { command: windowsApps.gitBash, args: [`--cd=${home}`], options: null }, 'Git Bash is the absolute git-bash.exe next to the git.exe on PATH and opens in the folder');

      await select(setPreference, 'hyper');
      await assertFolderOnly(runClaude, testTerminal, 'Hyper');
      assert.deepEqual(launches.at(-2), { command: windowsApps.hyper, args: [home], options: null });

      await select(setPreference, 'tabby');
      await assertFolderOnly(runClaude, testTerminal, 'Tabby');
      assert.deepEqual(launches.at(-2), { command: windowsApps.tabby, args: ['open', home], options: null });

      await select(setPreference, 'warp');
      const launchCount = launches.length;
      await assertFolderOnly(runClaude, testTerminal, 'Warp');
      assert.equal(launches.length, launchCount, 'Warp opens through its documented URI, not a spawned program');
      assert.deepEqual(externalUrls.slice(-2), [warpUrl(home), warpUrl(home)]);

      // Known install folders only come from absolute environment values.
      const savedLocalAppData = process.env.LOCALAPPDATA;
      process.env.LOCALAPPDATA = 'relative\\AppData';
      assert.equal((await getPreference()).options.find((option) => option.id === 'hyper').available, false, 'a relative LOCALAPPDATA must never be used to find Hyper');
      process.env.LOCALAPPDATA = savedLocalAppData;

      await select(setPreference, 'git-bash');
      await assertFallback(getPreference, 'git-bash', async () => {
        windowsFixtureFiles.delete(windowsApps.gitBash);
      });
      const fallbackLaunch = await runClaude(null, { projectPath: home });
      assert.match(fallbackLaunch.message, /^Claude Code opened in PowerShell .*saved Git Bash preference is unavailable/);
      assert.ok(launches.every((launch) => /^[A-Za-z]:\\/.test(launch.command)), 'every Windows terminal program is started by absolute path');
    } else {
      assert.deepEqual(initial.options.map((option) => option.id), ['default', 'gnome-terminal', 'konsole', 'xterm', 'kitty', 'alacritty', 'warp', 'hyper', 'tabby']);
      await select(setPreference, 'kitty');
      const launched = await runClaude(null, { projectPath: home });
      assert.equal(launched.ok, true);
      assert.match(launched.message, /Kitty/);
      assert.equal(launches.at(-1).command, commandLocations.kitty);
      assert.deepEqual(launches.at(-1).args, ['--directory', home, 'bash', '-lc', `cd '${home}'; exec '${fakeClaudePath}'`]);

      await select(setPreference, 'hyper');
      await assertFolderOnly(runClaude, testTerminal, 'Hyper');
      assert.deepEqual(launches.at(-2), { command: commandLocations.hyper, args: [home], options: null });

      await select(setPreference, 'tabby');
      await assertFolderOnly(runClaude, testTerminal, 'Tabby');
      assert.deepEqual(launches.at(-2), { command: commandLocations.tabby, args: ['open', home], options: null });

      await select(setPreference, 'warp');
      const launchCount = launches.length;
      await assertFolderOnly(runClaude, testTerminal, 'Warp');
      assert.equal(launches.length, launchCount, 'Warp opens through its documented URI, not a spawned program');
      assert.deepEqual(externalUrls.slice(-2), [warpUrl(home), warpUrl(home)]);

      await assertFallback(getPreference, 'warp', async () => { delete commandLocations['warp-terminal']; });
      const fallbackLaunch = await runClaude(null, { projectPath: home });
      assert.match(fallbackLaunch.message, /^Claude Code opened in Default system terminal .*saved Warp preference is unavailable/);
      assert.equal(launches.at(-1).command, commandLocations['x-terminal-emulator']);
    }

    console.log(JSON.stringify({ ok: true, platform, availableChoices: initial.options.map((option) => option.id), checkedLaunches: launches.length, checkedUriOpens: externalUrls.length }));
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
    for (const [name, value] of Object.entries(originalWindowsFolders)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}
run().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
