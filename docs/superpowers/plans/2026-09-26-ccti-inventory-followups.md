# CCTI Inventory Follow-ups Implementation Plan (plan 2b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the follow-ups deferred by plan 2's reviews:
- Harden the scanner and the install record against real-world noise.
- Label add-on-provided connections honestly.
- Fold the long "Found on this computer" tail out of the way.
- Close the known test gaps.

**Architecture:** Small, targeted edits to the existing `desktop/src/inventory/` modules, their `main.js` glue, and the renderer list. No new modules, no new IPC channels, no new user actions.

**Tech Stack:** Plain Node/CommonJS plus browser-global modules, an Electron renderer, and plain `node:assert` test scripts under `scripts/`, run by `cd desktop && npm run check` on macOS, `ubuntu-24.04`, and `windows-2022`.

**Spec:** `docs/ccti-tool-management-design-2026-09-23.md`. Previous plan: `docs/superpowers/plans/2026-09-26-ccti-tool-inventory.md` (shipped in v2026.09.26.01; its Global Constraints still bind).

## Global Constraints

- Everything in plan 2's Global Constraints still applies. In particular:
  - "The scan always wins."
  - "A corrupt or missing ledger degrades, never blocks."
  - "No terminal surface in management."
  - "Errors state a next action."
  - The record is advisory and never fails an install or a backup.
- The record must never be moved aside because of a **temporary** read problem. Only content that can't be parsed, or a directory in the file's place, counts as unreadable.
- Tests stay cross-platform and CRLF-safe (`\r?\n` in any regex over repo text).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A temporary file lock on `inventory.json`** (EBUSY / EPERM / EACCES on Windows). Expect the Manage list to show everything as found on this computer with a "check again" notice, the file left exactly where it is, and no write attempted (Task 2).
2. **Noise in `claude plugin list` / `claude mcp list` output**, such as a lone word on its own line or an error sentence. Expect no junk rows (Task 1).
3. **A connection supplied by an add-on** (`plugin:<add-on>:<server>`). Expect it labelled as part of that add-on, never "Found on this computer" (Tasks 1 and 3).
4. **A busy machine with 150+ items.** Expect the rows that need attention or were installed by CCTI to stay visible, and the rest folded behind one control per section (Tasks 3 and 4).
5. **A Reinstall request that throws in the renderer.** Expect the status to say what to do next and the UI to unlock (Task 4).

---

### Task 1: Scanner hardening and add-on provenance

**Files:**
- Modify: `desktop/src/inventory/scanner.js`
- Modify: `desktop/src/main.js`: the two `findings.push` lines for `plugin-cli:` / `connection-cli:` in `discoverClaudeSetup`
- Test: `scripts/test-inventory-scanner.js`

**Interfaces:**
- Produces: MCP scan items whose name matches `plugin:<addOn>:<server>` get `origin: 'plugin'`, `addOn: '<addOn>'`, and `scope: 'Part of the <addOn> add-on'`. All other items keep their current fields; `addOn` is `''` for them.

- [ ] **Step 1: Write the failing tests.** Append these to `scripts/test-inventory-scanner.js`, before the final `console.log`:

```js
// Review Focus 2: lone words and error sentences are not entries.
assert.deepEqual(parsePluginList(['Installed plugins:', '', '  ❯ claude-hud@claude-hud', '    Scope: user', 'Marketplace', 'Error loading marketplace cache'].join('\n')).map((item) => item.key), ['claude-hud@claude-hud'], 'only bulleted entries or legacy name@marketplace lines are plugins');
assert.deepEqual(parseMcpList(['Checking MCP server health…', 'playwright: npx @playwright/mcp@latest - ✔ Connected', 'Error', 'warning'].join('\n')).map((item) => item.key), ['playwright'], 'a lone word inside real health output is not a connection');
assert.deepEqual(parseMcpList('shared-connection\nother-one').map((item) => item.key), ['shared-connection', 'other-one'], 'bare names still parse when the whole output is the legacy bare format');

// Review Focus 3: add-on-provided connections carry their add-on.
const fromAddOn = parseMcpList('plugin:brand-voice:box: https://example.test/mcp - ✔ Connected\nplugin:data:google calendar: npx x - ✔ Connected');
assert.deepEqual(fromAddOn.map((item) => [item.name, item.origin, item.addOn, item.scope]), [
  ['plugin:brand-voice:box', 'plugin', 'brand-voice', 'Part of the brand-voice add-on'],
  ['plugin:data:google calendar', 'plugin', 'data', 'Part of the data add-on'],
]);
assert.equal(parseMcpList('playwright: npx x - ✔ Connected')[0].addOn, '', 'ordinary connections have no add-on');
```

