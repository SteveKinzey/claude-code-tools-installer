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
const fixturePath = path.join(os.tmpdir(), `ccti-duplicate-a11y-${process.pid}.html`);
const evidencePath = process.env.CCTI_A11Y_REPORT_PATH ? path.resolve(process.env.CCTI_A11Y_REPORT_PATH) : '';

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
  discoveryId: 'duplicate-a11y-fixture',
  checkedAt: '2026-09-15T00:00:00.000Z',
  projectPath: '/fixture-project',
  findings: duplicateItems,
  duplicates: [{
    name: 'revenue-systems',
    type: 'skill',
    match: 'content-hash',
    items: duplicateItems,
    explanation: 'These skill folders have the same name and identical verified file content.',
  }],
};

const backupReport = {
  ...discoveryReport,
  findings: [duplicateItems[1], {
    id: 'backup:/fixture-home/.setup-my-claude/disabled-skills/revenue-systems-1760000000000-a1b2c3d4',
    type: 'skill-backup',
    name: 'revenue-systems',
    scope: 'Just you',
    path: '/fixture-home/.setup-my-claude/disabled-skills/revenue-systems-1760000000000-a1b2c3d4',
    destination: '/fixture-home/.claude/skills/revenue-systems',
    restorable: true,
    description: 'A preserved CCTI skill backup that can be restored to its original Claude Code location.',
  }],
  duplicates: [],
};

