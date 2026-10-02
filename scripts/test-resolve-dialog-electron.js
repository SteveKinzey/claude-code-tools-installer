#!/usr/bin/env node
// Real-Electron renderer test for the Manage list's Resolve dialog: open -> review ->
// (for needsChoice, pick a copy) -> apply -> success state, plus the "changed since you
// looked" path where a stale apply hands back a fresh review to confirm again. Modeled on
// scripts/audit-duplicate-skill-accessibility.js: a temp fixture HTML with an injected
// window.installer stub bridge, driven with webContents.executeJavaScript.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { externalBridgeTag } = require('./renderer-fixture-bridge');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow } = require('electron');

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('headless');
  app.commandLine.appendSwitch('disable-gpu');
}

const root = path.resolve(__dirname, '..');
const rendererDir = path.join(root, 'desktop', 'src', 'renderer');
const indexPath = path.join(rendererDir, 'index.html');
const fixturePath = path.join(os.tmpdir(), `ccti-resolve-dialog-${process.pid}.html`);
const evidencePath = process.env.CCTI_RESOLVE_DIALOG_REPORT_PATH ? path.resolve(process.env.CCTI_RESOLVE_DIALOG_REPORT_PATH) : '';

// Two connection duplicates named "playwright" that must NOT hide one another (the fix on
// this branch: a project duplicate no longer hides a same-name home duplicate), plus an
// add-on installed from two marketplaces that needs a choice before it can be reviewed.
const homePlaywrightRow = {
  rowId: 'mcp:playwright',
  kind: 'mcp',
  key: 'playwright',
  name: 'playwright',
  state: 'duplicate',
  copies: [{ scope: 'Only you, in this folder', path: '' }, { scope: 'Just you, everywhere', path: '' }],
  resolution: { groupKey: 'mcp:playwright', needsChoice: false, keeper: 1, options: ['Only you, in this folder', 'Just you, everywhere'] },
};
const projectPlaywrightRow = {
  rowId: 'mcp:playwright:project',
  kind: 'mcp',
  key: 'playwright',
  name: 'playwright',
  state: 'duplicate',
  copies: [{ scope: 'Only you, in this project', path: '' }, { scope: 'Just you, everywhere', path: '' }],
  resolution: { groupKey: 'mcp:playwright:project', needsChoice: false, keeper: 1, options: ['Only you, in this project', 'Just you, everywhere'] },
};
const fooAddOnRow = {
  rowId: 'plugin:foo',
  kind: 'plugin',
  key: 'foo',
  name: 'foo',
  state: 'duplicate',
  copies: [{ scope: 'Just you', path: '' }, { scope: 'Just you', path: '' }],
  resolution: { groupKey: 'plugin:foo', needsChoice: true, keeper: null, options: ['market-a (Just you)', 'market-b (Just you)'] },
};
const allRows = [homePlaywrightRow, projectPlaywrightRow, fooAddOnRow];