- [ ] **Step 2: Run the test and confirm it fails.** Run: `node scripts/test-inventory-scanner.js`. Expected: FAIL on the first new assertion.

- [ ] **Step 3: Implement the scanner changes.** In `scanner.js`:

  1. Above `parsePluginList`, add:

```js
// `claude plugin list` prints a section header ("Installed plugins:"), then one
// "❯ name@marketplace" entry per plugin followed by indented "Key: value" detail
// lines. Older builds printed bare "name@marketplace status" lines.
```

  2. In `parsePluginList`, replace the `const id = …` line and the `if (!PLUGIN_ID…)` block with:

```js
    const bulleted = /^[❯•*+-]\s+/.test(line);
    const id = line.replace(/^[❯•*+-]\s+/, '').split(/\s+/)[0];
    if (!PLUGIN_ID.test(id) || /^no$/i.test(id) || (!bulleted && !id.includes('@'))) {
      current = null;
      continue;
    }
```

  3. Above `parseMcpList`, add:

```js
// `claude mcp list` prints a health banner, then "name: target - status" per
// server. Names may contain spaces ("claude.ai Slack") or colons
// ("plugin:add-on:server"), so the name ends at the first ": " followed by the
// target. Older builds printed bare names only; those are accepted only when the
// whole output is in that bare format.
const ADD_ON_CONNECTION = /^plugin:([^:]+):/;
```

  4. Replace the body of `parseMcpList` with:

```js
function parseMcpList(text) {
  const connections = new Map();
  const lines = textLines(text).filter((line) => !/^checking mcp server health/i.test(line) && !/^no mcp servers/i.test(line));
  const listedFormat = lines.some((line) => /^(.+?):\s+\S.*?\s+-\s+\S/.test(line));
  for (const line of lines) {
    const listed = line.match(/^(.+?):\s+\S.*?\s+-\s+\S/);
    const name = listed ? listed[1].trim() : !listedFormat && /^[\w.@-]+$/.test(line) ? line : '';
    if (!name) continue;
    const key = name.toLowerCase();
    if (connections.has(key)) continue;
    const addOn = name.match(ADD_ON_CONNECTION)?.[1] || '';
    const fromClaudeAi = key.startsWith('claude.ai ');
    connections.set(key, {
      kind: 'mcp',
      key,
      name,
      scope: fromClaudeAi ? CLAUDE_AI_SCOPE : addOn ? `Part of the ${addOn} add-on` : 'Claude Code',
      origin: fromClaudeAi ? 'claude.ai' : addOn ? 'plugin' : 'local',
      addOn,
      path: '',
      contentHash: '',
    });
  }
  return [...connections.values()];
}
```

The listed-format regex is lazy. `plugin:brand-voice:box: https://…` splits at `plugin:brand-voice:box` because `: ` (colon then space) first appears after `box`.

  5. Add `addOn: ''` to the objects built in `parsePluginList` and `skillsFromFindings`, so every scan item has the field.

- [ ] **Step 4: Use the parsers for the older "Full checkup inventory" list.** In `discoverClaudeSetup`, replace the two lines that push `plugin-cli:` and `connection-cli:` findings with:

