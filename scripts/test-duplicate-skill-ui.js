#!/usr/bin/env node
const assert = require('node:assert/strict');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow } = require('electron');

if (process.platform === 'linux') {
  // The package script supplies --no-sandbox before Electron starts because
  // GitHub's Ubuntu runners cannot use its packaged SUID sandbox helper. This
  // fixture-only test does not change the production BrowserWindow sandbox.
  app.commandLine.appendSwitch('headless');
  app.commandLine.appendSwitch('disable-gpu');
}

const root = path.resolve(__dirname, '..');
const rendererDir = path.join(root, 'desktop', 'src', 'renderer');
const indexPath = path.join(rendererDir, 'index.html');
const fixturePath = path.join(os.tmpdir(), `ccti-duplicate-skill-ui-${process.pid}.html`);
const resultPath = process.env.CCTI_DUPLICATE_UI_REPORT_PATH ? path.resolve(process.env.CCTI_DUPLICATE_UI_REPORT_PATH) : '';

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

const nameOverlapItems = [
  {
    id: 'skill:/fixture-home/.claude/skills/claude.ai',
    type: 'skill',
    name: 'claude.ai',
    scope: 'Just you',
    path: '/fixture-home/.claude/skills/claude.ai',
    updatedAt: '2026-02-15T10:00:00.000Z',
    description: 'A saved set of instructions for Claude Code.',
  },
  {
    id: 'skill:/fixture-project/.claude/skills/claude.ai',
    type: 'skill',
    name: 'claude.ai',
    scope: 'This project',
    path: '/fixture-project/.claude/skills/claude.ai',
    updatedAt: '2026-07-15T10:00:00.000Z',
    description: 'A saved set of instructions for Claude Code.',
  },
];

const linkedSkillExclusion = {
  id: 'skill-link-excluded:/fixture-home/.claude/skills/gstack',
  type: 'skill-link-excluded',
  name: 'gstack',
  scope: 'Just you',
  path: '/fixture-home/.claude/skills/gstack',
  description: 'This linked skill remains available to Claude Code. CCTI excludes skills containing symbolic links from duplicate cleanup, so it will not follow, compare, move, or delete linked files.',
};

const projectPackage = {
  id: 'project-package:/fixture-project/package.json:@convex-dev/agent',
  type: 'project-package',
  name: '@convex-dev/agent',
  version: '0.14.0',
  scope: 'This project',
  path: '/fixture-project/package.json',
  description: 'Project package · 0.14.0.',
};

const longPluginPath = '/fixture-home/.claude/plugins/synced/5b4d7fbe-5e6a-473a-91b3-6794b50af7d_552b50b7-59d8-42a6-b087-898165128950/operations';
const longPluginPathItem = {
  id: 'plugin:/fixture-home/.claude/plugins/synced/operations',
  type: 'plugin',
  name: `Path: ${longPluginPath}`,
  scope: 'Claude Code',
  path: 'Claude Code',
  description: 'Reported by Claude Code.',
};

const discoveryReport = {
  discoveryId: 'duplicate-ui-fixture',
  checkedAt: '2026-09-12T12:00:00.000Z',
  projectPath: '/fixture-project',
  findings: [...duplicateItems, ...nameOverlapItems, linkedSkillExclusion, projectPackage, longPluginPathItem],
  managedExtras: { actionCount: 1, manualCount: 1, ignored: 0, error: '' },
  duplicates: [
    {
      name: 'revenue-systems',
      type: 'skill',
      match: 'content-hash',
      items: duplicateItems,
      explanation: 'These skill folders have the same name and identical verified file content.',
    },
    {
      name: 'claude.ai',
      type: 'skill',
      match: 'name',
      items: nameOverlapItems,
      explanation: 'These skill folders have the same name in more than one Claude Code location, but their content was not verified as identical.',
    },
  ],
};

const backedUpSkill = {
  id: 'backup:/fixture-home/.setup-my-claude/disabled-skills/revenue-systems-backup',
  type: 'skill-backup',
  name: 'revenue-systems',
  scope: 'Just you',
  path: '/fixture-home/.setup-my-claude/disabled-skills/revenue-systems-backup',
  destination: '/fixture-home/.claude/skills/revenue-systems',
  restorable: true,
  description: 'A preserved CCTI skill backup that can be restored to its original Claude Code location.',
};

const backedUpReport = {
  ...discoveryReport,
  findings: [duplicateItems[1], backedUpSkill],
  duplicates: [],
};

const restoredReport = {
  ...discoveryReport,
  findings: [duplicateItems[1]],
  duplicates: [],
};

