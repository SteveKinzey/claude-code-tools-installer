#!/usr/bin/env node
// Real-Electron renderer test for "Delete turned-off copies": the cleanup card shows the
// count from the latest checkup, the dialog opens with every copy checked, Escape closes it
// without a review, "Review deletion" shows the exact list and the cannot-be-undone warning,
// "Delete permanently" stays disabled until exactly DELETE is typed, a failed apply is shown
// in the dialog, and a successful apply closes it, re-runs the checkup, and says what
// happened. Modeled on scripts/test-resolve-dialog-electron.js.
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
const fixturePath = path.join(os.tmpdir(), `ccti-permanent-delete-dialog-${process.pid}.html`);
const evidencePath = process.env.CCTI_PERMANENT_DELETE_DIALOG_REPORT_PATH ? path.resolve(process.env.CCTI_PERMANENT_DELETE_DIALOG_REPORT_PATH) : '';

const turnedOff = {
  addOns: [{ findingId: 'add-on-off:user:foo@market-a', name: 'foo', marketplace: 'market-a', scopeLabel: 'Just you' }],
  skillBackups: [{ findingId: 'backup:/fixture-home/.setup-my-claude/disabled-skills/old-helper-1760000000001-abcdef01', name: 'old-helper', scopeLabel: 'Just you' }],
};

