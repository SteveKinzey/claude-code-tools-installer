#!/usr/bin/env node
// Real-Electron renderer test, under the shipped Content-Security-Policy, for the terminal
// preference additions: the iTerm2 profile selector, the "Create a Claude Code profile" guide,
// folder-only terminal labels, and the terminal report preview (privacy lists, on-screen filter,
// save only through the main-process save dialog).
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
const fixturePath = path.join(os.tmpdir(), `ccti-terminal-profile-report-${process.pid}.html`);

const report = [
  'CCTI TERMINAL REPORT — local only; CCTI does not send this report anywhere.',
  '',
  'Supported terminal apps',
  '  iTerm2 [iterm2]: installed — starts Claude Code directly',
  '  Warp [warp]: installed — opens the folder; you type claude',
  '  Hyper [hyper]: not installed — opens the folder; you type claude',
].join('\n');

function injectedBridge() {
  return `
<script>
  (() => {
    const calls = [];
    window.__terminalFixture = { calls };
    const record = (method, payload) => calls.push({ method, payload });
    document.addEventListener('securitypolicyviolation', (event) => record('csp-violation', event.effectiveDirective));
    const options = [
      { id: 'default', label: 'Default Terminal', available: true },
      { id: 'iterm2', label: 'iTerm2', available: true },
      { id: 'warp', label: 'Warp', available: true, runsCommand: false },
      { id: 'hyper', label: 'Hyper', available: false, runsCommand: false },
    ];
    const profiles = [{ guid: 'GUID-1', name: 'Default' }, { guid: 'GUID-2', name: 'Claude Code' }];
    let selected = { terminalId: 'default', terminalProfileGuid: '' };
    let exportCount = 0;
    const preference = (message) => ({
      ok: true,
      selectedId: selected.terminalId,
      storedId: selected.terminalId,
      options,
      profileSupported: selected.terminalId === 'iterm2',
      profileOptions: selected.terminalId === 'iterm2' ? profiles : [],
      selectedProfileGuid: selected.terminalProfileGuid,
      message,
    });
    window.installer = {
      getCatalog: async () => [],
      getCatalogDetails: async () => ({ items: [] }),
      getComponentCatalog: async () => ({ components: [], count: 0 }),
      getCompassStatus: async () => ({ available: false }),
      getUpdateStatus: async () => ({ state: 'idle', message: 'No update check has run yet.' }),
      getTerminalPreference: async () => { record('getTerminalPreference'); return preference('Claude Code will open in the fixture terminal.'); },
      setTerminalPreference: async (payload) => {
        record('setTerminalPreference', payload);
        selected = { terminalId: payload.terminalId, terminalProfileGuid: payload.terminalProfileGuid || '' };
        return preference(payload.terminalId === 'warp' ? 'CCTI will open Claude Code in Warp. Warp does not let CCTI start programs, so type claude in the new Warp window and press Enter to start Claude Code.' : 'CCTI will open Claude Code in ' + payload.terminalId + '.');
      },
      testTerminalPreference: async () => { record('testTerminalPreference'); return { ok: true, message: 'Opened the fixture terminal.' }; },
      previewTerminalReport: async () => {
        record('previewTerminalReport');
        return { ok: true, reportId: 'report-1', report: ${JSON.stringify(report)}, privacy: { included: ['Supported terminal apps and whether each is installed'], keptLocal: ['Application and executable paths', 'Account name, computer name, and other machine identifiers'] } };
      },
      exportTerminalReport: async (payload) => {
        record('exportTerminalReport', payload);
        exportCount += 1;
        return exportCount === 1 ? { ok: true, canceled: true } : { ok: true, canceled: false, filename: 'ccti-terminal-report.txt' };
      },
      getClaudeStatus: async () => ({ installed: true, version: 'fixture', path: '/fixture-home/.local/bin/claude' }),
      verifySetup: async () => ({ ok: true, ready: true, summary: 'Ready.', checks: [] }),
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

async function callsOf(window, method) {
  return evaluate(window, `window.__terminalFixture.calls.filter((call) => call.method === ${JSON.stringify(method)})`);
}

async function run() {
  const rawHtml = (await fs.readFile(indexPath, 'utf8')).replace(/\r\n/g, '\n');
  const fixtureHtml = rawHtml
    .replace('<head>', `<head><base href="${pathToFileURL(`${rendererDir}${path.sep}`).href}">`)
    .replace('    <script src="../project-interview.js"></script>', `${externalBridgeTag(injectedBridge(), fixturePath)}\n    <script src="../project-interview.js"></script>`);
  assert.notEqual(fixtureHtml, rawHtml, 'the fixture must inject the test bridge');
  await fs.writeFile(fixturePath, fixtureHtml, 'utf8');

  const window = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  try {
    await window.loadFile(fixturePath);
    await waitFor(window, () => document.querySelector('#terminal-preference-note')?.textContent.includes('fixture terminal'), 'terminal preference load');

    const initial = await evaluate(window, `(() => ({
      profileHidden: document.querySelector('#terminal-profile-select').hidden,
      labelHidden: document.querySelector('#terminal-profile-label').hidden,
      guideHidden: document.querySelector('#terminal-profile-guide-button').hidden,
      options: [...document.querySelector('#terminal-preference-select').options].map((option) => [option.value, option.textContent, option.disabled]),
    }))()`);
    assert.deepEqual(initial, {
      profileHidden: true,
      labelHidden: true,
      guideHidden: false,
      options: [
        ['default', 'Default Terminal', false],
        ['iterm2', 'iTerm2', false],
        ['warp', 'Warp (opens the folder; you type claude)', false],
        ['hyper', 'Hyper (not installed)', true],
      ],
    }, 'folder-only apps say so in the menu and uninstalled apps stay disabled');

    // Choosing iTerm2 saves it exactly as before, then shows the detected profiles.
    await evaluate(window, `(() => { const select = document.querySelector('#terminal-preference-select'); select.value = 'iterm2'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await waitFor(window, () => !document.querySelector('#terminal-profile-select').hidden, 'profile selector');
    assert.deepEqual((await callsOf(window, 'setTerminalPreference')).map((call) => call.payload), [{ terminalId: 'iterm2' }]);
    const profileOptions = await evaluate(window, "[...document.querySelector('#terminal-profile-select').options].map((option) => [option.value, option.textContent])");
    assert.deepEqual(profileOptions, [['', 'iTerm2 default profile'], ['GUID-1', 'Default'], ['GUID-2', 'Claude Code']]);

    await evaluate(window, `(() => { const select = document.querySelector('#terminal-profile-select'); select.value = 'GUID-2'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await waitFor(window, () => window.__terminalFixture.calls.filter((call) => call.method === 'setTerminalPreference').length === 2, 'profile save');
    assert.deepEqual((await callsOf(window, 'setTerminalPreference'))[1].payload, { terminalId: 'iterm2', terminalProfileGuid: 'GUID-2' });
    await waitFor(window, () => document.querySelector('#terminal-profile-select').value === 'GUID-2' && !document.querySelector('#terminal-profile-select').disabled, 'profile shown as saved');

    // The profile guide is an in-app dialog with the setup steps.
    await evaluate(window, "document.querySelector('#terminal-profile-guide-button').focus(); document.querySelector('#terminal-profile-guide-button').click()");
    await waitFor(window, () => document.querySelector('#terminal-profile-guide-dialog').open, 'profile guide');
    const guide = await evaluate(window, `(() => ({
      steps: [...document.querySelectorAll('#terminal-profile-guide-steps li')].map((item) => item.textContent),
      focusInDialog: document.querySelector('#terminal-profile-guide-dialog').contains(document.activeElement),
    }))()`);
    assert.equal(guide.steps.length, 5);
    assert.match(guide.steps[1], /name the new profile Claude Code/);
    assert.match(guide.steps[3], /choose iTerm2 .* Claude Code profile/);
    assert.match(guide.steps[4], /Test selected terminal/);
    assert.equal(guide.focusInDialog, true);
    await evaluate(window, "document.querySelector('#refresh-terminal-profiles-button').click()");
    await waitFor(window, () => document.querySelector('#terminal-profile-guide-status').textContent.includes('2 iTerm2 profiles found'), 'profile refresh');
    await evaluate(window, "document.querySelector('#close-terminal-profile-guide-button').click()");
    await waitFor(window, () => !document.querySelector('#terminal-profile-guide-dialog').open, 'guide close');
    await waitFor(window, () => document.activeElement?.id === 'terminal-profile-guide-button', 'focus returns to the guide button');

    // Terminal report: preview, privacy lists, filter, then save only on request.
    await evaluate(window, "document.querySelector('#terminal-report-button').click()");
    await waitFor(window, () => document.querySelector('#terminal-report-dialog').open, 'report dialog');
    const shown = await evaluate(window, `(() => ({
      preview: document.querySelector('#terminal-report-preview').textContent,
      included: [...document.querySelectorAll('#terminal-report-included li')].map((item) => item.textContent),
      keptLocal: [...document.querySelectorAll('#terminal-report-kept-local li')].map((item) => item.textContent),
      status: document.querySelector('#terminal-report-status').textContent,
    }))()`);
    assert.equal(shown.preview, report, 'the preview shows the exact report');
    assert.deepEqual(shown.included, ['Supported terminal apps and whether each is installed']);
    assert.deepEqual(shown.keptLocal, ['Application and executable paths', 'Account name, computer name, and other machine identifiers']);
    assert.match(shown.status, /Nothing has been saved/);
    assert.deepEqual(await callsOf(window, 'exportTerminalReport'), [], 'opening the preview saves nothing');

    await evaluate(window, `(() => { const input = document.querySelector('#terminal-report-filter'); input.value = 'folder'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const filtered = await evaluate(window, `(() => ({ preview: document.querySelector('#terminal-report-preview').textContent, summary: document.querySelector('#terminal-report-filter-summary').textContent }))()`);
    assert.equal(filtered.preview, report.split('\n').filter((line) => line.includes('folder')).join('\n'));
    assert.match(filtered.summary, /^Showing 2 of 6 lines that match “folder”\. Save report still saves the full report\.$/);

    await evaluate(window, "document.querySelector('#save-terminal-report-button').click()");
    await waitFor(window, () => document.querySelector('#terminal-report-status').textContent.includes('canceled'), 'canceled save');
    await evaluate(window, "document.querySelector('#save-terminal-report-button').click()");
    await waitFor(window, () => document.querySelector('#terminal-report-status').textContent.includes('saved as ccti-terminal-report.txt'), 'saved report');
    assert.deepEqual((await callsOf(window, 'exportTerminalReport')).map((call) => call.payload), [{ reportId: 'report-1' }, { reportId: 'report-1' }], 'the full previewed report is saved by its id; the renderer never sends report text');

    await evaluate(window, "document.querySelector('#close-terminal-report-button').click()");
    await waitFor(window, () => !document.querySelector('#terminal-report-dialog').open, 'report close');
    await waitFor(window, () => document.querySelector('#terminal-report-preview').textContent === '' && document.querySelector('#terminal-report-filter').value === '', 'closing clears the preview and filter');

    // A folder-only app shows the type-claude instruction in its status text.
    await evaluate(window, `(() => { const select = document.querySelector('#terminal-preference-select'); select.value = 'warp'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await waitFor(window, () => document.querySelector('#terminal-preference-note').textContent.includes('type claude'), 'Warp instruction');
    assert.equal(await evaluate(window, "document.querySelector('#terminal-profile-select').hidden"), true, 'the profile selector is only shown for iTerm2');

    assert.deepEqual(await callsOf(window, 'csp-violation'), [], 'no Content-Security-Policy violation');
    console.log(JSON.stringify({ ok: true, checked: ['folder-only labels', 'iTerm2 profile selection', 'profile guide', 'terminal report preview, filter and save'] }));
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
