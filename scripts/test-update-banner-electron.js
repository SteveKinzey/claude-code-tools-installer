#!/usr/bin/env node
// Real-Electron renderer test for the top-of-app update banner. Most people install CCTI once and
// never return to claudetool.app or scroll to "Diagnostics and updates", so a newer release must be
// announced at the top of the app. This proves the banner:
//  - stays hidden when CCTI is current or the check failed;
//  - appears above the first section when a newer published release exists;
//  - Update Now runs the same checked download as the Diagnostics panel, then offers Restart to Update;
//  - Restart to Update waits while an installation is running;
//  - Not Now hides it until a newer version is published;
//  - builds that cannot update themselves open the release page, and an integrity notice asks for review;
//  - fits a narrow window without horizontal overflow.
// Set CCTI_UPDATE_BANNER_SCREENSHOTS=<folder> to save a PNG of each state.
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
const fixturePath = path.join(os.tmpdir(), `ccti-update-banner-${process.pid}.html`);
const screenshotDir = process.env.CCTI_UPDATE_BANNER_SCREENSHOTS || '';

const releaseUrl = 'https://github.com/SteveKinzey/claude-code-tools-installer/releases/tag/v2026.10.02.03';
const available = { state: 'available', currentVersion: '2026.10.201', latestVersion: '2026.10.02.03', latestPackageVersion: '2026.10.203', releaseUrl, canDownload: true, canInstall: false, message: 'CCTI 2026.10.02.03 is available.' };

