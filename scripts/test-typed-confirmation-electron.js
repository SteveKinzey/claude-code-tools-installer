#!/usr/bin/env node
// Real-Electron renderer test for the four destructive flows that need a typed final check:
// Remove Claude Code, Uninstall CCTI, Remove project package, and Remove CCTI extras.
// Electron's window.prompt throws ("prompt() is not supported"), so it is deliberately NOT
// stubbed here: each flow must use the in-app typed-confirmation dialog. For every flow this
// proves the dialog appears, a wrong phrase keeps the action disabled, Cancel sends nothing, and
// the exact phrase sends the same apply payload as before (review id + confirmation).
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow } = require('electron');
const { externalBridgeTag } = require('./renderer-fixture-bridge');

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('headless');
  app.commandLine.appendSwitch('disable-gpu');
}

const root = path.resolve(__dirname, '..');
const rendererDir = path.join(root, 'desktop', 'src', 'renderer');
const indexPath = path.join(rendererDir, 'index.html');
const fixturePath = path.join(os.tmpdir(), `ccti-typed-confirmation-${process.pid}.html`);

function injectedBridge() {
  return `
<script>
  (() => {
    const calls = [];
    window.__typedConfirmFixture = { calls };
    const record = (method, payload) => calls.push({ method, payload });
    // window.confirm works in Electron; answer the earlier review steps. Decline only the
    // optional "save a manifest first" question. window.prompt is intentionally left real.
    window.confirm = (message) => !String(message).includes('save a private installation manifest');
    window.alert = (message) => record('alert', message);
    document.addEventListener('securitypolicyviolation', (event) => record('csp-violation', event.effectiveDirective));

    window.installer = {
      getCatalog: async () => [],
      getCatalogDetails: async () => ({ items: [] }),
      getComponentCatalog: async () => ({ components: [], count: 0 }),
      getCompassStatus: async () => ({ available: false }),
      getUpdateStatus: async () => ({ state: 'idle', message: 'No update check has run yet.' }),
      getTerminalPreference: async () => ({ ok: true, selectedId: 'default', options: [{ id: 'default', label: 'Default Terminal', available: true }], message: 'Claude Code will open in Default Terminal.' }),
      setTerminalPreference: async () => ({ ok: true, selectedId: 'default', options: [], message: '' }),
      getClaudeStatus: async () => ({ installed: true, version: 'fixture', path: '/fixture-home/.local/bin/claude' }),
      verifySetup: async () => ({ ok: true, ready: true, summary: 'Ready.', checks: [] }),
      reviewClaudeRemoval: async () => {
        record('reviewClaudeRemoval');
        return { ok: true, reviewId: 'claude-removal-review', removable: [{ label: 'Claude Code launcher', scope: 'This computer' }], settings: [{ label: 'Claude Code settings', scope: 'This computer' }], protected: ['Claude Desktop app and its data'], attention: [] };
      },
      applyClaudeRemoval: async (payload) => { record('applyClaudeRemoval', payload); return { ok: true, message: 'Removed the reviewed Claude Code items.' }; },
      reviewAppUninstall: async () => {
        record('reviewAppUninstall');
        return { ok: true, reviewId: 'app-uninstall-review', removable: [{ label: 'CCTI app data', path: '/fixture-home/.setup-my-claude' }], protected: ['Claude Code'], platformGuidance: 'Move the app to the Trash afterwards.' };
      },
      applyAppUninstall: async (payload) => { record('applyAppUninstall', payload); return { ok: true, message: 'CCTI app data removed.', cleanupGuidance: '' }; },
      exportInstallationManifest: async () => ({ ok: true, canceled: true }),
      reviewProjectPackageRemoval: async (payload) => {
        record('reviewProjectPackageRemoval', payload);
        return { ok: true, reviewId: 'project-package-review', name: 'left-pad', projectPath: '/fixture/project', packageJsonPath: '/fixture/project/package.json', command: 'npm uninstall --ignore-scripts -- left-pad' };
      },
      applyProjectPackageRemoval: async (payload) => { record('applyProjectPackageRemoval', payload); return { ok: false, error: 'Fixture stopped before package removal.' }; },
      reviewManagedExtrasRemoval: async () => {
        record('reviewManagedExtrasRemoval');
        return { ok: true, reviewId: 'managed-extras-review', actions: [{ label: 'CCTI reference folder: learn-claude-code' }], manualItems: [], description: 'Removes only reviewed CCTI-managed extras.' };
      },
      applyManagedExtrasRemoval: async (payload) => { record('applyManagedExtrasRemoval', payload); return { ok: false, error: 'Fixture stopped before managed extras removal.' }; },
      reportAnonymousSetupSuccess: async () => ({ ok: true }),
      onOutput: () => {},
      onState: () => {},
      onComponentOutput: () => {},
      onComponentState: () => {},
      onUpdateStatus: () => {},
    };
  })();
</script>`;
}

