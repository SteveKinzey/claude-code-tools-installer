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
const fixturePath = path.join(os.tmpdir(), `ccti-duplicate-skill-ui-${process.pid}.html`);

const duplicateItems = [
  {
    id: 'skill:/fixture-home/.claude/skills/revenue-systems',
    type: 'skill',
    name: 'revenue-systems',
    scope: 'Just you',
    path: '/fixture-home/.claude/skills/revenue-systems',
    updatedAt: '2026-01-15T10:00:00.000Z',
    description: 'A saved set of instructions for Claude Code.',
  },
  {
    id: 'skill:/fixture-project/.claude/skills/revenue-systems',
    type: 'skill',
    name: 'revenue-systems',
    scope: 'This project',
    path: '/fixture-project/.claude/skills/revenue-systems',
    updatedAt: '2026-08-15T10:00:00.000Z',
    description: 'A saved set of instructions for Claude Code.',
  },
];

const discoveryReport = {
  discoveryId: 'duplicate-ui-fixture',
  checkedAt: '2026-09-12T12:00:00.000Z',
  projectPath: '/fixture-project',
  findings: duplicateItems,
  duplicates: [{
    name: 'revenue-systems',
    type: 'skill',
    items: duplicateItems,
    explanation: 'This name appears in more than one Claude Code location. That can be useful, but review the scopes before keeping more than one copy.',
  }],
};