```js
    if (plugins.code === 0) parsePluginList(plugins.stdout).forEach((item) => findings.push({ id: `plugin-cli:${item.key}`, type: 'plugin', name: item.name, scope: 'Claude Code', path: 'Claude Code', description: 'Reported by Claude Code.' }));
    if (connections.code === 0) parseMcpList(connections.stdout).forEach((item) => findings.push({ id: `connection-cli:${item.key}`, type: 'connection', name: item.name, scope: 'Claude Code', path: 'Claude Code', description: 'Reported by Claude Code.' }));
```

Add `parsePluginList, parseMcpList` to the existing `require('./inventory/scanner')` destructure.

- [ ] **Step 5: Run the tests and confirm they pass.** Run: `node scripts/test-inventory-scanner.js && node scripts/test-setup-manager.js && node scripts/test-inventory-main.js`. Expected: PASS. `test-setup-manager.js` still sees exactly one `shared-connection` and the `frontend-design` add-on.

- [ ] **Step 6: Commit.** Message: `fix(inventory): ignore stray CLI lines, label add-on connections, reuse parsers in the checkup`.

---

### Task 2: Record read errors and entry validation

**Files:**
- Modify: `desktop/src/inventory/ledger.js`
- Modify: `desktop/src/inventory/reconcile.js` (only if needed to pass `unavailable` through; see Step 3)
- Test: `scripts/test-inventory-ledger.js`, `scripts/test-inventory-reconcile.js`

**Interfaces:**
- `read()` now returns `status: 'ok' | 'missing' | 'corrupt' | 'unavailable'`:
  - `'missing'` for ENOENT.
  - `'corrupt'` for EISDIR and for content that can't be parsed.
  - `'unavailable'` for any other read error.
- Every write method (`recordInstalls`, `recordResolutions`, `reset`) rejects with an `Error` whose `code` is `'LEDGER_UNAVAILABLE'` when the current status is `'unavailable'`. It never renames or writes in that case.
- `reconcileInventory` passes `historyStatus: 'unavailable'` through and treats it like `'corrupt'` for provenance: no entries and no resolutions.

- [ ] **Step 1: Write the failing tests.** Append to `scripts/test-inventory-ledger.js`, inside the `try` block and before `} finally {`:

```js
    // Review Focus 1: a temporary read error never moves the record aside or writes.
    const lockedFile = path.join(dir, 'locked', 'inventory.json');
    const realReadFile = fs.readFile;
    const lockedStore = createLedgerStore(lockedFile, { now: () => now });
    await fs.mkdir(path.dirname(lockedFile), { recursive: true });
    await fs.writeFile(lockedFile, JSON.stringify({ schemaVersion: 1, entries: [], resolutions: [] }), 'utf8');
    fs.readFile = async (target, ...rest) => {
      if (target === lockedFile) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      return realReadFile(target, ...rest);
    };
    try {
      assert.equal((await lockedStore.read()).status, 'unavailable');
      await assert.rejects(lockedStore.recordInstalls([plugin]), (error) => error.code === 'LEDGER_UNAVAILABLE');
      await assert.rejects(lockedStore.reset(), (error) => error.code === 'LEDGER_UNAVAILABLE');
    } finally {
      fs.readFile = realReadFile;
    }
    assert.deepEqual((await fs.readdir(path.dirname(lockedFile))).sort(), ['inventory.json'], 'nothing was moved aside or left behind');
    assert.equal((await lockedStore.read()).status, 'ok');

    // reset() on a record that doesn't exist yet changes nothing.
    const freshStore = createLedgerStore(path.join(dir, 'fresh', 'inventory.json'), { now: () => now });
    assert.deepEqual(await freshStore.reset(), { ok: true, preservedAs: '', unchanged: true });

    // A failed write leaves no temporary file behind.
    const tmpDir = path.join(dir, 'tmp-check');
    await fs.mkdir(path.join(tmpDir, 'inventory.json'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'inventory.json', 'keep.txt'), 'x', 'utf8');
    const realRename = fs.rename;
    let failNextRename = true;
    fs.rename = async (from, to) => {
      if (failNextRename && String(from).endsWith('.tmp')) { failNextRename = false; throw Object.assign(new Error('denied'), { code: 'EPERM' }); }
      return realRename(from, to);
    };
    try {
      await assert.rejects(createLedgerStore(path.join(tmpDir, 'inventory.json'), { now: () => now }).recordInstalls([plugin]));
    } finally {
      fs.rename = realRename;
    }
    assert.ok(!(await fs.readdir(tmpDir)).some((name) => name.endsWith('.tmp')), 'a failed write removes its temporary file');
```

