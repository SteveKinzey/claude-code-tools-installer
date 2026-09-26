#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const tempRoot = path.join(os.tmpdir(), `ccti-staging-telemetry-${process.pid}`);
const handlers = new Map();
const received = [];
const originalLoad = Module._load;
const originalFetch = global.fetch;
const originalEndpoint = process.env.ANONYMOUS_SUCCESS_ENDPOINT;
const originalElectronTest = process.env.CCTI_ELECTRON_TEST;
const originalTestHome = process.env.CCTI_TEST_HOME;
let readyCallback;
let server;

const electronStub = {
  app: {
    setPath: () => {},
    getPath: (name) => name === 'home' ? tempRoot : tempRoot,
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
        setWindowOpenHandler: () => {},
        on: () => {},
      };
    }
    async loadFile() {}
    isDestroyed() { return false; }
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true, filePath: '' }),
  },
  Notification: class { static isSupported() { return false; } },
  shell: { openExternal: async () => {} },
  ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
};

function listen() {
  return new Promise((resolve, reject) => {
    server = http.createServer((request, response) => {
      let raw = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => { raw += chunk; });
      request.on('end', () => {
        received.push({ method: request.method, url: request.url, headers: request.headers, raw });
        response.writeHead(200, { 'content-type': 'application/json' });
        const responseBody = [{ result: { data: { json: { recorded: true } } } }];
        response.end(JSON.stringify(responseBody));
      });
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function closeServer() {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
}

async function run() {
  try {
    await fs.mkdir(tempRoot, { recursive: true });
    const port = await listen();
    const endpoint = `http://127.0.0.1:${port}/api/trpc/signals.reportSetupSuccess?batch=1`;
    process.env.ANONYMOUS_SUCCESS_ENDPOINT = endpoint;
    process.env.CCTI_ELECTRON_TEST = '1';
    process.env.CCTI_TEST_HOME = tempRoot;

    global.fetch = async (input, options) => {
      const requestedUrl = typeof input === 'string' ? input : input?.url;
      if (requestedUrl === endpoint) return originalFetch(input, options);
      throw new Error(`Blocked non-staging request during telemetry contract test: ${requestedUrl}`);
    };

    Module._load = function patchedLoad(request, parent, isMain) {
      if (request === 'electron') return electronStub;
      return originalLoad.call(this, request, parent, isMain);
    };

    require(path.join(root, 'desktop', 'src', 'main.js'));
    await readyCallback();

    const report = handlers.get('telemetry:report-setup-success');
    assert.ok(report, 'The narrow telemetry IPC handler must be registered.');

    const recorded = await report(null, {
      kind: 'selected_tools',
      consent: true,
      selectedIds: ['productivity'],
      path: '/private/example',
    });
    assert.deepEqual(recorded, { ok: true, error: '' }, 'The staging collector acknowledgement must produce a successful completion count.');
    assert.equal(received.length, 1, 'Exactly one opted-in staging request must be recorded.');

    const request = received[0];
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/api/trpc/signals.reportSetupSuccess?batch=1');
    assert.match(String(request.headers['content-type'] || ''), /^application\/json/i);
    assert.deepEqual(JSON.parse(request.raw), {
      '0': { json: { kind: 'selected_tools', consent: true } },
    }, 'Telemetry must retain only the anonymous category and explicit consent.');

    const rejected = await report(null, { kind: 'selected_tools', consent: false, selectedIds: ['productivity'] });
    assert.equal(rejected.ok, false, 'The handler must reject missing consent.');
    assert.equal(received.length, 1, 'Rejected telemetry must not reach the staging collector.');

    const renderer = await fs.readFile(path.join(root, 'desktop', 'src', 'renderer', 'app.js'), 'utf8');
    assert.match(renderer, /if \(!preview\) offerAnonymousSuccessCount\('selected_tools'\);/, 'Only a successful non-preview selected-tools action may offer an anonymous completion count.');

    const adapterSource = await fs.readFile(path.join(root, 'setup-my-claude.sh'), 'utf8');
    const productivityBranch = adapterSource.match(/\n\s*productivity\)[\s\S]*?\n\s*;;\n\s*ui-ux-pro-max\)/);
    assert.ok(productivityBranch, 'The macOS adapter must retain an explicit Productivity branch.');
    assert.doesNotMatch(productivityBranch[0], /append_plugin_command|run_cmd\s+claude\s+plugin\s+install|\/plugin\s+install/i, 'The Productivity adapter branch must not queue or run a local plugin installation.');

    console.log(JSON.stringify({
      ok: true,
      collector: 'loopback staging endpoint',
      endpointPath: request.url,
      payload: JSON.parse(request.raw),
      productivityAttributionSent: false,
      productivityLocalInstallQueued: false,
      consentRequired: true,
    }));
  } finally {
    Module._load = originalLoad;
    global.fetch = originalFetch;
    if (originalEndpoint === undefined) delete process.env.ANONYMOUS_SUCCESS_ENDPOINT;
    else process.env.ANONYMOUS_SUCCESS_ENDPOINT = originalEndpoint;
    if (originalElectronTest === undefined) delete process.env.CCTI_ELECTRON_TEST;
    else process.env.CCTI_ELECTRON_TEST = originalElectronTest;
    if (originalTestHome === undefined) delete process.env.CCTI_TEST_HOME;
    else process.env.CCTI_TEST_HOME = originalTestHome;
    await closeServer();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
