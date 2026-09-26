# CCTI Tool Inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give CCTI a memory of what it installed and a Manage list that shows every skill, add-on, and connection on the machine. Each row has a plain state, "Reinstall" appears on things CCTI installed that have gone missing, and "Resolve" appears on verified duplicate skills.

**Architecture:** Five small modules under `desktop/src/inventory/`:
- `tracked-items.js`: which catalog ids leave an observable skill, plugin, or MCP connection.
- `scanner.js`: pure parsers that turn the checkup's existing findings plus Claude Code's `plugin list` / `mcp list` output into scan items.
- `ledger.js`: `userData/inventory.json`, advisory and corruption-tolerant.
- `reconcile.js`: pure merge of scan and ledger into rows.
- `manage-view.js`: pure rows → badges, detail, and actions, loaded by the renderer.

`main.js` gains thin glue:
- `discoverClaudeSetup` returns `inventory`.
- The install paths record newly present tracked items.
- The skill backup paths record resolutions.
- One new IPC channel resets an unreadable record.

The renderer draws the Manage list inside the existing Setup Manager.

**Tech Stack:** Plain Node/CommonJS plus browser-global modules (no bundler), an Electron renderer, and plain `node:assert` test scripts under `scripts/`, wired into `desktop/package.json` `check`. The Windows CI runner also runs `npm run check`.

**Spec:** `docs/ccti-tool-management-design-2026-09-23.md`, sections "Architecture", "Ledger format", "Reconciliation states", "Two invariants", "Reinstall behavior", and "Manage screen". This is plan 2 of 3. Plan 1 (job matching) shipped in v2026.09.25.01. Plan 3 covers plugin and MCP duplicate resolution, the shared resolver interface, and the silent TTL refresh.

## Global Constraints

- "The app never installs anything just because it is shown." "Every install still passes the Step 3 confirmation." Reinstall asks with a confirmation dialog and then runs the existing `install:run`.
- "The scan always wins. The ledger is a claim about the past, never an authority over the present."
- "A corrupt or missing ledger degrades, never blocks. An unreadable `inventory.json` renders every row as `external`, the app works normally, and CCTI offers to rebuild."
- "Resolved duplicates are not losses." "Reconcile treats a resolved duplicate as expected absence."
- "`external` | "outside CCTI" — visible, never auto-touched."
- "`Reinstall` on a `missing` item **re-resolves through the current catalog** rather than replaying the recorded install action." "If the catalog entry changed since the recorded install, say so in one line before acting." "If the id is no longer in the catalog at all, say that plainly."
- "One list grouped by kind, four state badges, one action per row." "Settings, runtimes, and project packages appear read-only." "It replaces no existing screen."
- "No terminal surface in management. A path, a JSON fragment, or a `claude mcp remove` command is never the thing the user acts on."
- "Errors state a next action. Every failure message says what to do next in plain words."
- A failure to write the install record never fails an install or a skill backup. The record is advisory.
- Tests are cross-platform and CRLF-safe: Windows CI checks files out with CRLF, so any regex over repo text uses `\r?\n`. Fake `claude` binaries are Node scripts, not shell-only.
- Follow repo test convention: plain Node scripts in `scripts/`, run by `npm run check` from `desktop/`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` when made by Claude.

## Deviations from spec

1. **`scanner.js` parses; it does not do I/O.** The spec says the scanner is "extracted from existing checkup logic". The disk and CLI reads in `discoverClaudeSetup` are interleaved with the skill-cleanup cache that every cleanup flow depends on, so moving them is a refactor with regression risk and no user benefit. The part that is actually wrong today is the parsing. Real `claude plugin list` output has `Version:`/`Scope:`/`Status:` detail lines, and real `claude mcp list` names contain spaces (`claude.ai Slack`). `scanner.js` owns that parsing as pure functions over what `discoverClaudeSetup` already collects.
2. **A fifth state, `unchecked`.** "The scan always wins" only holds when the scan could look. If Claude Code isn't installed, `plugin list` fails, or the ledger entry is a project skill for a project that wasn't checked, CCTI shows "Not checked" rather than a false "Missing".
3. **Ledger fields.** Entries carry `id, kind, key, name, scope, projectPath, installedAt, source, catalogAction`. `version` and `pathHint` from the spec example are dropped (YAGNI; nothing reads them). `key` is the observable name used to match the scan. `catalogAction` detects a changed catalog entry for Reinstall.
4. **Only verified installs are recorded.** An entry is written only for tracked ids that were absent before the install and present after it. This keeps pre-existing tools `external` and keeps failed installs from later showing as "Missing".
5. **"Rebuild" means "start a fresh record".** Provenance cannot be recovered from an unreadable file, so the offer moves the unreadable file aside (kept, never deleted) and starts empty. Any write while the file is unreadable does the same automatically, so a corrupt record never blocks recording.
6. **Duplicates in plan 2 are skills only.** `Resolve` appears on skill rows whose copies are verified identical (same content hash). It opens the existing verified-duplicate review, which names the keeper before anything moves. Plugin and MCP duplicates and choosing a keeper for unverified name overlaps are plan 3.

## Review Focus

Each line is pinned by a test in the task that owns the code.

1. **Claude Code missing, or `plugin list` / `mcp list` failing.** A recorded plugin or connection must show "Not checked", never "Missing", and offer no Reinstall (Tasks 2 and 4).
2. **`inventory.json` unreadable in any way:** not JSON, truncated, `[]`, an unknown `schemaVersion`, or a directory where the file should be. Expect every row `external`, a "Start a fresh record" notice, and no throw. The next write keeps the old file and records normally (Tasks 3, 4, 6).
3. **Real CLI output noise:** detail lines, section headers, `Checking MCP server health…`, names with spaces, Claude.ai-synced plugins and connectors, `No plugins installed`, and CRLF line endings. Expect no junk rows, and Claude.ai items labelled as managed in the account (Task 2).
4. **A tool already present before CCTI installed it, or an install that failed or half-finished.** Expect it not recorded as CCTI-installed, so it never shows "Missing" later (Tasks 3 and 6).
5. **The user backs up a CCTI-installed skill, alone or as a duplicate.** Expect no "Missing" row for it afterwards (Tasks 4 and 6).

---

## File Structure

| File | Responsibility |
|---|---|
| `desktop/src/inventory/tracked-items.js` (create) | Catalog id → `{ kind, key }` for items that leave an observable skill, plugin, or MCP connection. |
| `desktop/src/inventory/scanner.js` (create) | Pure parsers: findings + CLI text → scan items with `observed` flags. |
| `desktop/src/inventory/ledger.js` (create) | Read/write `inventory.json` safely; pure helpers for new entries and resolutions. |
| `desktop/src/inventory/reconcile.js` (create) | Pure merge of scan and ledger into state rows. |
| `desktop/src/inventory/manage-view.js` (create) | Pure rows → sections, badges, detail, action. CommonJS + `window.CCTIManageView`. |
| `desktop/src/main.js` (modify) | Glue: inventory in discovery, record installs and resolutions, `inventory:reset-history`. |
| `desktop/src/preload.js` (modify) | `resetInventoryHistory`. |
| `desktop/src/renderer/index.html` (modify) | Manage list section; loads `manage-view.js`. |
| `desktop/src/renderer/app.js` (modify) | Renders the list; Reinstall, Resolve, and reset actions. |
| `desktop/src/renderer/styles.css` (modify) | Manage list styles. |
| `scripts/test-inventory-tracked-items.js` (create) | Keys match all three adapters and `reviewedPluginPlans`. |
| `scripts/test-inventory-scanner.js` (create) | Parsers against real CLI output. |
| `scripts/test-inventory-ledger.js` (create) | Store and helpers against a temp folder. |
| `scripts/test-inventory-reconcile.js` (create) | Every state and invariant. |
| `scripts/test-inventory-manage-view.js` (create) | Badges, actions, notices, no paths or commands in detail. |
| `scripts/test-inventory-main.js` (create) | `main.js` wiring with a stubbed Electron and a fake `claude`. |
| `scripts/validate-desktop-ui.js` (modify) | String contract for the new wiring. |
| `desktop/package.json` (modify) | `inventory:check`, added to `check` and `node --check`. |

---

### Task 1: Tracked items map

**Files:**
- Create: `desktop/src/inventory/tracked-items.js`
- Create: `scripts/test-inventory-tracked-items.js`
- Modify: `desktop/package.json` (scripts `inventory:check`, `check`)

**Interfaces:**
- Consumes: `desktop/catalog.json` (array of `{ id, name, action, ... }`); the adapter scripts `setup-my-claude.sh`, `setup-my-claude-linux.sh`, `setup-my-claude.ps1`; `reviewedPluginPlans` in `desktop/src/main.js`.
- Produces: `TRACKED_ITEMS: Readonly<Record<catalogId, { kind: 'skill'|'plugin'|'mcp', key: string }>>` and `trackedItem(id: string) → { kind, key } | null`. Skill `key` is the folder name under `.claude/skills`. Plugin `key` is the `claude plugin install` argument. MCP `key` is the registered server name.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-inventory-tracked-items.js`:

```js
#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { TRACKED_ITEMS, trackedItem } = require('../desktop/src/inventory/tracked-items');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const catalogIds = new Set(require(path.join(root, 'desktop', 'catalog.json')).map((item) => item.id));
const shellAdapters = ['setup-my-claude.sh', 'setup-my-claude-linux.sh'].map((file) => [file, read(file)]);
const powershell = read('setup-my-claude.ps1');
const mainSource = read('desktop/src/main.js');

// CRLF-safe: Windows CI checks these files out with \r\n.
function shellBranch(source, id) {
  return source.match(new RegExp(`\\r?\\n\\s*${escape(id)}\\)[\\s\\S]*?\\r?\\n\\s*;;`))?.[0] || '';
}
function powershellBranch(source, id) {
  return source.match(new RegExp(`\\r?\\n\\s*"${escape(id)}"\\s*\\{[\\s\\S]*?\\r?\\n {4}\\}`))?.[0] || '';
}
function reviewedPluginInstall(id) {
  return mainSource.match(new RegExp(`\\n\\s*'?${escape(id)}'?: \\[.*'plugin', 'install', '([^']+)'`))?.[1] || '';
}

assert.ok(Object.isFrozen(TRACKED_ITEMS), 'the tracked map must not be mutable at runtime');
assert.equal(trackedItem('constructor'), null, 'prototype names must not look tracked');
assert.equal(trackedItem('learn-claude-code'), null, 'reference clones are not tracked');

for (const [id, item] of Object.entries(TRACKED_ITEMS)) {
  assert.ok(catalogIds.has(id), `${id} must be a catalog.json id`);
  assert.ok(['skill', 'plugin', 'mcp'].includes(item.kind), `${id} must have a known kind`);
  assert.equal(trackedItem(id), item);

  if (item.kind === 'skill') {
    for (const [file, source] of shellAdapters) {
      const branch = shellBranch(source, id);
      assert.ok(branch, `${file} must have an install branch for ${id}`);
      const installs = id === 'gstack'
        ? /\.claude\/skills\/gstack"/.test(branch)
        : new RegExp(`install_skill \\S+ ${escape(item.key)} "\\$id"`).test(branch);
      assert.ok(installs, `${file} must install ${id} as the skill folder "${item.key}"`);
    }
    const branch = powershellBranch(powershell, id);
    const installs = id === 'gstack'
      ? /\.claude\\skills\\gstack"/.test(branch)
      : new RegExp(`Install-Skill "[^"]+" "${escape(item.key)}" \\$Id`).test(branch);
    assert.ok(installs, `setup-my-claude.ps1 must install ${id} as the skill folder "${item.key}"`);
  }

  if (item.kind === 'mcp') {
    for (const [file, source] of shellAdapters) {
      assert.match(shellBranch(source, id), new RegExp(`install_mcp(?:_after_dashdash)? ${escape(item.key)} "\\$id"`), `${file} must register ${id} as "${item.key}"`);
    }
    assert.match(powershellBranch(powershell, id), new RegExp(`Install-Mcp(?:AfterDashDash)? "${escape(item.key)}" \\$Id`), `setup-my-claude.ps1 must register ${id} as "${item.key}"`);
  }

  if (item.kind === 'plugin') {
    assert.equal(reviewedPluginInstall(id), item.key, `reviewedPluginPlans.${id} must install "${item.key}"`);
  }
}