function injectedBridge() {
  return `
<script>
  (() => {
    const duplicateItems = ${JSON.stringify(duplicateItems)};
    const discoveryReport = ${JSON.stringify(discoveryReport)};
    const backupReport = ${JSON.stringify(backupReport)};
    let scanCount = 0;
    window.confirm = () => true;
    window.installer = {
      getCatalog: async () => [],
      getCatalogDetails: async () => ({ items: [] }),
      getComponentCatalog: async () => ({ components: [], count: 0 }),
      getCompassStatus: async () => ({ available: false }),
      getUpdateStatus: async () => ({ status: 'idle', message: 'No update check has run yet.' }),
      getTerminalPreference: async () => ({ ok: true, selectedId: 'default', options: [{ id: 'default', label: 'Default Terminal', available: true }, { id: 'iterm2', label: 'iTerm2', available: true }], message: 'Claude Code will open in Default Terminal.' }),
      setTerminalPreference: async () => ({ ok: true, selectedId: 'default', options: [{ id: 'default', label: 'Default Terminal', available: true }, { id: 'iterm2', label: 'iTerm2', available: true }], message: 'CCTI will open Claude Code in Default Terminal.' }),
      getClaudeStatus: async () => ({ installed: true, version: 'test', path: '/fixture-home/.local/bin/claude' }),
      verifySetup: async () => ({ ok: true, ready: true, summary: 'CCTI verified the fixture setup.', checks: [] }),
      discoverSetup: async () => { scanCount += 1; return scanCount === 1 ? discoveryReport : backupReport; },
      reviewAllDuplicates: async () => ({
        ok: true,
        reviewId: 'cleanup-review',
        groups: [{ name: 'revenue-systems', keep: duplicateItems[1], moveCount: 1 }],
        moves: [{
          name: 'revenue-systems', scope: 'Just you',
          source: duplicateItems[0].path,
          destination: '/fixture-home/.setup-my-claude/disabled-skills/revenue-systems-1760000000000-a1b2c3d4',
          files: [{
            source: '/fixture-home/.claude/skills/revenue-systems/SKILL.md',
            destination: '/fixture-home/.setup-my-claude/disabled-skills/revenue-systems-1760000000000-a1b2c3d4/SKILL.md',
            size: 42,
            sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          }],
        }],
      }),
      applyAllDuplicates: async () => ({ ok: true, movedCount: 1, message: 'Moved duplicate skill copy to backup.' }),
      reviewAllSkillBackups: async () => ({
        ok: true,
        reviewId: 'restore-review',
        moves: [{
          name: 'revenue-systems', scope: 'Just you',
          source: '/fixture-home/.setup-my-claude/disabled-skills/revenue-systems-1760000000000-a1b2c3d4',
          destination: '/fixture-home/.claude/skills/revenue-systems',
          files: [{
            source: '/fixture-home/.setup-my-claude/disabled-skills/revenue-systems-1760000000000-a1b2c3d4/SKILL.md',
            destination: '/fixture-home/.claude/skills/revenue-systems/SKILL.md',
            size: 42,
            sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          }],
        }],
      }),
      applyAllSkillBackups: async () => ({ ok: true, restoredCount: 1, message: 'Restored skill backup copy.' }),
      reviewCleanup: async () => ({ ok: false, error: 'Not used in this audit.' }),
      applyCleanup: async () => ({ ok: false, error: 'Not used in this audit.' }),
      reviewCustomAddOn: async () => ({ ok: false, error: 'Not used in this audit.' }),
      applyCustomAddOn: async () => ({ ok: false, error: 'Not used in this audit.' }),
      reviewPluginChange: async () => ({ ok: false, error: 'Not used in this audit.' }),
      applyPluginChange: async () => ({ ok: false, error: 'Not used in this audit.' }),
      chooseSetupManagerProject: async () => ({ canceled: true }),
      chooseCustomSource: async () => ({ canceled: true }),
      onOutput: () => {}, onState: () => {}, onComponentOutput: () => {}, onComponentState: () => {}, onUpdateStatus: () => {},
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

async function run() {
  const rawHtml = await fs.readFile(indexPath, 'utf8');
  const fixtureHtml = rawHtml
    .replace('<head>', `<head><base href="${pathToFileURL(`${rendererDir}${path.sep}`).href}">`)
    .replace('    <script src="../project-interview.js"></script>', `${injectedBridge()}\n    <script src="../project-interview.js"></script>`);
  await fs.writeFile(fixturePath, fixtureHtml, 'utf8');
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  try {
    await window.loadFile(fixturePath);
    await waitFor(window, () => document.querySelector('#claude-status-text')?.textContent.includes('Yes, Claude Code is installed'), 'renderer startup');
    const staticLiveRegions = await evaluate(window, `(() => [...document.querySelectorAll('[aria-live], [role="status"], [role="alert"]')].map((node) => ({
      id: node.id,
      role: node.getAttribute('role'),
      live: node.getAttribute('aria-live'),
      busy: node.getAttribute('aria-busy'),
    })))()`);
    const expectedLiveRegions = [
      { id: 'reference-results', role: null, live: 'polite', busy: null },
      { id: 'setup-manager-results', role: null, live: 'polite', busy: null },
      { id: 'custom-addon-output', role: 'status', live: 'polite', busy: null },
      { id: 'project-interview-output', role: null, live: 'polite', busy: null },
      { id: 'queue-interview-suggestions-note', role: 'status', live: 'polite', busy: null },
      { id: 'catalog', role: null, live: 'polite', busy: null },
      { id: 'component-results', role: null, live: 'polite', busy: null },
      { id: 'component-detail', role: null, live: 'polite', busy: null },
      { id: 'complete-setup-scope-note', role: 'status', live: 'polite', busy: null },
      { id: 'setup-verification-summary', role: 'status', live: 'polite', busy: null },
      { id: 'setup-verification-results', role: null, live: 'polite', busy: null },
      { id: 'anonymous-success-message', role: null, live: 'polite', busy: null },
      { id: 'cleanup-actions-status', role: 'status', live: 'polite', busy: null },
      { id: 'terminal-preference-note', role: 'status', live: 'polite', busy: 'false' },
      { id: 'run-status', role: 'status', live: 'polite', busy: 'false' },
      { id: 'output', role: null, live: 'polite', busy: null },
      { id: 'update-status-note', role: 'status', live: 'polite', busy: 'false' },
      { id: 'release-integrity-alert', role: 'alert', live: null, busy: null },
      { id: 'manifest-verification-status', role: 'status', live: 'polite', busy: null },
      { id: 'manifest-comparison-result', role: null, live: 'polite', busy: null },
      { id: 'compass-messages', role: null, live: 'polite', busy: null },
      { id: 'duplicate-backup-preview-summary', role: 'status', live: 'polite', busy: null },
      { id: 'runtime-path-health-cards', role: null, live: 'polite', busy: null },
      { id: 'runtime-path-health-summary', role: 'status', live: 'polite', busy: null },
    ];
    assert.deepEqual(
      staticLiveRegions.sort((left, right) => left.id.localeCompare(right.id)),
      expectedLiveRegions.sort((left, right) => left.id.localeCompare(right.id)),
      'every rendered CCTI announcement region must retain its approved live-region semantics',
    );

    await evaluate(window, "document.querySelector('#scan-setup-button').click()");
    await waitFor(window, () => !document.querySelector('#cleanup-actions')?.classList.contains('is-hidden'), 'action-first cleanup panel');
    const cleanupPanel = await evaluate(window, `(() => ({
      inventoryOpen: document.querySelector('#setup-manager-inventory').open,
      duplicateAction: document.querySelector('#cleanup-review-duplicates-button').textContent,
      duplicateActionHidden: document.querySelector('#cleanup-review-duplicates-button').hidden,
      live: document.querySelector('#cleanup-actions-status').getAttribute('aria-live'),
      role: document.querySelector('#cleanup-actions-status').getAttribute('role'),
    }))()`);
    assert.deepEqual(cleanupPanel, { inventoryOpen: false, duplicateAction: 'Review 1 duplicate copy', duplicateActionHidden: false, live: 'polite', role: 'status' });
    await evaluate(window, "document.querySelector('#cleanup-review-duplicates-button').click()");
    await waitFor(window, () => document.querySelector('#duplicate-skill-dialog')?.open, 'explicit duplicate review dialog');
    const dialogSemantics = await evaluate(window, `(() => {
      const dialog = document.querySelector('#duplicate-skill-dialog');
      const preview = document.querySelector('#duplicate-backup-preview');
      return {
        modal: dialog.getAttribute('aria-modal'), labelledBy: dialog.getAttribute('aria-labelledby'), describedBy: dialog.getAttribute('aria-describedby'),
        titleTabIndex: document.querySelector('#duplicate-skill-dialog-heading').getAttribute('tabindex'),
        previewHidden: preview.hidden,
      };
    })()`);
    assert.deepEqual(dialogSemantics, { modal: 'true', labelledBy: 'duplicate-skill-dialog-heading', describedBy: 'duplicate-skill-dialog-copy', titleTabIndex: '-1', previewHidden: true });

    await evaluate(window, "document.querySelector('#deduplicate-all-skills-button').click()");
    await waitFor(window, () => !document.querySelector('#duplicate-backup-preview')?.hidden && document.activeElement?.id === 'duplicate-backup-preview-heading', 'backup preview announcement');
    const backupAnnouncement = await evaluate(window, `(() => ({
      live: document.querySelector('#duplicate-backup-preview-summary').getAttribute('aria-live'),
      role: document.querySelector('#duplicate-backup-preview-summary').getAttribute('role'),
      text: document.querySelector('#duplicate-backup-preview-summary').textContent,
      focus: document.activeElement?.id,
    }))()`);
    assert.equal(backupAnnouncement.role, 'status');
    assert.equal(backupAnnouncement.live, 'polite');
    assert.match(backupAnnouncement.text, /Review 1 exact file/i);
    assert.equal(backupAnnouncement.focus, 'duplicate-backup-preview-heading');

    await evaluate(window, "document.querySelector('#cancel-deduplicate-preview-button').click()");
    await waitFor(window, () => document.querySelector('#duplicate-backup-preview')?.hidden, 'return to duplicate review');
    await evaluate(window, "document.querySelector('#deduplicate-all-skills-button').click()");
    await waitFor(window, () => !document.querySelector('#duplicate-backup-preview')?.hidden, 'backup preview reopen');
    await evaluate(window, "document.querySelector('#deduplicate-all-skills-button').click()");
    await waitFor(window, () => !document.querySelector('#duplicate-skill-dialog')?.open && !document.querySelector('#skill-backup-review')?.classList.contains('is-hidden'), 'backup inventory refresh');
    await evaluate(window, "document.querySelector('#restore-all-skill-backups-button').click()");
    await waitFor(window, () => !document.querySelector('#duplicate-backup-preview')?.hidden && !document.querySelector('#restore-listed-skill-backups-button')?.hidden && document.activeElement?.id === 'duplicate-backup-preview-heading', 'restore preview announcement');
    const restoreAnnouncement = await evaluate(window, `(() => ({
      text: document.querySelector('#duplicate-backup-preview-summary').textContent,
      role: document.querySelector('#duplicate-backup-preview-summary').getAttribute('role'),
      live: document.querySelector('#duplicate-backup-preview-summary').getAttribute('aria-live'),
      restoreButtonType: document.querySelector('#restore-listed-skill-backups-button').type,
      cancelButtonType: document.querySelector('#cancel-deduplicate-preview-button').type,
      focus: document.activeElement?.id,
    }))()`);
    assert.equal(restoreAnnouncement.role, 'status');
    assert.equal(restoreAnnouncement.live, 'polite');
    assert.match(restoreAnnouncement.text, /shown original Claude Code locations/i);
    assert.equal(restoreAnnouncement.restoreButtonType, 'button');
    assert.equal(restoreAnnouncement.cancelButtonType, 'button');
    assert.equal(restoreAnnouncement.focus, 'duplicate-backup-preview-heading');

    const evidence = {
      ok: true,
      liveRegionCount: staticLiveRegions.length,
      liveRegionIds: staticLiveRegions.map((region) => region.id).sort(),
      duplicatePreview: { backupAnnouncement, restoreAnnouncement, dialogSemantics },
    };
    if (evidencePath) {
      await fs.mkdir(path.dirname(evidencePath), { recursive: true });
      await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    }
    console.log(JSON.stringify(evidence));
  } finally {
    if (!window.isDestroyed()) window.destroy();
    await fs.rm(fixturePath, { force: true });
  }
}

app.whenReady().then(run).then(() => app.quit()).catch(async (error) => {
  console.error(error.stack || error.message || error);
  if (evidencePath) {
    await fs.mkdir(path.dirname(evidencePath), { recursive: true }).catch(() => {});
    await fs.writeFile(evidencePath, `${JSON.stringify({ ok: false, error: String(error.message || error) }, null, 2)}\n`, 'utf8').catch(() => {});
  }
  await fs.rm(fixturePath, { force: true }).catch(() => {});
  process.exit(1);
});
