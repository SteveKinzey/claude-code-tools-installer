#!/usr/bin/env node
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const tempRoot = path.join(os.tmpdir(), `ccti-action-boundaries-${process.pid}`);
const home = path.join(tempRoot, 'home');
const project = path.join(tempRoot, 'project');
const handlers = new Map();
const openedUrls = [];
const componentSpawns = [];
const windows = [];
let readyCallback;

function childProcess() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  return child;
}

function spawnStub(command, args = []) {
  const child = childProcess();
  const completeSetup = args.includes('--complete') || args.includes('-Complete');
  const prerequisiteSetup = args.includes('--project-prerequisites') || args.includes('-ProjectPrerequisites');
  if (prerequisiteSetup) {
    componentSpawns.push(child);
    return child;
  }
  queueMicrotask(() => {
    // On Windows, npm.cmd is launched through cmd.exe as one quoted command line
    // ('"npm.cmd" install <package>'); elsewhere it is "npm" with separate arguments.
    if (completeSetup || /^"?npm(\.cmd)?"?(\s|$)/.test(String(command))) child.emit('close', 0);
    else child.emit('close', 1);
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
    constructor() {
      this.webContents = {
        send: () => {},
        setWindowOpenHandler: (handler) => { this.windowOpenHandler = handler; },
        on: (event, handler) => { if (event === 'will-navigate') this.willNavigateHandler = handler; },
      };
      windows.push(this);
    }
    async loadFile() {}
    isDestroyed() { return false; }
  },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true, filePath: '' }) },
  Notification: class { static isSupported() { return false; } },
  shell: { openExternal: async (url) => { openedUrls.push(url); } },
  ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') return electronStub;
  if (request === 'node:child_process') return { ...originalLoad.call(this, request, parent, isMain), spawn: spawnStub };
  return originalLoad.call(this, request, parent, isMain);
};

async function run() {
  try {
    await fs.mkdir(home, { recursive: true });
    await fs.mkdir(project, { recursive: true });
    require(path.join(root, 'desktop', 'src', 'main.js'));
    await readyCallback();

    const completeSetup = handlers.get('setup:complete');
    const installComponents = handlers.get('components:install');
    assert.ok(completeSetup && installComponents, 'complete setup and component installation handlers must be registered');

    const setupResult = await completeSetup(null, { fresh: false });
    assert.equal(setupResult.ok, false, 'a zero-exit installer without a usable Claude command must not report setup success');
    assert.equal(setupResult.installed, false);
    assert.match(setupResult.error, /could not verify Claude Code/i);

    const window = windows.at(-1);
    assert.ok(window?.windowOpenHandler && window?.willNavigateHandler, 'the primary window must install navigation controls');
    assert.deepEqual(window.windowOpenHandler({ url: 'https://example.com/release-notes' }), { action: 'deny' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(openedUrls, ['https://example.com/release-notes'], 'trusted external pages must open outside the privileged renderer');
    assert.deepEqual(window.windowOpenHandler({ url: 'javascript:window.installer.applyCustomAddOn()' }), { action: 'deny' });
    assert.deepEqual(openedUrls, ['https://example.com/release-notes'], 'unsafe protocols must never be opened');
    let navigationPrevented = false;
    window.willNavigateHandler({ preventDefault: () => { navigationPrevented = true; } });
    assert.equal(navigationPrevented, true, 'in-window navigation must be prevented');

    const componentCatalog = JSON.parse(await fs.readFile(path.join(root, 'desktop', 'convex-components.json'), 'utf8'));
    const firstInstall = installComponents(null, { projectPath: project, componentIds: [componentCatalog.components[0].id], dryRun: false });
    // Project prerequisite discovery includes asynchronous filesystem work. Use
    // a bounded wall-clock wait instead of racing only queued microtasks.
    for (let attempts = 0; attempts < 100 && componentSpawns.length === 0; attempts += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(componentSpawns.length, 1, 'the first component install must reach its prerequisite boundary');
    const concurrentInstall = await installComponents(null, { projectPath: project, componentIds: [componentCatalog.components[0].id], dryRun: false });
    assert.equal(concurrentInstall.ok, false);
    assert.match(concurrentInstall.error, /already running/i);
    componentSpawns[0].emit('close', 0);
    const firstResult = await firstInstall;
    assert.equal(firstResult.ok, true, 'the original component install should complete after the lock releases');

    console.log('Desktop action boundaries passed: reviewed setup truthfulness, external navigation isolation, and component-install locking are enforced.');
  } finally {
    Module._load = originalLoad;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
