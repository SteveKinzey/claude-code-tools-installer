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
const fixturePath = path.join(os.tmpdir(), `ccti-checkup-layout-${process.pid}.html`);

const longPath = '/Users/skinzey/.claude/plugins/synced/5b4d7fbe-5e6a-473a-91b3-6794b50af7d_552b50b7-59d8-42a6-b087-898165128950/design';

const sampleFindings = [
  {
    id: 'plugin:/plugins/synced/operations',
    type: 'plugin',
    name: '> operations@synced',
    scope: 'Add-on · Claude Code',
    path: '/Users/skinzey/.claude/plugins/synced/5b4d7fbe-5e6a-473a-91b3-67994b50af7d_552b50b7-59d8-42a6-b087-898165128950/operations',
    description: 'Reported by Claude Code.',
  },
  {
    id: 'plugin:/plugins/synced/version',
    type: 'plugin',
    name: 'Version: 1.3.0',
    scope: 'Add-on · Claude Code',
    path: 'Claude Code',
    description: 'Reported by Claude Code.',
  },
  {
    id: 'plugin:/plugins/synced/long-path-1',
    type: 'plugin',
    name: `Path: ${longPath}`,
    scope: 'Add-on · Claude Code',
    path: 'Claude Code',
    description: 'Reported by Claude Code.',
  },
  ...Array.from({ length: 77 }, (_, i) => ({
    id: `conn:item-${i + 4}`,
    type: 'connection',
    name: `Saved connection ${i + 4}`,
    scope: 'Add-on · Claude Code',
    path: 'Claude Code',
    description: 'Reported by Claude Code.',
  })),
  {
    id: 'plugin:/plugins/synced/long-path-80',
    type: 'plugin',
    name: `Path: ${longPath}`,
    scope: 'Add-on · Claude Code',
    path: 'Claude Code',
    description: 'Reported by Claude Code.',
  },
  {
    id: 'conn:item-82-overflow',
    type: 'connection',
    name: 'Extra item beyond 80',
    scope: 'Add-on · Claude Code',
    path: 'Claude Code',
    description: 'Reported by Claude Code.',
  },
];

const discoveryReport = {
  discoveryId: 'checkup-layout-fixture',
  checkedAt: '2026-09-22T04:10:00.000Z',
  findings: sampleFindings,
  duplicates: [],
  managedExtras: { actionCount: 0, manualCount: 0, ignored: 0, error: '' },
};

function injectedBridge() {
  return `<script>
    (() => {
      window.__checkupUiCalls = [];
      const record = (method, payload) => window.__checkupUiCalls.push({ method, payload });
      window.installer = {
        getCatalog: async () => [],
        getCatalogDetails: async () => ({ items: [] }),
        getComponentCatalog: async () => ({ components: [], count: 0 }),
        getCompassStatus: async () => ({ available: false }),
        getUpdateStatus: async () => ({ status: 'idle', message: 'No update check has run yet.' }),
        reportAnonymousSetupSuccess: async (payload) => { record('reportAnonymousSetupSuccess', payload); return { ok: true }; },
        getTerminalPreference: async () => ({ ok: true, selectedId: 'default', options: [{ id: 'default', label: 'Default Terminal', available: true }], message: 'Claude Code will open in Default Terminal.' }),
        setTerminalPreference: async (payload) => ({ ok: true, selectedId: 'default', options: [{ id: 'default', label: 'Default Terminal', available: true }], message: 'Claude Code will open in Default Terminal.' }),
        testTerminalPreference: async () => ({ ok: true, message: 'Opened Default Terminal with the CCTI terminal launch test.' }),
        getClaudeStatus: async () => ({ installed: true, version: '1.0.0', path: '/usr/local/bin/claude' }),
        verifySetup: async () => ({ ok: true, ready: true, summary: 'CCTI verified the fixture setup.', checks: [] }),
        discoverSetup: async (payload) => { record('discoverSetup', payload); return ${JSON.stringify(discoveryReport)}; },
        reviewCleanup: async () => ({ ok: false, error: 'Not implemented' }),
        applyCleanup: async () => ({ ok: false, error: 'Not implemented' }),
        reviewProjectPackageRemoval: async () => ({ ok: false, error: 'Not implemented' }),
        applyProjectPackageRemoval: async () => ({ ok: false, error: 'Not implemented' }),
        reviewManagedExtrasRemoval: async () => ({ ok: false, error: 'Not implemented' }),
        applyManagedExtrasRemoval: async () => ({ ok: false, error: 'Not implemented' }),
        reviewAllDuplicates: async () => ({ ok: false, error: 'Not implemented' }),
        applyAllDuplicates: async () => ({ ok: false, error: 'Not implemented' }),
        reviewAllSkillBackups: async () => ({ ok: false, error: 'Not implemented' }),
        applyAllSkillBackups: async () => ({ ok: false, error: 'Not implemented' }),
        reviewCustomAddOn: async () => ({ ok: false, error: 'Not implemented' }),
        chooseSetupManagerProject: async () => ({ canceled: true }),
        chooseCustomSource: async () => ({ canceled: true }),
        onUpdateStatus: () => {},
        onOutput: () => {},
        onState: () => {},
        onComponentOutput: () => {},
        onComponentState: () => {},
      };
    })();
  </script>`;
}

