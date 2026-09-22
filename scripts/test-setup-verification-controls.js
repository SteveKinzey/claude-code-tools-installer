#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow } = require('electron');

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('headless');
  app.commandLine.appendSwitch('disable-gpu');
}

const root = path.resolve(__dirname, '..');
const rendererDir = path.join(root, 'desktop', 'src', 'renderer');
const indexPath = path.join(rendererDir, 'index.html');
const stylesPath = path.join(rendererDir, 'styles.css');
const fixturePath = path.join(os.tmpdir(), `ccti-setup-verification-${process.pid}.html`);
const viewports = [
  { width: 390, height: 844, label: 'narrow' },
  { width: 768, height: 1024, label: 'tablet' },
  { width: 1280, height: 720, label: 'desktop' },
];

function injectedBridge() {
  return `
<script>
  (() => {
    const calls = [];
    let resolveCompleteSetup;
    let resolveVerifySetup;
    let updateStatusListener = () => {};

    window.__setupVerificationFixture = {
      calls,
      resolveCompleteSetup: (result) => resolveCompleteSetup(result),
      resolveVerifySetup: (result) => resolveVerifySetup(result),
      emitUpdateStatus: (status) => updateStatusListener(status),
    };
    window.confirm = () => true;
    window.prompt = () => '';
    const record = (method, payload) => calls.push({ method, payload });

    window.installer = {
      getCatalog: async () => [],
      getCatalogDetails: async () => ({ items: [] }),
      getComponentCatalog: async () => ({ components: [], count: 0 }),
      getCompassStatus: async () => ({ available: false }),
      getUpdateStatus: async () => ({ state: 'idle', message: 'No update check has run yet.' }),
      getTerminalPreference: async () => ({
        ok: true,
        selectedId: 'default',
        options: [{ id: 'default', label: 'Default Terminal', available: true }],
        message: 'Claude Code will open in Default Terminal.',
      }),
      setTerminalPreference: async () => ({ ok: true, selectedId: 'default', options: [], message: 'CCTI will open Claude Code in Default Terminal.' }),
      getClaudeStatus: async () => ({ installed: true, version: 'fixture', path: '/fixture-home/.local/bin/claude' }),
      runCompleteSetup: (payload) => {
        record('runCompleteSetup', payload);
        return new Promise((resolve) => { resolveCompleteSetup = resolve; });
      },
      verifySetup: () => {
        record('verifySetup');
        return new Promise((resolve) => { resolveVerifySetup = resolve; });
      },
      reportAnonymousSetupSuccess: async (payload) => { record('reportAnonymousSetupSuccess', payload); return { ok: true }; },
      onOutput: () => {},
      onState: () => {},
      onComponentOutput: () => {},
      onComponentState: () => {},
      onUpdateStatus: (listener) => { updateStatusListener = listener; },
    };
  })();
</script>`;
}

async function waitFor(window, predicate, label) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(`(${predicate.toString()})()`)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function evaluate(window, expression) {
  return window.webContents.executeJavaScript(expression, true);
}

async function measureViewport(window, viewport) {
  window.setSize(viewport.width, viewport.height);
  await new Promise((resolve) => setTimeout(resolve, 80));
  const measurement = await evaluate(window, `(() => {
    const verification = document.querySelector('.setup-verification');
    const controls = document.querySelector('.setup-verification-buttons');
    const complete = document.querySelector('#complete-setup-button');
    const verify = document.querySelector('#verify-setup-button');
    const horizontallyVisible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= window.innerWidth;
    };
    return {
      rootFits: document.documentElement.scrollWidth <= window.innerWidth,
      verificationFits: verification.scrollWidth <= verification.clientWidth,
      controlsFit: controls.scrollWidth <= controls.clientWidth,
      completeFits: complete.scrollWidth <= complete.clientWidth && horizontallyVisible(complete),
      verifyFits: verify.scrollWidth <= verify.clientWidth && horizontallyVisible(verify),
      completeTargetHeight: complete.getBoundingClientRect().height,
      verifyTargetHeight: verify.getBoundingClientRect().height,
      actionOrder: [...controls.querySelectorAll('button')].map((button) => button.id),
      verificationGrid: getComputedStyle(verification).gridTemplateColumns,
    };
  })()`);

  assert.equal(measurement.rootFits, true, `${viewport.label}: document must not scroll horizontally.`);
  assert.equal(measurement.verificationFits, true, `${viewport.label}: Setup Check must contain its content.`);
  assert.equal(measurement.controlsFit, true, `${viewport.label}: setup action group must contain both controls.`);
  assert.equal(measurement.completeFits, true, `${viewport.label}: Complete setup must remain fully visible.`);
  assert.equal(measurement.verifyFits, true, `${viewport.label}: Verify setup must remain fully visible.`);
  assert.ok(measurement.completeTargetHeight >= 40, `${viewport.label}: Complete setup needs a comfortable target.`);
  assert.ok(measurement.verifyTargetHeight >= 40, `${viewport.label}: Verify setup needs a comfortable target.`);
  assert.deepEqual(measurement.actionOrder, ['complete-setup-button', 'verify-setup-button'], `${viewport.label}: Complete setup must remain before Verify setup.`);

  if (viewport.width < 980) {
    assert.equal(measurement.verificationGrid.split(' ').length, 1, `${viewport.label}: Setup Check must use a single-column layout.`);
  }

  return { ...viewport, ...measurement };
}