function injectedBridge() {
  return `
<script>
  (() => {
    const calls = [];
    let pushStatus = () => {};
    window.__updateBannerFixture = { calls, push: (status) => pushStatus(status) };
    const record = (method, payload) => calls.push({ method, payload });
    document.addEventListener('securitypolicyviolation', (event) => record('csp-violation', event.effectiveDirective));
    const downloaded = { ...${JSON.stringify(available)}, state: 'downloaded', canDownload: false, canInstall: true, message: 'CCTI 2026.10.02.03 is downloaded and verified. Restart CCTI to apply it now.' };

    window.installer = {
      getCatalog: async () => [],
      getCatalogDetails: async () => ({ items: [] }),
      getComponentCatalog: async () => ({ components: [], count: 0 }),
      getCompassStatus: async () => ({ available: false }),
      getUpdateStatus: async () => ({ state: 'current', currentVersion: '2026.10.203', latestVersion: '2026.10.02.03', releaseUrl: ${JSON.stringify(releaseUrl)}, message: 'CCTI 2026.10.02.03 is the newest published release.' }),
      getTerminalPreference: async () => ({ ok: true, selectedId: 'default', options: [{ id: 'default', label: 'Default Terminal', available: true }], message: '' }),
      setTerminalPreference: async () => ({ ok: true, selectedId: 'default', options: [], message: '' }),
      getClaudeStatus: async () => ({ installed: true, version: 'fixture', path: '/fixture-home/.local/bin/claude' }),
      verifySetup: async () => ({ ok: true, ready: true, summary: 'Ready.', checks: [] }),
      downloadAvailableUpdate: async () => {
        record('downloadAvailableUpdate');
        pushStatus({ ...downloaded, state: 'downloading', canInstall: false, message: 'Downloading the signed CCTI 2026.10.02.03 update… 40%' });
        await new Promise((resolve) => setTimeout(resolve, 200));
        return downloaded;
      },
      installDownloadedUpdate: async () => { record('installDownloadedUpdate'); return { ok: true }; },
      openPublishedRelease: async () => { record('openPublishedRelease'); return { ok: true }; },
      reportAnonymousSetupSuccess: async () => ({ ok: true }),
      onOutput: () => {},
      onState: () => {},
      onComponentOutput: () => {},
      onComponentState: () => {},
      onUpdateStatus: (callback) => { pushStatus = callback; },
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

const banner = (window) => evaluate(window, `(() => {
  const element = document.querySelector('#update-banner');
  const action = document.querySelector('#update-banner-action');
  return {
    hidden: element.hidden,
    className: element.className,
    heading: document.querySelector('#update-banner-heading').textContent,
    message: document.querySelector('#update-banner-message').textContent,
    action: action.textContent,
    actionDisabled: action.disabled,
    dismissHidden: document.querySelector('#update-banner-dismiss').hidden,
    top: element.getBoundingClientRect().top,
    noticeTop: document.querySelector('.notice').getBoundingClientRect().top,
  };
})()`);
const push = (window, status) => evaluate(window, `window.__updateBannerFixture.push(${JSON.stringify(status)})`);
const callsOf = (window, method) => evaluate(window, `window.__updateBannerFixture.calls.filter((call) => call.method === ${JSON.stringify(method)}).length`);
const click = (window, selector) => evaluate(window, `document.querySelector(${JSON.stringify(selector)}).click()`);

async function screenshot(window, name) {
  if (!screenshotDir) return;
  await fs.mkdir(screenshotDir, { recursive: true });
  // Let the renderer paint the latest state before capturing it.
  await evaluate(window, 'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const image = await window.webContents.capturePage({ x: 0, y: 0, width: window.getContentSize()[0], height: 420 });
  await fs.writeFile(path.join(screenshotDir, `${name}.png`), image.toPNG());
}

async function run() {
  const rawHtml = await fs.readFile(indexPath, 'utf8');
  const fixtureHtml = rawHtml
    .replace('<head>', `<head><base href="${pathToFileURL(`${rendererDir}${path.sep}`).href}">`)
    .replace('    <script src="../project-interview.js"></script>', `${externalBridgeTag(injectedBridge(), fixturePath)}\n    <script src="../project-interview.js"></script>`);
  assert.notEqual(fixtureHtml, rawHtml, 'the fixture must inject the test bridge');
  await fs.writeFile(fixturePath, fixtureHtml, 'utf8');

  const window = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  const checked = [];
  try {
    await window.loadFile(fixturePath);
    await waitFor(window, () => document.querySelector('#claude-status-text')?.textContent.includes('Yes, Claude Code is installed'), 'renderer startup');

    // Current: hidden.
    assert.equal((await banner(window)).hidden, true, 'no banner while CCTI is current');
    checked.push('hidden when current');

    // A newer release: visible at the top, Update Now.
    await push(window, available);
    let shown = await banner(window);
    assert.equal(shown.hidden, false, 'banner appears when a newer release exists');
    assert.equal(shown.heading, 'CCTI 2026.10.02.03 is available');
    assert.match(shown.message, /You have 2026\.10\.201\./);
    assert.equal(shown.action, 'Update Now');
    assert.ok(shown.top < shown.noticeTop && shown.top < 400, 'banner sits at the top of the app, above the first section');
    await screenshot(window, '1-available');
    checked.push('visible at top');

    // Update Now runs the checked download; the banner follows it to Restart to Update.
    await click(window, '#update-banner-action');
    shown = await banner(window);
    assert.equal(shown.actionDisabled, true, 'the action is disabled while the update downloads');
    assert.equal(shown.dismissHidden, true);
    assert.equal(shown.hidden, false, 'the banner stays up while its download runs');
    await screenshot(window, '2-downloading');
    await waitFor(window, () => document.querySelector('#update-banner-action').textContent === 'Restart to Update', 'download finished');
    assert.equal(await callsOf(window, 'downloadAvailableUpdate'), 1);
    shown = await banner(window);
    assert.equal(shown.heading, 'CCTI 2026.10.02.03 is ready to install');
    assert.match(shown.className, /is-ready/);
    await screenshot(window, '3-ready');
    checked.push('update now -> restart to update');

    // Restart waits while an installation is running.
    await evaluate(window, 'state.running = true');
    await click(window, '#update-banner-action');
    assert.equal(await callsOf(window, 'installDownloadedUpdate'), 0, 'no restart while an installation runs');
    assert.match((await banner(window)).message, /Wait for the current installation to finish/);
    await evaluate(window, 'state.running = false');
    await click(window, '#update-banner-action');
    await waitFor(window, () => window.__updateBannerFixture.calls.some((call) => call.method === 'installDownloadedUpdate'), 'restart call');
    checked.push('restart guarded during install');

    // Not Now hides it until a newer version is published.
    await push(window, available);
    await click(window, '#update-banner-dismiss');
    assert.equal((await banner(window)).hidden, true, 'Not Now hides the banner');
    await push(window, available);
    assert.equal((await banner(window)).hidden, true, 'the same version stays dismissed');
    await push(window, { ...available, latestVersion: '2026.10.03.01', latestPackageVersion: '2026.10.301' });
    assert.equal((await banner(window)).hidden, false, 'a newer version shows the banner again');
    checked.push('not now until newer');
    const newer = { ...available, latestVersion: '2026.10.03.01', latestPackageVersion: '2026.10.301' };

    // A build that cannot update itself opens the release page.
    await push(window, { ...newer, canDownload: false });
    shown = await banner(window);
    assert.equal(shown.action, 'Get CCTI 2026.10.03.01');
    await screenshot(window, '4-release-page');
    await click(window, '#update-banner-action');
    await waitFor(window, () => window.__updateBannerFixture.calls.some((call) => call.method === 'openPublishedRelease'), 'release page call');
    checked.push('release page fallback');

    // An integrity notice asks for review instead of updating.
    await push(window, { ...newer, digestAlert: { count: 1, names: ['latest.yml'], message: '1 published release artifact is missing a SHA-256 digest.' } });
    shown = await banner(window);
    assert.equal(shown.action, 'Review Release');
    assert.match(shown.className, /is-attention/);
    checked.push('integrity review');

    // Failed check or current again: hidden.
    await push(window, { state: 'unavailable', message: 'Update check could not reach the public release service.' });
    assert.equal((await banner(window)).hidden, true, 'no banner when the check failed');
    await push(window, { ...newer, state: 'current' });
    assert.equal((await banner(window)).hidden, true, 'no banner once current');
    checked.push('hidden when unavailable');

    // Narrow window: no horizontal overflow.
    await push(window, newer);
    window.setContentSize(720, 900);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const overflow = await evaluate(window, `(() => {
      const element = document.querySelector('#update-banner');
      return { page: document.documentElement.scrollWidth > window.innerWidth, banner: element.scrollWidth > element.clientWidth };
    })()`);
    assert.deepEqual(overflow, { page: false, banner: false }, 'the banner fits a narrow window');
    await screenshot(window, '5-narrow');
    checked.push('narrow window');

    assert.equal(await callsOf(window, 'csp-violation'), 0, 'no Content-Security-Policy violation');
    console.log(JSON.stringify({ ok: true, checked }));
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
