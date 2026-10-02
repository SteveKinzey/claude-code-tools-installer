#!/usr/bin/env node
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
// Captured before node:child_process is replaced, so the fake plutil below can run the real one.
const realChildProcess = require('node:child_process');

const root = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccti-terminal-preference-test-'));
const home = path.join(tempRoot, 'home');
const fakeClaudePath = path.join(home, '.local', 'bin', 'claude');
const fakeItermBundle = path.join(home, 'Applications', 'iTerm.app');
const handlers = new Map();
const osascriptCalls = [];
const plutilCalls = [];
let readyCallback;
let saveDialogResult = { canceled: true, filePath: '' };
const itermFixtures = path.join(__dirname, 'fixtures', 'iterm2');
const itermPreferences = path.join(home, 'Library', 'Preferences', 'com.googlecode.iterm2.plist');
let itermFixtureName = '';
const realPlutil = process.platform === 'darwin' && fs.existsSync('/usr/bin/plutil');

// Read-only plutil extraction of "New Bookmarks". On macOS the real plutil reads the fixture plist;
// elsewhere the output it produced for that fixture (recorded next to it) is replayed.
function fakePlutil(args) {
  plutilCalls.push(args);
  assert.deepEqual(args.slice(0, 2), ['-extract', 'New Bookmarks'], 'CCTI may only extract the iTerm2 profile list');
  assert.deepEqual(args.slice(3), ['-o', '-', itermPreferences], 'plutil must print to stdout and never write the preferences file');
  if (realPlutil) {
    const result = realChildProcess.spawnSync('/usr/bin/plutil', args, { encoding: 'utf8' });
    return { code: result.status, stdout: result.stdout || '' };
  }
  const recorded = path.join(itermFixtures, `${itermFixtureName}.${args[2]}.out`);
  return fs.existsSync(recorded) ? { code: 0, stdout: fs.readFileSync(recorded, 'utf8') } : { code: 1, stdout: '' };
}

async function useItermFixture(name) {
  itermFixtureName = name;
  await fsp.mkdir(path.dirname(itermPreferences), { recursive: true });
  await fsp.copyFile(path.join(itermFixtures, `${name}.plist`), itermPreferences);
}

function fakeSpawn(command, args) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  process.nextTick(() => {
    if (command === 'which' && args[0] === 'claude') {
      child.stdout.emit('data', `${fakeClaudePath}\n`);
      child.emit('close', 0);
      return;
    }
    if (command === fakeClaudePath && args[0] === '--version') {
      child.stdout.emit('data', 'claude 1.0.0\n');
      child.emit('close', 0);
      return;
    }
    if (command === 'osascript') {
      osascriptCalls.push(args);
      child.emit('close', 0);
      return;
    }
    if (command === '/usr/bin/plutil') {
      const result = fakePlutil(args);
      if (result.stdout) child.stdout.emit('data', result.stdout);
      child.emit('close', result.code);
      return;
    }
    child.stderr.emit('data', `Unexpected command: ${command}`);
    child.emit('close', 1);
  });
  return child;
}

const electronStub = {
  app: {
    getPath: (name) => name === 'home' ? home : tempRoot,
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
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => saveDialogResult },
  Notification: class { static isSupported() { return false; } },
  shell: { openExternal: async () => {} },
  ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
};

const originalLoad = Module._load;
const originalPlatform = process.platform;
const originalSetInterval = global.setInterval;
const originalTerminalPreferenceTest = process.env.CCTI_TERMINAL_PREFERENCE_TEST;
const originalItermBundlePath = process.env.CCTI_TEST_ITERM2_BUNDLE_PATH;
const originalBundlePaths = process.env.CCTI_TEST_TERMINAL_BUNDLE_PATHS;
const originalUser = process.env.USER;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') return electronStub;
  if (request === 'node:child_process') return { spawn: fakeSpawn };
  return originalLoad.call(this, request, parent, isMain);
};
global.setInterval = () => ({ unref() {} });
Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
process.env.CCTI_TERMINAL_PREFERENCE_TEST = '1';
process.env.CCTI_TEST_ITERM2_BUNDLE_PATH = fakeItermBundle;
// Other terminal apps point at fixture paths that do not exist, so apps installed on the machine
// running the test do not change the result.
process.env.CCTI_TEST_TERMINAL_BUNDLE_PATHS = JSON.stringify(Object.fromEntries(['Ghostty.app', 'WezTerm.app', 'Alacritty.app', 'kitty.app', 'Warp.app', 'Hyper.app', 'Tabby.app'].map((bundle) => [bundle, path.join(home, 'Applications', bundle)])));