async function run() {
  const [rawHtml, styles] = await Promise.all([
    fs.readFile(indexPath, 'utf8'),
    fs.readFile(stylesPath, 'utf8'),
  ]);

  assert.match(styles, /\.complete-setup-spinner[^}]*animation:\s*ccti-spin/i, 'Complete setup requires an in-button spinner animation.');
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.complete-setup-spinner[^}]*animation:\s*none/i, 'The spinner must stop for reduced-motion preferences.');

  const fixtureHtml = rawHtml
    .replace('<head>', `<head><base href="${pathToFileURL(`${rendererDir}${path.sep}`).href}">`)
    .replace('    <script src="../project-interview.js"></script>', `${injectedBridge()}\n    <script src="../project-interview.js"></script>`);
  await fs.writeFile(fixturePath, fixtureHtml, 'utf8');

  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 720,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  try {
    await window.loadFile(fixturePath);
    await waitFor(window, () => document.querySelector('#claude-status-text')?.textContent.includes('Yes, Claude Code is installed'), 'renderer startup');

    const initialSemantics = await evaluate(window, `(() => ({
      complete: {
        tag: document.querySelector('#complete-setup-button').tagName,
        type: document.querySelector('#complete-setup-button').type,
        name: document.querySelector('#complete-setup-button').textContent.trim(),
        busy: document.querySelector('#complete-setup-button').getAttribute('aria-busy'),
        describedBy: document.querySelector('#complete-setup-button').getAttribute('aria-describedby'),
        spinnerHidden: document.querySelector('#complete-setup-spinner').hidden,
      },
      verify: {
        tag: document.querySelector('#verify-setup-button').tagName,
        type: document.querySelector('#verify-setup-button').type,
        name: document.querySelector('#verify-setup-button').textContent.trim(),
        busy: document.querySelector('#verify-setup-button').getAttribute('aria-busy'),
        describedBy: document.querySelector('#verify-setup-button').getAttribute('aria-describedby'),
      },
      summary: {
        role: document.querySelector('#setup-verification-summary').getAttribute('role'),
        live: document.querySelector('#setup-verification-summary').getAttribute('aria-live'),
        text: document.querySelector('#setup-verification-summary').textContent,
      },
    }))()`);

    assert.deepEqual(initialSemantics, {
      complete: {
        tag: 'BUTTON',
        type: 'button',
        name: 'Complete setup',
        busy: 'false',
        describedBy: 'setup-verification-summary',
        spinnerHidden: true,
      },
      verify: {
        tag: 'BUTTON',
        type: 'button',
        name: 'Verify setup',
        busy: 'false',
        describedBy: 'setup-verification-summary',
      },
      summary: {
        role: 'status',
        live: 'polite',
        text: 'Run this check after Complete setup or whenever you want a clear answer.',
      },
    }, 'Relocated Setup Check controls must retain native names and a shared polite live status description.');

    const responsiveEvidence = [];
    for (const viewport of viewports) {
      responsiveEvidence.push(await measureViewport(window, viewport));
    }

    await evaluate(window, "document.querySelector('#complete-setup-button').click()");
    await waitFor(window, () => document.querySelector('#complete-setup-button')?.getAttribute('aria-busy') === 'true', 'Complete setup busy state');
    const runningCompleteSetup = await evaluate(window, `(() => ({
      disabled: document.querySelector('#complete-setup-button').disabled,
      busy: document.querySelector('#complete-setup-button').getAttribute('aria-busy'),
      loading: document.querySelector('#complete-setup-button').classList.contains('is-loading'),
      label: document.querySelector('#complete-setup-button-label').textContent,
      spinnerHidden: document.querySelector('#complete-setup-spinner').hidden,
      spinnerAriaHidden: document.querySelector('#complete-setup-spinner').getAttribute('aria-hidden'),
      spinnerAnimation: getComputedStyle(document.querySelector('#complete-setup-spinner')).animationName,
      announcement: document.querySelector('#setup-verification-summary').textContent,
      runCall: window.__setupVerificationFixture.calls.find((call) => call.method === 'runCompleteSetup'),
    }))()`);
    assert.deepEqual(runningCompleteSetup, {
      disabled: true,
      busy: 'true',
      loading: true,
      label: 'Completing setup…',
      spinnerHidden: false,
      spinnerAriaHidden: 'true',
      spinnerAnimation: 'ccti-spin',
      announcement: 'Complete setup is running. CCTI is installing prerequisites, Claude Code, and recommended tools locally.',
      runCall: { method: 'runCompleteSetup', payload: { fresh: false } },
    }, 'Complete setup must expose a visible spinner, an explicit busy label, and a polite in-progress announcement.');

    const completeResult = {
      ok: true,
      installed: true,
      version: 'fixture',
      verification: {
        ok: true,
        ready: false,
        summary: 'CCTI verified 3 of 10 setup items. 7 items need attention. Select Complete setup to retry; no terminal commands are required.',
        checks: [],
      },
    };
    await evaluate(window, `window.__setupVerificationFixture.resolveCompleteSetup(${JSON.stringify(completeResult)})`);
    await waitFor(window, () => document.querySelector('#complete-setup-button')?.getAttribute('aria-busy') === 'false' && document.querySelector('#setup-verification-summary')?.textContent === 'CCTI verified 3 of 10 setup items. 7 items need attention. Select Complete setup to retry; no terminal commands are required.', 'Complete setup result announcement');
    const completedSetup = await evaluate(window, `(() => ({
      disabled: document.querySelector('#complete-setup-button').disabled,
      busy: document.querySelector('#complete-setup-button').getAttribute('aria-busy'),
      label: document.querySelector('#complete-setup-button-label').textContent,
      spinnerHidden: document.querySelector('#complete-setup-spinner').hidden,
      announcement: document.querySelector('#setup-verification-summary').textContent,
    }))()`);
    assert.deepEqual(completedSetup, {
      disabled: false,
      busy: 'false',
      label: 'Complete setup',
      spinnerHidden: true,
      announcement: 'CCTI verified 3 of 10 setup items. 7 items need attention. Select Complete setup to retry; no terminal commands are required.',
    }, 'Complete setup must restore its action label and announce the resulting readiness summary.');

    await evaluate(window, "document.querySelector('#verify-setup-button').click()");
    await waitFor(window, () => document.querySelector('#verify-setup-button')?.getAttribute('aria-busy') === 'true', 'Verify setup busy state');
    const runningVerifySetup = await evaluate(window, `(() => ({
      disabled: document.querySelector('#verify-setup-button').disabled,
      busy: document.querySelector('#verify-setup-button').getAttribute('aria-busy'),
      label: document.querySelector('#verify-setup-button').textContent,
      announcement: document.querySelector('#setup-verification-summary').textContent,
      callCount: window.__setupVerificationFixture.calls.filter((call) => call.method === 'verifySetup').length,
    }))()`);
    assert.deepEqual(runningVerifySetup, {
      disabled: true,
      busy: 'true',
      label: 'Verifying…',
      announcement: 'Checking your CCTI setup locally. Nothing is being changed.',
      callCount: 1,
    }, 'Verify setup must announce its read-only check while it is in progress.');

    const verifyResult = {
      ok: true,
      ready: true,
      summary: 'CCTI verified all 10 setup items. Everything is ready.',
      checks: [],
    };
    await evaluate(window, `window.__setupVerificationFixture.resolveVerifySetup(${JSON.stringify(verifyResult)})`);
    await waitFor(window, () => document.querySelector('#verify-setup-button')?.getAttribute('aria-busy') === 'false' && document.querySelector('#setup-verification-summary')?.textContent === 'CCTI verified all 10 setup items. Everything is ready.', 'Verify setup result announcement');
    const completedVerifySetup = await evaluate(window, `(() => ({
      disabled: document.querySelector('#verify-setup-button').disabled,
      busy: document.querySelector('#verify-setup-button').getAttribute('aria-busy'),
      label: document.querySelector('#verify-setup-button').textContent,
      announcement: document.querySelector('#setup-verification-summary').textContent,
    }))()`);
    assert.deepEqual(completedVerifySetup, {
      disabled: false,
      busy: 'false',
      label: 'Verify setup',
      announcement: 'CCTI verified all 10 setup items. Everything is ready.',
    }, 'Verify setup must restore its control and announce the completed check result.');

    console.log(JSON.stringify({
      ok: true,
      viewports: responsiveEvidence,
      screenReaderAnnouncements: {
        completeSetup: completedSetup.announcement,
        verifySetup: completedVerifySetup.announcement,
      },
    }));
  } finally {
    if (!window.isDestroyed()) window.destroy();
    await fs.rm(fixturePath, { force: true });
  }
}

app.whenReady()
  .then(run)
  .then(() => app.quit())
  .catch(async (error) => {
    console.error(error.stack || error.message || error);
    await fs.rm(fixturePath, { force: true }).catch(() => {});
    process.exit(1);
  });