`fs` here is the same `node:fs/promises` module object that `ledger.js` requires, so patching its properties is visible to the store. Confirm that `ledger.js` calls `fs.readFile(...)` / `fs.rename(...)` through the module object, not destructured references. If it destructures, change it to call through the object.

Also add these entry-validation assertions near the existing `parseLedger` checks:

```js
  const kinds = parseLedger(JSON.stringify({ schemaVersion: 1, entries: [{ id: 'a', kind: 'skill', key: 'a', installedAt: now.toISOString() }, { id: 'b', kind: 'widget', key: 'b', installedAt: now.toISOString() }], resolutions: [{ kind: 'gadget', key: 'x', resolvedAt: now.toISOString() }] }));
  assert.deepEqual(kinds.ledger.entries.map((entry) => entry.id), ['a'], 'entries of an unknown kind are dropped');
  assert.equal(kinds.ledger.resolutions.length, 0, 'resolutions of an unknown kind are dropped');
```

Append to `scripts/test-inventory-reconcile.js`, before the final `console.log`:

```js
const unavailable = reconcileInventory({ scan: scan(items), ledger, ledgerStatus: 'unavailable', catalog, tracked });
assert.equal(unavailable.historyStatus, 'unavailable');
assert.ok(unavailable.rows.every((row) => !row.installedByCcti && row.state !== 'missing'), 'an unavailable record claims nothing and reports nothing missing');
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run: `node scripts/test-inventory-ledger.js; node scripts/test-inventory-reconcile.js`. Expected: FAIL.

- [ ] **Step 3: Implement.** In `ledger.js`:

  1. Add a known-kind check to both validators:

```js
const KNOWN_KINDS = new Set(['skill', 'plugin', 'mcp']);
const validEntry = (entry) => Boolean(entry) && isText(entry.id) && KNOWN_KINDS.has(entry.kind) && isText(entry.key) && isText(entry.installedAt);
const validResolution = (item) => Boolean(item) && KNOWN_KINDS.has(item.kind) && isText(item.key) && isText(item.resolvedAt);
```

  2. In `read()`, change the catch to:

```js
      if (error.code === 'ENOENT') return { status: 'missing', ledger: emptyLedger() };
      if (error.code === 'EISDIR') return { status: 'corrupt', ledger: emptyLedger() };
      return { status: 'unavailable', ledger: emptyLedger() };
```

  3. In `update()`, immediately after `const current = await read();`:

```js
      if (current.status === 'unavailable') {
        throw Object.assign(new Error('CCTI could not open its record right now.'), { code: 'LEDGER_UNAVAILABLE' });
      }
