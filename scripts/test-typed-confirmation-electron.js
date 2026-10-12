#!/usr/bin/env node
// Real-Electron renderer test for destructive typed-confirmation flows and the local-first
// tester changelog and feedback controls.
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

// Values embedded in code strings run in the renderer. JSON.stringify alone leaves characters
// such as < > / U+2028 U+2029 that can break out of the surrounding code, so escape them too.
const unsafeLiteralCharacters = { '<': '\\u003C', '>': '\\u003E', '/': '\\u002F', '\u2028': '\\u2028', '\u2029': '\\u2029' };
function jsLiteral(value) {
  return JSON.stringify(value).replace(/[<>/\u2028\u2029]/g, (character) => unsafeLiteralCharacters[character]);
}

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
      chooseTesterFeedbackScreenshot: async () => { record('chooseTesterFeedbackScreenshot'); return { ok: true, canceled: false, screenshotToken: 'tester-screenshot-token', filename: 'tester-screenshot.png', size: 1234 }; },
      saveTesterFeedback: async (payload) => { record('saveTesterFeedback', payload); return { ok: true, canceled: false, filename: 'ccti-tester-feedback.txt' }; },
      openTesterFeedbackEmail: async (payload) => { record('openTesterFeedbackEmail', payload); return { ok: true, message: 'Your email app opened with a draft. Nothing was sent by CCTI.' }; },
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
    input.value = ${jsLiteral(value)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return document.querySelector('#apply-typed-confirm-button').disabled;
  })()`);
}

async function callsOf(window, method) {
  return evaluate(window, `window.__typedConfirmFixture.calls.filter((call) => call.method === ${jsLiteral(method)})`);
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
      await waitFor(window, new Function(`return window.__typedConfirmFixture.calls.some((call) => call.method === ${jsLiteral(flow.apply)});`), `${flow.label} apply call`);
      const applied = await callsOf(window, flow.apply);
      assert.equal(applied.length, 1, `${flow.label}: exactly one apply call`);
      assert.deepEqual(applied[0].payload, flow.payload, `${flow.label}: apply payload`);
      assert.equal(await evaluate(window, "document.querySelector('#typed-confirm-input').value"), '', `${flow.label}: the typed phrase is cleared`);
      evidence.push(flow.label);
    }
    const selectedBeforeTesterWindows = await evaluate(window, "document.querySelectorAll('.tool-toggle[aria-checked=\"true\"]').length");
    await evaluate(window, "(() => { const button = document.querySelector('#open-test-changelog-button'); button.focus(); button.click(); })()");
    await waitFor(window, () => document.querySelector('#test-changelog-dialog')?.open === true, 'test changelog dialog');
    const changelog = await evaluate(window, `(() => ({
      labelledBy: document.querySelector('#test-changelog-dialog').getAttribute('aria-labelledby'),
      modal: document.querySelector('#test-changelog-dialog').getAttribute('aria-modal'),
      focusInDialog: document.querySelector('#test-changelog-dialog').contains(document.activeElement),
      listItems: document.querySelectorAll('.tester-changelog-list li').length,
      selected: document.querySelectorAll('.tool-toggle[aria-checked="true"]').length,
    }))()`);
    assert.equal(changelog.labelledBy, 'test-changelog-heading');
    assert.equal(changelog.modal, 'true');
    assert.equal(changelog.focusInDialog, true, 'changelog dialog moves focus inside');
    assert.equal(changelog.listItems, 7, 'changelog explains each approved test scope, including accessibility and keyboard behavior');
    assert.equal(await evaluate(window, "document.querySelector('.tester-changelog-list').textContent.includes('Clear accessibility feedback')"), true, 'changelog names the accessibility changes');
    assert.equal(changelog.selected, selectedBeforeTesterWindows, 'opening the changelog cannot select tools');
    await evaluate(window, "document.querySelector('#close-test-changelog-button').click()");
    await waitFor(window, () => document.querySelector('#test-changelog-dialog')?.open === false, 'test changelog close');
    await waitFor(window, () => document.activeElement?.id === 'open-test-changelog-button', 'test changelog focus restoration');

    await evaluate(window, "(() => { const button = document.querySelector('#open-tester-feedback-button'); button.focus(); button.click(); })()");
    await waitFor(window, () => document.querySelector('#tester-feedback-dialog')?.open === true, 'tester feedback dialog');
    const initialFeedback = await evaluate(window, `(() => ({
      labelledBy: document.querySelector('#tester-feedback-dialog').getAttribute('aria-labelledby'),
      describedBy: document.querySelector('#tester-feedback-dialog').getAttribute('aria-describedby'),
      modal: document.querySelector('#tester-feedback-dialog').getAttribute('aria-modal'),
      focusInDialog: document.querySelector('#tester-feedback-dialog').contains(document.activeElement),
      saveDisabled: document.querySelector('#save-tester-feedback-button').disabled,
      emailDisabled: document.querySelector('#email-tester-feedback-button').disabled,
      attachmentButton: document.querySelector('#attach-tester-screenshot-button').textContent.trim(),
    }))()`);
    assert.deepEqual(initialFeedback, {
      labelledBy: 'tester-feedback-heading',
      describedBy: 'tester-feedback-copy',
      modal: 'true',
      focusInDialog: true,
      saveDisabled: true,
      emailDisabled: true,
      attachmentButton: 'Attach a screenshot (optional)…',
    }, 'tester feedback starts with a named modal and no enabled send-like actions');
    await evaluate(window, `(() => {
      const set = (selector, value, eventName = 'input') => {
        const element = document.querySelector(selector);
        element.value = value;
        element.dispatchEvent(new Event(eventName, { bubbles: true }));
      };
      set('#tester-feedback-area', 'Tool details or References', 'change');
      set('#tester-feedback-expected', 'A detail explanation should open without changing my choices.');
      set('#tester-feedback-actual', 'The sample issue did not show the detail explanation.');
      set('#tester-feedback-steps', '1. Open Details. 2. Read the explanation.');
    })()`);
    await waitFor(window, () => !document.querySelector('#save-tester-feedback-button')?.disabled && !document.querySelector('#email-tester-feedback-button')?.disabled, 'completed tester feedback controls');
    await evaluate(window, "document.querySelector('#attach-tester-screenshot-button').click()");
    await waitFor(window, () => window.__typedConfirmFixture.calls.some((call) => call.method === 'chooseTesterFeedbackScreenshot'), 'screenshot selection call');
    await waitFor(window, () => document.querySelector('#tester-screenshot-status')?.textContent.includes('tester-screenshot.png'), 'selected screenshot status');
    await evaluate(window, "document.querySelector('#save-tester-feedback-button').click()");
    await waitFor(window, () => window.__typedConfirmFixture.calls.some((call) => call.method === 'saveTesterFeedback'), 'local feedback save call');
    await evaluate(window, "document.querySelector('#email-tester-feedback-button').click()");
    await waitFor(window, () => window.__typedConfirmFixture.calls.some((call) => call.method === 'openTesterFeedbackEmail'), 'explicit email draft call');
    const savedFeedback = await callsOf(window, 'saveTesterFeedback');
    const emailedFeedback = await callsOf(window, 'openTesterFeedbackEmail');
    assert.equal(savedFeedback.length, 1, 'one local feedback save request is made');
    assert.equal(emailedFeedback.length, 1, 'one explicit email-draft request is made');
    assert.deepEqual(emailedFeedback[0].payload, savedFeedback[0].payload, 'save and email choices use the same reviewed feedback text');
    assert.equal(savedFeedback[0].payload.screenshotToken, 'tester-screenshot-token', 'only an opaque screenshot token crosses the renderer boundary');
    assert.match(savedFeedback[0].payload.actual, /sample issue/i);
    assert.equal(await evaluate(window, "document.querySelector('#tester-feedback-status').textContent.includes('Nothing was sent by CCTI.')"), true, 'email draft status is explicit that CCTI did not send anything');
    await evaluate(window, "document.querySelector('#close-tester-feedback-button').click()");
    await waitFor(window, () => document.querySelector('#tester-feedback-dialog')?.open === false, 'tester feedback close');
    await waitFor(window, () => document.activeElement?.id === 'open-tester-feedback-button', 'tester feedback focus restoration');
    evidence.push('test changelog and local-first tester feedback');
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