async function evaluate(window, expression) {
  return window.webContents.executeJavaScript(expression, true);
}

async function waitFor(window, predicate, label) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await evaluate(window, `(${predicate.toString()})()`)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

const dialogOpen = () => document.querySelector('#typed-confirm-dialog')?.open === true;
const dialogClosed = () => document.querySelector('#typed-confirm-dialog')?.open === false;

async function typePhrase(window, value) {
  return evaluate(window, `(() => {
    const input = document.querySelector('#typed-confirm-input');
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return document.querySelector('#apply-typed-confirm-button').disabled;
  })()`);
}

async function callsOf(window, method) {
  return evaluate(window, `window.__typedConfirmFixture.calls.filter((call) => call.method === ${JSON.stringify(method)})`);
}

const flows = [
  {
    label: 'Remove Claude Code',
    start: "document.querySelector('#remove-claude-button').click()",
    phrase: 'REMOVE CLAUDE CODE',
    title: 'Remove Claude Code',
    confirmLabel: 'Remove Claude Code',
    apply: 'applyClaudeRemoval',
    payload: { reviewId: 'claude-removal-review', confirmation: 'REMOVE CLAUDE CODE', removeSettings: true },
  },
  {
    label: 'Uninstall CCTI',
    start: 'void uninstallApplication()',
    phrase: 'UNINSTALL CCTI',
    title: 'Uninstall CCTI',
    confirmLabel: 'Uninstall CCTI',
    apply: 'applyAppUninstall',
    payload: { reviewId: 'app-uninstall-review', confirmation: 'UNINSTALL CCTI' },
    afterCancel: async (window) => {
      await waitFor(window, () => document.querySelector('#uninstall-status-note')?.textContent.includes('Uninstallation canceled'), 'uninstall cancel note');
    },
  },
  {
    label: 'Remove project package',
    start: "void reviewAndRemoveProjectPackage({ id: 'project-package:left-pad' })",
    phrase: 'REMOVE PROJECT PACKAGE',
    title: 'Remove project package',
    confirmLabel: 'Remove package',
    apply: 'applyProjectPackageRemoval',
    payload: { reviewId: 'project-package-review', confirmation: 'REMOVE PROJECT PACKAGE' },
  },
  {
    label: 'Remove CCTI extras',
    start: 'void reviewAndRemoveManagedExtras()',
    phrase: 'REMOVE CCTI EXTRAS',
    title: 'Remove CCTI extras',
    confirmLabel: 'Remove extras',
    apply: 'applyManagedExtrasRemoval',
    payload: { reviewId: 'managed-extras-review', confirmation: 'REMOVE CCTI EXTRAS' },
  },
];