function injectedBridge() {
  return `
<script>
  (() => {
    const duplicateItems = ${JSON.stringify(duplicateItems)};
    const discoveryReport = ${JSON.stringify(discoveryReport)};
    const backedUpSkill = ${JSON.stringify(backedUpSkill)};
    const backedUpReport = ${JSON.stringify(backedUpReport)};
    const restoredReport = ${JSON.stringify(restoredReport)};
    let scanCount = 0;
    let terminalId = 'default';
    const terminalOptions = [{ id: 'default', label: 'Default Terminal', available: true }, { id: 'iterm2', label: 'iTerm2', available: true }];
    let updateStatusListener = () => {};
    window.__duplicateUiCalls = [];
    window.__emitUpdateStatus = (status) => updateStatusListener(status);
    window.confirm = (message) => {
      window.__duplicateUiCalls.push({ method: 'confirm', message });
      return true;
    };
    window.prompt = (message) => {
      window.__duplicateUiCalls.push({ method: 'prompt', message });
      return message.includes('PROJECT PACKAGE') ? 'REMOVE PROJECT PACKAGE' : message.includes('CCTI EXTRAS') ? 'REMOVE CCTI EXTRAS' : '';
    };
    const record = (method, payload) => window.__duplicateUiCalls.push({ method, payload });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (value) => record('copyPath', value) },
    });
    window.installer = {
      getCatalog: async () => [],
      getCatalogDetails: async () => ({ items: [] }),
      getComponentCatalog: async () => ({ components: [], count: 0 }),
      getCompassStatus: async () => ({ available: false }),
      getUpdateStatus: async () => ({ status: 'idle', message: 'No update check has run yet.' }),
      reportAnonymousSetupSuccess: async (payload) => { record('reportAnonymousSetupSuccess', payload); return { ok: true }; },
      getTerminalPreference: async () => ({ ok: true, selectedId: terminalId, options: terminalOptions, message: 'Claude Code will open in ' + (terminalId === 'iterm2' ? 'iTerm2' : 'Default Terminal') + '.' }),
      setTerminalPreference: async (payload) => { record('setTerminalPreference', payload); terminalId = payload.terminalId; return { ok: true, selectedId: terminalId, options: terminalOptions, message: 'CCTI will open Claude Code in ' + (terminalId === 'iterm2' ? 'iTerm2' : 'Default Terminal') + '.' }; },
      testTerminalPreference: async () => { record('testTerminalPreference'); return { ok: true, message: 'Opened iTerm2 with the CCTI terminal launch test.' }; },
      getClaudeStatus: async () => ({ installed: true, version: 'test', path: '/fixture-home/.local/bin/claude' }),
      verifySetup: async () => ({ ok: true, ready: true, summary: 'CCTI verified the fixture setup.', checks: [] }),
      discoverSetup: async (payload) => { record('discoverSetup', payload); scanCount += 1; return scanCount === 1 ? discoveryReport : scanCount === 2 ? backedUpReport : restoredReport; },
      reviewCleanup: async (payload) => {
        record('reviewCleanup', payload);
        return {
          ok: true,
          reviewId: 'duplicate-cleanup-review',
          source: duplicateItems[0].path,
          destination: '/fixture-home/.claude/ccti-backups/revenue-systems-20260912-120000',
          moves: [{
            name: 'revenue-systems',
            scope: duplicateItems[0].scope,
            source: duplicateItems[0].path,
            destination: '/fixture-home/.claude/ccti-backups/revenue-systems-20260912-120000',
            files: [{
              source: '/fixture-home/.claude/skills/revenue-systems/SKILL.md',
              destination: '/fixture-home/.claude/ccti-backups/revenue-systems-20260912-120000/SKILL.md',
              size: 42,
              sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            }],
          }],
        };
      },
      applyCleanup: async (payload) => { record('applyCleanup', payload); return { ok: true, message: 'Moved the selected skill to a backup folder.' }; },
      reviewProjectPackageRemoval: async (payload) => {
        record('reviewProjectPackageRemoval', payload);
        return { ok: true, reviewId: 'project-package-removal-review', name: '@convex-dev/agent', projectPath: '/fixture-project', packageJsonPath: '/fixture-project/package.json', command: 'npm uninstall --ignore-scripts --no-audit --no-fund @convex-dev/agent' };
      },
      applyProjectPackageRemoval: async (payload) => { record('applyProjectPackageRemoval', payload); return { ok: false, error: 'Fixture stopped before package removal.' }; },
      reviewManagedExtrasRemoval: async () => ({ ok: true, reviewId: 'managed-extras-removal-review', actions: [{ label: 'CCTI reference folder: learn-claude-code' }], manualItems: [{ label: 'claude-mem: Use docs' }], description: 'Removes only reviewed CCTI-managed extras.' }),
      applyManagedExtrasRemoval: async (payload) => { record('applyManagedExtrasRemoval', payload); return { ok: false, error: 'Fixture stopped before managed extras removal.' }; },
      reviewAllDuplicates: async (payload) => {
        record('reviewAllDuplicates', payload);
        return {
          ok: true,
          reviewId: 'all-duplicates-cleanup-review',
          groups: [{ name: 'revenue-systems', keep: duplicateItems[1], moveCount: 1 }],
          moves: [{
            name: 'revenue-systems',
            scope: duplicateItems[0].scope,
            source: duplicateItems[0].path,
            destination: '/fixture-home/.setup-my-claude/disabled-skills/revenue-systems-backup',
            files: [{
              source: '/fixture-home/.claude/skills/revenue-systems/SKILL.md',
              destination: '/fixture-home/.setup-my-claude/disabled-skills/revenue-systems-backup/SKILL.md',
              size: 42,
              sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            }],
          }],
        };
      },
      applyAllDuplicates: async (payload) => { record('applyAllDuplicates', payload); return { ok: true, movedCount: 1, groupCount: 1, message: 'Moved the selected duplicate skill copy to a backup folder.' }; },
      reviewAllSkillBackups: async (payload) => {
        record('reviewAllSkillBackups', payload);
        return {
          ok: true,
          reviewId: 'all-skill-backups-restore-review',
          moves: [{
            name: 'revenue-systems',
            scope: backedUpSkill.scope,
            source: backedUpSkill.path,
            destination: backedUpSkill.destination,
            files: [{
              source: '/fixture-home/.setup-my-claude/disabled-skills/revenue-systems-backup/SKILL.md',
              destination: '/fixture-home/.claude/skills/revenue-systems/SKILL.md',
              size: 42,
              sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            }],
          }],
        };
      },
      applyAllSkillBackups: async (payload) => { record('applyAllSkillBackups', payload); return { ok: true, restoredCount: 1, message: 'Restored the selected skill backup copy.' }; },
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
      onUpdateStatus: (listener) => { updateStatusListener = listener; },
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

    const anonymousPrompt = await pageValue(window, `(() => ({
      heading: document.querySelector('#anonymous-success-heading').textContent,
      detail: document.querySelector('#anonymous-success-detail').textContent,
      reportText: document.querySelector('#report-anonymous-success-button').textContent,
      skipHidden: document.querySelector('#skip-anonymous-success-button').hidden,
    }))()`);
    assert.equal(anonymousPrompt.heading, 'Optional private completion count');
    assert.equal(anonymousPrompt.detail, 'Nothing is counted unless you choose it.');
    assert.equal(anonymousPrompt.reportText, 'Count this completion (optional)');
    assert.equal(anonymousPrompt.skipHidden, false);
    await pageValue(window, "document.querySelector('#skip-anonymous-success-button').click()");
    const anonymousOptOut = await pageValue(window, `(() => ({
      detail: document.querySelector('#anonymous-success-detail').textContent,
      message: document.querySelector('#anonymous-success-message').textContent,
      reportDisabled: document.querySelector('#report-anonymous-success-button').disabled,
      skipHidden: document.querySelector('#skip-anonymous-success-button').hidden,
      reported: window.__duplicateUiCalls.filter((call) => call.method === 'reportAnonymousSetupSuccess').length,
    }))()`);
    assert.deepEqual(anonymousOptOut, {
      detail: 'No completion count was sent.',
      message: 'Your setup is still complete.',
      reportDisabled: true,
      skipHidden: true,
      reported: 0,
    });

    const terminalControl = await pageValue(window, `(() => ({
      value: document.querySelector('#terminal-preference-select').value,
      note: document.querySelector('#terminal-preference-note').textContent,
      live: document.querySelector('#terminal-preference-note').getAttribute('aria-live'),
      busy: document.querySelector('#terminal-preference-note').getAttribute('aria-busy'),
      options: [...document.querySelector('#terminal-preference-select').options].map((option) => ({ value: option.value, disabled: option.disabled })),
    }))()`);
    assert.deepEqual(terminalControl, {
      value: 'default',
      note: 'Claude Code will open in Default Terminal.',
      live: 'polite',
      busy: 'false',
      options: [{ value: 'default', disabled: false }, { value: 'iterm2', disabled: false }],
    });
    await pageValue(window, `(() => {
      const terminal = document.querySelector('#terminal-preference-select');
      terminal.value = 'iterm2';
      terminal.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitFor(window, () => window.__duplicateUiCalls.some((call) => call.method === 'setTerminalPreference'), 'terminal preference save');
    const terminalSave = await pageValue(window, `(() => ({
      call: window.__duplicateUiCalls.find((item) => item.method === 'setTerminalPreference'),
      value: document.querySelector('#terminal-preference-select').value,
      note: document.querySelector('#terminal-preference-note').textContent,
    }))()`);
    assert.deepEqual(terminalSave, {
      call: { method: 'setTerminalPreference', payload: { terminalId: 'iterm2' } },
      value: 'iterm2',
      note: 'CCTI will open Claude Code in iTerm2.',
    });
    await pageValue(window, "document.querySelector('#test-terminal-preference-button').click()");
    await waitFor(window, () => window.__duplicateUiCalls.some((call) => call.method === 'testTerminalPreference'), 'terminal test launch');
    const terminalTest = await pageValue(window, `(() => ({
      call: window.__duplicateUiCalls.find((item) => item.method === 'testTerminalPreference'),
      note: document.querySelector('#terminal-preference-note').textContent,
      busy: document.querySelector('#terminal-preference-note').getAttribute('aria-busy'),
      buttonDisabled: document.querySelector('#test-terminal-preference-button').disabled,
    }))()`);
    assert.deepEqual(terminalTest, {
      call: { method: 'testTerminalPreference', payload: undefined },
      note: 'Opened iTerm2 with the CCTI terminal launch test.',
      busy: 'false',
      buttonDisabled: false,
    });

    await pageValue(window, `window.__emitUpdateStatus({
      state: 'available',
      latestVersion: '2026.09.17',
      releaseUrl: 'https://github.com/SteveKinzey/claude-code-tools-installer/releases/tag/v2026.09.17',
      message: 'CCTI 2026.09.17 is available. Select Check for Updates to download the signed update.',
      canDownload: true,
      canInstall: false,
      artifactDigestSummary: { total: 5, verified: 5, missing: [] },
    })`);
    const availableUpdate = await pageValue(window, `(() => ({
      note: document.querySelector('#update-status-note').textContent,
      stateClass: document.querySelector('#update-status-note').className,
      busy: document.querySelector('#update-status-note').getAttribute('aria-busy'),
      spinnerHidden: document.querySelector('#update-status-spinner').hidden,
      spinnerDisplay: getComputedStyle(document.querySelector('#update-status-spinner')).display,
      integrityHidden: document.querySelector('#release-integrity-alert').hidden,
      integrityDisplay: getComputedStyle(document.querySelector('#release-integrity-alert')).display,
      viewReleaseHidden: document.querySelector('#open-release-button').hidden,
      viewReleaseText: document.querySelector('#open-release-button').textContent,
      restartHidden: document.querySelector('#install-update-button').hidden,
      checkText: document.querySelector('#check-updates-button').textContent,
    }))()`);
    assert.deepEqual(availableUpdate, {
      note: 'CCTI 2026.09.17 is available. Select Check for Updates to download the signed update.',
      stateClass: 'update-status-note update-status-available',
      busy: 'false',
      spinnerHidden: true,
      spinnerDisplay: 'none',
      integrityHidden: true,
      integrityDisplay: 'none',
      viewReleaseHidden: false,
      viewReleaseText: 'View CCTI 2026.09.17',
      restartHidden: true,
      checkText: 'Check for Updates',
    });
    await pageValue(window, `window.__emitUpdateStatus({
      state: 'current',
      latestVersion: '2026.09.17',
      releaseUrl: 'https://github.com/SteveKinzey/claude-code-tools-installer/releases/tag/v2026.09.17',
      message: 'CCTI 2026.09.17 is the newest published release.',
      digestAlert: { count: 1, names: ['ccti-windows.zip'], message: '1 published release artifact is missing a SHA-256 digest.' },
    })`);
    const integrityNotice = await pageValue(window, `(() => ({
      hidden: document.querySelector('#release-integrity-alert').hidden,
      text: document.querySelector('#release-integrity-alert').textContent.replace(/\\s+/g, ' ').trim(),
      buttonHidden: document.querySelector('#open-release-button').hidden,
      buttonText: document.querySelector('#open-release-button').textContent,
    }))()`);
    assert.deepEqual(integrityNotice, {
      hidden: false,
      text: 'Release integrity notice: 1 published release artifact is missing a SHA-256 digest. Missing: ccti-windows.zip. Review the release before downloading.',
      buttonHidden: false,
      buttonText: 'Review CCTI 2026.09.17 Release',
    });
    await pageValue(window, `window.__emitUpdateStatus({ state: 'downloading', latestVersion: '2026.09.17', message: 'Downloading signed update…' })`);
    const downloadingUpdate = await pageValue(window, `(() => ({
      busy: document.querySelector('#update-status-note').getAttribute('aria-busy'),
      spinnerHidden: document.querySelector('#update-status-spinner').hidden,
      checkText: document.querySelector('#check-updates-button').textContent,
      checkDisabled: document.querySelector('#check-updates-button').disabled,
    }))()`);
    assert.deepEqual(downloadingUpdate, { busy: 'true', spinnerHidden: false, checkText: 'Downloading Update…', checkDisabled: true });
    await pageValue(window, `window.__emitUpdateStatus({ state: 'downloaded', latestVersion: '2026.09.17', releaseUrl: 'https://github.com/SteveKinzey/claude-code-tools-installer/releases/tag/v2026.09.17', message: 'CCTI 2026.09.17 is downloaded and verified. Restart CCTI to apply it now.', canInstall: true })`);
    const downloadedUpdate = await pageValue(window, `(() => ({
      restartHidden: document.querySelector('#install-update-button').hidden,
      restartDisabled: document.querySelector('#install-update-button').disabled,
      checkText: document.querySelector('#check-updates-button').textContent,
      checkDisabled: document.querySelector('#check-updates-button').disabled,
      note: document.querySelector('#update-status-note').textContent,
    }))()`);
    assert.deepEqual(downloadedUpdate, {
      restartHidden: false,
      restartDisabled: false,
      checkText: 'Update Downloaded',
      checkDisabled: true,
      note: 'CCTI 2026.09.17 is downloaded and verified. Restart CCTI to apply it now.',
    });

    await pageValue(window, "document.querySelector('#scan-setup-button').click()");
    await waitFor(window, () => document.querySelector('#cleanup-actions')?.classList.contains('is-hidden') === false, 'cleanup action panel after a checkup scan');
    const cleanupActionPanel = await pageValue(window, `(() => ({
      duplicate: document.querySelector('#cleanup-duplicates-status').textContent,
      skills: document.querySelector('#cleanup-skills-status').textContent,
      plugins: document.querySelector('#cleanup-plugins-status').textContent,
      packages: document.querySelector('#cleanup-packages-status').textContent,
      managedExtras: document.querySelector('#cleanup-managed-extras-status').textContent,
      inventoryOpen: document.querySelector('#setup-manager-inventory').open,
      duplicateButton: document.querySelector('#cleanup-review-duplicates-button').textContent,
      skillButton: document.querySelector('#cleanup-manage-skills-button').textContent,
      packageButton: document.querySelector('#cleanup-manage-packages-button').textContent,
      managedExtrasButton: document.querySelector('#cleanup-review-managed-extras-button').textContent,
    }))()`);
    assert.match(cleanupActionPanel.duplicate, /1 verified identical-content group/i);
    assert.match(cleanupActionPanel.skills, /4 installed skills/i);
    assert.match(cleanupActionPanel.plugins, /no user or project add-ons/i);
    assert.match(cleanupActionPanel.packages, /1 package found/i);
    assert.match(cleanupActionPanel.managedExtras, /1 CCTI-managed extra/i);
    assert.equal(cleanupActionPanel.inventoryOpen, false, 'the raw inventory should not bury cleanup actions after a checkup');
    assert.equal(cleanupActionPanel.duplicateButton, 'Review 1 duplicate copy');
    assert.equal(cleanupActionPanel.skillButton, 'Review 4 installed skills');
    assert.equal(cleanupActionPanel.packageButton, 'Review 1 project package');
    assert.equal(cleanupActionPanel.managedExtrasButton, 'Review 1 removal');

    const linkedSkillCard = await pageValue(window, `(() => {
      const card = [...document.querySelectorAll('.manager-item-skill-link-excluded')]
        .find((item) => item.querySelector('h3')?.textContent === 'gstack');
      return {
        title: card?.querySelector('h3')?.textContent,
        meta: card?.querySelector('p')?.textContent,
        copy: card?.querySelectorAll('p')[1]?.textContent,
        buttonCount: card?.querySelectorAll('button').length,
      };
    })()`);
    assert.deepEqual(linkedSkillCard, {
      title: 'gstack',
      meta: 'Linked skill · Cleanup excluded · Just you',
      copy: 'This linked skill remains available to Claude Code. CCTI excludes skills containing symbolic links from duplicate cleanup, so it will not follow, compare, move, or delete linked files.',
      buttonCount: 0,
    }, 'Linked skills must be shown as safe cleanup exclusions with no backup or removal action.');

    const longPathCopyControl = await pageValue(window, `(() => {
      const card = [...document.querySelectorAll('.manager-item-plugin')]
        .find((item) => item.querySelector('h3')?.textContent.includes('5b4d7fbe-5e6a'));
      const button = card?.querySelector('.manager-path-copy');
      return {
        title: card?.querySelector('h3')?.textContent,
        buttonText: button?.textContent,
        accessibleName: button?.getAttribute('aria-label'),
        tooltipText: card?.querySelector('.manager-path-copy-tooltip')?.textContent,
        tooltipHidden: card?.querySelector('.manager-path-copy-tooltip')?.getAttribute('aria-hidden'),
        cardFits: card ? card.scrollWidth <= card.clientWidth : false,
        titleFits: card?.querySelector('h3') ? card.querySelector('h3').scrollWidth <= card.querySelector('h3').clientWidth : false,
      };
    })()`);
    assert.equal(longPathCopyControl.title, `Path: ${longPluginPath}`);
    assert.equal(longPathCopyControl.buttonText, 'Copy path');
    assert.equal(longPathCopyControl.accessibleName, 'Copy this add-on path');
    assert.equal(longPathCopyControl.tooltipText, 'Copied!');
    assert.equal(longPathCopyControl.tooltipHidden, 'true');
    assert.equal(longPathCopyControl.cardFits, true, 'a long plugin path card must remain within its grid track');
    assert.equal(longPathCopyControl.titleFits, true, 'a long plugin path heading must wrap within its card');
    await pageValue(window, "document.querySelector('.manager-path-copy').click()");
    await waitFor(window, () => window.__duplicateUiCalls.some((call) => call.method === 'copyPath'), 'long plugin path copy action');
    assert.equal((await pageValue(window, "window.__duplicateUiCalls.find((call) => call.method === 'copyPath')?.payload")), longPluginPath);
    assert.equal(await pageValue(window, "document.querySelector('.manager-path-copy').textContent"), 'Copied');
    assert.equal(await pageValue(window, "document.querySelector('.manager-path-copy').getAttribute('aria-label')"), 'Copied! Add-on path copied');
    assert.equal(await pageValue(window, "document.querySelector('.manager-path-copy-tooltip').classList.contains('is-visible')"), true);
    assert.equal(await pageValue(window, "document.querySelector('.manager-path-copy-tooltip').getAttribute('aria-hidden')"), 'false');

    await pageValue(window, "document.querySelector('#cleanup-manage-skills-button').click()");
    await waitFor(window, () => document.querySelector('#setup-manager-inventory')?.open === true, 'installed skills inventory reveal');
    await pageValue(window, "document.querySelector('.manager-item-skill button').click()");
    await waitFor(window, () => document.querySelector('#duplicate-skill-dialog')?.open === true && document.querySelector('#duplicate-skill-dialog-heading')?.textContent === 'Move this skill to a backup', 'single skill backup preview');
    assert.equal(await pageValue(window, "document.querySelector('#backup-selected-skill-button').hidden"), false, 'a discovered skill must offer a clear safe backup action');
    await pageValue(window, "document.querySelector('#cancel-deduplicate-preview-button').click()");
    await waitFor(window, () => document.querySelector('#duplicate-skill-dialog')?.open === false, 'single skill preview dismissal');
    await pageValue(window, "document.querySelector('.manager-item-project-package button').click()");
    await waitFor(window, () => window.__duplicateUiCalls.some((call) => call.method === 'applyProjectPackageRemoval'), 'reviewed project package removal control');
    assert.deepEqual((await pageValue(window, 'window.__duplicateUiCalls')).find((call) => call.method === 'applyProjectPackageRemoval')?.payload, {
      reviewId: 'project-package-removal-review',
      confirmation: 'REMOVE PROJECT PACKAGE',
    });
    await pageValue(window, "document.querySelector('#cleanup-review-managed-extras-button').click()");
    await waitFor(window, () => window.__duplicateUiCalls.some((call) => call.method === 'applyManagedExtrasRemoval'), 'reviewed CCTI-managed extras removal control');
    assert.deepEqual((await pageValue(window, 'window.__duplicateUiCalls')).find((call) => call.method === 'applyManagedExtrasRemoval')?.payload, {
      reviewId: 'managed-extras-removal-review',
      confirmation: 'REMOVE CCTI EXTRAS',
    });
    await pageValue(window, "document.querySelector('#cleanup-review-duplicates-button').click()");
    await waitFor(window, () => document.querySelector('#duplicate-skill-dialog')?.open === true, 'duplicate skills dialog after explicit cleanup action');

    const scanDialog = await pageValue(window, `(() => {
      const dialog = document.querySelector('#duplicate-skill-dialog');
      return {
        labelledBy: dialog.getAttribute('aria-labelledby'),
        describedBy: dialog.getAttribute('aria-describedby'),
        copy: document.querySelector('#duplicate-skill-dialog-copy').textContent,
        groups: document.querySelectorAll('.duplicate-skill-dialog-item').length,
        bulkButton: {
          text: document.querySelector('#deduplicate-all-skills-button').textContent,
          hidden: document.querySelector('#deduplicate-all-skills-button').hidden,
          disabled: document.querySelector('#deduplicate-all-skills-button').disabled,
        },
        locations: [...dialog.querySelectorAll('.duplicate-skill-dialog-location > span')].map((item) => item.textContent),
        copyButtons: [...dialog.querySelectorAll('.duplicate-skill-dialog-location button')].map((item) => item.textContent),
        nameOverlap: {
          summary: document.querySelector('#duplicate-review-summary').textContent,
          text: [...document.querySelectorAll('.duplicate-group.is-information')].map((item) => item.textContent).join('\\n'),
          actionCount: document.querySelectorAll('.duplicate-group.is-information button').length,
        },
      };
    })()`);
    assert.equal(scanDialog.labelledBy, 'duplicate-skill-dialog-heading');
    assert.equal(scanDialog.describedBy, 'duplicate-skill-dialog-copy');
    assert.equal(await pageValue(window, "document.querySelector('#duplicate-skill-dialog').getAttribute('aria-modal')"), 'true');
    assert.match(scanDialog.copy, /identical verified file content/i);
    assert.equal(scanDialog.groups, 1, 'The scan should render one grouped duplicate skill.');
    assert.deepEqual(scanDialog.bulkButton, { text: 'Back up verified duplicates', hidden: false, disabled: false });
    // The personal (home) copy is always the keeper, even though the project copy here is
    // newer: Claude Code resolves the personal copy over a project copy (documented
    // personal-over-project rule), so the dialog must not label the newer project copy "keep".
    assert.match(scanDialog.locations[0], /^Keep this copy · the one Claude Code uses · Just you/);
    assert.match(scanDialog.locations[0], /\/fixture-home\/\.claude\/skills\/revenue-systems/);
    assert.match(scanDialog.locations[1], /^Available for backup review · This project/);
    assert.deepEqual(scanDialog.copyButtons, ['Move this copy to backup', 'Move this copy to backup'], 'every actionable duplicate copy should offer a granular backup review button');
    assert.match(scanDialog.nameOverlap.summary, /1 same-name overlap is informational only/i);
    assert.match(scanDialog.nameOverlap.text, /claude\.ai/i);
    assert.match(scanDialog.nameOverlap.text, /will not offer a backup move or deletion/i);
    assert.equal(scanDialog.nameOverlap.actionCount, 0, 'A name overlap must never expose a removal or backup action.');

    await pageValue(window, "document.querySelector('.duplicate-skill-dialog-location button').click()");
    await waitFor(window, () => document.querySelector('#duplicate-backup-preview')?.hidden === false && document.querySelector('#duplicate-skill-dialog-heading')?.textContent === 'Move this skill to a backup', 'single duplicate copy preview');
    const selectivePreview = await pageValue(window, `(() => ({
      previewTitle: document.querySelector('#duplicate-backup-preview-heading').textContent,
      files: document.querySelector('#duplicate-backup-preview-list').textContent,
      singleButtonHidden: document.querySelector('#backup-selected-skill-button').hidden,
      lastReview: window.__duplicateUiCalls.filter((call) => call.method === 'reviewCleanup').at(-1)?.payload,
    }))()`);
    assert.equal(selectivePreview.previewTitle, 'Files that will move to backup');
    assert.match(selectivePreview.files, /\/fixture-home\/\.claude\/skills\/revenue-systems\/SKILL\.md/);
    assert.equal(selectivePreview.singleButtonHidden, false, 'a selected duplicate copy must expose its reviewed backup action');
    assert.deepEqual(selectivePreview.lastReview, {
      discoveryId: 'duplicate-ui-fixture',
      findingId: 'skill:/fixture-home/.claude/skills/revenue-systems',
    });
    await pageValue(window, "document.querySelector('#cancel-deduplicate-preview-button').click()");
    await waitFor(window, () => document.querySelector('#duplicate-skill-dialog')?.open === true && document.querySelector('#duplicate-backup-preview')?.hidden === true && document.querySelectorAll('.duplicate-skill-dialog-location button').length === 2, 'return to duplicate copy selection');

    await pageValue(window, "document.querySelector('#deduplicate-all-skills-button').click()");
    await waitFor(window, () => document.querySelector('#duplicate-backup-preview')?.hidden === false && document.activeElement?.id === 'duplicate-backup-preview-heading', 'exact backup file preview');
    const backupPreview = await pageValue(window, `(() => ({
      button: document.querySelector('#deduplicate-all-skills-button').textContent,
      summary: document.querySelector('#duplicate-backup-preview-summary').textContent,
      files: document.querySelector('#duplicate-backup-preview-list').textContent,
      backVisible: document.querySelector('#cancel-deduplicate-preview-button').hidden === false,
      confirmCalls: window.__duplicateUiCalls.filter((call) => call.method === 'confirm').length,
    }))()`);
    assert.equal(backupPreview.button, 'Back up listed verified duplicates');
    assert.match(backupPreview.summary, /1 exact file/i);
    assert.match(backupPreview.files, /\/fixture-home\/\.claude\/skills\/revenue-systems\/SKILL\.md/);
    assert.match(backupPreview.files, /\/fixture-home\/\.setup-my-claude\/disabled-skills\/revenue-systems-backup\/SKILL\.md/);
    assert.match(backupPreview.files, /SHA-256 a{64}/);
    assert.equal(backupPreview.backVisible, true);
    assert.equal(backupPreview.confirmCalls, 2, 'the duplicate preview should not add a confirmation before its final action');
    assert.equal(await pageValue(window, "document.activeElement?.id"), 'duplicate-backup-preview-heading', 'the file preview heading should receive focus when the preview phase opens');

    await pageValue(window, "document.querySelector('#cancel-deduplicate-preview-button').click()");
    await waitFor(window, () => document.querySelector('#duplicate-backup-preview')?.hidden === true && document.querySelector('#deduplicate-all-skills-button')?.textContent === 'Back up verified duplicates' && document.activeElement?.id === 'duplicate-skill-dialog-heading', 'return to duplicate review');
    assert.equal(await pageValue(window, "document.activeElement?.id"), 'duplicate-skill-dialog-heading', 'returning to duplicate review should move focus to its dialog title');
    await pageValue(window, "document.querySelector('#deduplicate-all-skills-button').click()");
    await waitFor(window, () => document.querySelector('#duplicate-backup-preview')?.hidden === false, 'reopened exact backup file preview');

    await pageValue(window, "document.querySelector('#deduplicate-all-skills-button').click()");
    await waitFor(window, () => window.__duplicateUiCalls.some((call) => call.method === 'applyAllDuplicates'), 'reviewed bulk backup move');
    const cleanupCalls = await pageValue(window, 'window.__duplicateUiCalls');
    const cleanupConfirmation = cleanupCalls.filter((call) => call.method === 'confirm').at(-1)?.message || '';
    assert.match(cleanupConfirmation, /Back up exactly 1 reviewed file/);
    assert.match(cleanupConfirmation, /exact file list and backup destinations are shown in the CCTI dialog/i);
    assert.match(cleanupConfirmation, /does not delete any skill/i);
    assert.deepEqual(cleanupCalls.find((call) => call.method === 'reviewAllDuplicates')?.payload, {
      discoveryId: 'duplicate-ui-fixture',
    });
    assert.deepEqual(cleanupCalls.find((call) => call.method === 'applyAllDuplicates')?.payload, { reviewId: 'all-duplicates-cleanup-review' });

    await waitFor(window, () => document.querySelector('#duplicate-skill-dialog')?.open === false, 'bulk cleanup dialog closure');
    await waitFor(window, () => document.querySelector('#restore-all-skill-backups-button')?.disabled === false, 'safe backup restore control after cleanup');
    const restoreControl = await pageValue(window, `(() => ({
      text: document.querySelector('#restore-all-skill-backups-button').textContent,
      summary: document.querySelector('#skill-backup-review-summary').textContent,
      listed: document.querySelector('#skill-backup-review-list').textContent,
    }))()`);
    assert.match(restoreControl.text, /Restore 1 safe backup copy/);
    assert.match(restoreControl.summary, /1 of 1 preserved skill backup copy is safe to restore/);
    assert.match(restoreControl.listed, /Original location: \/fixture-home\/\.claude\/skills\/revenue-systems/);

    await pageValue(window, "document.querySelector('#restore-all-skill-backups-button').click()");
    await waitFor(window, () => document.querySelector('#duplicate-backup-preview')?.hidden === false && document.querySelector('#restore-listed-skill-backups-button')?.hidden === false && document.activeElement?.id === 'duplicate-backup-preview-heading', 'restore file preview');
    const restorePreview = await pageValue(window, `(() => ({
      title: document.querySelector('#duplicate-skill-dialog-heading').textContent,
      previewTitle: document.querySelector('#duplicate-backup-preview-heading').textContent,
      copy: document.querySelector('#duplicate-skill-dialog-copy').textContent,
      files: document.querySelector('#duplicate-backup-preview-list').textContent,
      active: document.activeElement?.id,
    }))()`);
    assert.equal(restorePreview.title, 'Review backed-up skills');
    assert.equal(restorePreview.previewTitle, 'Files that will be restored');
    assert.match(restorePreview.copy, /never overwrites active skills/i);
    assert.match(restorePreview.files, /\/fixture-home\/\.setup-my-claude\/disabled-skills\/revenue-systems-backup\/SKILL\.md/);
    assert.match(restorePreview.files, /→ \/fixture-home\/\.claude\/skills\/revenue-systems\/SKILL\.md/);
    assert.equal(restorePreview.active, 'duplicate-backup-preview-heading');

    await pageValue(window, `(() => {
      const dialog = document.querySelector('#duplicate-skill-dialog');
      dialog.dataset.fixtureCloseComplete = '';
      dialog.addEventListener('close', () => { dialog.dataset.fixtureCloseComplete = 'true'; }, { once: true });
      document.querySelector('#cancel-deduplicate-preview-button').click();
    })()`);
    await waitFor(window, () => document.querySelector('#duplicate-skill-dialog')?.open === false && document.querySelector('#duplicate-skill-dialog')?.dataset.fixtureCloseComplete === 'true', 'restore preview dismissal');
    assert.equal(await pageValue(window, "document.querySelector('#cancel-deduplicate-preview-button').type"), 'button', 'restore cancellation must remain a native keyboard-operable button');
    assert.equal(await pageValue(window, "document.querySelector('#restore-all-skill-backups-button').disabled"), false, 'cancelling restore must leave the restore review control available');

    await pageValue(window, "document.querySelector('#restore-all-skill-backups-button').click()");
    await waitFor(window, () => document.querySelector('#restore-listed-skill-backups-button')?.hidden === false, 'restored preview reopen');
    await pageValue(window, "document.querySelector('#restore-listed-skill-backups-button').click()");
    await waitFor(window, () => window.__duplicateUiCalls.some((call) => call.method === 'applyAllSkillBackups'), 'reviewed backup restore');
    const restoreCalls = await pageValue(window, 'window.__duplicateUiCalls');
    const restoreConfirmation = restoreCalls.filter((call) => call.method === 'confirm').at(-1)?.message || '';
    assert.match(restoreConfirmation, /Restore exactly 1 reviewed file/);
    assert.match(restoreConfirmation, /will not overwrite active skills/i);
    assert.deepEqual(restoreCalls.find((call) => call.method === 'applyAllSkillBackups')?.payload, { reviewId: 'all-skill-backups-restore-review' });
    await waitFor(window, () => document.querySelector('#duplicate-skill-dialog')?.open === false, 'backup restore dialog closure');

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
    console.log('Duplicate skill UI integration passed: the single bulk cleanup action, reviewed backup prompt, blocked add alert, and dismissal controls behaved as expected.');
    if (resultPath) fsSync.writeFileSync(resultPath, JSON.stringify({ ok: true }), 'utf8');
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
    if (resultPath) await fs.writeFile(resultPath, JSON.stringify({ ok: false, error: String(error.message || error) }), 'utf8').catch(() => {});
    await fs.rm(fixturePath, { force: true }).catch(() => {});
    process.exit(1);
  });