// No silent gaps: every plugin CCTI installs itself is tracked.
const reviewedIds = [...mainSource.matchAll(/\n\s*'?([a-z0-9-]+)'?: \[.*'plugin', 'install', '[^']+'/g)].map((match) => match[1]);
assert.ok(reviewedIds.length >= 9, 'the reviewedPluginPlans scan must find the plugin installs');
for (const id of reviewedIds) assert.equal(trackedItem(id)?.kind, 'plugin', `${id} installs a plugin inside CCTI and must be tracked`);

console.log(`Inventory tracked items passed: ${Object.keys(TRACKED_ITEMS).length} catalog items match all three adapters and the in-app plugin plans.`);
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node scripts/test-inventory-tracked-items.js`
Expected: FAIL with `Cannot find module '../desktop/src/inventory/tracked-items'`

- [ ] **Step 3: Write the implementation**

Create `desktop/src/inventory/tracked-items.js`:

```js
// Catalog items whose install leaves something the inventory can observe: a
// skill folder, a Claude Code plugin, or an MCP connection. Everything else CCTI
// installs (reference clones, npm globals, marketplaces) is not tracked. Keys must
// match the adapters and reviewedPluginPlans in main.js; the
// test-inventory-tracked-items.js check enforces that.

const TRACKED_ITEMS = Object.freeze({
  ponytail: Object.freeze({ kind: 'skill', key: 'ponytail' }),
  gstack: Object.freeze({ kind: 'skill', key: 'gstack' }),
  'taste-skill': Object.freeze({ kind: 'skill', key: 'design-taste-frontend' }),
  'planning-with-files': Object.freeze({ kind: 'skill', key: 'planning-with-files' }),
  graphify: Object.freeze({ kind: 'skill', key: 'graphify' }),
  repomix: Object.freeze({ kind: 'mcp', key: 'repomix' }),
  'playwright-mcp': Object.freeze({ kind: 'mcp', key: 'playwright' }),
  superpowers: Object.freeze({ kind: 'plugin', key: 'superpowers@superpowers-marketplace' }),
  ecc: Object.freeze({ kind: 'plugin', key: 'ecc@ecc' }),
  'wshobson-agents': Object.freeze({ kind: 'plugin', key: 'claude-code-essentials' }),
  'frontend-design': Object.freeze({ kind: 'plugin', key: 'frontend-design@claude-plugins-official' }),
  'code-review': Object.freeze({ kind: 'plugin', key: 'code-review@claude-plugins-official' }),
  context7: Object.freeze({ kind: 'plugin', key: 'context7@claude-plugins-official' }),
  'skill-creator': Object.freeze({ kind: 'plugin', key: 'skill-creator@claude-plugins-official' }),
  convex: Object.freeze({ kind: 'plugin', key: 'convex@claude-plugins-official' }),
  'claude-hud': Object.freeze({ kind: 'plugin', key: 'claude-hud' }),
});

function trackedItem(id) {
  return Object.prototype.hasOwnProperty.call(TRACKED_ITEMS, id) ? TRACKED_ITEMS[id] : null;
}

module.exports = { TRACKED_ITEMS, trackedItem };
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node scripts/test-inventory-tracked-items.js`
Expected: PASS, printing `Inventory tracked items passed: 16 catalog items …`

- [ ] **Step 5: Wire it into `npm run check`**

In `desktop/package.json` `scripts`, add after `"interview-fixtures:check"`:

```json
    "inventory:check": "node ../scripts/test-inventory-tracked-items.js",
```

In `check`, insert `npm run inventory:check && ` immediately before `npm run project-interview:check`. Append ` && node --check src/inventory/tracked-items.js` to the end of `check`.

Run: `cd desktop && npm run inventory:check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add desktop/src/inventory/tracked-items.js scripts/test-inventory-tracked-items.js desktop/package.json
git commit -m "feat(inventory): map catalog items to observable skills, plugins, and connections

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Scanner parsers

**Files:**
- Create: `desktop/src/inventory/scanner.js`
- Create: `scripts/test-inventory-scanner.js`
- Modify: `desktop/package.json` (`inventory:check`, `check`)

**Interfaces:**
- Consumes: discovery findings from `discoverClaudeSetup` (`{ id, type, name, scope, path, contentHash? }`). Skills are `type: 'skill'` or `'skill-link-excluded'`, or `type: 'attention'` with an id starting `skill:`. An unreadable skills root is `type: 'attention'` with an id starting `skill-root:`. Also consumes raw stdout of `claude plugin list` and `claude mcp list`.
- Produces:
  - `skillKey(name: string) → string`: lowercase, runs of non-alphanumerics → `-`. Same rule as `normalizedFindingName` in `main.js`.
  - `parsePluginList(text) → ScanItem[]` and `parseMcpList(text) → ScanItem[]`.
  - `skillsFromFindings(findings) → ScanItem[]`.
  - `buildScan({ findings, pluginList, mcpList, projectPath }) → Scan`. `pluginList`/`mcpList` are `{ ok: boolean, text: string } | null` (`null` = Claude Code unavailable).
  - `ScanItem = { kind: 'skill'|'plugin'|'mcp', key, name, scope, origin: 'local'|'claude.ai', path, contentHash }`. Skill scope is `'Just you'|'This project'`. Plugin scope is from its `Scope:` line (`user`→`'Just you'`, `project`→`'This project'`, `local`→`'Only you in this project'`, else `'Claude Code'`). MCP scope is `'Claude Code'`. Claude.ai items have scope `'Your Claude.ai account'`.
  - `Scan = { projectPath: string, observed: { skill: true, plugin: boolean, mcp: boolean }, unreadableSkillScopes: string[], items: ScanItem[] }`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-inventory-scanner.js`:

```js
#!/usr/bin/env node
const assert = require('node:assert/strict');
const { buildScan, parsePluginList, parseMcpList, skillsFromFindings, skillKey } = require('../desktop/src/inventory/scanner');

// Captured from `claude plugin list` (Claude Code, 2026-09-26).
const pluginText = [
  'Installed plugins:',
  '',
  '  ❯ claude-hud@claude-hud',
  '    Version: 0.8.0',
  '    Scope: user',
  '    Status: ✔ enabled',
  '',
  '  ❯ superpowers@superpowers-marketplace',
  '    Version: 6.4.1',
  '    Scope: project',
  '    Status: ✔ enabled',
  '',
  'Synced from claude.ai:',
  '',
  '  ❯ operations@synced',
  '    Version: 1.3.0',
  '    Path: /Users/example/.claude/plugins/synced/abc/operations',
  '    Status: ✔ loaded',
].join('\n');

// Captured from `claude mcp list` (Claude Code, 2026-09-26).
const mcpText = [
  'Checking MCP server health…',
  '',
  'claude.ai Slack: https://mcp.slack.com/mcp - ✔ Connected',
  'playwright: npx @playwright/mcp@latest - ✔ Connected',
  'repomix: npx -y repomix --mcp - ✗ Failed to connect',
].join('\n');

const plugins = parsePluginList(pluginText);
assert.deepEqual(plugins.map((item) => item.key), ['claude-hud@claude-hud', 'superpowers@superpowers-marketplace', 'operations@synced'], 'only real plugin entries are items; detail lines and headers are not');
assert.equal(plugins[0].scope, 'Just you');
assert.equal(plugins[1].scope, 'This project');
assert.equal(plugins[2].origin, 'claude.ai', 'synced plugins belong to the Claude.ai account');
assert.equal(plugins[2].scope, 'Your Claude.ai account');
assert.ok(plugins.every((item) => item.kind === 'plugin'));

assert.deepEqual(parsePluginList(pluginText.replace(/\n/g, '\r\n')), plugins, 'CRLF output must parse identically');
assert.deepEqual(parsePluginList('frontend-design@claude-plugins-official enabled\nfrontend-design@claude-plugins-official enabled').map((item) => item.key), ['frontend-design@claude-plugins-official'], 'bare legacy lines parse and de-duplicate');
assert.deepEqual(parsePluginList('No plugins installed.'), [], 'an empty-list message is not a plugin');
assert.deepEqual(parsePluginList(''), []);

const connections = parseMcpList(mcpText);
assert.deepEqual(connections.map((item) => item.name), ['claude.ai Slack', 'playwright', 'repomix'], 'names with spaces survive and the health banner is ignored');
assert.equal(connections[0].origin, 'claude.ai');
assert.equal(connections[1].key, 'playwright');
assert.equal(connections[1].origin, 'local');
assert.deepEqual(parseMcpList(mcpText.replace(/\n/g, '\r\n')), connections, 'CRLF output must parse identically');
assert.deepEqual(parseMcpList('shared-connection\nshared-connection').map((item) => item.key), ['shared-connection'], 'bare legacy lines parse and de-duplicate');
assert.deepEqual(parseMcpList('No MCP servers configured. Use `claude mcp add` to add a server.'), []);

assert.equal(skillKey('Design Taste_Frontend'), 'design-taste-frontend');
const findings = [
  { id: 'skill:/h/.claude/skills/graphify', type: 'skill', name: 'graphify', scope: 'Just you', path: '/h/.claude/skills/graphify', contentHash: 'abc' },
  { id: 'skill-link-excluded:/h/.claude/skills/linked', type: 'skill-link-excluded', name: 'linked', scope: 'Just you', path: '/h/.claude/skills/linked' },
  { id: 'skill:/p/.claude/skills/odd', type: 'attention', name: 'odd', scope: 'This project', path: '/p/.claude/skills/odd' },
  { id: 'plugin:/h/.claude/settings.json:x', type: 'plugin', name: 'x', scope: 'Just you', path: '/h/.claude/settings.json' },
  { id: 'skill-root:/p/.claude/skills', type: 'attention', name: 'Skills folder needs attention', scope: 'This project', path: '/p/.claude/skills' },
];
const skills = skillsFromFindings(findings);
assert.deepEqual(skills.map((item) => [item.key, item.scope, item.contentHash]), [['graphify', 'Just you', 'abc'], ['linked', 'Just you', ''], ['odd', 'This project', '']], 'hashed, linked, and unverifiable skill folders all count as present; settings findings do not');

const full = buildScan({ findings, pluginList: { ok: true, text: pluginText }, mcpList: { ok: true, text: mcpText }, projectPath: '/p' });
assert.deepEqual(full.observed, { skill: true, plugin: true, mcp: true });
assert.deepEqual(full.unreadableSkillScopes, ['This project']);
assert.equal(full.projectPath, '/p');
assert.equal(full.items.length, skills.length + plugins.length + connections.length);

// Review Focus 1: an unavailable or failing CLI is "not observed", never "observed empty".
for (const [pluginList, mcpList] of [[null, null], [{ ok: false, text: pluginText }, { ok: false, text: mcpText }]]) {
  const scan = buildScan({ findings, pluginList, mcpList });
  assert.deepEqual(scan.observed, { skill: true, plugin: false, mcp: false });
  assert.ok(scan.items.every((item) => item.kind === 'skill'), 'unobserved kinds contribute no items');
}
assert.doesNotThrow(() => buildScan(), 'no input must not throw');
assert.deepEqual(buildScan().items, []);

console.log('Inventory scanner passed: real Claude Code output, CRLF, Claude.ai items, and unobserved sources.');
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node scripts/test-inventory-scanner.js`
Expected: FAIL with `Cannot find module '../desktop/src/inventory/scanner'`

- [ ] **Step 3: Write the implementation**

Create `desktop/src/inventory/scanner.js`:

```js
// Turns what the checkup already collects into inventory scan items: skill
// folders from discovery findings, and plugins and MCP connections from Claude
// Code's own `plugin list` / `mcp list` output. Pure: no I/O.

const PLUGIN_ID = /^[a-z0-9][a-z0-9._-]*(?:@[a-z0-9][a-z0-9._-]*)?$/i;
const PLUGIN_SCOPES = { user: 'Just you', project: 'This project', local: 'Only you in this project' };
const CLAUDE_AI_SCOPE = 'Your Claude.ai account';

function skillKey(name) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function textLines(text) {
  return String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function parsePluginList(text) {
  const plugins = new Map();
  let inClaudeAiSection = false;
  let current = null;
  for (const line of textLines(text)) {
    if (line.endsWith(':')) {
      inClaudeAiSection = /claude\.ai/i.test(line);
      current = null;
      continue;
    }
    const detail = line.match(/^([A-Za-z]+):\s*(.*)$/);
    if (detail) {
      const scope = PLUGIN_SCOPES[detail[2].trim().toLowerCase()];
      if (current && detail[1].toLowerCase() === 'scope' && scope && current.origin === 'local') current.scope = scope;
      continue;
    }
    const id = line.replace(/^[❯•*+-]\s+/, '').split(/\s+/)[0];
    if (!PLUGIN_ID.test(id) || /^no$/i.test(id)) {
      current = null;
      continue;
    }
    const key = id.toLowerCase();
    const fromClaudeAi = inClaudeAiSection || key.endsWith('@synced');
    current = plugins.get(key) || {
      kind: 'plugin',
      key,
      name: id,
      scope: fromClaudeAi ? CLAUDE_AI_SCOPE : 'Claude Code',
      origin: fromClaudeAi ? 'claude.ai' : 'local',
      path: '',
      contentHash: '',
    };
    plugins.set(key, current);
  }
  return [...plugins.values()];
}

function parseMcpList(text) {
  const connections = new Map();
  for (const line of textLines(text)) {
    if (/^checking mcp server health/i.test(line) || /^no mcp servers/i.test(line)) continue;
    const listed = line.match(/^(.+?):\s+\S.*?\s+-\s+\S/);
    const name = listed ? listed[1].trim() : /^[\w.@-]+$/.test(line) ? line : '';
    if (!name) continue;
    const key = name.toLowerCase();
    if (connections.has(key)) continue;
    const fromClaudeAi = key.startsWith('claude.ai ');
    connections.set(key, {
      kind: 'mcp',
      key,
      name,
      scope: fromClaudeAi ? CLAUDE_AI_SCOPE : 'Claude Code',
      origin: fromClaudeAi ? 'claude.ai' : 'local',
      path: '',
      contentHash: '',
    });
  }
  return [...connections.values()];
}

function isSkillFinding(item) {
  if (!item) return false;
  if (item.type === 'skill' || item.type === 'skill-link-excluded') return true;
  return item.type === 'attention' && String(item.id || '').startsWith('skill:');
}

function skillsFromFindings(findings) {
  return (Array.isArray(findings) ? findings : []).filter(isSkillFinding).map((item) => ({
    kind: 'skill',
    key: skillKey(item.name),
    name: item.name,
    scope: item.scope,
    origin: 'local',
    path: item.path || '',
    contentHash: item.type === 'skill' ? String(item.contentHash || '') : '',
  }));
}

function buildScan({ findings = [], pluginList = null, mcpList = null, projectPath = '' } = {}) {
  const pluginsObserved = Boolean(pluginList && pluginList.ok);
  const mcpObserved = Boolean(mcpList && mcpList.ok);
  const unreadableSkillScopes = [...new Set((Array.isArray(findings) ? findings : [])
    .filter((item) => item && item.type === 'attention' && String(item.id || '').startsWith('skill-root:'))
    .map((item) => item.scope))];
  return {
    projectPath: String(projectPath || ''),
    observed: { skill: true, plugin: pluginsObserved, mcp: mcpObserved },
    unreadableSkillScopes,
    items: [
      ...skillsFromFindings(findings),
      ...(pluginsObserved ? parsePluginList(pluginList.text) : []),
      ...(mcpObserved ? parseMcpList(mcpList.text) : []),
    ],
  };
}

module.exports = { buildScan, parsePluginList, parseMcpList, skillsFromFindings, skillKey };
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node scripts/test-inventory-scanner.js`
Expected: PASS

- [ ] **Step 5: Wire it into `npm run check`**

In `desktop/package.json`, change `inventory:check` to:

```json
    "inventory:check": "node ../scripts/test-inventory-tracked-items.js && node ../scripts/test-inventory-scanner.js",
```

Append ` && node --check src/inventory/scanner.js` to `check`.

Run: `cd desktop && npm run inventory:check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add desktop/src/inventory/scanner.js scripts/test-inventory-scanner.js desktop/package.json
git commit -m "feat(inventory): parse real plugin and MCP list output into scan items

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Install ledger

**Files:**
- Create: `desktop/src/inventory/ledger.js`
- Create: `scripts/test-inventory-ledger.js`
- Modify: `desktop/package.json` (`inventory:check`, `check`)

**Interfaces:**
- Consumes: `skillKey` from `./scanner`; `TRACKED_ITEMS` shape from Task 1 (passed in, not required, so tests can use fixtures).
- Produces:
  - `SCHEMA_VERSION = 1`
  - `emptyLedger() → Ledger`
  - `parseLedger(text) → { status: 'ok'|'corrupt', ledger: Ledger }`
  - `newlyInstalledEntries(ids: string[], before: Set<string>, after: Set<string>, { tracked, catalog, skillScope?: 'global'|'project', projectPath?, now?: Date }) → Entry[]`
  - `skillBackupResolutions(moves: {name, scope: 'Just you'|'This project', source, destination}[], { projectPath?, now?: Date }) → Resolution[]`
  - `createLedgerStore(filePath, { now?: () => Date }) → { read(): Promise<{ status: 'ok'|'missing'|'corrupt', ledger }>, recordInstalls(entries): Promise<{ ok, preservedAs }>, recordResolutions(resolutions): Promise<{ ok, preservedAs }>, reset(): Promise<{ ok, preservedAs, unchanged? }> }`
  - `Ledger = { schemaVersion: 1, entries: Entry[], resolutions: Resolution[] }`
  - `Entry = { id, kind, key, name, scope: 'user'|'project', projectPath, installedAt, source: 'ccti-catalog', catalogAction }`
  - `Resolution = { kind: 'skill', key, scope: 'user'|'project', projectPath, resolvedAt, action: 'backup', movedFrom, movedTo }`
- Store methods reject on I/O failure. Callers in `main.js` catch; the record is advisory.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-inventory-ledger.js`:

```js
#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { SCHEMA_VERSION, emptyLedger, parseLedger, newlyInstalledEntries, skillBackupResolutions, createLedgerStore } = require('../desktop/src/inventory/ledger');

const tracked = {
  'planning-with-files': { kind: 'skill', key: 'planning-with-files' },
  'claude-hud': { kind: 'plugin', key: 'claude-hud' },
  'playwright-mcp': { kind: 'mcp', key: 'playwright' },
};
const catalog = [
  { id: 'planning-with-files', name: 'Planning with Files', action: 'Install with npx skills' },
  { id: 'claude-hud', name: 'Claude HUD', action: 'Install selected plugin in CCTI' },
  { id: 'playwright-mcp', name: 'Playwright MCP', action: 'Register MCP server' },
];
const now = new Date('2026-09-26T10:00:00.000Z');

async function run() {
  // Pure helpers.
  assert.deepEqual(emptyLedger(), { schemaVersion: SCHEMA_VERSION, entries: [], resolutions: [] });
  for (const bad of ['{not json', '', '[]', 'null', '{"schemaVersion":2,"entries":[],"resolutions":[]}', '{"schemaVersion":1,"entries":{},"resolutions":[]}', '{"schemaVersion":1,"entries":[]']) {
    assert.equal(parseLedger(bad).status, 'corrupt', `${JSON.stringify(bad)} must read as unreadable`);
    assert.deepEqual(parseLedger(bad).ledger, emptyLedger());
  }
  const mixed = parseLedger(JSON.stringify({ schemaVersion: 1, entries: [{ id: 'a', kind: 'skill', key: 'a', installedAt: now.toISOString() }, { id: 'b' }, null], resolutions: [{ kind: 'skill', key: 'a', resolvedAt: now.toISOString() }, 7] }));
  assert.equal(mixed.status, 'ok');
  assert.deepEqual(mixed.ledger.entries.map((entry) => entry.id), ['a'], 'malformed entries are dropped, not fatal');
  assert.equal(mixed.ledger.resolutions.length, 1);

  // Review Focus 4: only items absent before and present after are CCTI installs.
  const entries = newlyInstalledEntries(
    ['planning-with-files', 'claude-hud', 'playwright-mcp', 'playwright-mcp', 'learn-claude-code', 'constructor'],
    new Set(['claude-hud']),
    new Set(['planning-with-files', 'claude-hud']),
    { tracked, catalog, skillScope: 'project', projectPath: '/work/app', now },
  );
  assert.deepEqual(entries, [{
    id: 'planning-with-files', kind: 'skill', key: 'planning-with-files', name: 'Planning with Files',
    scope: 'project', projectPath: '/work/app', installedAt: now.toISOString(), source: 'ccti-catalog', catalogAction: 'Install with npx skills',
  }], 'already-present, failed, untracked, and prototype-named ids are not recorded');
  const plugin = newlyInstalledEntries(['claude-hud'], new Set(), new Set(['claude-hud']), { tracked, catalog, skillScope: 'project', projectPath: '/work/app', now })[0];
  assert.equal(plugin.scope, 'user', 'plugins and connections are recorded at user scope');
  assert.equal(plugin.projectPath, '');

  assert.deepEqual(skillBackupResolutions([
    { name: 'Planning With Files', scope: 'This project', source: '/work/app/.claude/skills/planning-with-files', destination: '/backup/planning-with-files' },
    { name: 'graphify', scope: 'Just you', source: '/h/.claude/skills/graphify', destination: '/backup/graphify' },
  ], { projectPath: '/work/app', now }), [
    { kind: 'skill', key: 'planning-with-files', scope: 'project', projectPath: '/work/app', resolvedAt: now.toISOString(), action: 'backup', movedFrom: '/work/app/.claude/skills/planning-with-files', movedTo: '/backup/planning-with-files' },
    { kind: 'skill', key: 'graphify', scope: 'user', projectPath: '', resolvedAt: now.toISOString(), action: 'backup', movedFrom: '/h/.claude/skills/graphify', movedTo: '/backup/graphify' },
  ]);

  // Store.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ccti-ledger-test-'));
  try {
    const file = path.join(dir, 'user-data', 'inventory.json');
    const store = createLedgerStore(file, { now: () => now });
    assert.deepEqual(await store.read(), { status: 'missing', ledger: emptyLedger() }, 'no file yet is a normal first run');

    await store.recordInstalls(entries);
    const first = await store.read();
    assert.equal(first.status, 'ok');
    assert.equal(first.ledger.entries.length, 1);

    const later = { ...entries[0], installedAt: '2026-09-27T00:00:00.000Z' };
    await store.recordInstalls([later]);
    assert.deepEqual((await store.read()).ledger.entries, [later], 'reinstalling the same id at the same scope replaces its entry');

    await Promise.all([store.recordInstalls([plugin]), store.recordResolutions(skillBackupResolutions([{ name: 'graphify', scope: 'Just you', source: 's', destination: 'd' }], { now }))]);
    const both = await store.read();
    assert.equal(both.ledger.entries.length, 2, 'concurrent writes must not lose an update');
    assert.equal(both.ledger.resolutions.length, 1);

    assert.deepEqual(await store.reset(), { ok: true, preservedAs: '', unchanged: true }, 'reset must never wipe a readable record');
    assert.equal((await store.read()).ledger.entries.length, 2);

    // Review Focus 2: an unreadable record is kept aside and recording carries on.
    await fs.writeFile(file, '{"schemaVersion":1,"entr', 'utf8');
    assert.equal((await store.read()).status, 'corrupt');
    const recovered = await store.recordInstalls([plugin]);
    assert.ok(recovered.preservedAs, 'the unreadable file must be kept');
    assert.equal(await fs.readFile(recovered.preservedAs, 'utf8'), '{"schemaVersion":1,"entr', 'the kept copy is byte-for-byte the old file');
    assert.deepEqual((await store.read()).ledger.entries, [plugin]);

    await fs.writeFile(file, 'garbage', 'utf8');
    const reset = await store.reset();
    assert.ok(reset.preservedAs);
    assert.deepEqual(await store.read(), { status: 'ok', ledger: emptyLedger() });

    await fs.rm(file);
    await fs.mkdir(file);
    await fs.writeFile(path.join(file, 'stray.txt'), 'x', 'utf8');
    assert.equal((await store.read()).status, 'corrupt', 'a directory where the file should be is unreadable, not fatal');
    const fromDirectory = await store.recordInstalls([plugin]);
    assert.ok(fromDirectory.preservedAs);
    assert.equal((await store.read()).status, 'ok');

    // A failed write rejects, and the next write still works.
    const blocked = path.join(dir, 'blocked');
    await fs.writeFile(blocked, 'not a folder', 'utf8');
    const blockedStore = createLedgerStore(path.join(blocked, 'inventory.json'), { now: () => now });
    await assert.rejects(blockedStore.recordInstalls([plugin]));
    await fs.rm(blocked);
    await blockedStore.recordInstalls([plugin]);
    assert.equal((await blockedStore.read()).ledger.entries.length, 1, 'one failed write must not poison later writes');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
  console.log('Inventory ledger passed: verified-install recording, safe concurrent writes, and unreadable records kept aside without blocking.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node scripts/test-inventory-ledger.js`
Expected: FAIL with `Cannot find module '../desktop/src/inventory/ledger'`

- [ ] **Step 3: Write the implementation**

Create `desktop/src/inventory/ledger.js`:

```js
// CCTI's own record of what it installed, kept in userData/inventory.json.
// Advisory only: the disk scan always decides what exists. A missing or
// unreadable file never blocks the app. It reads as an empty record, and the
// next write keeps the unreadable file aside and starts fresh.

const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { skillKey } = require('./scanner');

const SCHEMA_VERSION = 1;

function emptyLedger() {
  return { schemaVersion: SCHEMA_VERSION, entries: [], resolutions: [] };
}

const isText = (value) => typeof value === 'string' && value.length > 0;
const validEntry = (entry) => Boolean(entry) && isText(entry.id) && isText(entry.kind) && isText(entry.key) && isText(entry.installedAt);
const validResolution = (item) => Boolean(item) && isText(item.kind) && isText(item.key) && isText(item.resolvedAt);

function parseLedger(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { status: 'corrupt', ledger: emptyLedger() };
  }
  if (!json || typeof json !== 'object' || Array.isArray(json) || json.schemaVersion !== SCHEMA_VERSION || !Array.isArray(json.entries) || !Array.isArray(json.resolutions)) {
    return { status: 'corrupt', ledger: emptyLedger() };
  }
  return {
    status: 'ok',
    ledger: { schemaVersion: SCHEMA_VERSION, entries: json.entries.filter(validEntry), resolutions: json.resolutions.filter(validResolution) },
  };
}

function newlyInstalledEntries(ids, before, after, { tracked, catalog, skillScope = 'global', projectPath = '', now = new Date() }) {
  const byId = new Map((Array.isArray(catalog) ? catalog : []).map((item) => [item.id, item]));
  const installedAt = now.toISOString();
  return [...new Set(Array.isArray(ids) ? ids : [])].flatMap((id) => {
    const item = Object.prototype.hasOwnProperty.call(tracked || {}, id) ? tracked[id] : null;
    if (!item || before.has(id) || !after.has(id)) return [];
    const scope = item.kind === 'skill' && skillScope === 'project' ? 'project' : 'user';
    return [{
      id,
      kind: item.kind,
      key: item.key,
      name: byId.get(id)?.name || id,
      scope,
      projectPath: scope === 'project' ? String(projectPath || '') : '',
      installedAt,
      source: 'ccti-catalog',
      catalogAction: byId.get(id)?.action || '',
    }];
  });
}

function skillBackupResolutions(moves, { projectPath = '', now = new Date() } = {}) {
  return (Array.isArray(moves) ? moves : []).map((move) => {
    const scope = move.scope === 'This project' ? 'project' : 'user';
    return {
      kind: 'skill',
      key: skillKey(move.name),
      scope,
      projectPath: scope === 'project' ? String(projectPath || '') : '',
      resolvedAt: now.toISOString(),
      action: 'backup',
      movedFrom: String(move.source || ''),
      movedTo: String(move.destination || ''),
    };
  });
}

const entryIdentity = (entry) => [entry.id, entry.scope, entry.projectPath || ''].join('\u0000');

function createLedgerStore(filePath, { now = () => new Date() } = {}) {
  let queue = Promise.resolve();

  async function read() {
    let text;
    try {
      text = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      return { status: error.code === 'ENOENT' ? 'missing' : 'corrupt', ledger: emptyLedger() };
    }
    return parseLedger(text);
  }

  async function keepUnreadable() {
    const stamp = now().toISOString().replace(/[:.]/g, '-');
    // The random suffix keeps two recoveries in the same millisecond from colliding.
    const preservedAs = path.join(path.dirname(filePath), `inventory.unreadable-${stamp}-${randomUUID().slice(0, 8)}.json`);
    await fs.rename(filePath, preservedAs);
    return preservedAs;
  }

  async function write(ledger) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, filePath);
  }

  function update(change) {
    const run = queue.then(async () => {
      const current = await read();
      const next = change(current.ledger, current.status);
      if (next === null) return { ok: true, preservedAs: '', unchanged: true };
      const preservedAs = current.status === 'corrupt' ? await keepUnreadable() : '';
      await write(next);
      return { ok: true, preservedAs };
    });
    queue = run.catch(() => {});
    return run;
  }

  return {
    read,
    recordInstalls: (entries) => update((ledger) => {
      const replaced = new Set(entries.map(entryIdentity));
      return { ...ledger, entries: [...ledger.entries.filter((entry) => !replaced.has(entryIdentity(entry))), ...entries] };
    }),
    recordResolutions: (resolutions) => update((ledger) => ({ ...ledger, resolutions: [...ledger.resolutions, ...resolutions] })),
    reset: () => update((_ledger, status) => (status === 'corrupt' ? emptyLedger() : null)),
  };
}

module.exports = { SCHEMA_VERSION, emptyLedger, parseLedger, newlyInstalledEntries, skillBackupResolutions, createLedgerStore };
```

Note: `reset()` on a `missing` record returns `unchanged` too, because there is nothing to preserve or clear.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node scripts/test-inventory-ledger.js`
Expected: PASS

- [ ] **Step 5: Wire it into `npm run check`**

Append ` && node ../scripts/test-inventory-ledger.js` to `inventory:check`. Append ` && node --check src/inventory/ledger.js` to `check`.

Run: `cd desktop && npm run inventory:check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add desktop/src/inventory/ledger.js scripts/test-inventory-ledger.js desktop/package.json
git commit -m "feat(inventory): add an advisory install record that never blocks on corruption

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Reconcile scan and ledger

**Files:**
- Create: `desktop/src/inventory/reconcile.js`
- Create: `scripts/test-inventory-reconcile.js`
- Modify: `desktop/package.json` (`inventory:check`, `check`)

**Interfaces:**
- Consumes: `Scan` (Task 2), `Ledger` and status (Task 3), `catalog.json` array, `TRACKED_ITEMS` shape (Task 1).
- Produces: `reconcileInventory({ scan, ledger, ledgerStatus: 'ok'|'missing'|'corrupt', catalog, tracked }) → { historyStatus, rows: Row[] }`.
  - `Row = { rowId, kind, key, name, state: 'installed'|'missing'|'external'|'duplicate'|'unchecked', scope, origin, installedAt, installedByCcti: boolean, copies: {scope, path}[], resolvable: boolean, reinstall: null | { id, available: boolean, changed: boolean, message: string }, uncheckedReason: ''|'project'|'folder'|'claude-code' }`.
  - Rows are sorted by kind (skill, plugin, mcp), then state (missing, duplicate, unchecked, installed, external), then name.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-inventory-reconcile.js`:

```js
#!/usr/bin/env node
const assert = require('node:assert/strict');
const { reconcileInventory } = require('../desktop/src/inventory/reconcile');

const tracked = {
  'planning-with-files': { kind: 'skill', key: 'planning-with-files' },
  graphify: { kind: 'skill', key: 'graphify' },
  ponytail: { kind: 'skill', key: 'ponytail' },
  'claude-hud': { kind: 'plugin', key: 'claude-hud' },
  'playwright-mcp': { kind: 'mcp', key: 'playwright' },
  repomix: { kind: 'mcp', key: 'repomix' },
};
const catalog = [
  { id: 'planning-with-files', name: 'Planning with Files', action: 'Install with npx skills' },
  { id: 'graphify', name: 'Graphify', action: 'Install with npx skills' },
  { id: 'ponytail', name: 'Ponytail', action: 'Install with npx skills' },
  { id: 'claude-hud', name: 'Claude HUD', action: 'Install selected plugin in CCTI' },
  { id: 'playwright-mcp', name: 'Playwright MCP', action: 'Register MCP server' },
  { id: 'repomix', name: 'Repomix', action: 'Install CLI and register MCP server' },
];
const entry = (id, kind, key, extra = {}) => ({ id, kind, key, name: catalog.find((item) => item.id === id)?.name || id, scope: 'user', projectPath: '', installedAt: '2026-09-14T10:00:00.000Z', source: 'ccti-catalog', catalogAction: catalog.find((item) => item.id === id)?.action || 'Old action', ...extra });
const skill = (key, scope, contentHash = 'h1', path = `/${scope}/${key}`) => ({ kind: 'skill', key, name: key, scope, origin: 'local', path, contentHash });
const scan = (items, extra = {}) => ({ projectPath: '', observed: { skill: true, plugin: true, mcp: true }, unreadableSkillScopes: [], items, ...extra });
const rowFor = (result, key) => result.rows.find((row) => row.key === key);

const ledger = {
  schemaVersion: 1,
  entries: [
    entry('planning-with-files', 'skill', 'planning-with-files'),
    entry('claude-hud', 'plugin', 'claude-hud'),
    entry('playwright-mcp', 'mcp', 'playwright'),
    entry('repomix', 'mcp', 'repomix', { catalogAction: 'Install the old way' }),
    entry('retired-tool', 'skill', 'retired-tool'),
  ],
  resolutions: [],
};
const items = [
  skill('planning-with-files', 'Just you'),
  { kind: 'plugin', key: 'claude-hud@claude-hud', name: 'claude-hud@claude-hud', scope: 'Just you', origin: 'local', path: '', contentHash: '' },
  { kind: 'plugin', key: 'operations@synced', name: 'operations@synced', scope: 'Your Claude.ai account', origin: 'claude.ai', path: '', contentHash: '' },
  skill('graphify', 'Just you', 'same'),
  skill('graphify', 'This project', 'same'),
  skill('notes', 'Just you', 'a'),
  skill('notes', 'This project', 'b'),
];
const result = reconcileInventory({ scan: scan(items, { projectPath: '/work' }), ledger, ledgerStatus: 'ok', catalog, tracked });

assert.equal(result.historyStatus, 'ok');
assert.equal(rowFor(result, 'planning-with-files').state, 'installed');
assert.equal(rowFor(result, 'planning-with-files').installedAt, '2026-09-14T10:00:00.000Z');
assert.equal(rowFor(result, 'claude-hud@claude-hud').state, 'installed', 'a plugin installed by short name matches its listed marketplace id');
assert.equal(rowFor(result, 'claude-hud@claude-hud').name, 'Claude HUD', 'rows CCTI installed use the catalog name');
assert.equal(rowFor(result, 'operations@synced').state, 'external');
assert.equal(rowFor(result, 'operations@synced').origin, 'claude.ai');

const playwright = rowFor(result, 'playwright');
assert.equal(playwright.state, 'missing');
assert.deepEqual(playwright.reinstall, { id: 'playwright-mcp', available: true, changed: false, message: '' });
const repomix = rowFor(result, 'repomix');
assert.equal(repomix.state, 'missing');
assert.equal(repomix.reinstall.changed, true, 'a changed catalog entry is flagged before reinstalling');
assert.match(repomix.reinstall.message, /differently/);
const retired = rowFor(result, 'retired-tool');
assert.equal(retired.reinstall.available, false, 'an id no longer in the catalog cannot be reinstalled');
assert.match(retired.reinstall.message, /no longer offered/);

const graphify = rowFor(result, 'graphify');
assert.equal(graphify.state, 'duplicate');
assert.equal(graphify.copies.length, 2);
assert.equal(graphify.resolvable, true, 'identical copies can be resolved');
assert.equal(rowFor(result, 'notes').resolvable, false, 'same name with different content is informational only');
assert.equal(reconcileInventory({ scan: scan([skill('x', 'Just you', ''), skill('x', 'This project', '')]), ledger: { entries: [], resolutions: [] }, catalog, tracked }).rows[0].resolvable, false, 'unverified content is never resolvable');

assert.deepEqual(result.rows.map((row) => row.kind), [...result.rows.map((row) => row.kind)].sort((a, b) => ['skill', 'plugin', 'mcp'].indexOf(a) - ['skill', 'plugin', 'mcp'].indexOf(b)), 'rows are grouped by kind');
assert.equal(result.rows.filter((row) => row.kind === 'skill')[0].state, 'missing', 'within a kind, missing rows come first');

// Review Focus 1: unobserved kinds are "unchecked", never "missing".
const blind = reconcileInventory({ scan: scan([], { observed: { skill: true, plugin: false, mcp: false } }), ledger, catalog, tracked });
for (const key of ['claude-hud', 'playwright', 'repomix']) {
  assert.equal(rowFor(blind, key).state, 'unchecked', `${key} must not be called missing when Claude Code could not be asked`);
  assert.equal(rowFor(blind, key).reinstall, null);
  assert.equal(rowFor(blind, key).uncheckedReason, 'claude-code');
}

// Project skills are only judged when that project was checked; unreadable folders are not judged.
const projectLedger = { entries: [entry('ponytail', 'skill', 'ponytail', { scope: 'project', projectPath: '/work' })], resolutions: [] };
assert.equal(rowFor(reconcileInventory({ scan: scan([]), ledger: projectLedger, catalog, tracked }), 'ponytail').uncheckedReason, 'project');
assert.equal(rowFor(reconcileInventory({ scan: scan([], { projectPath: '/other' }), ledger: projectLedger, catalog, tracked }), 'ponytail').state, 'unchecked');
assert.equal(rowFor(reconcileInventory({ scan: scan([], { projectPath: '/work' }), ledger: projectLedger, catalog, tracked }), 'ponytail').state, 'missing');
assert.equal(rowFor(reconcileInventory({ scan: scan([skill('ponytail', 'This project')], { projectPath: '/work' }), ledger: projectLedger, catalog, tracked }), 'ponytail').state, 'installed');
const otherScope = reconcileInventory({ scan: scan([skill('ponytail', 'Just you')], { projectPath: '/work' }), ledger: projectLedger, catalog, tracked });
assert.deepEqual(otherScope.rows.map((row) => row.state).sort(), ['external', 'missing'], 'a same-named skill in another scope is not the one CCTI installed');
const unreadable = reconcileInventory({ scan: scan([], { projectPath: '/work', unreadableSkillScopes: ['This project'] }), ledger: projectLedger, catalog, tracked });
assert.equal(rowFor(unreadable, 'ponytail').uncheckedReason, 'folder');

// Review Focus 5: a skill the user backed up after CCTI installed it is expected absence.
const backedUp = { entries: [entry('graphify', 'skill', 'graphify')], resolutions: [{ kind: 'skill', key: 'graphify', scope: 'user', projectPath: '', resolvedAt: '2026-09-20T00:00:00.000Z', action: 'backup' }] };
assert.equal(rowFor(reconcileInventory({ scan: scan([]), ledger: backedUp, catalog, tracked }), 'graphify'), undefined, 'no Missing row after a backup');
assert.equal(rowFor(reconcileInventory({ scan: scan([skill('graphify', 'This project')], { projectPath: '/work' }), ledger: backedUp, catalog, tracked }), 'graphify').state, 'external', 'the surviving copy still shows');
const reinstalledAfter = { entries: [entry('graphify', 'skill', 'graphify', { installedAt: '2026-09-25T00:00:00.000Z' })], resolutions: backedUp.resolutions };
assert.equal(rowFor(reconcileInventory({ scan: scan([]), ledger: reinstalledAfter, catalog, tracked }), 'graphify').state, 'missing', 'a backup from before the latest install does not excuse a later loss');

// Review Focus 2: an unreadable record degrades to "found on this computer".
const corrupt = reconcileInventory({ scan: scan(items), ledger, ledgerStatus: 'corrupt', catalog, tracked });
assert.equal(corrupt.historyStatus, 'corrupt');
assert.ok(corrupt.rows.every((row) => ['external', 'duplicate'].includes(row.state) && !row.installedByCcti), 'nothing is claimed as CCTI-installed or missing');

assert.doesNotThrow(() => reconcileInventory());
assert.deepEqual(reconcileInventory().rows, []);

console.log('Inventory reconcile passed: all states, unobserved sources, project scope, backups, and unreadable records.');
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node scripts/test-inventory-reconcile.js`
Expected: FAIL with `Cannot find module '../desktop/src/inventory/reconcile'`

- [ ] **Step 3: Write the implementation**

Create `desktop/src/inventory/reconcile.js`:

```js
// Merges the disk scan with CCTI's install record into display rows. The scan
// always wins: the record adds provenance, never existence. Where the scan could
// not look, a recorded item is "unchecked", not "missing". Pure.

const KIND_ORDER = { skill: 0, plugin: 1, mcp: 2 };
const STATE_ORDER = { missing: 0, duplicate: 1, unchecked: 2, installed: 3, external: 4 };
const SKILL_SCOPE_LABELS = { user: 'Just you', project: 'This project' };

function keyMatches(kind, scannedKey, recordedKey) {
  if (scannedKey === recordedKey) return true;
  return kind === 'plugin' && !recordedKey.includes('@') && scannedKey.split('@')[0] === recordedKey;
}

function entryScopeLabel(entry) {
  return entry.kind === 'skill' ? SKILL_SCOPE_LABELS[entry.scope] || 'Just you' : 'Claude Code';
}

function entryPresent(entry, items, scan) {
  return items.some((item) => {
    if (item.kind !== entry.kind || !keyMatches(item.kind, item.key, entry.key)) return false;
    if (entry.kind !== 'skill') return true;
    if (entry.scope === 'project') return item.scope === 'This project' && scan.projectPath === entry.projectPath;
    return item.scope === 'Just you';
  });
}

function uncheckedReason(entry, scan) {
  if (!scan.observed?.[entry.kind]) return 'claude-code';
  if (entry.kind !== 'skill') return '';
  if (entry.scope === 'project' && (!scan.projectPath || scan.projectPath !== entry.projectPath)) return 'project';
  if ((scan.unreadableSkillScopes || []).includes(entryScopeLabel(entry))) return 'folder';
  return '';
}

function backedUpSinceInstall(entry, resolutions) {
  const installed = Date.parse(entry.installedAt) || 0;
  return resolutions.some((item) => item.kind === entry.kind
    && item.key === entry.key
    && (item.scope || 'user') === entry.scope
    && (item.projectPath || '') === (entry.projectPath || '')
    && (Date.parse(item.resolvedAt) || 0) >= installed);
}

function reinstallPlan(entry, catalog, tracked) {
  const item = catalog.find((candidate) => candidate.id === entry.id);
  const current = Object.prototype.hasOwnProperty.call(tracked, entry.id) ? tracked[entry.id] : null;
  const name = entry.name || entry.id;
  if (!item || !current) {
    return { id: entry.id, available: false, changed: false, message: `${name} is no longer offered by CCTI, so it can’t be reinstalled from here.` };
  }
  const changed = current.key !== entry.key || (Boolean(entry.catalogAction) && item.action !== entry.catalogAction);
  return {
    id: entry.id,
    available: true,
    changed,
    message: changed ? `CCTI now installs ${item.name} differently than when you first installed it. Reinstall uses the current steps.` : '',
  };
}

function reconcileInventory({ scan, ledger, ledgerStatus = 'ok', catalog = [], tracked = {} } = {}) {
  const view = {
    projectPath: String(scan?.projectPath || ''),
    observed: scan?.observed || { skill: true, plugin: false, mcp: false },
    unreadableSkillScopes: Array.isArray(scan?.unreadableSkillScopes) ? scan.unreadableSkillScopes : [],
  };
  const items = Array.isArray(scan?.items) ? scan.items : [];
  const record = ledgerStatus === 'corrupt' ? {} : ledger || {};
  const entries = Array.isArray(record.entries) ? record.entries : [];
  const resolutions = Array.isArray(record.resolutions) ? record.resolutions : [];
  const catalogItems = Array.isArray(catalog) ? catalog : [];

  const groups = new Map();
  for (const item of items) {
    const groupKey = `${item.kind}:${item.key}`;
    groups.set(groupKey, [...(groups.get(groupKey) || []), item]);
  }

  const rows = [];
  for (const [groupKey, copies] of groups) {
    const first = copies[0];
    const matched = entries
      .filter((entry) => entry.kind === first.kind && keyMatches(first.kind, first.key, entry.key) && entryPresent(entry, copies, view))
      .sort((left, right) => (Date.parse(right.installedAt) || 0) - (Date.parse(left.installedAt) || 0));
    const duplicate = copies.length > 1;
    const hashes = new Set(copies.map((copy) => copy.contentHash || ''));
    rows.push({
      rowId: groupKey,
      kind: first.kind,
      key: first.key,
      name: matched[0]?.name || first.name,
      state: duplicate ? 'duplicate' : matched.length ? 'installed' : 'external',
      scope: first.scope,
      origin: first.origin || 'local',
      installedAt: matched[0]?.installedAt || '',
      installedByCcti: matched.length > 0,
      copies: copies.map((copy) => ({ scope: copy.scope, path: copy.path || '' })),
      resolvable: first.kind === 'skill' && duplicate && !hashes.has('') && hashes.size === 1,
      reinstall: null,
      uncheckedReason: '',
    });
  }

  for (const entry of entries) {
    if (entryPresent(entry, items, view)) continue;
    const reason = uncheckedReason(entry, view);
    if (!reason && backedUpSinceInstall(entry, resolutions)) continue;
    rows.push({
      rowId: `record:${entry.id}:${entry.scope}:${entry.projectPath || ''}`,
      kind: entry.kind,
      key: entry.key,
      name: entry.name || entry.id,
      state: reason ? 'unchecked' : 'missing',
      scope: entryScopeLabel(entry),
      origin: 'local',
      installedAt: entry.installedAt,
      installedByCcti: true,
      copies: [],
      resolvable: false,
      reinstall: reason ? null : reinstallPlan(entry, catalogItems, tracked || {}),
      uncheckedReason: reason,
    });
  }

  rows.sort((left, right) => (KIND_ORDER[left.kind] - KIND_ORDER[right.kind])
    || (STATE_ORDER[left.state] - STATE_ORDER[right.state])
    || String(left.name).localeCompare(String(right.name)));
  return { historyStatus: ledgerStatus, rows };
}

module.exports = { reconcileInventory };
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node scripts/test-inventory-reconcile.js`
Expected: PASS

- [ ] **Step 5: Wire it into `npm run check`**

Append ` && node ../scripts/test-inventory-reconcile.js` to `inventory:check`. Append ` && node --check src/inventory/reconcile.js` to `check`.

Run: `cd desktop && npm run inventory:check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add desktop/src/inventory/reconcile.js scripts/test-inventory-reconcile.js desktop/package.json
git commit -m "feat(inventory): reconcile scan and install record into manage rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Manage view model

**Files:**
- Create: `desktop/src/inventory/manage-view.js`
- Create: `scripts/test-inventory-manage-view.js`
- Modify: `desktop/package.json` (`inventory:check`, `check`)

**Interfaces:**
- Consumes: `{ historyStatus, rows: Row[] }` from Task 4.
- Produces: `manageSections(inventory) → { summary: string, notice: null | { text, action: { type: 'reset-history', label } }, sections: { kind, title, rows: ViewRow[] }[] }`.
  - `ViewRow = { rowId, name, badge, tone: 'ok'|'attention'|'neutral', detail, action: null | { type: 'reinstall', label: 'Reinstall', id, note } | { type: 'resolve', label: 'Resolve' } }`.
  - Exported via CommonJS and `window.CCTIManageView`, in the same way as `tool-matcher.js`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-inventory-manage-view.js`:

```js
#!/usr/bin/env node
const assert = require('node:assert/strict');
const { manageSections } = require('../desktop/src/inventory/manage-view');

const base = { key: 'k', scope: 'Just you', origin: 'local', installedAt: '', installedByCcti: false, copies: [], resolvable: false, reinstall: null, uncheckedReason: '' };
const row = (rowId, kind, state, extra = {}) => ({ ...base, rowId, kind, name: rowId, state, ...extra });
const inventory = {
  historyStatus: 'ok',
  rows: [
    row('planning', 'skill', 'installed', { installedAt: '2026-09-14T10:22:31Z', installedByCcti: true }),
    row('ponytail', 'skill', 'missing', { installedByCcti: true, reinstall: { id: 'ponytail', available: true, changed: false, message: '' } }),
    row('retired', 'skill', 'missing', { installedByCcti: true, reinstall: { id: 'retired', available: false, changed: false, message: 'retired is no longer offered by CCTI, so it can’t be reinstalled from here.' } }),
    row('graphify', 'skill', 'duplicate', { resolvable: true, copies: [{ scope: 'Just you', path: '/Users/me/.claude/skills/graphify' }, { scope: 'This project', path: '/work/.claude/skills/graphify' }] }),
    row('notes', 'skill', 'duplicate', { copies: [{ scope: 'Just you', path: '/a' }, { scope: 'This project', path: '/b' }] }),
    row('ops', 'plugin', 'external', { origin: 'claude.ai' }),
    row('mine', 'plugin', 'external'),
    row('repomix', 'mcp', 'missing', { installedByCcti: true, reinstall: { id: 'repomix', available: true, changed: true, message: 'CCTI now installs Repomix differently than when you first installed it. Reinstall uses the current steps.' } }),
    row('playwright', 'mcp', 'unchecked', { uncheckedReason: 'claude-code' }),
    row('proj', 'skill', 'unchecked', { uncheckedReason: 'project' }),
  ],
};
const view = manageSections(inventory);
const find = (id) => view.sections.flatMap((section) => section.rows).find((item) => item.rowId === id);

assert.deepEqual(view.sections.map((section) => section.title), ['Skills', 'Add-ons', 'Connections'], 'one list grouped by kind');
assert.equal(find('planning').badge, 'Installed by CCTI · 2026-09-14');
assert.equal(find('planning').action, null);
assert.deepEqual(find('ponytail').action, { type: 'reinstall', label: 'Reinstall', id: 'ponytail', note: '' });
assert.equal(find('ponytail').badge, 'Missing');
assert.equal(find('retired').action, null, 'no Reinstall for an item CCTI no longer offers');
assert.match(find('retired').detail, /no longer offered/);
assert.match(find('repomix').action.note, /differently/, 'a changed catalog entry is said before acting');
assert.deepEqual(find('graphify').action, { type: 'resolve', label: 'Resolve' });
assert.equal(find('graphify').badge, '2 copies');
assert.equal(find('notes').action, null, 'unverified duplicates are informational');
assert.equal(find('ops').badge, 'From your Claude.ai account');
assert.equal(find('mine').badge, 'Found on this computer');
assert.equal(find('mine').action, null, 'external items are never auto-touched');
assert.equal(find('playwright').badge, 'Not checked');
assert.equal(find('playwright').action, null);
assert.match(find('proj').detail, /Also check a project/);
assert.equal(view.notice, null);
assert.match(view.summary, /10 items/);
assert.match(view.summary, /3 missing/);

// No terminal surface: details never show a path or a command.
for (const item of view.sections.flatMap((section) => section.rows)) {
  assert.doesNotMatch(item.detail, /[\\/]|claude (?:mcp|plugin)|\.json/, `${item.rowId} detail must not expose a path or command`);
  assert.ok(item.detail.length > 0, `${item.rowId} must explain itself`);
}

// Review Focus 2: an unreadable record offers a fresh start and still lists everything.
const corrupt = manageSections({ historyStatus: 'corrupt', rows: [row('mine', 'plugin', 'external')] });
assert.deepEqual(corrupt.notice.action, { type: 'reset-history', label: 'Start a fresh record' });
assert.match(corrupt.notice.text, /still works/);
assert.equal(manageSections({ historyStatus: 'missing', rows: [] }).notice, null, 'a first run is not an error');

const empty = manageSections({ historyStatus: 'ok', rows: [] });
assert.deepEqual(empty.sections, []);
assert.match(empty.summary, /No skills, add-ons, or connections/);
assert.doesNotThrow(() => manageSections(undefined));

console.log('Inventory manage view passed: badges, one action per row, plain-language detail, and the fresh-record offer.');
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node scripts/test-inventory-manage-view.js`
Expected: FAIL with `Cannot find module '../desktop/src/inventory/manage-view'`

- [ ] **Step 3: Write the implementation**

Create `desktop/src/inventory/manage-view.js`:

```js
// Turns reconciled inventory rows into what the Manage list shows: a plain-word
// badge, one sentence of detail, and at most one action. A path or a command is
// never the thing a person acts on. Pure; also loaded by the renderer.

const MANAGE_SECTIONS = [['skill', 'Skills'], ['plugin', 'Add-ons'], ['mcp', 'Connections']];

function installedDate(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : '';
}

function scopeList(copies) {
  return [...new Set((copies || []).map((copy) => copy.scope).filter(Boolean))].join(', ') || 'more than one place';
}

function uncheckedDetail(reason) {
  if (reason === 'project') return 'You installed this into a project that wasn’t part of this check. Choose “Also check a project” to include it.';
  if (reason === 'folder') return 'CCTI couldn’t read the folder this lives in. Nothing was changed. Check again, or run Diagnostics if it keeps happening.';
  return 'CCTI couldn’t ask Claude Code about this right now. Nothing was changed. Check again in a moment.';
}

function rowView(row) {
  if (row.state === 'installed') {
    const date = installedDate(row.installedAt);
    return { badge: date ? `Installed by CCTI · ${date}` : 'Installed by CCTI', tone: 'ok', detail: `Ready for Claude Code (${row.scope}).`, action: null };
  }
  if (row.state === 'missing') {
    const plan = row.reinstall || { available: false, message: '' };
    return {
      badge: 'Missing',
      tone: 'attention',
      detail: ['You installed this with CCTI, but it is no longer on this computer.', plan.message].filter(Boolean).join(' '),
      action: plan.available ? { type: 'reinstall', label: 'Reinstall', id: plan.id, note: plan.changed ? plan.message : '' } : null,
    };
  }
  if (row.state === 'duplicate') {
    return {
      badge: `${row.copies.length} copies`,
      tone: 'attention',
      detail: row.resolvable
        ? `Identical copies are saved in: ${scopeList(row.copies)}. Resolve shows which copy stays before anything moves, and the others go to a backup you can restore.`
        : `Copies with this name are saved in: ${scopeList(row.copies)}. CCTI can’t confirm they are identical, so it won’t move either one.`,
      action: row.resolvable ? { type: 'resolve', label: 'Resolve' } : null,
    };
  }
  if (row.state === 'unchecked') {
    return { badge: 'Not checked', tone: 'neutral', detail: uncheckedDetail(row.uncheckedReason), action: null };
  }
  const fromAccount = row.origin === 'claude.ai';
  return {
    badge: fromAccount ? 'From your Claude.ai account' : 'Found on this computer',
    tone: 'neutral',
    detail: fromAccount ? 'Managed in your Claude.ai account. CCTI will not change it.' : 'CCTI did not install this, so it will not change it.',
    action: null,
  };
}

function manageSections(inventory) {
  const rows = Array.isArray(inventory?.rows) ? inventory.rows : [];
  const sections = MANAGE_SECTIONS
    .map(([kind, title]) => ({ kind, title, rows: rows.filter((row) => row.kind === kind).map((row) => ({ rowId: row.rowId, name: row.name, ...rowView(row) })) }))
    .filter((section) => section.rows.length > 0);
  const missing = rows.filter((row) => row.state === 'missing').length;
  const duplicates = rows.filter((row) => row.state === 'duplicate').length;
  const notes = [missing ? `${missing} missing` : '', duplicates ? `${duplicates} with extra copies` : ''].filter(Boolean);
  const summary = rows.length
    ? `${rows.length} item${rows.length === 1 ? '' : 's'} found${notes.length ? ` — ${notes.join(', ')}` : ''}.`
    : 'No skills, add-ons, or connections were found in the places checked.';
  const notice = inventory?.historyStatus === 'corrupt'
    ? {
      text: 'CCTI couldn’t read its record of what it installed. Everything still works; items are shown as found on this computer. Starting a fresh record keeps a copy of the old one.',
      action: { type: 'reset-history', label: 'Start a fresh record' },
    }
    : null;
  return { summary, notice, sections };
}

const manageViewApi = { manageSections };

if (typeof module !== 'undefined' && module.exports) module.exports = manageViewApi;
if (typeof window !== 'undefined') window.CCTIManageView = manageViewApi;
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node scripts/test-inventory-manage-view.js`
Expected: PASS

- [ ] **Step 5: Wire it into `npm run check`**

Append ` && node ../scripts/test-inventory-manage-view.js` to `inventory:check`. Append ` && node --check src/inventory/manage-view.js` to `check`.

Run: `cd desktop && npm run inventory:check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add desktop/src/inventory/manage-view.js scripts/test-inventory-manage-view.js desktop/package.json
git commit -m "feat(inventory): plain-language manage view with one action per row

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Main-process wiring

**Files:**
- Modify: `desktop/src/main.js`
  - requires near the top (after line 7)
  - `inventoryLedger` next to `terminalPreferencePath` (about line 84)
  - helpers after `installReviewedPlugins` (about line 944)
  - `discoverClaudeSetup` (about lines 2279–2358)
  - `applyCleanup` (about line 2794)
  - `applyAllDuplicateSkills` (about line 2849)
  - the `setup:complete` and `install:run` handlers (about lines 3234 and 3279)
  - a new IPC handler (about line 3381)
- Modify: `desktop/src/preload.js`
- Create: `scripts/test-inventory-main.js`
- Modify: `desktop/package.json` (`inventory:check`)

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - The `setup-manager:discover` result gains `inventory: { historyStatus, rows } | null`.
  - New IPC `inventory:reset-history` → `{ ok: true, preserved: boolean } | { ok: false, error }`.
  - Preload `resetInventoryHistory()`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-inventory-main.js`. It boots `main.js` with a stubbed Electron (the `test-setup-manager.js` pattern) and a fake `claude` written in Node, so it runs on macOS, Linux, and the Windows CI runner.

```js
#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccti-inventory-main-'));
const home = path.join(tempRoot, 'home');
const project = path.join(tempRoot, 'project');
const ledgerFile = path.join(tempRoot, 'inventory.json');
const fakeState = path.join(tempRoot, 'fake-claude-state.json');
const handlers = new Map();
let readyCallback;
const originalAppData = process.env.APPDATA;
const originalLocalAppData = process.env.LOCALAPPDATA;

const electronStub = {
  app: {
    getPath: (name) => (name === 'home' ? home : tempRoot),
    isPackaged: false,
    whenReady: () => ({ then: (callback) => { readyCallback = callback; } }),
    on: () => {},
    quit: () => {},
  },
  BrowserWindow: class {
    static getAllWindows() { return []; }
    constructor() { this.webContents = { send: () => {}, setWindowOpenHandler: () => {}, on: () => {} }; }
    async loadFile() {}
    isDestroyed() { return false; }
  },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true, filePath: '' }) },
  shell: { showItemInFolder: () => true, openPath: async () => '', openExternal: async () => {} },
  Notification: class { static isSupported() { return false; } },
  ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
};

// Prints real Claude Code output shapes; plugin installs change what `plugin list` shows.
const fakeClaudeScript = `
const fs = require('node:fs');
const statePath = ${JSON.stringify(fakeState)};
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const [a, b, c] = process.argv.slice(2);
if (a === '--version') { console.log('claude test'); process.exit(0); }
if (a === 'plugin' && b === 'list') {
  console.log('Installed plugins:\\n');
  for (const id of state.plugins) console.log('  \\u276f ' + id + '\\n    Version: 1.0.0\\n    Scope: user\\n    Status: \\u2714 enabled\\n');
  process.exit(0);
}
if (a === 'plugin' && b === 'install') {
  state.plugins.push(c.includes('@') ? c : c + '@' + c);
  fs.writeFileSync(statePath, JSON.stringify(state));
  process.exit(0);
}
if (a === 'plugin' && b === 'marketplace') process.exit(0);
if (a === 'mcp' && b === 'list') {
  if (state.mcpFails) process.exit(1);
  console.log('Checking MCP server health\\u2026\\n');
  for (const name of state.mcp) console.log(name + ': npx example - \\u2714 Connected');
  process.exit(0);
}
if (a === 'mcp' && b === 'get') process.exit(state.mcp.includes(c) ? 0 : 1);
process.exit(0);
`;

async function writeSkill(folder, body = '# Skill\n') {
  await fsp.mkdir(folder, { recursive: true });
  await fsp.writeFile(path.join(folder, 'SKILL.md'), body, 'utf8');
}

async function setFakeClaude(state) {
  await fsp.writeFile(fakeState, JSON.stringify({ plugins: [], mcp: [], mcpFails: false, ...state }), 'utf8');
}

async function installFakeClaude() {
  const script = path.join(tempRoot, 'fake-claude.js');
  await fsp.writeFile(script, fakeClaudeScript, 'utf8');
  if (process.platform === 'win32') {
    process.env.APPDATA = path.join(tempRoot, 'appdata');
    process.env.LOCALAPPDATA = path.join(tempRoot, 'local-appdata');
    const launcher = path.join(process.env.APPDATA, 'npm', 'claude.cmd');
    await fsp.mkdir(path.dirname(launcher), { recursive: true });
    await fsp.writeFile(launcher, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`, 'utf8');
  } else {
    const launcher = path.join(home, '.local', 'bin', 'claude');
    await fsp.mkdir(path.dirname(launcher), { recursive: true });
    await fsp.writeFile(launcher, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  }
}

const entry = (id, kind, key, extra = {}) => ({ id, kind, key, name: id, scope: 'user', projectPath: '', installedAt: '2026-09-14T10:00:00.000Z', source: 'ccti-catalog', catalogAction: '', ...extra });
const rowFor = (report, key) => report.inventory.rows.find((row) => row.key === key);

async function run() {
  await fsp.mkdir(project, { recursive: true });
  await installFakeClaude();
  await writeSkill(path.join(home, '.claude', 'skills', 'planning-with-files'));
  await writeSkill(path.join(home, '.claude', 'skills', 'twin'), '# Same\n');
  await writeSkill(path.join(project, '.claude', 'skills', 'twin'), '# Same\n');
  await setFakeClaude({ plugins: ['superpowers@superpowers-marketplace'], mcp: ['repomix'] });
  await fsp.writeFile(ledgerFile, JSON.stringify({
    schemaVersion: 1,
    entries: [
      entry('planning-with-files', 'skill', 'planning-with-files'),
      entry('superpowers', 'plugin', 'superpowers@superpowers-marketplace'),
      entry('playwright-mcp', 'mcp', 'playwright'),
    ],
    resolutions: [],
  }), 'utf8');

  Module._load = ((originalLoad) => function patchedLoad(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  })(Module._load);
  require(path.join(root, 'desktop', 'src', 'main.js'));
  await readyCallback();
  const discover = handlers.get('setup-manager:discover');

  // Discovery carries the reconciled inventory.
  let report = await discover(null, { projectPath: project });
  assert.equal(report.inventory.historyStatus, 'ok');
  assert.equal(rowFor(report, 'planning-with-files').state, 'installed');
  assert.equal(rowFor(report, 'superpowers@superpowers-marketplace').state, 'installed');
  assert.equal(rowFor(report, 'playwright').state, 'missing');
  assert.equal(rowFor(report, 'playwright').reinstall.available, true);
  assert.equal(rowFor(report, 'repomix').state, 'external', 'a connection CCTI did not record is outside CCTI');
  assert.equal(rowFor(report, 'twin').state, 'duplicate');
  assert.equal(rowFor(report, 'twin').resolvable, true);

  // Review Focus 1: a failing `mcp list` never turns a recorded connection into Missing.
  await setFakeClaude({ plugins: ['superpowers@superpowers-marketplace'], mcp: ['repomix'], mcpFails: true });
  report = await discover(null, {});
  assert.equal(rowFor(report, 'playwright').state, 'unchecked');

  // Review Focus 5: backing up a duplicate records a resolution, so nothing reads as lost.
  await setFakeClaude({ plugins: ['superpowers@superpowers-marketplace'], mcp: ['repomix'] });
  report = await discover(null, { projectPath: project });
  const review = await handlers.get('setup-manager:review-all-duplicates')(null, { discoveryId: report.discoveryId });
  assert.equal(review.ok, true, review.error);
  const applied = await handlers.get('setup-manager:apply-all-duplicates')(null, { reviewId: review.reviewId });
  assert.equal(applied.ok, true, applied.error);
  const afterBackup = JSON.parse(await fsp.readFile(ledgerFile, 'utf8'));
  assert.ok(afterBackup.resolutions.some((item) => item.key === 'twin' && item.action === 'backup'), 'the backup is recorded as a resolution');

  // Review Focus 4 and 2: install:run records only newly present tracked items, and an
  // unreadable record (a directory where the file should be) is kept aside, not fatal.
  await fsp.rm(ledgerFile, { force: true });
  await fsp.mkdir(ledgerFile);
  const result = await handlers.get('install:run')(null, { selectedIds: ['claude-hud', 'superpowers'], dryRun: false });
  assert.equal(result.ok, true, result.error);
  const recorded = JSON.parse(await fsp.readFile(ledgerFile, 'utf8'));
  assert.deepEqual(recorded.entries.map((item) => item.id), ['claude-hud'], 'superpowers was already present, so it is not claimed as a CCTI install');
  assert.equal(recorded.entries[0].key, 'claude-hud');
  assert.ok(fs.readdirSync(tempRoot).some((name) => name.startsWith('inventory.unreadable-')), 'the unreadable record was kept');

  const preview = await handlers.get('install:run')(null, { selectedIds: ['context7'], dryRun: true });
  assert.equal(preview.ok, true);
  assert.ok(!JSON.parse(await fsp.readFile(ledgerFile, 'utf8')).entries.some((item) => item.id === 'context7'), 'a preview records nothing');

  // Reset: refuses to wipe a readable record, and starts fresh from an unreadable one.
  const reset = handlers.get('inventory:reset-history');
  assert.deepEqual(await reset(null), { ok: true, preserved: false });
  assert.equal(JSON.parse(await fsp.readFile(ledgerFile, 'utf8')).entries.length, 1);
  await fsp.writeFile(ledgerFile, 'not json', 'utf8');
  report = await discover(null, {});
  assert.equal(report.inventory.historyStatus, 'corrupt');
  assert.ok(report.inventory.rows.every((row) => !row.installedByCcti), 'an unreadable record claims nothing');
  assert.deepEqual(await reset(null), { ok: true, preserved: true });
  report = await discover(null, {});
  assert.equal(report.inventory.historyStatus, 'ok');

  console.log('Inventory main wiring passed: discovery rows, unobserved connections, backup resolutions, verified install recording, and record reset.');
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (originalAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = originalAppData;
    if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = originalLocalAppData;
    await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    process.exit(process.exitCode || 0);
  });
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node scripts/test-inventory-main.js`
Expected: FAIL with `TypeError: Cannot read properties of undefined (reading 'historyStatus')` (discovery has no `inventory` yet)

- [ ] **Step 3: Add requires and the ledger accessor**

In `desktop/src/main.js`, after the `release-identity` require (line 7):

```js
const { TRACKED_ITEMS, trackedItem } = require('./inventory/tracked-items');
const { buildScan } = require('./inventory/scanner');
const { createLedgerStore, newlyInstalledEntries, skillBackupResolutions } = require('./inventory/ledger');
const { reconcileInventory } = require('./inventory/reconcile');
```

After `function terminalPreferencePath() { … }`:

```js
let inventoryStore = null;

function inventoryLedger() {
  if (!inventoryStore) inventoryStore = createLedgerStore(path.join(app.getPath('userData'), 'inventory.json'));
  return inventoryStore;
}
```

- [ ] **Step 4: Add the inventory helpers**

After the closing brace of `async function installReviewedPlugins(selectedIds) { … }`:

```js
async function presentTrackedItems(ids, { skillScope = 'global', projectPath = '' } = {}) {
  const tracked = [...new Set(ids)].map((id) => [id, trackedItem(id)]).filter(([, item]) => item);
  const present = new Set();
  if (tracked.length === 0) return present;
  const skillRoot = skillScope === 'project' && projectPath
    ? path.join(projectPath, '.claude', 'skills')
    : path.join(app.getPath('home'), '.claude', 'skills');
  const claude = await claudeStatus();
  const pluginIds = tracked.some(([, item]) => item.kind === 'plugin') ? await installedClaudePluginIds() : [];
  for (const [id, item] of tracked) {
    if (item.kind === 'skill' && await pathExists(path.join(skillRoot, item.key, 'SKILL.md'))) present.add(id);
    if (item.kind === 'plugin' && pluginIsInstalled(pluginIds, item.key)) present.add(id);
    if (item.kind === 'mcp' && await configuredMcpReady(item.key, claude)) present.add(id);
  }
  return present;
}

async function recordCctiInstalls(ids, before, scope = {}) {
  try {
    const after = await presentTrackedItems(ids, scope);
    const entries = newlyInstalledEntries(ids, before, after, { tracked: TRACKED_ITEMS, catalog: await readCatalog(), skillScope: scope.skillScope, projectPath: scope.projectPath });
    if (entries.length > 0) await inventoryLedger().recordInstalls(entries);
  } catch (error) {
    emit('installer:output', { stream: 'stderr', text: `[CCTI] Your tools were installed, but CCTI could not update its record of them: ${error.message}. Check this computer again to see them.\n` });
  }
}

async function recordSkillResolutions(moves, projectPath = '') {
  if (!Array.isArray(moves) || moves.length === 0) return;
  try {
    await inventoryLedger().recordResolutions(skillBackupResolutions(moves, { projectPath }));
  } catch {
    // The record is advisory. The backup move already succeeded and is shown to the user.
  }
}

async function inventoryFromScan(scan) {
  try {
    const [history, catalog] = await Promise.all([inventoryLedger().read(), readCatalog()]);
    return reconcileInventory({ scan, ledger: history.ledger, ledgerStatus: history.status, catalog, tracked: TRACKED_ITEMS });
  } catch {
    return null;
  }
}

async function resetInventoryHistory() {
  try {
    const result = await inventoryLedger().reset();
    return { ok: true, preserved: Boolean(result.preservedAs) };
  } catch {
    return { ok: false, error: 'CCTI could not start a fresh record. Nothing else changed. Restart CCTI and try again.' };
  }
}
```

`configuredMcpReady` only answers for `repomix` and `playwright`. Those are exactly the tracked MCP keys, which Task 1's test pins.

- [ ] **Step 5: Return the inventory from discovery**

In `discoverClaudeSetup`, replace the block that runs `plugin list` / `mcp list`:

```js
  const claude = await claudeStatus();
  let pluginList = null;
  let mcpList = null;
  if (claude.installed) {
    const claudeCommand = claude.path || 'claude';
    const [plugins, connections] = await Promise.all([
      runProcess(claudeCommand, ['plugin', 'list'], { cwd: home, env: claudeProcessEnv() }).catch(() => ({ code: 1, stdout: '' })),
      runProcess(claudeCommand, ['mcp', 'list'], { cwd: home, env: claudeProcessEnv() }).catch(() => ({ code: 1, stdout: '' })),
    ]);
    pluginList = { ok: plugins.code === 0, text: plugins.stdout || '' };
    mcpList = { ok: connections.code === 0, text: connections.stdout || '' };
    if (plugins.code === 0) plugins.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach((name) => findings.push({ id: `plugin-cli:${name}`, type: 'plugin', name, scope: 'Claude Code', path: 'Claude Code', description: 'Reported by Claude Code.' }));
    if (connections.code === 0) connections.stdout.split(/\r?\n/).map((line) => line.trim().split(/\s+/)[0]).filter(Boolean).forEach((name) => findings.push({ id: `connection-cli:${name}`, type: 'connection', name, scope: 'Claude Code', path: 'Claude Code', description: 'Reported by Claude Code.' }));
  }
```

The two `findings.push` lines are unchanged. Only the `let` declarations and the two assignments are new. Then, in the returned object, add after `duplicates,`:

```js
    inventory: await inventoryFromScan(buildScan({ findings: uniqueFindings, pluginList, mcpList, projectPath: resolvedProjectPath })),
```

- [ ] **Step 6: Record skill backups as resolutions**

In `applyCleanup`, replace the success block inside `try`:

```js
    await fs.rename(plan.source, plan.destination);
    const cleanupReport = discoveredSkillCleanup.get(plan.discoveryId);
    cleanupReport?.skills.delete(plan.findingId);
    reviewedCleanupPlans.delete(reviewId);
    await recordSkillResolutions(plan.moves, cleanupReport?.projectPath || '');
    return { ok: true, message: 'The selected skill was moved to a backup folder. No other settings were changed.' };
```

`plan.moves[0]` already has `{ name, scope, source, destination }`.

In `applyAllDuplicateSkills`, change the `finally` block so partial moves are recorded too:

```js
  } finally {
    if (moved.length > 0) await recordSkillResolutions(moved, report.projectPath);
    activeSkillCleanup = false;
  }
```

- [ ] **Step 7: Record verified installs**

In the `install:run` handler, replace the body from `activeInstall = true;` through the end of the handler:

```js
    activeInstall = true;
    emit('installer:state', { running: true });
    let trackedBefore = null;
    try {
      if (!dryRun) trackedBefore = await presentTrackedItems(selectedIds).catch(() => null);
      const reviewedPluginIds = selectedIds.filter((id) => Object.prototype.hasOwnProperty.call(reviewedPluginPlans, id));
      const adapterIds = selectedIds.filter((id) => !Object.prototype.hasOwnProperty.call(reviewedPluginPlans, id));
      const result = adapterIds.length > 0
        ? await spawnInstaller('install', adapterIds, Boolean(dryRun))
        : { code: 0 };
      if (result.code === 0 && !dryRun) await installReviewedPlugins(reviewedPluginIds);
      if (result.code === 0 && dryRun && reviewedPluginIds.length > 0) {
        emit('installer:output', { stream: 'stdout', text: `[CCTI] Preview: ${reviewedPluginIds.length} selected plugin action${reviewedPluginIds.length === 1 ? '' : 's'} would run inside CCTI after Claude Code is ready.\n` });
      }
      return { ok: result.code === 0, code: result.code };
    } catch (error) {
      return { ok: false, error: error.message };
    } finally {
      if (trackedBefore) await recordCctiInstalls(selectedIds, trackedBefore);
      activeInstall = false;
      emit('installer:state', { running: false });
    }
  });
```

In the `setup:complete` handler, after `emit('installer:state', { running: true });`:

```js
    const trackedIds = Object.keys(TRACKED_ITEMS);
    const trackedBefore = fresh ? new Set() : await presentTrackedItems(trackedIds, setupScope).catch(() => null);
```

In its `finally`, before `activeInstall = false;`:

```js
      if (trackedBefore) await recordCctiInstalls(trackedIds, trackedBefore, setupScope);
```

A fresh setup removes the previous configuration first. Everything present afterwards was put there by CCTI, so `before` is empty.

- [ ] **Step 8: Expose the reset channel**

In `main.js`, after `ipcMain.handle('telemetry:report-setup-success', …)`:

```js
  ipcMain.handle('inventory:reset-history', async () => resetInventoryHistory());
```

In `desktop/src/preload.js`, after the `discoverSetup` line:

```js
  resetInventoryHistory: () => ipcRenderer.invoke('inventory:reset-history'),
```

- [ ] **Step 9: Run the tests and confirm they pass**

Run: `node scripts/test-inventory-main.js`
Expected: PASS, printing `Inventory main wiring passed: …`

Run: `node scripts/test-setup-manager.js && node scripts/test-desktop-action-boundaries.js && node scripts/run-duplicate-skill-ui-test.js`
Expected: all PASS (the existing flows are unchanged)

- [ ] **Step 10: Wire it into `npm run check` and commit**

Append ` && node ../scripts/test-inventory-main.js` to `inventory:check`.

Run: `cd desktop && npm run inventory:check`
Expected: PASS

```bash
git add desktop/src/main.js desktop/src/preload.js scripts/test-inventory-main.js desktop/package.json
git commit -m "feat(inventory): record verified installs and backups; return inventory from the checkup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Manage list in the Setup Manager

**Files:**
- Modify: `desktop/src/renderer/index.html` (after `#setup-manager-summary`, about line 167; script tags about line 497)
- Modify: `desktop/src/renderer/app.js` (element constants near line 103; `renderSetupManager` line 1885; `scanSetup` line 2113; listeners near line 2521)
- Modify: `desktop/src/renderer/styles.css` (after `.cleanup-actions-status`, line 224)
- Modify: `scripts/validate-desktop-ui.js`

**Interfaces:**
- Consumes: `window.CCTIManageView.manageSections` (Task 5); `report.inventory` and `window.installer.resetInventoryHistory` (Task 6); existing `window.installer.runInstall`, `openDuplicateSkillDialog`, `scanSetup`, `appendOutput`, `updateSummary`, `state.catalog`, and `state.running`.
- Produces: the `#tool-inventory` section and `renderToolInventory(inventory)`.

- [ ] **Step 1: Write the failing contract check**

In `scripts/validate-desktop-ui.js`, append before the final success `console.log`:

```js
const inventoryContract = [
  [html.includes('id="tool-inventory"'), 'the Manage list section must exist inside the Setup Manager'],
  [html.indexOf('id="tool-inventory"') > html.indexOf('id="setup-manager"') && html.indexOf('id="tool-inventory"') < html.indexOf('id="cleanup-actions"'), 'the Manage list must sit above the cleanup actions'],
  [/<script src="\.\.\/inventory\/manage-view\.js"><\/script>\s*<script src="app\.js">/.test(html), 'manage-view.js must load before app.js'],
  [/renderToolInventory\(report\?\.inventory\)/.test(renderer), 'renderSetupManager must draw the Manage list from report.inventory'],
  [/window\.CCTIManageView\.manageSections/.test(renderer), 'the renderer must use the tested view model'],
  [/action\.type !== 'reinstall'[\s\S]*?window\.confirm\([\s\S]*?window\.installer\.runInstall\(\{ selectedIds: \[tool\.id\]/.test(renderer), 'Reinstall must confirm, then use the existing install path for that one tool'],
  [/action\.type === 'resolve'[\s\S]*?openDuplicateSkillDialog\(/.test(renderer), 'Resolve must open the existing reviewed duplicate flow'],
  [main.includes("ipcMain.handle('inventory:reset-history'"), 'main must handle inventory:reset-history'],
];
for (const [ok, message] of inventoryContract) if (!ok) throw new Error(message);
```

Run: `node scripts/validate-desktop-ui.js`
Expected: FAIL with `the Manage list section must exist inside the Setup Manager`

- [ ] **Step 2: Add the markup**

In `index.html`, immediately after `<p id="setup-manager-summary" class="manager-summary">Nothing has been checked yet.</p>`:

```html
        <section id="tool-inventory" class="tool-inventory is-hidden" aria-labelledby="tool-inventory-heading">
          <div class="tool-inventory-heading">
            <p class="eyebrow">WHAT YOU HAVE</p>
            <h3 id="tool-inventory-heading">Your skills, add-ons, and connections</h3>
            <p id="tool-inventory-summary">Nothing has been checked yet.</p>
          </div>
          <div id="tool-inventory-notice" class="tool-inventory-notice" role="status" hidden>
            <p id="tool-inventory-notice-text"></p>
            <button id="tool-inventory-reset-button" class="button button-secondary" type="button">Start a fresh record</button>
          </div>
          <div id="tool-inventory-list" class="tool-inventory-list"></div>
          <p class="tool-inventory-note">Settings files, runtimes, and project packages are listed read-only in the full checkup inventory below. Having several of them is normal.</p>
          <p id="tool-inventory-status" class="cleanup-actions-status" role="status" aria-live="polite"></p>
        </section>
```

Change the script tags at the end of `<body>` to:

```html
    <script src="../tool-matcher.js"></script>
    <script src="../project-interview.js"></script>
    <script src="../inventory/manage-view.js"></script>
    <script src="app.js"></script>
```

- [ ] **Step 3: Render the list and wire its actions**

In `app.js`, after `const reviewDuplicateSkillsButton = …` (line 112):

```js
const toolInventoryElement = document.querySelector('#tool-inventory');
const toolInventorySummaryElement = document.querySelector('#tool-inventory-summary');
const toolInventoryNoticeElement = document.querySelector('#tool-inventory-notice');
const toolInventoryNoticeTextElement = document.querySelector('#tool-inventory-notice-text');
const toolInventoryResetButton = document.querySelector('#tool-inventory-reset-button');
const toolInventoryListElement = document.querySelector('#tool-inventory-list');
const toolInventoryStatusElement = document.querySelector('#tool-inventory-status');
```

Immediately before `function renderSetupManager(report) {`:

```js
function renderToolInventory(inventory) {
  if (!inventory || !window.CCTIManageView) {
    toolInventoryElement.classList.add('is-hidden');
    return;
  }
  const view = window.CCTIManageView.manageSections(inventory);
  toolInventoryElement.classList.remove('is-hidden');
  toolInventorySummaryElement.textContent = view.summary;
  toolInventoryNoticeElement.hidden = !view.notice;
  toolInventoryNoticeTextElement.textContent = view.notice?.text || '';
  toolInventoryListElement.replaceChildren(...view.sections.map((section) => {
    const group = document.createElement('section');
    group.className = 'tool-inventory-group';
    const heading = document.createElement('h4');
    heading.textContent = section.title;
    const list = document.createElement('ul');
    list.className = 'tool-inventory-rows';
    list.append(...section.rows.map((row) => {
      const item = document.createElement('li');
      item.className = `tool-inventory-row tool-inventory-${row.tone}`;
      const name = document.createElement('strong');
      name.textContent = row.name;
      const badge = document.createElement('span');
      badge.className = 'tool-inventory-badge';
      badge.textContent = row.badge;
      const detail = document.createElement('p');
      detail.textContent = row.detail;
      item.append(name, badge, detail);
      if (row.action) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'button button-secondary';
        button.textContent = row.action.label;
        button.setAttribute('aria-label', `${row.action.label} ${row.name}`);
        button.addEventListener('click', () => runInventoryAction(row.action, row.name, button));
        item.append(button);
      }
      return item;
    }));
    group.append(heading, list);
    return group;
  }));
}

async function runInventoryAction(action, name, button) {
  if (action.type === 'resolve') {
    openDuplicateSkillDialog(state.managerReport?.duplicates || []);
    return;
  }
  if (action.type !== 'reinstall' || state.running) return;
  const tool = state.catalog.find((item) => item.id === action.id);
  if (!tool) {
    toolInventoryStatusElement.textContent = `${name} is no longer offered by CCTI, so it can’t be reinstalled from here.`;
    return;
  }
  const note = action.note ? `${action.note}\n\n` : '';
  if (!window.confirm(`Reinstall ${tool.name}?\n\n${note}CCTI uses its current install steps for this one tool. Nothing else is changed.`)) return;
  button.disabled = true;
  state.running = true;
  updateSummary();
  toolInventoryStatusElement.textContent = `Reinstalling ${tool.name}…`;
  appendOutput(`Reinstalling ${tool.name}…\n`);
  try {
    const result = await window.installer.runInstall({ selectedIds: [tool.id], dryRun: false });
    toolInventoryStatusElement.textContent = result.ok
      ? `${tool.name} was reinstalled.`
      : `${tool.name} could not be reinstalled. Open the activity details to see what happened, then select Reinstall again.`;
  } finally {
    state.running = false;
    updateSummary();
    await scanSetup();
  }
}

async function resetToolInventoryRecord() {
  toolInventoryResetButton.disabled = true;
  try {
    const result = await window.installer.resetInventoryHistory();
    toolInventoryStatusElement.textContent = result.ok
      ? 'Started a fresh record. A copy of the old one was kept.'
      : result.error;
    if (result.ok) await scanSetup();
  } finally {
    toolInventoryResetButton.disabled = false;
  }
}
```

In `renderSetupManager`, after `state.managerReport = report;`:

```js
  renderToolInventory(report?.inventory);
```

In `scanSetup`, after `setupManagerResultsElement.replaceChildren();`:

```js
  toolInventoryElement.classList.add('is-hidden');
```

Next to `document.querySelector('#scan-setup-button').addEventListener('click', scanSetup);`:

```js
toolInventoryResetButton.addEventListener('click', resetToolInventoryRecord);
```

- [ ] **Step 4: Add styles**

In `styles.css`, after the `.cleanup-actions-status` rule:

```css
.tool-inventory { margin-top: 16px; padding: 16px; border: 1px solid #31596b; border-radius: 10px; background: #0d1d2c; }
.tool-inventory-heading h3 { margin: 2px 0 6px; color: #d5f5f2; }
.tool-inventory-heading p { margin: 0; color: #b4d0d7; font-size: .85rem; }
.tool-inventory-notice { display: grid; gap: 8px; margin-top: 12px; padding: 12px; border: 1px solid #7a6a36; border-radius: 9px; background: #231f12; color: #f1e3b5; font-size: .83rem; }
.tool-inventory-notice p { margin: 0; }
.tool-inventory-notice .button { justify-self: start; }
.tool-inventory-group h4 { margin: 16px 0 8px; color: #d5f5f2; font-size: .92rem; }
.tool-inventory-rows { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.tool-inventory-row { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 4px 12px; padding: 10px 12px; border: 1px solid #28495a; border-radius: 8px; background: #0b1d2a; }
.tool-inventory-row strong { color: #e6f7f5; font-size: .88rem; overflow-wrap: anywhere; }
.tool-inventory-row p { grid-column: 1 / -1; margin: 0; color: #b4d0d7; font-size: .8rem; line-height: 1.45; }
.tool-inventory-row .button { grid-column: 2; grid-row: 1; }
.tool-inventory-badge { justify-self: start; padding: 2px 8px; border-radius: 999px; background: #1b3442; color: #cfe7ea; font-size: .74rem; }
.tool-inventory-ok .tool-inventory-badge { background: #143a2f; color: #bdf0d9; }
.tool-inventory-attention { border-color: #7a6a36; }
.tool-inventory-attention .tool-inventory-badge { background: #3a3218; color: #f5e3a8; }
.tool-inventory-note { margin: 12px 0 0; color: #9fbcc4; font-size: .78rem; }
```

- [ ] **Step 5: Run the checks and confirm they pass**

Run: `node scripts/validate-desktop-ui.js`
Expected: PASS

Run: `cd desktop && npm run check`
Expected: every step passes, ending with `node --check` output and no errors.

- [ ] **Step 6: See it working**

Run the app from `desktop/` with `npm start`, then select "Check this computer". Expected:
- "Your skills, add-ons, and connections" appears above "Clean up or remove something".
- Claude.ai connectors show "From your Claude.ai account".
- Nothing shows "Missing" on a machine with no `inventory.json` yet.

Capture a screenshot for the review.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/renderer/index.html desktop/src/renderer/app.js desktop/src/renderer/styles.css scripts/validate-desktop-ui.js
git commit -m "feat(inventory): show the Manage list with Reinstall and Resolve in the Setup Manager

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Out of scope (plan 3 or later)

- Plugin and MCP duplicate detection and resolvers, and the shared resolver interface.
- Choosing a keeper for unverified same-name skills. Until then, CCTI only lists both copies.
- The silent TTL refresh and plain-language replacements for "Run the checkup again" in the existing cleanup flows.
- Fixing the older `Full checkup inventory` plugin and connection parsing in `discoverClaudeSetup`, which lists `Version:`/`Scope:` lines as add-ons. The Manage list uses the new parsers; the old list is unchanged here so its existing tests keep passing. Worth a small follow-up that switches it to `parsePluginList`/`parseMcpList`.