async function run() {
  try {
    await fsp.mkdir(path.dirname(fakeClaudePath), { recursive: true });
    await fsp.writeFile(fakeClaudePath, '#!/bin/sh\n', { mode: 0o755 });
    await fsp.mkdir(fakeItermBundle, { recursive: true });

    require(path.join(root, 'desktop', 'src', 'main.js'));
    await readyCallback();

    const getPreference = handlers.get('terminal:get-preference');
    const setPreference = handlers.get('terminal:set-preference');
    const testTerminal = handlers.get('terminal:test-preference');
    const runClaude = handlers.get('claude:run');
    const previewReport = handlers.get('terminal:preview-report');
    const exportReport = handlers.get('terminal:export-report');
    assert.ok(getPreference && setPreference && testTerminal && runClaude && previewReport && exportReport, 'terminal preference, test, report, and Claude launch handlers must be registered');

    const initial = await getPreference();
    assert.equal(initial.ok, true);
    assert.equal(initial.selectedId, 'default');
    assert.deepEqual(initial.options.map((option) => [option.id, option.available]), [
      ['default', true],
      ['iterm2', true],
      ['ghostty', false],
      ['wezterm', false],
      ['alacritty', false],
      ['kitty', false],
      ['warp', false],
      ['hyper', false],
      ['tabby', false],
    ]);
    assert.equal(initial.profileSupported, false, 'profile selection is offered only for iTerm2');

    const rejected = await setPreference(null, { terminalId: '/Applications/Untrusted.app' });
    assert.equal(rejected.ok, false, 'arbitrary terminal paths must be rejected');
    assert.match(rejected.error, /Custom terminal commands are not accepted/i);

    const saved = await setPreference(null, { terminalId: 'iterm2' });
    assert.equal(saved.ok, true);
    assert.equal(saved.selectedId, 'iterm2');
    const preferencePath = path.join(tempRoot, 'terminal-preference.json');
    const persisted = JSON.parse(await fsp.readFile(preferencePath, 'utf8'));
    assert.equal(persisted.terminalId, 'iterm2', 'the selected terminal must persist in CCTI-only preferences');
    if (originalPlatform !== 'win32') {
      assert.equal((await fsp.stat(preferencePath)).mode & 0o077, 0, 'terminal preference must not be group or world readable');
    } else {
      assert.deepEqual(Object.keys(persisted).sort(), ['terminalId', 'updatedAt'], 'the Windows preference file must persist only the trusted terminal identifier and a CCTI update timestamp');
      assert.ok(Number.isFinite(Date.parse(persisted.updatedAt)), 'the Windows preference timestamp must be a valid ISO date');
    }

    const iTermLaunch = await runClaude(null, {});
    assert.equal(iTermLaunch.ok, true);
    assert.match(iTermLaunch.message, /iTerm2/);
    assert.equal(osascriptCalls.length, 1);
    assert.match(osascriptCalls[0][1], /tell application id "com\.googlecode\.iterm2"/);
    assert.match(osascriptCalls[0][1], /write text/);
    assert.match(osascriptCalls[0][1], /\.local/);

    const iTermTest = await testTerminal();
    assert.equal(iTermTest.ok, true);
    assert.match(iTermTest.message, /Opened iTerm2 with the CCTI terminal launch test/);
    assert.equal(osascriptCalls.length, 2);
    assert.match(osascriptCalls[1][1], /tell application id "com\.googlecode\.iterm2"/);
    assert.match(osascriptCalls[1][1], /CCTI terminal launch test passed/);
    assert.match(osascriptCalls[1][1], /\$\{SHELL:-\/bin\/zsh\}/);

    // iTerm2 profiles: detected read-only from the iTerm2 preferences, names and GUIDs only.
    const noPreferences = await getPreference();
    assert.equal(noPreferences.profileSupported, true);
    assert.deepEqual(noPreferences.profileOptions, [], 'no iTerm2 preferences file means no detected profiles');
    assert.equal(plutilCalls.length, 0, 'plutil must not run when iTerm2 has no preferences file');

    await useItermFixture('profiles');
    const fixtureBefore = await fsp.readFile(itermPreferences);
    const withProfiles = await getPreference();
    const expectedProfiles = [
      { guid: '0D5C3F2E-1111-4A8B-9C3D-000000000001', name: 'Default' },
      { guid: '0D5C3F2E-2222-4A8B-9C3D-000000000002', name: 'Claude Code' },
      { guid: '0D5C3F2E-4444-4A8B-9C3D-000000000004', name: 'Ops "Prod" \\ Shell & Logs' },
      { guid: '0D5C3F2E-5555-4A8B-9C3D-000000000005', name: 'fixtureuser work' },
    ];
    assert.deepEqual(withProfiles.profileOptions, expectedProfiles, 'only top-level profile names and GUIDs are kept; duplicate names, invalid GUIDs and non-text names are skipped');
    assert.doesNotMatch(JSON.stringify(withProfiles), /do-not-leak|private-client-project|nested color/, 'profile commands, folders and settings never leave the main process');
    assert.deepEqual(await fsp.readFile(itermPreferences), fixtureBefore, 'detection must not change the iTerm2 preferences file');

    const unknownProfile = await setPreference(null, { terminalId: 'iterm2', terminalProfileGuid: '0D5C3F2E-3333-4A8B-9C3D-000000000003' });
    assert.equal(unknownProfile.ok, false, 'a profile that was not detected cannot be saved');
    const profileOnDefault = await setPreference(null, { terminalId: 'default', terminalProfileGuid: expectedProfiles[1].guid });
    assert.equal(profileOnDefault.ok, false, 'profiles apply only to iTerm2');

    const savedProfile = await setPreference(null, { terminalId: 'iterm2', terminalProfileGuid: expectedProfiles[1].guid });
    assert.equal(savedProfile.ok, true);
    assert.equal(savedProfile.selectedProfileGuid, expectedProfiles[1].guid);
    assert.match(savedProfile.message, /iTerm2 with the Claude Code profile/);
    assert.deepEqual(Object.keys(JSON.parse(await fsp.readFile(preferencePath, 'utf8'))).sort(), ['terminalId', 'terminalProfileGuid', 'updatedAt'], 'only the profile GUID is stored');
    const profileLaunch = await runClaude(null, {});
    assert.equal(profileLaunch.ok, true);
    const profileScript = osascriptCalls.at(-1)[1];
    assert.match(profileScript, /^tell application id "com\.googlecode\.iterm2"\nactivate\ncreate window with profile "Claude Code"\ntell current session of current window\nwrite text /);
    assert.match(profileScript, /exec '.*\.local\/bin\/claude'/, 'the profile launch still runs only the fixed Claude Code command');
    const profileTest = await testTerminal();
    assert.match(profileTest.message, /Opened iTerm2 with the Claude Code profile with the CCTI terminal launch test/);
    assert.match(osascriptCalls.at(-1)[1], /create window with profile "Claude Code"[\s\S]*CCTI terminal launch test passed/);

    const quotedProfile = await setPreference(null, { terminalId: 'iterm2', terminalProfileGuid: expectedProfiles[2].guid });
    assert.equal(quotedProfile.ok, true);
    await runClaude(null, {});
    assert.ok(osascriptCalls.at(-1)[1].includes('create window with profile "Ops \\"Prod\\" \\\\ Shell & Logs"\n'), 'quotes and backslashes in a profile name are escaped for AppleScript');

    await useItermFixture('profiles-with-data');
    assert.deepEqual((await getPreference()).profileOptions, expectedProfiles, 'profiles holding binary data are read through the XML fallback');

    await useItermFixture('malformed');
    const malformed = await getPreference();
    assert.deepEqual(malformed.profileOptions, [], 'an unreadable preferences file means no detected profiles');
    assert.match(malformed.message, /default profile because the saved iTerm2 profile was not found/);
    await runClaude(null, {});
    assert.match(osascriptCalls.at(-1)[1], /create window with default profile/, 'a missing saved profile falls back to the iTerm2 default profile');

    // Terminal report: preview, privacy, then save only through the save dialog.
    await useItermFixture('profiles');
    process.env.USER = 'fixtureuser';
    assert.equal((await setPreference(null, { terminalId: 'iterm2', terminalProfileGuid: expectedProfiles[3].guid })).ok, true);
    const preview = await previewReport();
    assert.equal(preview.ok, true);
    assert.match(preview.reportId, /^[0-9a-f-]{36}$/);
    const report = preview.report;
    assert.match(report, /^CCTI TERMINAL REPORT — local only/);
    assert.match(report, /\n  iTerm2 \(iTerm2 profile: <user> work\)\n/, 'a profile name containing the account name is scrubbed');
    assert.match(report, /  iTerm2 \[iterm2\]: installed — starts Claude Code directly/);
    assert.match(report, /  Warp \[warp\]: not installed — opens the folder; you type claude/);
    assert.match(report, /Profiles found: 4\n  Profile named Claude Code: found/);
    assert.match(report, /Kept on this computer \(not in this report\)/);
    const forbidden = [home, tempRoot, fakeItermBundle, fakeClaudePath, 'fixtureuser', 'do-not-leak', 'private-client-project', 'Ops "Prod"', 'osascript', 'write text', '/Applications'];
    for (const value of forbidden) assert.equal(report.includes(value), false, `the terminal report must not include ${value}`);
    const account = os.userInfo().username;
    assert.doesNotMatch(report, new RegExp(`(?<![A-Za-z0-9])${account.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`, 'i'), 'the terminal report must not include the account name');
    const hostName = os.hostname().split('.')[0];
    if (hostName.length >= 2) assert.equal(report.toLowerCase().includes(hostName.toLowerCase()), false, 'the terminal report must not include the computer name');
    assert.deepEqual(Object.keys(preview.privacy).sort(), ['included', 'keptLocal']);

    const canceledExport = await exportReport(null, { reportId: preview.reportId });
    assert.deepEqual(canceledExport, { ok: true, canceled: true }, 'canceling the save dialog writes nothing');
    const exportedFile = path.join(tempRoot, 'exports', 'terminal-report.txt');
    await fsp.mkdir(path.dirname(exportedFile), { recursive: true });
    saveDialogResult = { canceled: false, filePath: exportedFile };
    const exportedReport = await exportReport(null, { reportId: preview.reportId });
    assert.deepEqual(exportedReport, { ok: true, canceled: false, filename: 'terminal-report.txt' });
    assert.equal(await fsp.readFile(exportedFile, 'utf8'), `${report}\n`, 'the saved file is exactly the previewed report');
    if (originalPlatform !== 'win32') assert.equal((await fsp.stat(exportedFile)).mode & 0o077, 0, 'the saved report is readable only by its owner');
    const unknownReport = await exportReport(null, { reportId: 'not-a-report' });
    assert.equal(unknownReport.ok, false);
    assert.match(unknownReport.error, /Preview it again/);
    saveDialogResult = { canceled: true, filePath: '' };
    process.env.USER = originalUser;

    await fsp.rm(fakeItermBundle, { recursive: true, force: true });
    const fallback = await getPreference();
    assert.equal(fallback.selectedId, 'default', 'a removed preferred terminal must fall back to Default Terminal');
    assert.equal(fallback.storedId, 'iterm2');
    assert.match(fallback.message, /not installed/i);

    const defaultLaunch = await runClaude(null, {});
    assert.equal(defaultLaunch.ok, true);
    assert.match(defaultLaunch.message, /Default Terminal/);
    assert.match(defaultLaunch.message, /saved iTerm2 preference is unavailable/i);
    assert.match(osascriptCalls.at(-1)[1], /tell application id "com\.apple\.Terminal"/);

    console.log('Terminal preference behavior passed: iTerm2 selection and detected profiles persist safely, its fixed test command is sent through the tested adapter, arbitrary commands and undetected profiles are blocked, the terminal report stays scrubbed and is saved only through the save dialog, and unavailable iTerm2 falls back to Default Terminal.');
  } finally {
    Module._load = originalLoad;
    global.setInterval = originalSetInterval;
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    if (originalTerminalPreferenceTest === undefined) delete process.env.CCTI_TERMINAL_PREFERENCE_TEST;
    else process.env.CCTI_TERMINAL_PREFERENCE_TEST = originalTerminalPreferenceTest;
    if (originalItermBundlePath === undefined) delete process.env.CCTI_TEST_ITERM2_BUNDLE_PATH;
    else process.env.CCTI_TEST_ITERM2_BUNDLE_PATH = originalItermBundlePath;
    if (originalBundlePaths === undefined) delete process.env.CCTI_TEST_TERMINAL_BUNDLE_PATHS;
    else process.env.CCTI_TEST_TERMINAL_BUNDLE_PATHS = originalBundlePaths;
    if (originalUser === undefined) delete process.env.USER;
    else process.env.USER = originalUser;
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