```

  4. In `write()`, wrap the write and rename so a failure removes the temporary file and still rejects:

```js
    try {
      await fs.writeFile(temporary, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
      await fs.rename(temporary, filePath);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
```

  In `reconcile.js`, change the provenance guard to:

```js
  const record = ledgerStatus === 'corrupt' || ledgerStatus === 'unavailable' ? {} : ledger || {};
```

- [ ] **Step 4: Handle the new rejection in `main.js`.**
  - `recordCctiInstalls` and `recordSkillResolutions` already catch; no change needed.
  - `resetInventoryHistory` returns its generic error. Add a branch before it:

```js
  } catch (error) {
    if (error.code === 'LEDGER_UNAVAILABLE') return { ok: false, error: 'CCTI could not open its record right now. Nothing was changed. Close anything that might be using it, then try again.' };
    return { ok: false, error: 'CCTI could not start a fresh record. Nothing else changed. Restart CCTI and try again.' };
  }
```

  (Replace the existing bare `catch {` block in `resetInventoryHistory` with this.)

- [ ] **Step 5: Run the tests and confirm they pass.** Run: `cd desktop && npm run inventory:check`. Expected: PASS.

- [ ] **Step 6: Commit.** Message: `fix(inventory): never shelve the record on a temporary read error; drop unknown kinds; clean up failed writes`.

---

### Task 3: View model: unavailable notice, add-on badge, folded rows

**Files:**
- Modify: `desktop/src/inventory/manage-view.js`
- Test: `scripts/test-inventory-manage-view.js`

**Interfaces:**
- `manageSections(inventory)` still returns `{ summary, notice, sections }`. Each section becomes `{ kind, title, rows, foldedRows, foldedLabel }`:
  - `rows`: everything that is not `external`. That is, installed by CCTI, missing, duplicate, or unchecked.
  - `foldedRows`: the `external` rows.
  - `foldedLabel`: `'Show N more you already had'`, or `''` when `foldedRows` is empty.
- A section is kept when either list is non-empty.
- `notice` for `historyStatus === 'unavailable'` is `{ text, action: null }`. The corrupt notice is unchanged.
- External rows with `origin === 'plugin'` use the badge `'Part of an add-on'` and the detail `'Comes with the <addOn> add-on. Manage it through that add-on.'`. Reconcile must copy `addOn` from the scan item onto the row; add `addOn: first.addOn || ''` to the scan-group row object in `reconcile.js` and `addOn: ''` to record-only rows.

- [ ] **Step 1: Write the failing tests.** In `scripts/test-inventory-manage-view.js`, update the fixture and add assertions:
  - Rows with state `external` now live in `foldedRows`. Change the test's `find` helper to search both lists:

```js
const allRows = (v) => v.sections.flatMap((section) => [...section.rows, ...section.foldedRows]);
const find = (id) => allRows(view).find((item) => item.rowId === id);
```

  - Update the "no terminal surface" loop to iterate `allRows(view)`.
  - Add, before the final `console.log`:

```js
const plugins = view.sections.find((section) => section.kind === 'plugin');
assert.deepEqual(plugins.rows, [], 'external add-ons are folded');
assert.equal(plugins.foldedRows.length, 2);
assert.equal(plugins.foldedLabel, 'Show 2 more you already had');
const skills = view.sections.find((section) => section.kind === 'skill');
assert.ok(skills.rows.some((item) => item.rowId === 'ponytail'), 'missing rows stay visible');
assert.equal(skills.foldedLabel, '', 'nothing folded when there are no external rows');

const addOnView = manageSections({ historyStatus: 'ok', rows: [row('plugin:brand-voice:box', 'mcp', 'external', { origin: 'plugin', addOn: 'brand-voice' })] });
const addOnRow = addOnView.sections[0].foldedRows[0];
assert.equal(addOnRow.badge, 'Part of an add-on');
assert.equal(addOnRow.detail, 'Comes with the brand-voice add-on. Manage it through that add-on.');

const unavailableView = manageSections({ historyStatus: 'unavailable', rows: [] });
assert.equal(unavailableView.notice.action, null, 'no reset is offered for a temporary problem');
assert.match(unavailableView.notice.text, /check again/i);
```

- [ ] **Step 2: Run the test and confirm it fails.** Run: `node scripts/test-inventory-manage-view.js`. Expected: FAIL.

- [ ] **Step 3: Implement.** In `manage-view.js`:

  1. Replace the final `external` branch of `rowView` with:

```js
  if (row.origin === 'plugin') {
    return { badge: 'Part of an add-on', tone: 'neutral', detail: `Comes with the ${row.addOn || 'an'} add-on. Manage it through that add-on.`, action: null };
  }
  const fromAccount = row.origin === 'claude.ai';
  return {
    badge: fromAccount ? 'From your Claude.ai account' : 'Found on this computer',
    tone: 'neutral',
    detail: fromAccount ? 'Managed in your Claude.ai account. CCTI will not change it.' : 'CCTI did not install this, so it will not change it.',
    action: null,
  };
```

  2. Replace the `sections` construction in `manageSections` with:

```js
  const view = (row) => ({ rowId: row.rowId, name: row.name, ...rowView(row) });
  const sections = MANAGE_SECTIONS
    .map(([kind, title]) => {
      const ofKind = rows.filter((row) => row.kind === kind);
      const foldedRows = ofKind.filter((row) => row.state === 'external').map(view);
      return {
        kind,
        title,
        rows: ofKind.filter((row) => row.state !== 'external').map(view),
        foldedRows,
        foldedLabel: foldedRows.length ? `Show ${foldedRows.length} more you already had` : '',
      };
    })
    .filter((section) => section.rows.length > 0 || section.foldedRows.length > 0);
```

  3. Replace the `notice` expression with:

```js
  const notice = inventory?.historyStatus === 'corrupt'
    ? {
      text: 'CCTI couldn’t read its record of what it installed. Everything still works; items are shown as found on this computer. Starting a fresh record keeps a copy of the old one.',
      action: { type: 'reset-history', label: 'Start a fresh record' },
    }
    : inventory?.historyStatus === 'unavailable'
      ? { text: 'CCTI couldn’t open its record of what it installed right now. Everything still works; items are shown as found on this computer. Check again in a moment.', action: null }
      : null;
```

  In `reconcile.js`, add the `addOn` fields described in Interfaces.

- [ ] **Step 4: Run the tests and confirm they pass.** Run: `cd desktop && npm run inventory:check`. Expected: PASS.

- [ ] **Step 5: Commit.** Message: `feat(inventory): fold rows you already had, label add-on connections, explain a temporarily unavailable record`.

---

### Task 4: Renderer: folded rows, safer actions

**Files:**
- Modify: `desktop/src/renderer/app.js` (`renderToolInventory`, `runInventoryAction`, `resetToolInventoryRecord`)
- Modify: `desktop/src/renderer/styles.css`
- Modify: `scripts/validate-desktop-ui.js`

**Interfaces:**
- Consumes the Task 3 section shape: `rows`, `foldedRows`, and `foldedLabel`.

- [ ] **Step 1: Write the failing contract check.** Append these to the `inventoryContract` list in `scripts/validate-desktop-ui.js`:

```js
  [/section\.foldedRows/.test(renderer) && /document\.createElement\('details'\)/.test(renderer), 'rows you already had must render folded inside a details element'],
  [/async function runInventoryAction[\s\S]*?catch \(error\)[\s\S]*?Open the activity details/.test(renderer), 'a failed Reinstall call must tell the user what to do next'],
  [/async function resetToolInventoryRecord\(\) \{\s*if \(state\.running\) return;/.test(renderer), 'reset must not run while an install is running'],
```

Run: `node scripts/validate-desktop-ui.js`. Expected: FAIL.

- [ ] **Step 2: Implement.** In `app.js`:

  1. In `renderToolInventory`, extract the row-building arrow function into a named inner function, `const buildRow = (row) => { … return item; };`. Its body is unchanged: the current `li` construction with the name, badge, detail, and optional button. Then build each group as:

```js
    list.append(...section.rows.map(buildRow));
    group.append(heading, list);
    if (section.foldedRows.length) {
      const folded = document.createElement('details');
      folded.className = 'tool-inventory-folded';
      const summary = document.createElement('summary');
      summary.textContent = section.foldedLabel;
      const foldedList = document.createElement('ul');
      foldedList.className = 'tool-inventory-rows';
      foldedList.append(...section.foldedRows.map(buildRow));
      folded.append(summary, foldedList);
      group.append(folded);
    }
    return group;
```

  2. In `runInventoryAction`, add a `catch` between the existing `try` and `finally`:

```js
  } catch (error) {
    toolInventoryStatusElement.textContent = `${tool.name} could not be reinstalled. Open the activity details to see what happened, then select Reinstall again.`;
    appendOutput(`[Manage] ${error?.message || 'The reinstall request failed.'}\n`, 'stderr');
  } finally {
```

  3. Make the first line of `resetToolInventoryRecord` `if (state.running) return;`.

In `styles.css`, after `.tool-inventory-note`:

```css
.tool-inventory-folded { margin-top: 8px; }
.tool-inventory-folded > summary { cursor: pointer; color: #9fd8d0; font-size: .82rem; padding: 6px 2px; }
.tool-inventory-folded > .tool-inventory-rows { margin-top: 8px; }
```

- [ ] **Step 3: Run the checks and confirm they pass.** Run: `node scripts/validate-desktop-ui.js && cd desktop && npm run check`. Expected: PASS, full check exit 0.

- [ ] **Step 4: Commit.** Message: `feat(inventory): fold rows you already had in the Manage list; safer Reinstall and reset`.

---

### Task 5: Close the test gaps

**Files:**
- Modify: `scripts/test-inventory-tracked-items.js`
- Modify: `scripts/test-inventory-main.js`

- [ ] **Step 1: Add the reverse adapter guard.** Append to `scripts/test-inventory-tracked-items.js`, before the final `console.log`:

```js
// No silent gaps: every adapter branch that installs a skill or registers an MCP server is tracked.
for (const [file, source] of shellAdapters) {
  for (const match of source.matchAll(/\r?\n\s*([a-z0-9-]+)\)([\s\S]*?)\r?\n\s*;;/g)) {
    const [, id, body] = match;
    if (/\binstall_skill\b|\binstall_mcp(?:_after_dashdash)?\b/.test(body)) {
      assert.ok(trackedItem(id), `${file} installs a skill or connection for "${id}", so TRACKED_ITEMS must include it`);
    }
  }
}
for (const match of powershell.matchAll(/\r?\n\s*"([a-z0-9-]+)"\s*\{([\s\S]*?)\r?\n {4}\}/g)) {
  const [, id, body] = match;
  if (/\bInstall-Skill\b|\bInstall-Mcp(?:AfterDashDash)?\b/.test(body)) {
    assert.ok(trackedItem(id), `setup-my-claude.ps1 installs a skill or connection for "${id}", so TRACKED_ITEMS must include it`);
  }
}
```

If a helper function definition (such as `install_skill() {`) is itself caught by the branch regex, tighten the regex. Don't loosen the assertion, and report the adjustment.

- [ ] **Step 2: Add the single-skill backup case.** In `scripts/test-inventory-main.js`, after the duplicate-backup block:
  1. Write a new skill `solo` under `home/.claude/skills`.
  2. Run `discover`.
  3. Call `setup-manager:review-cleanup` with that finding's id.
  4. Call `setup-manager:apply-cleanup`.
  5. Assert the ledger's `resolutions` contain `{ kind: 'skill', key: 'solo', action: 'backup' }`.

  Find the finding with `report.findings.find((item) => item.type === 'skill' && item.name === 'solo')`.

- [ ] **Step 3: Run the tests and confirm they pass.** Run: `node scripts/test-inventory-tracked-items.js && node scripts/test-inventory-main.js`. Expected: PASS.

- [ ] **Step 4: Commit.** Message: `test(inventory): guard every adapter install branch and the single-skill backup path`.

---

## Out of scope

- Plugin and MCP duplicates, the resolver interface, and precedence rules: plan 3.
- Rewriting the managed-extras manifest after a partial removal. That behaviour predates plan 2, and the record already reflects completed removals.