function injectedBridge() {
  return `
<script>
  (() => {
    const duplicateItems = ${JSON.stringify(duplicateItems)};
    const discoveryReport = ${JSON.stringify(discoveryReport)};
    window.__duplicateUiCalls = [];
    window.confirm = (message) => {
      window.__duplicateUiCalls.push({ method: 'confirm', message });
      return true;
    };
    const record = (method, payload) => window.__duplicateUiCalls.push({ method, payload });
    window.installer = {
      getCatalog: async () => [],
      getCatalogDetails: async () => ({ items: [] }),
      getComponentCatalog: async () => ({ components: [], count: 0 }),
      getCompassStatus: async () => ({ available: false }),
      getUpdateStatus: async () => ({ status: 'idle', message: 'No update check has run yet.' }),
      getClaudeStatus: async () => ({ installed: true, version: 'test', path: '/fixture-home/.local/bin/claude' }),
      discoverSetup: async (payload) => { record('discoverSetup', payload); return discoveryReport; },
      reviewCleanup: async (payload) => {
        record('reviewCleanup', payload);
        return {
          ok: true,
          reviewId: 'duplicate-cleanup-review',
          source: duplicateItems[0].path,
          destination: '/fixture-home/.claude/ccti-backups/revenue-systems-20260912-120000',
        };
      },
      applyCleanup: async (payload) => { record('applyCleanup', payload); return { ok: true, message: 'Moved the selected skill to a backup folder.' }; },
      reviewCustomAddOn: async (payload) => {
        record('reviewCustomAddOn', payload);
        return {
          ok: true,
          blocked: true,
          kind: 'duplicate-skill',
          name: 'revenue-systems',
          description: 'CCTI did not add revenue-systems because this skill is already available in Claude Code.',
          existing: duplicateItems,
        };
      },
      chooseSetupManagerProject: async () => ({ canceled: true }),
      chooseCustomSource: async () => ({ canceled: true }),
      onOutput: () => {},
      onState: () => {},
      onComponentOutput: () => {},
      onComponentState: () => {},
      onUpdateStatus: () => {},
    };
  })();
</script>`;
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

async function pageValue(window, expression) {
  return window.webContents.executeJavaScript(expression, true);
}

async function run() {
  const rawHtml = await fs.readFile(indexPath, 'utf8');
  const rendererBase = pathToFileURL(`${rendererDir}${path.sep}`).href;
  const fixtureHtml = rawHtml
    .replace('<head>', `<head><base href="${rendererBase}">`)
    .replace('    <script src="../project-interview.js"></script>', `${injectedBridge()}\n    <script src="../project-interview.js"></script>`);
  assert.notEqual(fixtureHtml, rawHtml, 'The UI fixture must inject the narrow test bridge before renderer startup.');
  await fs.writeFile(fixturePath, fixtureHtml, 'utf8');

  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  try {
    await window.loadFile(fixturePath);
    await waitFor(window, () => document.querySelector('#claude-status-text')?.textContent.includes('Yes, Claude Code is installed'), 'renderer startup');

    await pageValue(window, "document.querySelector('#scan-setup-button').click()");
    await waitFor(window, () => document.querySelector('#duplicate-skill-dialog')?.open === true, 'duplicate skills dialog after a checkup scan');

    const scanDialog = await pageValue(window, `(() => {
      const dialog = document.querySelector('#duplicate-skill-dialog');
      return {
        labelledBy: dialog.getAttribute('aria-labelledby'),
        describedBy: dialog.getAttribute('aria-describedby'),
        copy: document.querySelector('#duplicate-skill-dialog-copy').textContent,
        groups: document.querySelectorAll('.duplicate-skill-dialog-item').length,
        buttons: [...dialog.querySelectorAll('.duplicate-skill-dialog-location button')].map((button) => button.textContent),
        locations: [...dialog.querySelectorAll('.duplicate-skill-dialog-location > span')].map((item) => item.textContent),
      };
    })()`);
    assert.equal(scanDialog.labelledBy, 'duplicate-skill-dialog-heading');
    assert.equal(scanDialog.describedBy, 'duplicate-skill-dialog-copy');
    assert.match(scanDialog.copy, /cannot determine which version you still need/i);
    assert.equal(scanDialog.groups, 1, 'The scan should render one grouped duplicate skill.');
    assert.deepEqual(scanDialog.buttons, ['Move this copy to backup', 'Move this copy to backup']);
    assert.match(scanDialog.locations[0], /^Older local copy by date · Just you/);
    assert.match(scanDialog.locations[0], /\/fixture-home\/\.claude\/skills\/revenue-systems/);
    assert.match(scanDialog.locations[1], /^Another local copy · This project/);

    await pageValue(window, "document.querySelector('.duplicate-skill-dialog-location button').click()");
    await waitFor(window, () => window.__duplicateUiCalls.some((call) => call.method === 'applyCleanup'), 'reviewed backup move');
    const cleanupCalls = await pageValue(window, 'window.__duplicateUiCalls');
    const cleanupConfirmation = cleanupCalls.find((call) => call.method === 'confirm')?.message || '';
    assert.match(cleanupConfirmation, /Move this skill to a backup folder\?/);
    assert.match(cleanupConfirmation, /Backup location:/);
    assert.match(cleanupConfirmation, /does not delete the skill/i);
    assert.deepEqual(cleanupCalls.find((call) => call.method === 'reviewCleanup')?.payload, {
      discoveryId: 'duplicate-ui-fixture',
      findingId: duplicateItems[0].id,
    });
    assert.deepEqual(cleanupCalls.find((call) => call.method === 'applyCleanup')?.payload, { reviewId: 'duplicate-cleanup-review' });

    await pageValue(window, "document.querySelector('#duplicate-skill-dialog').close()");
    await pageValue(window, `(() => {
      document.querySelector('#custom-addon-source').value = '/incoming/revenue-systems';
      document.querySelector('#review-custom-addon-button').click();
    })()`);
    await waitFor(window, () => document.querySelector('#duplicate-skill-dialog')?.open === true, 'duplicate skills dialog after a blocked custom add');

    const blockedAdd = await pageValue(window, `(() => ({
      output: document.querySelector('#custom-addon-output').textContent,
      hasError: document.querySelector('#custom-addon-output').classList.contains('has-error'),
      applyDisabled: document.querySelector('#apply-custom-addon-button').disabled,
      dialogCopy: document.querySelector('#duplicate-skill-dialog-copy').textContent,
      reviewCalls: window.__duplicateUiCalls.filter((call) => call.method === 'reviewCustomAddOn').length,
    }))()`);
    assert.match(blockedAdd.output, /already available in Claude Code/i);
    assert.match(blockedAdd.output, /CCTI will not add a duplicate/i);
    assert.equal(blockedAdd.hasError, true, 'A blocked duplicate add should use the existing live error state.');
    assert.equal(blockedAdd.applyDisabled, true, 'The add control must stay disabled after duplicate detection.');
    assert.match(blockedAdd.dialogCopy, /CCTI did not add another copy/i);
    assert.equal(blockedAdd.reviewCalls, 1);

    await pageValue(window, "document.querySelector('#close-duplicate-skill-dialog').click()");
    await waitFor(window, () => document.querySelector('#duplicate-skill-dialog')?.open === false, 'Keep all copies dialog dismissal');
    console.log('Duplicate skill UI integration passed: the scan dialog, reviewed backup prompt, blocked add alert, and dismissal controls behaved as expected.');
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
    app.exit(1);
  });