function injectedBridge() {
  return `
<script>
  (() => {
    const allRows = ${JSON.stringify(allRows)};
    const resolvedGroups = new Set();
    const reviewLog = {};
    const applyOutcomes = {};
    const reviewCalls = [];
    const applyCalls = [];
    const groupReviewCounts = {};
    let discoverCalls = 0;
    window.__resolveDialogTest = { reviewCalls, applyCalls, get discoverCalls() { return discoverCalls; } };

    function currentInventory() {
      return { rows: allRows.filter((row) => !resolvedGroups.has(row.resolution.groupKey)), historyStatus: 'ok' };
    }

    // The "changed since you looked" path: this reviewId's apply call reports the group
    // changed after review and hands back a fresh review with a NEW reviewId; that follow-up
    // reviewId then applies cleanly.
    applyOutcomes['mcp:playwright:project#1'] = { changed: true, follow: 'mcp:playwright:project#2' };
    reviewLog['mcp:playwright:project#2'] = { groupKey: 'mcp:playwright:project' };

    function reviewText(groupKey, keep) {
      if (groupKey === 'mcp:playwright') {
        return { name: 'playwright', keepLabel: 'Just you, everywhere', changes: [{ label: 'Remove the copy saved for Only you, in this folder', undo: 'The same connection is still saved for Just you, everywhere, so nothing stops working.' }] };
      }
      if (groupKey === 'mcp:playwright:project') {
        return { name: 'playwright', keepLabel: 'Just you, everywhere', changes: [{ label: 'Remove the copy saved for Only you, in this project', undo: 'The same connection is still saved for Just you, everywhere, so nothing stops working.' }] };
      }
      if (groupKey === 'plugin:foo') {
        const keptLabel = keep === 1 ? 'market-b (Just you)' : 'market-a (Just you)';
        const droppedLabel = keep === 1 ? 'market-a' : 'market-b';
        return { name: 'foo', keepLabel: keptLabel, changes: [{ label: 'Turn off the copy from ' + droppedLabel, undo: 'The add-on stays installed; only the ' + droppedLabel + ' copy turns off.' }] };
      }
      return null;
    }

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
      resetInventoryHistory: async () => ({ ok: true, preserved: false }),
      discoverSetup: async () => {
        discoverCalls += 1;
        return { discoveryId: 'resolve-dialog-fixture', checkedAt: '2026-09-26T00:00:00.000Z', projectPath: '/fixture-project', findings: [], duplicates: [], inventory: currentInventory() };
      },
      reviewResolution: async (payload) => {
        reviewCalls.push({ ...payload });
        if (payload.groupKey === 'plugin:foo' && payload.keep === undefined) {
          return { ok: false, error: 'Choose which copy to keep first.' };
        }
        const info = reviewText(payload.groupKey, payload.keep);
        if (!info) return { ok: false, error: 'Unknown group.' };
        groupReviewCounts[payload.groupKey] = (groupReviewCounts[payload.groupKey] || 0) + 1;
        const reviewId = payload.groupKey + '#' + groupReviewCounts[payload.groupKey];
        reviewLog[reviewId] = { groupKey: payload.groupKey, keep: payload.keep };
        return { ok: true, reviewId, ...info };
      },
      applyResolution: async (payload) => {
        applyCalls.push({ ...payload });
        const scripted = applyOutcomes[payload.reviewId];
        if (scripted?.changed) {
          const followGroupKey = reviewLog[scripted.follow].groupKey;
          const info = reviewText(followGroupKey);
          return {
            ok: false,
            changed: true,
            error: 'This changed since you looked at it, so nothing was changed. Here is how it looks now.',
            review: { reviewId: scripted.follow, ...info },
            resolution: allRows.find((row) => row.resolution.groupKey === followGroupKey).resolution,
          };
        }
        const entry = reviewLog[payload.reviewId];
        if (!entry) return { ok: false, error: 'This review is no longer available, so nothing was changed. Check this computer again, then choose Resolve.' };
        resolvedGroups.add(entry.groupKey);
        const info = reviewText(entry.groupKey, entry.keep);
        const label = info.changes[0].label.replace(/^Remove the copy saved for |^Turn off the copy from /, '');
        return { ok: true, message: 'Resolved ' + info.name + '. ' + label + ' is done; ' + info.keepLabel + ' stays working.' };
      },
      reviewAllDuplicates: async () => ({ ok: false, error: 'Not used in this test.' }),
      applyAllDuplicates: async () => ({ ok: false, error: 'Not used in this test.' }),
      reviewAllSkillBackups: async () => ({ ok: false, error: 'Not used in this test.' }),
      applyAllSkillBackups: async () => ({ ok: false, error: 'Not used in this test.' }),
      reviewCleanup: async () => ({ ok: false, error: 'Not used in this test.' }),
      applyCleanup: async () => ({ ok: false, error: 'Not used in this test.' }),
      reviewCustomAddOn: async () => ({ ok: false, error: 'Not used in this test.' }),
      applyCustomAddOn: async () => ({ ok: false, error: 'Not used in this test.' }),
      reviewPluginChange: async () => ({ ok: false, error: 'Not used in this test.' }),
      applyPluginChange: async () => ({ ok: false, error: 'Not used in this test.' }),
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

async function pressEscape(window) {
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
}

function resolveButtonClick(name, index) {
  return `(() => {
    const buttons = [...document.querySelectorAll('#tool-inventory-list button')].filter((b) => b.getAttribute('aria-label') === 'Resolve ${name}');
    if (!buttons[${index}]) return false;
    buttons[${index}].click();
    return true;
  })()`;
}

async function run() {
  const rawHtml = await fs.readFile(indexPath, 'utf8');
  const fixtureHtml = rawHtml
    .replace('<head>', `<head><base href="${pathToFileURL(`${rendererDir}${path.sep}`).href}">`)
    .replace('    <script src="../project-interview.js"></script>', `${externalBridgeTag(injectedBridge(), fixturePath)}\n    <script src="../project-interview.js"></script>`);
  await fs.writeFile(fixturePath, fixtureHtml, 'utf8');
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  try {
    await window.loadFile(fixturePath);
    await waitFor(window, () => document.querySelector('#claude-status-text')?.textContent.includes('Yes, Claude Code is installed'), 'renderer startup');

    await evaluate(window, "document.querySelector('#scan-setup-button').click()");
    await waitFor(window, () => !document.querySelector('#tool-inventory')?.classList.contains('is-hidden'), 'Manage list rendered');

    // The fix under test: a project duplicate must not hide a same-name home duplicate.
    // Both "playwright" rows render as separate, independently resolvable groups.
    const initialButtons = await evaluate(window, `(() => [...document.querySelectorAll('#tool-inventory-list button')].map((b) => b.getAttribute('aria-label')))()`);
    assert.deepEqual(initialButtons.sort(), ['Resolve foo', 'Resolve playwright', 'Resolve playwright'].sort(), 'both playwright duplicates and the foo add-on duplicate each show a Resolve button');

    // --- Case 4 (keyboard/a11y sanity), folded into the top of case 1's flow ---
    const clicked1 = await evaluate(window, resolveButtonClick('playwright', 0));
    assert.equal(clicked1, true, 'the home-folder playwright Resolve button is clickable');
    await waitFor(window, () => document.querySelector('#resolve-duplicate-dialog')?.open, 'resolve dialog opens');
    const openFocus = await evaluate(window, `(() => document.activeElement?.id)()`);
    assert.equal(openFocus, 'resolve-duplicate-dialog-heading', 'the dialog heading gets focus when opened');
    const heading1 = await evaluate(window, `(() => document.querySelector('#resolve-duplicate-dialog-heading').textContent)()`);
    assert.equal(heading1, 'Resolve playwright');
    const copy1 = await evaluate(window, `(() => document.querySelector('#resolve-duplicate-dialog-copy').textContent)()`);
    assert.equal(copy1, 'These copies are identical. CCTI keeps the one saved for Just you, everywhere and removes the extra copy, so nothing stops working.');

    await pressEscape(window);
    await waitFor(window, () => !document.querySelector('#resolve-duplicate-dialog')?.open, 'Escape closes the dialog');
    let counts = await evaluate(window, `(() => ({ review: window.__resolveDialogTest.reviewCalls.length, apply: window.__resolveDialogTest.applyCalls.length }))()`);
    assert.deepEqual(counts, { review: 0, apply: 0 }, 'Escape closes the dialog without calling review or apply');

    // Reopen the same group and drive it through to a successful apply.
    await evaluate(window, resolveButtonClick('playwright', 0));
    await waitFor(window, () => document.querySelector('#resolve-duplicate-dialog')?.open, 'resolve dialog reopens');
    await evaluate(window, "document.querySelector('#review-resolve-duplicate-button').click()");
    await waitFor(window, () => !document.querySelector('#resolve-duplicate-dialog-changes')?.hidden, 'review renders changes');
    let reviewCalls = await evaluate(window, `(() => window.__resolveDialogTest.reviewCalls)()`);
    assert.deepEqual(reviewCalls, [{ discoveryId: 'resolve-dialog-fixture', groupKey: 'mcp:playwright', keep: undefined }]);
    const keepText1 = await evaluate(window, `(() => document.querySelector('#resolve-duplicate-dialog-keep').textContent)()`);
    assert.equal(keepText1, 'CCTI keeps: Just you, everywhere');
    const changes1 = await evaluate(window, `(() => [...document.querySelectorAll('#resolve-duplicate-dialog-changes-list li')].map((li) => ({ label: li.querySelector('strong').textContent, undo: li.querySelector('span').textContent })))()`);
    assert.deepEqual(changes1, [{ label: 'Remove the copy saved for Only you, in this folder', undo: 'The same connection is still saved for Just you, everywhere, so nothing stops working.' }]);

    await evaluate(window, "document.querySelector('#apply-resolve-duplicate-button').click()");
    await waitFor(window, () => !document.querySelector('#resolve-duplicate-dialog')?.open, 'dialog closes after a successful apply');
    let applyCalls = await evaluate(window, `(() => window.__resolveDialogTest.applyCalls)()`);
    assert.deepEqual(applyCalls, [{ reviewId: 'mcp:playwright#1' }], 'apply is called once with the reviewed reviewId');
    await waitFor(window, () => window.__resolveDialogTest.discoverCalls >= 2, 'the app re-runs discovery after a successful apply');
    await waitFor(window, () => [...document.querySelectorAll('#tool-inventory-list button')].filter((b) => b.getAttribute('aria-label') === 'Resolve playwright').length === 1, 'the resolved playwright group disappears from the Manage list (success state)');
    const successStatus = await evaluate(window, "document.querySelector('#tool-inventory-status').textContent");
    assert.match(successStatus, /^Resolved playwright\./, 'a successful Resolve says what happened');

    // --- Case: needs choice (add-on from two marketplaces) ---
    await evaluate(window, resolveButtonClick('foo', 0));
    await waitFor(window, () => document.querySelector('#resolve-duplicate-dialog')?.open, 'resolve dialog opens for the add-on');
    const fooCopy = await evaluate(window, `(() => document.querySelector('#resolve-duplicate-dialog-copy').textContent)()`);
    assert.equal(fooCopy, 'Choose which copy of foo to keep. CCTI turns off the others; nothing is uninstalled, so you can turn one back on later.');
    const choiceState = await evaluate(window, `(() => ({
      choiceHidden: document.querySelector('#resolve-duplicate-dialog-choice').hidden,
      options: [...document.querySelectorAll('#resolve-duplicate-dialog-options span')].map((s) => s.textContent),
      reviewDisabled: document.querySelector('#review-resolve-duplicate-button').disabled,
    }))()`);
    assert.deepEqual(choiceState, { choiceHidden: false, options: ['market-a (Just you)', 'market-b (Just you)'], reviewDisabled: true });

    // Attempting to review with no choice made must not call the bridge.
    await evaluate(window, "document.querySelector('#review-resolve-duplicate-button').click()");
    counts = await evaluate(window, `(() => window.__resolveDialogTest.reviewCalls.length)()`);
    assert.equal(counts, 1, 'no new review call happens while disabled and unchosen (still just the earlier playwright review)');

    await evaluate(window, `(() => {
      const radios = [...document.querySelectorAll('#resolve-duplicate-dialog-options input[type="radio"]')];
      radios[1].checked = true;
      radios[1].dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    const enabledAfterChoice = await evaluate(window, `(() => document.querySelector('#review-resolve-duplicate-button').disabled)()`);
    assert.equal(enabledAfterChoice, false, 'choosing a copy enables Review changes');

    await evaluate(window, "document.querySelector('#review-resolve-duplicate-button').click()");
    await waitFor(window, () => !document.querySelector('#resolve-duplicate-dialog-changes')?.hidden, 'the add-on review renders changes');
    reviewCalls = await evaluate(window, `(() => window.__resolveDialogTest.reviewCalls)()`);
    assert.deepEqual(reviewCalls[1], { discoveryId: 'resolve-dialog-fixture', groupKey: 'plugin:foo', keep: 1 }, 'reviewResolution got keep: 1 for the second option');
    const fooKeepText = await evaluate(window, `(() => document.querySelector('#resolve-duplicate-dialog-keep').textContent)()`);
    assert.equal(fooKeepText, 'CCTI keeps: market-b (Just you)');

    await evaluate(window, "document.querySelector('#apply-resolve-duplicate-button').click()");
    await waitFor(window, () => !document.querySelector('#resolve-duplicate-dialog')?.open, 'dialog closes after the add-on apply succeeds');
    applyCalls = await evaluate(window, `(() => window.__resolveDialogTest.applyCalls)()`);
    assert.deepEqual(applyCalls[1], { reviewId: 'plugin:foo#1' });
    await waitFor(window, () => [...document.querySelectorAll('#tool-inventory-list button')].every((b) => b.getAttribute('aria-label') !== 'Resolve foo'), 'the resolved add-on disappears from the Manage list');

    // --- Case: changed since you looked at it (project-scoped playwright group) ---
    // The add-on apply re-runs discovery; wait until that refresh has fully landed so the
    // Manage list is not redrawn under the next dialog.
    await waitFor(window, () => window.__resolveDialogTest.discoverCalls >= 3 && !/^Checking/.test(document.querySelector('#setup-manager-summary')?.textContent || ''), 'the refresh after the add-on apply finishes');
    const clickedProject = await evaluate(window, resolveButtonClick('playwright', 0));
    assert.equal(clickedProject, true, 'the project-folder playwright Resolve button is clickable now that it is the only one left');
    await waitFor(window, () => document.querySelector('#resolve-duplicate-dialog')?.open, 'resolve dialog opens for the project group');
    const projectHeading = await evaluate(window, `(() => document.querySelector('#resolve-duplicate-dialog-heading').textContent)()`);
    assert.equal(projectHeading, 'Resolve playwright');

    await waitFor(window, () => { const b = document.querySelector('#review-resolve-duplicate-button'); return b && !b.hidden && !b.disabled; }, 'the project group Review button is ready');
    await evaluate(window, "document.querySelector('#review-resolve-duplicate-button').click()");
    await waitFor(window, () => !document.querySelector('#resolve-duplicate-dialog-changes')?.hidden, 'the project group review renders changes');
    reviewCalls = await evaluate(window, `(() => window.__resolveDialogTest.reviewCalls)()`);
    assert.deepEqual(reviewCalls[2], { discoveryId: 'resolve-dialog-fixture', groupKey: 'mcp:playwright:project', keep: undefined }, 'the project row sends its own groupKey, distinct from the home-folder group');

    await evaluate(window, "document.querySelector('#apply-resolve-duplicate-button').click()");
    await waitFor(window, () => document.querySelector('#resolve-duplicate-dialog-status')?.textContent.includes('This changed since you looked at it'), '"changed since you looked" text becomes visible');
    applyCalls = await evaluate(window, `(() => window.__resolveDialogTest.applyCalls)()`);
    assert.deepEqual(applyCalls[2], { reviewId: 'mcp:playwright:project#1' }, 'the first apply used the stale reviewId');
    const afterChanged = await evaluate(window, `(() => ({
      dialogOpen: document.querySelector('#resolve-duplicate-dialog')?.open,
      keep: document.querySelector('#resolve-duplicate-dialog-keep').textContent,
      changesHidden: document.querySelector('#resolve-duplicate-dialog-changes').hidden,
      applyHidden: document.querySelector('#apply-resolve-duplicate-button').hidden,
      applyDisabled: document.querySelector('#apply-resolve-duplicate-button').disabled,
    }))()`);
    assert.deepEqual(afterChanged, { dialogOpen: true, keep: 'CCTI keeps: Just you, everywhere', changesHidden: false, applyHidden: false, applyDisabled: false }, 'the dialog stays open and shows the fresh review after a changed apply');

    await evaluate(window, "document.querySelector('#apply-resolve-duplicate-button').click()");
    await waitFor(window, () => !document.querySelector('#resolve-duplicate-dialog')?.open, 'dialog closes once the fresh review is applied');
    applyCalls = await evaluate(window, `(() => window.__resolveDialogTest.applyCalls)()`);
    assert.deepEqual(applyCalls[3], { reviewId: 'mcp:playwright:project#2' }, 'the second confirm applies with the NEW reviewId, not the stale one');
    await waitFor(window, () => document.querySelectorAll('#tool-inventory-list button').length === 0, 'every duplicate is resolved and the Manage list has no Resolve buttons left');

    const evidence = {
      ok: true,
      reviewCalls: await evaluate(window, `(() => window.__resolveDialogTest.reviewCalls)()`),
      applyCalls: await evaluate(window, `(() => window.__resolveDialogTest.applyCalls)()`),
      discoverCalls: await evaluate(window, `(() => window.__resolveDialogTest.discoverCalls)()`),
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