function injectedBridge() {
  return `
<script>
  (() => {
    const turnedOff = ${JSON.stringify(turnedOff)};
    let deleted = false;
    let discoverCalls = 0;
    let reviewCount = 0;
    let applyCount = 0;
    const reviewCalls = [];
    const applyCalls = [];
    window.__permanentDeleteTest = { reviewCalls, applyCalls, get discoverCalls() { return discoverCalls; } };
    window.confirm = () => true;
    window.installer = {
      getCatalog: async () => [],
      getCatalogDetails: async () => ({ items: [] }),
      getComponentCatalog: async () => ({ components: [], count: 0 }),
      getCompassStatus: async () => ({ available: false }),
      getUpdateStatus: async () => ({ status: 'idle', message: 'No update check has run yet.' }),
      getTerminalPreference: async () => ({ ok: true, selectedId: 'default', options: [{ id: 'default', label: 'Default Terminal', available: true }], message: 'Claude Code will open in Default Terminal.' }),
      setTerminalPreference: async () => ({ ok: true, selectedId: 'default', options: [{ id: 'default', label: 'Default Terminal', available: true }], message: 'CCTI will open Claude Code in Default Terminal.' }),
      getClaudeStatus: async () => ({ installed: true, version: 'test', path: '/fixture-home/.local/bin/claude' }),
      verifySetup: async () => ({ ok: true, ready: true, summary: 'CCTI verified the fixture setup.', checks: [] }),
      resetInventoryHistory: async () => ({ ok: true, preserved: false }),
      discoverSetup: async () => {
        discoverCalls += 1;
        return {
          discoveryId: 'permanent-delete-fixture-' + discoverCalls,
          checkedAt: '2026-09-26T00:00:00.000Z',
          projectPath: '',
          findings: [],
          duplicates: [],
          inventory: { rows: [], historyStatus: 'ok' },
          turnedOff: deleted ? { addOns: [], skillBackups: [] } : turnedOff,
        };
      },
      reviewPermanentDelete: async (payload) => {
        reviewCalls.push(JSON.parse(JSON.stringify(payload)));
        reviewCount += 1;
        const labels = { 'add-on': 'Add-on foo from market-a (Just you)', 'skill-backup': 'Skill backup old-helper (Just you)' };
        return {
          ok: true,
          reviewId: 'delete-review-' + reviewCount,
          items: payload.items.map((item) => ({ label: labels[item.kind] })),
          warning: 'Deleting these copies cannot be undone.',
        };
      },
      applyPermanentDelete: async (payload) => {
        applyCalls.push({ ...payload });
        applyCount += 1;
        if (payload.confirmation !== 'DELETE') return { ok: false, error: 'Type DELETE in capital letters to confirm. Nothing was deleted.' };
        if (applyCount === 1) return { ok: false, error: 'CCTI couldn’t read your Claude Code add-ons right now, so foo was not deleted. Try again in a moment. Nothing else was deleted.', completed: [] };
        deleted = true;
        return { ok: true, message: 'Permanently deleted 2 turned-off copies.', completed: [] };
      },
      reviewResolution: async () => ({ ok: false, error: 'Not used in this test.' }),
      applyResolution: async () => ({ ok: false, error: 'Not used in this test.' }),
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

function typeConfirmation(value) {
  return `(() => {
    const input = document.querySelector('#permanent-delete-confirmation');
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return document.querySelector('#apply-permanent-delete-button').disabled;
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
    await waitFor(window, () => !document.querySelector('#cleanup-actions')?.classList.contains('is-hidden'), 'cleanup actions rendered');

    // The card shows the count from the latest checkup.
    const card = await evaluate(window, `(() => ({
      status: document.querySelector('#cleanup-turned-off-status').textContent,
      buttonText: document.querySelector('#cleanup-review-turned-off-button').textContent,
      buttonHidden: document.querySelector('#cleanup-review-turned-off-button').hidden,
      buttonDisabled: document.querySelector('#cleanup-review-turned-off-button').disabled,
    }))()`);
    assert.deepEqual(card, {
      status: '1 turned-off add-on and 1 skill backup can be deleted for good. You review the list and type DELETE first; this can’t be undone.',
      buttonText: 'Review 2 turned-off copies',
      buttonHidden: false,
      buttonDisabled: false,
    });

    // Open, check focus and the default selection, then Escape closes with no review.
    await evaluate(window, "document.querySelector('#cleanup-review-turned-off-button').focus(); document.querySelector('#cleanup-review-turned-off-button').click()");
    await waitFor(window, () => document.querySelector('#permanent-delete-dialog')?.open, 'the delete dialog opens');
    assert.equal(await evaluate(window, '(() => document.activeElement?.id)()'), 'permanent-delete-dialog-heading', 'the dialog heading gets focus when opened');
    const options = await evaluate(window, `(() => [...document.querySelectorAll('#permanent-delete-dialog-options label')].map((label) => ({ text: label.querySelector('span').textContent, checked: label.querySelector('input').checked })))()`);
    assert.deepEqual(options, [
      { text: 'Add-on foo from market-a · Just you', checked: true },
      { text: 'Skill backup old-helper · Just you', checked: true },
    ], 'every turned-off copy is listed and checked by default');
    assert.equal(await evaluate(window, "document.querySelector('#apply-permanent-delete-button').hidden"), true, 'Delete permanently is hidden before a review');
    await pressEscape(window);
    await waitFor(window, () => !document.querySelector('#permanent-delete-dialog')?.open, 'Escape closes the dialog');
    await waitFor(window, () => document.activeElement?.id === 'cleanup-review-turned-off-button', 'focus returns to the card button');
    assert.equal(await evaluate(window, 'window.__permanentDeleteTest.reviewCalls.length'), 0, 'Escape does not review');

    // Reopen, unchecking everything disables Review deletion.
    await evaluate(window, "document.querySelector('#cleanup-review-turned-off-button').click()");
    await waitFor(window, () => document.querySelector('#permanent-delete-dialog')?.open, 'the delete dialog reopens');
    const noneChecked = await evaluate(window, `(() => {
      for (const box of document.querySelectorAll('#permanent-delete-dialog-options input')) { box.checked = false; box.dispatchEvent(new Event('change', { bubbles: true })); }
      const disabled = document.querySelector('#review-permanent-delete-button').disabled;
      for (const box of document.querySelectorAll('#permanent-delete-dialog-options input')) { box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); }
      return disabled;
    })()`);
    assert.equal(noneChecked, true, 'Review deletion is disabled with nothing chosen');

    // Review shows the exact list, the warning, and the typed-confirmation field.
    await evaluate(window, "document.querySelector('#review-permanent-delete-button').click()");
    await waitFor(window, () => !document.querySelector('#permanent-delete-dialog-review')?.hidden, 'the review renders');
    assert.deepEqual(await evaluate(window, 'window.__permanentDeleteTest.reviewCalls'), [{
      discoveryId: 'permanent-delete-fixture-1',
      items: [{ kind: 'add-on', findingId: turnedOff.addOns[0].findingId }, { kind: 'skill-backup', findingId: turnedOff.skillBackups[0].findingId }],
    }]);
    const reviewState = await evaluate(window, `(() => ({
      list: [...document.querySelectorAll('#permanent-delete-dialog-review-list li')].map((li) => li.textContent),
      warning: document.querySelector('#permanent-delete-dialog-warning').textContent,
      label: document.querySelector('label[for="permanent-delete-confirmation"]').textContent.trim(),
      applyHidden: document.querySelector('#apply-permanent-delete-button').hidden,
      applyDisabled: document.querySelector('#apply-permanent-delete-button').disabled,
    }))()`);
    assert.deepEqual(reviewState, {
      list: ['Add-on foo from market-a (Just you)', 'Skill backup old-helper (Just you)'],
      warning: 'Deleting these copies cannot be undone.',
      label: 'Type DELETE to confirm',
      applyHidden: false,
      applyDisabled: true,
    });

    // The button stays disabled until exactly DELETE is typed.
    for (const almost of ['delete', 'Delete', 'DELETE ', ' DELETE', 'DELET', '']) {
      assert.equal(await evaluate(window, typeConfirmation(almost)), true, `"${almost}" keeps Delete permanently disabled`);
    }
    // Clicking while disabled-by-text calls nothing.
    await evaluate(window, "document.querySelector('#apply-permanent-delete-button').click()");
    assert.equal(await evaluate(window, 'window.__permanentDeleteTest.applyCalls.length'), 0);
    assert.equal(await evaluate(window, typeConfirmation('DELETE')), false, 'exactly DELETE enables Delete permanently');

    // Enter in the field never submits (and so never closes) the dialog.
    await evaluate(window, "document.querySelector('#permanent-delete-confirmation').focus()");
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(await evaluate(window, "document.querySelector('#permanent-delete-dialog').open"), true, 'Enter does not close the dialog');
    assert.equal(await evaluate(window, 'window.__permanentDeleteTest.applyCalls.length'), 0, 'Enter does not apply');

    // A failed apply shows its error in the dialog, and a new review is needed.
    await evaluate(window, "document.querySelector('#apply-permanent-delete-button').click()");
    await waitFor(window, () => /not deleted/.test(document.querySelector('#permanent-delete-dialog-status')?.textContent || ''), 'the failure shows in the dialog');
    assert.deepEqual(await evaluate(window, 'window.__permanentDeleteTest.applyCalls'), [{ reviewId: 'delete-review-1', confirmation: 'DELETE' }]);
    const afterFailure = await evaluate(window, `(() => ({
      open: document.querySelector('#permanent-delete-dialog').open,
      reviewHidden: document.querySelector('#review-permanent-delete-button').hidden,
      applyHidden: document.querySelector('#apply-permanent-delete-button').hidden,
      typed: document.querySelector('#permanent-delete-confirmation').value,
    }))()`);
    assert.deepEqual(afterFailure, { open: true, reviewHidden: false, applyHidden: true, typed: '' });

    // Review again, type DELETE, apply: the dialog closes, the checkup re-runs, and the
    // inventory status line says what happened.
    await evaluate(window, "document.querySelector('#review-permanent-delete-button').click()");
    await waitFor(window, () => !document.querySelector('#permanent-delete-dialog-review')?.hidden, 'the second review renders');
    assert.equal(await evaluate(window, typeConfirmation('DELETE')), false);
    await evaluate(window, "document.querySelector('#apply-permanent-delete-button').click()");
    await waitFor(window, () => !document.querySelector('#permanent-delete-dialog')?.open, 'the dialog closes after a successful delete');
    assert.deepEqual((await evaluate(window, 'window.__permanentDeleteTest.applyCalls'))[1], { reviewId: 'delete-review-2', confirmation: 'DELETE' });
    await waitFor(window, () => window.__permanentDeleteTest.discoverCalls >= 2, 'the checkup re-runs');
    await waitFor(window, () => document.querySelector('#tool-inventory-status')?.textContent === 'Permanently deleted 2 turned-off copies.', 'the result message is shown');
    assert.match(await evaluate(window, "document.querySelector('#output').textContent"), /\[Manage\] Permanently deleted 2 turned-off copies\./, 'the result reaches the activity log');
    const emptyCard = await evaluate(window, `(() => ({
      status: document.querySelector('#cleanup-turned-off-status').textContent,
      buttonHidden: document.querySelector('#cleanup-review-turned-off-button').hidden,
      buttonDisabled: document.querySelector('#cleanup-review-turned-off-button').disabled,
    }))()`);
    assert.deepEqual(emptyCard, { status: 'No turned-off add-ons or skill backups were found, so there is nothing to delete.', buttonHidden: true, buttonDisabled: true });

    const evidence = {
      ok: true,
      reviewCalls: await evaluate(window, 'window.__permanentDeleteTest.reviewCalls'),
      applyCalls: await evaluate(window, 'window.__permanentDeleteTest.applyCalls'),
      discoverCalls: await evaluate(window, 'window.__permanentDeleteTest.discoverCalls'),
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

// Destroying the test window must not quit the app before a failure is reported.
app.on('window-all-closed', () => {});
app.whenReady().then(run).then(() => app.quit()).catch(async (error) => {
  console.error(error.stack || error.message || error);
  if (evidencePath) {
    await fs.mkdir(path.dirname(evidencePath), { recursive: true }).catch(() => {});
    await fs.writeFile(evidencePath, `${JSON.stringify({ ok: false, error: String(error.message || error) }, null, 2)}\n`, 'utf8').catch(() => {});
  }
  await fs.rm(fixturePath, { force: true }).catch(() => {});
  process.exit(1);
});