async function run() {
  const rawHtml = await fs.readFile(indexPath, 'utf8');
  const fixtureHtml = rawHtml
    .replace('<head>', `<head><base href="${pathToFileURL(`${rendererDir}${path.sep}`).href}">`)
    .replace('    <script src="../project-interview.js"></script>', `${externalBridgeTag(injectedBridge(), fixturePath)}\n    <script src="../project-interview.js"></script>`);
  assert.notEqual(fixtureHtml, rawHtml, 'the fixture must inject the test bridge');
  await fs.writeFile(fixturePath, fixtureHtml, 'utf8');

  const window = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  const evidence = [];
  try {
    await window.loadFile(fixturePath);
    await waitFor(window, () => document.querySelector('#claude-status-text')?.textContent.includes('Yes, Claude Code is installed'), 'renderer startup');
    const promptThrows = await evaluate(window, '(() => { try { window.prompt("probe"); return false; } catch { return true; } })()');

    for (const flow of flows) {
      // 1. Cancel sends nothing.
      await evaluate(window, flow.start);
      await waitFor(window, dialogOpen, `${flow.label} dialog`);
      const shown = await evaluate(window, `(() => ({
        title: document.querySelector('#typed-confirm-heading').textContent,
        copy: document.querySelector('#typed-confirm-copy').textContent,
        label: document.querySelector('#typed-confirm-label').textContent,
        action: document.querySelector('#apply-typed-confirm-button').textContent,
        disabled: document.querySelector('#apply-typed-confirm-button').disabled,
        modal: document.querySelector('#typed-confirm-dialog').getAttribute('aria-modal'),
        labelledBy: document.querySelector('#typed-confirm-dialog').getAttribute('aria-labelledby'),
        focusInDialog: document.querySelector('#typed-confirm-dialog').contains(document.activeElement),
      }))()`);
      assert.equal(shown.title, flow.title, `${flow.label}: dialog title`);
      assert.ok(shown.copy.includes(flow.phrase), `${flow.label}: the existing explanation text names the phrase`);
      assert.equal(shown.label, `Type ${flow.phrase} to confirm`);
      assert.equal(shown.action, flow.confirmLabel);
      assert.equal(shown.disabled, true, `${flow.label}: the action starts disabled`);
      assert.equal(shown.modal, 'true');
      assert.equal(shown.labelledBy, 'typed-confirm-heading');
      assert.equal(shown.focusInDialog, true, `${flow.label}: focus moves into the dialog`);
      for (const wrong of ['', flow.phrase.toLowerCase(), `${flow.phrase} `, flow.phrase.slice(0, -1)]) {
        assert.equal(await typePhrase(window, wrong), true, `${flow.label}: ${JSON.stringify(wrong)} must keep the action disabled`);
      }
      await evaluate(window, "document.querySelector('#apply-typed-confirm-button').click()");
      assert.equal(await evaluate(window, "document.querySelector('#typed-confirm-dialog').open"), true, `${flow.label}: a disabled action does nothing`);
      await typePhrase(window, flow.phrase);
      await evaluate(window, "document.querySelector('#cancel-typed-confirm-button').click()");
      await waitFor(window, dialogClosed, `${flow.label} cancel`);
      if (flow.afterCancel) await flow.afterCancel(window);
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.deepEqual(await callsOf(window, flow.apply), [], `${flow.label}: Cancel must send nothing`);

      // 2. Closing the dialog another way (for example Escape) behaves like Cancel.
      await evaluate(window, flow.start);
      await waitFor(window, dialogOpen, `${flow.label} dialog again`);
      await typePhrase(window, flow.phrase);
      await evaluate(window, "document.querySelector('#typed-confirm-dialog').close()");
      await waitFor(window, dialogClosed, `${flow.label} escape`);
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.deepEqual(await callsOf(window, flow.apply), [], `${flow.label}: closing the dialog must send nothing`);

      // 3. The exact phrase sends the same payload as before.
      await evaluate(window, flow.start);
      await waitFor(window, dialogOpen, `${flow.label} dialog for apply`);
      assert.equal(await typePhrase(window, flow.phrase), false, `${flow.label}: the exact phrase enables the action`);
      await evaluate(window, "document.querySelector('#apply-typed-confirm-button').click()");
      await waitFor(window, dialogClosed, `${flow.label} apply closes the dialog`);
      await waitFor(window, new Function(`return window.__typedConfirmFixture.calls.some((call) => call.method === ${JSON.stringify(flow.apply)});`), `${flow.label} apply call`);
      const applied = await callsOf(window, flow.apply);
      assert.equal(applied.length, 1, `${flow.label}: exactly one apply call`);
      assert.deepEqual(applied[0].payload, flow.payload, `${flow.label}: apply payload`);
      assert.equal(await evaluate(window, "document.querySelector('#typed-confirm-input').value"), '', `${flow.label}: the typed phrase is cleared`);
      evidence.push(flow.label);
    }
    assert.deepEqual(await callsOf(window, 'csp-violation'), [], 'no Content-Security-Policy violation');
    console.log(JSON.stringify({ ok: true, windowPromptThrows: promptThrows, flows: evidence }));
  } finally {
    window.destroy();
    await fs.rm(fixturePath, { force: true });
  }
}

app.whenReady()
  .then(run)
  .then(() => app.exit(0))
  .catch(async (error) => {
    console.error(error.stack || error.message);
    await fs.rm(fixturePath, { force: true }).catch(() => {});
    app.exit(1);
  });