async function pageValue(window, expression) {
  return window.webContents.executeJavaScript(expression, true);
}

async function waitFor(window, predicate, label) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const matched = await window.webContents.executeJavaScript(`(${predicate.toString()})()`);
    if (matched) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function run() {
  const rawHtml = await fs.readFile(indexPath, 'utf8');
  const rendererBase = pathToFileURL(`${rendererDir}${path.sep}`).href;
  const fixtureHtml = rawHtml
    .replace('<head>', `<head><base href="${rendererBase}">`)
    .replace('    <script src="../project-interview.js"></script>', `${injectedBridge()}\n    <script src="../project-interview.js"></script>`);
  await fs.writeFile(fixturePath, fixtureHtml, 'utf8');

  const viewports = [
    { width: 1280, height: 720, label: 'desktop' },
    { width: 768, height: 1024, label: 'tablet' },
    { width: 390, height: 844, label: 'mobile' },
  ];

  const window = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  try {
    await window.loadFile(fixturePath);
    await waitFor(window, () => Boolean(document.querySelector('#scan-setup-button')), 'startup');

    await pageValue(window, "document.querySelector('#scan-setup-button').click()");

    await waitFor(window, () => {
      const results = document.querySelector('#setup-manager-results');
      return results && results.children.length >= 80;
    }, 'inventory population');

    await pageValue(window, "document.querySelector('#setup-manager-inventory').open = true");

    for (const vp of viewports) {
      window.setContentSize(vp.width, vp.height);
      await new Promise((resolve) => setTimeout(resolve, 150));

      const containment = await pageValue(window, `(() => {
        const doc = document.documentElement;
        const results = document.querySelector('#setup-manager-results');
        const cards = [...document.querySelectorAll('.manager-item')];
        const cardWithLongPath = cards.find(c => c.querySelector('h3')?.textContent.includes('5b4d7fbe-5e6a'));
        const heading = cardWithLongPath ? cardWithLongPath.querySelector('h3') : null;
        const notice = document.querySelector('#setup-manager-results .empty-results');

        return {
          rootFits: doc.scrollWidth <= window.innerWidth,
          resultsFit: results ? results.scrollWidth <= results.clientWidth : false,
          cardFits: cardWithLongPath ? cardWithLongPath.scrollWidth <= cardWithLongPath.clientWidth : false,
          headingFits: heading ? heading.scrollWidth <= heading.clientWidth : false,
          docScrollWidth: doc.scrollWidth,
          windowInnerWidth: window.innerWidth,
          resultsScrollWidth: results?.scrollWidth,
          resultsClientWidth: results?.clientWidth,
          cardScrollWidth: cardWithLongPath?.scrollWidth,
          cardClientWidth: cardWithLongPath?.clientWidth,
          headingScrollWidth: heading?.scrollWidth,
          headingClientWidth: heading?.clientWidth,
          noticePresent: Boolean(notice),
          noticeText: notice?.textContent,
        };
      })()`);

      console.log(`Viewport ${vp.label} (${vp.width}x${vp.height}):`, containment);

      assert.equal(containment.rootFits, true, `Root must fit in viewport at ${vp.width}px`);
      assert.equal(containment.resultsFit, true, `Results grid must fit without overflowing horizontally at ${vp.width}px`);
      assert.equal(containment.cardFits, true, `Card with long path must fit inside its allocated grid column at ${vp.width}px`);
      assert.equal(containment.headingFits, true, `Heading with long path must fit inside its card at ${vp.width}px`);
      assert.equal(containment.noticePresent, true, '80-item notice must be present when findings exceed 80 items');
    }
  } finally {
    if (!window.isDestroyed()) window.destroy();
    await fs.rm(fixturePath, { force: true });
  }

  console.log('All checkup layout containment assertions passed across desktop, tablet, and mobile viewports!');
}

app.whenReady()
  .then(run)
  .then(() => app.quit())
  .catch(async (error) => {
    console.error(error.stack || error.message || error);
    await fs.rm(fixturePath, { force: true }).catch(() => {});
    process.exit(1);
  });
