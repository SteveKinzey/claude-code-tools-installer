# CCTI Duplicate Resolution Implementation Plan (plan 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect duplicate MCP connections and duplicate add-ons, and resolve them safely from the Manage list. CCTI keeps the copy Claude Code actually uses (per documented precedence) or asks when there is no documented rule. Also fix the skill keeper to match Claude Code's documented rule, and replace "this review has expired" scolding with silent re-verification.

**Architecture:** Three new pure modules under `desktop/src/inventory/`:
- `config-scan.js` reads MCP scopes from config JSON text and add-on installs from `claude plugin list --json`.
- `duplicates.js` groups duplicates and names the keeper by documented precedence.
- `resolvers.js` turns a group plus a chosen keeper into a list of reversible CLI changes with plain-language labels.

`main.js` gains:
- discovery reads the config files and `plugin list --json`;
- two IPC handlers (`inventory:review-resolution`, `inventory:apply-resolution`) with check-then-act re-verification;
- resolution recording.

The renderer adds one focused Resolve dialog for add-on and connection duplicates. Skill duplicates keep the existing reviewed backup flow, with a corrected keeper.

**Tech Stack:** Plain Node/CommonJS plus browser-global modules, an Electron renderer, and plain `node:assert` tests under `scripts/`, run by `cd desktop && npm run check` on macOS, Linux, and Windows CI.

**Spec:** `docs/ccti-tool-management-design-2026-09-23.md`, section "Duplicate resolution" and the "Remove friction" table. Precedence facts: `docs/claude-code-precedence-2026-09-26.md`. They are researched from code.claude.com docs and every one is cited.

## Global Constraints

- Keeper rule from the spec: "CCTI keeps the copy Claude Code actually resolves at runtime and backs up the shadowed ones. Removing the winning copy would silently change behavior."
- Precedence and asking, also from the spec: "The precedence order must be read from Claude Code's documented resolution rules per kind … and encoded in one place … Until that order is verified for a given kind, CCTI does not guess: it presents both locations and asks the user which to keep." "The manage screen names the keeper before the user confirms in either case."
  - "One place" means `desktop/src/inventory/duplicates.js`.
  - MCP local, project, and user duplicates are verified by name (local > project > user).
  - Skills are verified: personal beats project.
  - Add-ons offered by two marketplaces are **not documented**, so CCTI asks.
- Removal semantics, per the spec's table:
  - An MCP duplicate is removed from exactly one scope with `claude mcp remove <name> --scope <scope>`, always passing `--scope`. CCTI never hand-edits `.claude.json`.
  - An add-on duplicate is resolved by **disabling** the other install with `claude plugin disable <name@marketplace> --scope <scope>`. That is reversible with `enable`. CCTI never uninstalls and never deletes plugin cache files.
  - A skill duplicate is moved to a timestamped backup (the existing flow). It is never deleted.
- Check-then-act, from the spec: "No resolver acts on a stale plan." At apply time CCTI re-reads the current state. It proceeds only if the group is unchanged; otherwise it returns the updated plan and changes nothing.
- The spec's "Refresh silently instead of scolding" and "Plain language, or no message at all" rules:
  - A review is not rejected for its age alone when re-verification passes.
  - User-facing messages never say "Run the checkup again". The button is called "Check this computer", so messages say "Check this computer again".
- No terminal surface: CLI arguments are built only in `main.js` from verified data, and are never shown as the thing the user acts on. Technical detail goes to the activity log.
- Errors state a next action. Raw CLI stderr is logged, not shown as the message.
- Claude.ai connectors and add-on-provided connections are informational here. Claude Code already hides a connector shadowed by an added server, and add-on connections are managed through their add-on. CCTI does not remove them.
- Tests are cross-platform and CRLF-safe. Fake `claude` binaries are Node scripts.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A connection defined identically at local and user scope (the same name).** Expect CCTI to keep the user copy, which applies everywhere, and to remove only the local copy with `--scope local`. Nothing stops working anywhere. This is superseded during execution; see `docs/claude-code-precedence-2026-09-26.md`. The original "keep local, remove user" would have removed the connection from every other folder (Tasks 2, 3, 5).
2. **The same add-on from two marketplaces, both enabled.** Expect no automatic keeper: the user must pick one, and CCTI disables only the other, reversibly (Tasks 2, 3, 5, 6).
3. **Something changed between review and apply**, such as the copy already being removed in a terminal, or a third copy added. Expect nothing to run and the updated situation to be shown (Task 5).
4. **Identical personal and project copies of a skill.** Expect CCTI to keep the personal copy, so the skill doesn't disappear from other projects (Task 4).
5. **A review left open for over 10 minutes, with nothing changed.** Expect Apply to work without an "expired" message (Tasks 4, 5).

---

## File Structure

| File | Responsibility |
|---|---|
| `desktop/src/inventory/config-scan.js` (create) | Pure: MCP definitions per scope from config JSON text; add-on installs from `plugin list --json` text. |
| `desktop/src/inventory/duplicates.js` (create) | Pure: group duplicates, name the keeper by documented precedence, or mark `needsChoice`. The one place precedence is encoded. |
| `desktop/src/inventory/resolvers.js` (create) | Pure: group + keeper → plan of changes (CLI args + plain labels + undo text), and a fingerprint for check-then-act. |
| `desktop/src/inventory/reconcile.js` (modify) | Duplicate groups for add-ons and connections become `duplicate` rows with a `resolution` summary. |
| `desktop/src/inventory/manage-view.js` (modify) | Plain text and a Resolve action for add-on and connection duplicates. |
| `desktop/src/main.js` (modify) | Read config + `plugin list --json` in discovery; review/apply IPC; skill keeper; silent re-verify; message wording. |
| `desktop/src/preload.js` (modify) | `reviewResolution`, `applyResolution`. |
| `desktop/src/renderer/{index.html,app.js,styles.css}` (modify) | Resolve dialog. |
| `scripts/test-inventory-config-scan.js`, `test-inventory-duplicates.js`, `test-inventory-resolvers.js`, `test-inventory-resolution-main.js` (create) | Tests. |
| `desktop/package.json` (modify) | Add the new tests to `inventory:check`, and `node --check` for the new files. |

---

### Task 1: Config scan

**Files:**
- Create: `desktop/src/inventory/config-scan.js`
- Create: `scripts/test-inventory-config-scan.js`
- Modify: `desktop/package.json`

**Interfaces:**
- `mcpDefinitions({ claudeJsonText, projectMcpJsonText, homePath, projectPath }) → { ok: boolean, definitions: McpDefinition[] }`:
  - `McpDefinition = { name, key /* lowercase name */, scope: 'user'|'local'|'project', projectPath: string /* '' for user */, fingerprint: string /* JSON of the definition, key-sorted */ }`.
  - user = top-level `mcpServers` in `~/.claude.json`.
  - local = `projects[<homePath>].mcpServers`, and `projects[<projectPath>].mcpServers` when a project was checked. Each carries its projectPath.
  - project = `mcpServers` in `<projectPath>/.mcp.json`.
  - A config file that is missing contributes nothing (the text is `null`).
  - A config file that can't be parsed sets `ok: false` and contributes nothing. It never throws.
- `pluginInstalls(jsonText) → { ok: boolean, installs: PluginInstall[] }`:
  - `PluginInstall = { id /* name@marketplace, lowercase */, name, marketplace, scope: 'user'|'project'|'local'|string, enabled: boolean, projectPath: string }`.
  - Input that isn't a JSON array gives `ok: false`.
  - Entries without a string `id` are skipped.

- [ ] **Step 1: Write the failing test.** Create `scripts/test-inventory-config-scan.js`:

```js
#!/usr/bin/env node
const assert = require('node:assert/strict');
const { mcpDefinitions, pluginInstalls } = require('../desktop/src/inventory/config-scan');

const home = '/Users/me';
const project = '/work/app';
const claudeJsonText = JSON.stringify({
  mcpServers: { playwright: { command: 'npx', args: ['@playwright/mcp@latest'] }, docs: { type: 'http', url: 'https://x.test' } },
  projects: {
    [home]: { mcpServers: { playwright: { args: ['@playwright/mcp@latest'], command: 'npx' }, repomix: { command: 'npx', args: ['-y', 'repomix', '--mcp'] } } },
    [project]: { mcpServers: { Docs: { type: 'http', url: 'https://y.test' } } },
    '/elsewhere': { mcpServers: { unrelated: { command: 'x' } } },
  },
});
const projectMcpJsonText = JSON.stringify({ mcpServers: { docs: { type: 'http', url: 'https://z.test' } } });

const all = mcpDefinitions({ claudeJsonText, projectMcpJsonText, homePath: home, projectPath: project });
assert.equal(all.ok, true);
const rows = all.definitions.map((d) => [d.key, d.scope, d.projectPath]).sort((a, b) => (a.join('|') < b.join('|') ? -1 : 1));
assert.deepEqual(rows, [
  ['docs', 'local', project],
  ['docs', 'project', project],
  ['docs', 'user', ''],
  ['playwright', 'local', home],
  ['playwright', 'user', ''],
  ['repomix', 'local', home],
], 'user, local (home and the checked project), and project scopes are all read; other projects are ignored');
const [userPw, localPw] = ['user', 'local'].map((scope) => all.definitions.find((d) => d.key === 'playwright' && d.scope === scope));
assert.equal(userPw.fingerprint, localPw.fingerprint, 'fingerprints ignore key order');
assert.equal(all.definitions.find((d) => d.key === 'docs' && d.scope === 'local').name, 'Docs', 'the original spelling is kept as the name');

const noProject = mcpDefinitions({ claudeJsonText, projectMcpJsonText: null, homePath: home, projectPath: '' });
assert.ok(noProject.definitions.every((d) => d.projectPath !== project), 'without a checked project only home-local and user are read');
assert.deepEqual(mcpDefinitions({ claudeJsonText: null, projectMcpJsonText: null, homePath: home, projectPath: '' }), { ok: true, definitions: [] }, 'missing files are empty, not errors');
const broken = mcpDefinitions({ claudeJsonText: '{"mcpServers":', projectMcpJsonText: null, homePath: home, projectPath: '' });
assert.equal(broken.ok, false, 'an unreadable config is reported, not thrown');
assert.deepEqual(broken.definitions, []);
assert.doesNotThrow(() => mcpDefinitions({ claudeJsonText: '[]', projectMcpJsonText: '"x"', homePath: home, projectPath: project }));

const pluginsText = JSON.stringify([
  { id: 'Foo@market-a', scope: 'user', enabled: true, version: '1.0.0' },
  { id: 'foo@market-b', scope: 'project', enabled: false, projectPath: project },
  { id: 'claude-hud@claude-hud', scope: 'user', enabled: true },
  { scope: 'user', enabled: true },
]);
const installs = pluginInstalls(pluginsText);
assert.equal(installs.ok, true);
assert.deepEqual(installs.installs.map((i) => [i.id, i.name, i.marketplace, i.scope, i.enabled, i.projectPath]), [
  ['foo@market-a', 'foo', 'market-a', 'user', true, ''],
  ['foo@market-b', 'foo', 'market-b', 'project', false, project],
  ['claude-hud@claude-hud', 'claude-hud', 'claude-hud', 'user', true, ''],
]);
assert.equal(pluginInstalls('not json').ok, false);
assert.equal(pluginInstalls('{"id":"x"}').ok, false, 'a non-array is not a plugin list');

console.log('Inventory config scan passed: MCP scopes from config files and add-on installs from plugin list --json.');
```

- [ ] **Step 2: Run the test and confirm it fails** (module not found).

- [ ] **Step 3: Implement** `desktop/src/inventory/config-scan.js`:

```js
// Reads where each MCP connection is defined (user, local, project) from Claude
// Code's own config files, and which add-ons are installed from
// `claude plugin list --json`. Pure: callers pass file text in. CCTI only reads
// these files; changes always go through the claude CLI.

function parseObject(text) {
  if (text === null || text === undefined) return { ok: true, value: null };
  try {
    const value = JSON.parse(text);
    return { ok: true, value: value && typeof value === 'object' && !Array.isArray(value) ? value : null };
  } catch {
    return { ok: false, value: null };
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function serversOf(container, scope, projectPath) {
  const servers = container && typeof container.mcpServers === 'object' && container.mcpServers && !Array.isArray(container.mcpServers) ? container.mcpServers : {};
  return Object.entries(servers).map(([name, definition]) => ({
    name,
    key: name.toLowerCase(),
    scope,
    projectPath,
    fingerprint: stableJson(definition),
  }));
}

function mcpDefinitions({ claudeJsonText = null, projectMcpJsonText = null, homePath = '', projectPath = '' } = {}) {
  const claudeJson = parseObject(claudeJsonText);
  const projectJson = parseObject(projectMcpJsonText);
  const definitions = [];
  const config = claudeJson.value;
  if (config) {
    definitions.push(...serversOf(config, 'user', ''));
    const projects = config.projects && typeof config.projects === 'object' ? config.projects : {};
    for (const localPath of [...new Set([homePath, projectPath].filter(Boolean))]) {
      definitions.push(...serversOf(projects[localPath], 'local', localPath));
    }
  }
  if (projectPath && projectJson.value) definitions.push(...serversOf(projectJson.value, 'project', projectPath));
  return { ok: claudeJson.ok && projectJson.ok, definitions };
}

function pluginInstalls(jsonText) {
  let list;
  try {
    list = JSON.parse(jsonText);
  } catch {
    return { ok: false, installs: [] };
  }
  if (!Array.isArray(list)) return { ok: false, installs: [] };
  const installs = list
    .filter((entry) => entry && typeof entry.id === 'string' && entry.id.includes('@'))
    .map((entry) => {
      const id = entry.id.toLowerCase();
      const [name, marketplace] = id.split('@');
      return {
        id,
        name,
        marketplace,
        scope: typeof entry.scope === 'string' ? entry.scope : 'user',
        enabled: entry.enabled !== false,
        projectPath: typeof entry.projectPath === 'string' ? entry.projectPath : '',
      };
    });
  return { ok: true, installs };
}

module.exports = { mcpDefinitions, pluginInstalls, stableJson };
```

- [ ] **Step 4: Run the test and confirm it passes.**

- [ ] **Step 5: Wire it into `npm run check`.** Append `&& node ../scripts/test-inventory-config-scan.js` to `inventory:check`, and ` && node --check src/inventory/config-scan.js` to `check`. Run `cd desktop && npm run inventory:check`.

- [ ] **Step 6: Commit.** Message: `feat(inventory): read MCP scopes and add-on installs for duplicate detection`.

---

### Task 2: Duplicate groups and documented precedence

**Files:**
- Create: `desktop/src/inventory/duplicates.js`
- Create: `scripts/test-inventory-duplicates.js`
- Modify: `desktop/package.json`

**Interfaces:**
- `MCP_SCOPE_PRECEDENCE = ['local', 'project', 'user']`. Highest first; see `docs/claude-code-precedence-2026-09-26.md`.
- `SKILL_SCOPE_PRECEDENCE = ['Just you', 'This project']`. Personal beats project.
- `mcpDuplicateGroups(definitions) → Group[]`:
  - Groups by `key` where there are ≥ 2 definitions.
  - `Group = { kind: 'mcp', key, name, copies: [{ scope, projectPath, fingerprint, label }], keeper: 0 /* index into copies, sorted by precedence */, needsChoice: false, identical: boolean }`.
  - Copies are ordered by precedence, so `keeper` is always 0.
  - `label` is the plain scope label:
    - local → `'Only you, in this folder'` when projectPath is home, else `'Only you, in this project'`;
    - project → `'Everyone on this project'`;
    - user → `'Just you, everywhere'`.
- `pluginDuplicateGroups(installs) → Group[]`:
  - Considers **enabled** installs only.
  - Groups by `name` where the group spans ≥ 2 distinct `marketplace` values.
  - `Group = { kind: 'plugin', key: name, name, copies: [{ id, scope, projectPath, marketplace, label }], keeper: null, needsChoice: true, identical: false }`.
  - `label` is `'<marketplace> (<Just you|This project|Only you in this project>)'`.
  - The same id at two scopes is **not** a duplicate: settings precedence already picks one value.
- `compareSkillKeeper(left, right)`:
  - A comparator for skill copies. Personal (`'Just you'`) sorts before `'This project'`.
  - Within the same scope, the newer `updatedAt` first.
  - Then `path` ascending.

- [ ] **Step 1: Write the failing test.** Create `scripts/test-inventory-duplicates.js`:

```js
#!/usr/bin/env node
const assert = require('node:assert/strict');
const { MCP_SCOPE_PRECEDENCE, mcpDuplicateGroups, pluginDuplicateGroups, compareSkillKeeper } = require('../desktop/src/inventory/duplicates');

assert.deepEqual(MCP_SCOPE_PRECEDENCE, ['local', 'project', 'user']);
const home = '/Users/me';
const defs = [
  { name: 'playwright', key: 'playwright', scope: 'user', projectPath: '', fingerprint: 'a' },
  { name: 'playwright', key: 'playwright', scope: 'local', projectPath: home, fingerprint: 'a' },
  { name: 'docs', key: 'docs', scope: 'user', projectPath: '', fingerprint: 'x' },
  { name: 'docs', key: 'docs', scope: 'project', projectPath: '/work/app', fingerprint: 'y' },
  { name: 'Docs', key: 'docs', scope: 'local', projectPath: '/work/app', fingerprint: 'z' },
  { name: 'solo', key: 'solo', scope: 'user', projectPath: '', fingerprint: 's' },
];
const groups = mcpDuplicateGroups(defs, { homePath: home });
assert.deepEqual(groups.map((g) => g.key).sort(), ['docs', 'playwright'], 'single definitions are not duplicates');
const pw = groups.find((g) => g.key === 'playwright');
assert.deepEqual(pw.copies.map((c) => c.scope), ['local', 'user'], 'copies are ordered by documented precedence');
assert.equal(pw.keeper, 0);
assert.equal(pw.needsChoice, false);
assert.equal(pw.identical, true);
assert.equal(pw.copies[0].label, 'Only you, in this folder');
assert.equal(pw.copies[1].label, 'Just you, everywhere');
const docs = groups.find((g) => g.key === 'docs');
assert.deepEqual(docs.copies.map((c) => c.scope), ['local', 'project', 'user']);
assert.equal(docs.copies[0].label, 'Only you, in this project');
assert.equal(docs.copies[1].label, 'Everyone on this project');
assert.equal(docs.identical, false);

const installs = [
  { id: 'foo@market-a', name: 'foo', marketplace: 'market-a', scope: 'user', enabled: true, projectPath: '' },
  { id: 'foo@market-b', name: 'foo', marketplace: 'market-b', scope: 'project', enabled: true, projectPath: '/work/app' },
  { id: 'bar@one', name: 'bar', marketplace: 'one', scope: 'user', enabled: true, projectPath: '' },
  { id: 'bar@two', name: 'bar', marketplace: 'two', scope: 'user', enabled: false, projectPath: '' },
  { id: 'baz@m', name: 'baz', marketplace: 'm', scope: 'user', enabled: true, projectPath: '' },
  { id: 'baz@m', name: 'baz', marketplace: 'm', scope: 'project', enabled: true, projectPath: '/work/app' },
];
const pgroups = pluginDuplicateGroups(installs);
assert.deepEqual(pgroups.map((g) => g.key), ['foo'], 'only enabled installs from two marketplaces are duplicates; one id at two scopes is not');
assert.equal(pgroups[0].needsChoice, true, 'there is no documented rule, so the user chooses');
assert.equal(pgroups[0].keeper, null);
assert.deepEqual(pgroups[0].copies.map((c) => c.label), ['market-a (Just you)', 'market-b (This project)']);

const personal = { scope: 'Just you', updatedAt: '2026-01-01T00:00:00Z', path: '/h/s' };
const projectNewer = { scope: 'This project', updatedAt: '2026-09-01T00:00:00Z', path: '/p/s' };
assert.ok(compareSkillKeeper(personal, projectNewer) < 0, 'personal beats project even when the project copy is newer');
const older = { scope: 'Just you', updatedAt: '2026-01-01T00:00:00Z', path: '/h/b' };
const newer = { scope: 'Just you', updatedAt: '2026-05-01T00:00:00Z', path: '/h/a' };
assert.ok(compareSkillKeeper(newer, older) < 0, 'within one scope the newer copy comes first');

assert.deepEqual(mcpDuplicateGroups([]), []);
assert.deepEqual(pluginDuplicateGroups(undefined), []);
console.log('Inventory duplicates passed: documented MCP precedence, add-on choice, and the personal-first skill keeper.');
```

- [ ] **Step 2: Run the test and confirm it fails.**

- [ ] **Step 3: Implement** `desktop/src/inventory/duplicates.js`:

```js
// The one place CCTI encodes which duplicate Claude Code actually uses. Every rule
// here is documented; see docs/claude-code-precedence-2026-09-26.md. Where Claude
// Code documents no rule (the same add-on from two marketplaces), CCTI does not
// guess: the group needs the user's choice. Pure.

const MCP_SCOPE_PRECEDENCE = ['local', 'project', 'user'];
const SKILL_SCOPE_PRECEDENCE = ['Just you', 'This project'];
const PLUGIN_SCOPE_LABELS = { user: 'Just you', project: 'This project', local: 'Only you in this project' };

function mcpLabel(definition, homePath) {
  if (definition.scope === 'user') return 'Just you, everywhere';
  if (definition.scope === 'project') return 'Everyone on this project';
  return definition.projectPath && definition.projectPath === homePath ? 'Only you, in this folder' : 'Only you, in this project';
}

function groupBy(items, keyOf) {
  const groups = new Map();
  for (const item of items) groups.set(keyOf(item), [...(groups.get(keyOf(item)) || []), item]);
  return groups;
}

function mcpDuplicateGroups(definitions, { homePath } = {}) {
  const list = Array.isArray(definitions) ? definitions : [];
  const home = homePath || (list.find((d) => d.scope === 'local')?.projectPath ?? '');
  return [...groupBy(list, (d) => d.key)]
    .filter(([, copies]) => copies.length > 1)
    .map(([key, copies]) => {
      const ordered = [...copies].sort((a, b) => MCP_SCOPE_PRECEDENCE.indexOf(a.scope) - MCP_SCOPE_PRECEDENCE.indexOf(b.scope));
      return {
        kind: 'mcp',
        key,
        name: ordered[0].name,
        copies: ordered.map((d) => ({ scope: d.scope, projectPath: d.projectPath, fingerprint: d.fingerprint, label: mcpLabel(d, home) })),
        keeper: 0,
        needsChoice: false,
        identical: new Set(ordered.map((d) => d.fingerprint)).size === 1,
      };
    });
}

function pluginDuplicateGroups(installs) {
  const enabled = (Array.isArray(installs) ? installs : []).filter((install) => install.enabled);
  return [...groupBy(enabled, (install) => install.name)]
    .filter(([, copies]) => new Set(copies.map((c) => c.marketplace)).size > 1)
    .map(([name, copies]) => ({
      kind: 'plugin',
      key: name,
      name,
      copies: copies.map((c) => ({ id: c.id, scope: c.scope, projectPath: c.projectPath, marketplace: c.marketplace, label: `${c.marketplace} (${PLUGIN_SCOPE_LABELS[c.scope] || c.scope})` })),
      keeper: null,
      needsChoice: true,
      identical: false,
    }));
}

function compareSkillKeeper(left, right) {
  const rank = (item) => {
    const index = SKILL_SCOPE_PRECEDENCE.indexOf(item.scope);
    return index === -1 ? SKILL_SCOPE_PRECEDENCE.length : index;
  };
  const byScope = rank(left) - rank(right);
  if (byScope !== 0) return byScope;
  const byDate = (Date.parse(right.updatedAt || '') || 0) - (Date.parse(left.updatedAt || '') || 0);
  if (byDate !== 0) return byDate;
  return String(left.path || '').localeCompare(String(right.path || ''));
}

module.exports = { MCP_SCOPE_PRECEDENCE, SKILL_SCOPE_PRECEDENCE, mcpDuplicateGroups, pluginDuplicateGroups, compareSkillKeeper };
```

The `homePath` option decides which local copy is "this folder" and which is "this project". Callers always pass it; the fallback exists only so a missing option can't throw.

- [ ] **Step 4: Run the test and confirm it passes.**

- [ ] **Step 5: Wire it into `npm run check` and commit.** Add the test to `inventory:check` and `node --check src/inventory/duplicates.js` to `check`. Message: `feat(inventory): group duplicates and name the keeper by documented precedence`.

---

### Task 3: Resolution plans

**Files:**
- Create: `desktop/src/inventory/resolvers.js`
- Create: `scripts/test-inventory-resolvers.js`
- Modify: `desktop/package.json`

**Interfaces:**
- `planResolution(group, { keep } = {}) → { ok: true, kind, name, keep: Copy, changes: Change[], fingerprint } | { ok: false, reason: 'needs-choice' | 'invalid-choice' | 'nothing-to-do' }`:
  - `keep` is an index into `group.copies`.
  - It is required when `group.needsChoice`.
  - When the group has a keeper, `keep` must be omitted or equal to `group.keeper`. Anything else is `'invalid-choice'`: CCTI never removes the copy Claude Code uses.
- `Change = { args: string[], label: string, undo: string }`:
  - MCP: `args: ['mcp', 'remove', name, '--scope', copy.scope]`; `label: 'Remove the copy saved for <copy.label>'`; `undo: 'Add it again from the Claude Code tools list if you need it.'`
  - Plugin: `args: ['plugin', 'disable', copy.id, '--scope', copy.scope]`; `label: 'Turn off <copy.marketplace>’s copy (<scope label>)'`; `undo: 'You can turn it back on later; nothing is uninstalled.'`
- `groupFingerprint(group) → string`: a stable string of kind, key, and each copy's scope, projectPath, fingerprint, and id, in order. Check-then-act compares these.

- [ ] **Step 1: Write the failing test.** Create `scripts/test-inventory-resolvers.js`:

```js
#!/usr/bin/env node
const assert = require('node:assert/strict');
const { planResolution, groupFingerprint } = require('../desktop/src/inventory/resolvers');

const mcp = { kind: 'mcp', key: 'playwright', name: 'playwright', keeper: 0, needsChoice: false, identical: true, copies: [
  { scope: 'local', projectPath: '/Users/me', fingerprint: 'a', label: 'Only you, in this folder' },
  { scope: 'user', projectPath: '', fingerprint: 'a', label: 'Just you, everywhere' },
] };
const plan = planResolution(mcp);
assert.equal(plan.ok, true);
assert.equal(plan.keep.scope, 'local', 'the documented winner is kept');
assert.deepEqual(plan.changes.map((c) => c.args), [['mcp', 'remove', 'playwright', '--scope', 'user']], 'only the shadowed copy is removed, always with --scope');
assert.match(plan.changes[0].label, /Just you, everywhere/);
assert.deepEqual(planResolution(mcp, { keep: 1 }), { ok: false, reason: 'invalid-choice' }, 'CCTI never removes the copy Claude Code uses');
assert.equal(planResolution(mcp, { keep: 0 }).ok, true);

const plugin = { kind: 'plugin', key: 'foo', name: 'foo', keeper: null, needsChoice: true, identical: false, copies: [
  { id: 'foo@market-a', scope: 'user', projectPath: '', marketplace: 'market-a', label: 'market-a (Just you)' },
  { id: 'foo@market-b', scope: 'project', projectPath: '/work/app', marketplace: 'market-b', label: 'market-b (This project)' },
] };
assert.deepEqual(planResolution(plugin), { ok: false, reason: 'needs-choice' }, 'no documented rule: the user must choose');
const chosen = planResolution(plugin, { keep: 1 });
assert.equal(chosen.ok, true);
assert.deepEqual(chosen.changes.map((c) => c.args), [['plugin', 'disable', 'foo@market-a', '--scope', 'user']], 'the other copy is disabled, never uninstalled');
assert.match(chosen.changes[0].undo, /turn it back on/i);
assert.deepEqual(planResolution(plugin, { keep: 5 }), { ok: false, reason: 'invalid-choice' });
assert.deepEqual(planResolution({ ...mcp, copies: [mcp.copies[0]] }), { ok: false, reason: 'nothing-to-do' });

assert.equal(groupFingerprint(mcp), groupFingerprint(JSON.parse(JSON.stringify(mcp))), 'fingerprints are stable');
assert.notEqual(groupFingerprint(mcp), groupFingerprint({ ...mcp, copies: [...mcp.copies, { scope: 'project', projectPath: '/x', fingerprint: 'b', label: 'x' }] }), 'a new copy changes the fingerprint');
assert.equal(chosen.fingerprint, groupFingerprint(plugin));
for (const change of [...plan.changes, ...chosen.changes]) {
  assert.doesNotMatch(change.label, /claude |--scope|\//, 'labels are plain language, never a command or path');
}
console.log('Inventory resolvers passed: keep the documented winner, ask when undocumented, reversible add-on changes.');
```

- [ ] **Step 2: Run the test and confirm it fails.**

- [ ] **Step 3: Implement** `desktop/src/inventory/resolvers.js`:

```js
// Turns a duplicate group and a keeper into the exact, reversible changes CCTI
// will make. The CLI arguments are for main.js; the labels are what people read.
// Pure.

const PLUGIN_SCOPE_LABELS = { user: 'Just you', project: 'This project', local: 'Only you in this project' };

function groupFingerprint(group) {
  return JSON.stringify([group.kind, group.key, (group.copies || []).map((copy) => [copy.scope, copy.projectPath || '', copy.fingerprint || '', copy.id || ''])]);
}

function changeFor(group, copy) {
  if (group.kind === 'mcp') {
    return {
      args: ['mcp', 'remove', group.name, '--scope', copy.scope],
      label: `Remove the copy saved for ${copy.label}`,
      undo: 'Add it again from the Claude Code tools list if you need it.',
    };
  }
  return {
    args: ['plugin', 'disable', copy.id, '--scope', copy.scope],
    label: `Turn off ${copy.marketplace}’s copy (${PLUGIN_SCOPE_LABELS[copy.scope] || copy.scope})`,
    undo: 'You can turn it back on later; nothing is uninstalled.',
  };
}

function planResolution(group, { keep } = {}) {
  const copies = Array.isArray(group?.copies) ? group.copies : [];
  if (copies.length < 2) return { ok: false, reason: 'nothing-to-do' };
  let keeper;
  if (group.needsChoice) {
    if (keep === undefined || keep === null) return { ok: false, reason: 'needs-choice' };
    keeper = keep;
  } else {
    if (keep !== undefined && keep !== null && keep !== group.keeper) return { ok: false, reason: 'invalid-choice' };
    keeper = group.keeper;
  }
  if (!Number.isInteger(keeper) || keeper < 0 || keeper >= copies.length) return { ok: false, reason: 'invalid-choice' };
  return {
    ok: true,
    kind: group.kind,
    name: group.name,
    keep: copies[keeper],
    changes: copies.filter((_, index) => index !== keeper).map((copy) => changeFor(group, copy)),
    fingerprint: groupFingerprint(group),
  };
}

module.exports = { planResolution, groupFingerprint };
```

- [ ] **Step 4: Run the test, wire it into `npm run check`, and commit.** Message: `feat(inventory): turn a duplicate group and keeper into reversible, plain-language changes`.

---

### Task 4: Skill keeper and silent re-verification

**Files:**
- Modify: `desktop/src/main.js` (`duplicateSkillSort`, `applyCleanup`, `applyAllDuplicateSkills`, `applyPluginChange`, and every user-facing "Run the checkup again" string)
- Test: `scripts/test-setup-manager.js`, `scripts/test-inventory-main.js`, `scripts/validate-desktop-ui.js`

**Interfaces:**
- Consumes: `compareSkillKeeper` (Task 2).

- [ ] **Step 1: Write the failing tests.**
  1. In `scripts/test-inventory-main.js`, add a case. Create identical skills `keeper-check` in `home/.claude/skills` and `project/.claude/skills`, with the **project** copy's SKILL.md `mtime` set newer (`fsp.utimes`). Run `discover` with the project, `setup-manager:review-all-duplicates`, then `setup-manager:apply-all-duplicates`. Assert that the home copy still exists and the project copy was moved. That is the documented personal-over-project rule.
  2. Add a case that simulates an old review. Review a single-skill cleanup, then advance the plan's age by stubbing `Date.now` to return `+ 11 minutes` around the apply call (restore it afterwards). Assert that apply succeeds, because re-verification passes.
  3. In `scripts/validate-desktop-ui.js`, add a check that `desktop/src/main.js` contains no user-facing string matching `/Run the (project )?checkup again/`.

  Run them and confirm they fail.

- [ ] **Step 2: Implement.**
  1. Replace the body of `duplicateSkillSort(left, right)` with `return compareSkillKeeper(left, right);`, and import `compareSkillKeeper` from `./inventory/duplicates`. Update the bulk review's description string from "keeps the newest discovered copy" to "keeps the copy Claude Code uses (your personal copy over a project copy, otherwise the newest)". Update the matching success message in `applyAllDuplicateSkills` in the same way.
  2. `applyCleanup`: remove the `Date.now() - plan.createdAt > 10 * 60 * 1000` condition. Keep the existence checks. Before the rename, re-verify content: `skillContentManifest(plan.source)` must match the finding's `contentHash`, which you need to store on the plan at review time. If it doesn't match, return `{ ok: false, error: 'This skill changed after you looked at it, so nothing was moved. Check this computer again to see it as it is now.' }`.
  3. `applyAllDuplicateSkills`: remove the age condition. Its per-move re-verification (hash, files, destination) already covers stale state.
  4. The review functions prune plans older than 10 minutes when new reviews are created. Raise those prune windows to 24 hours (`24 * 60 * 60 * 1000`) for `reviewedCleanupPlans` and `reviewedBulkCleanupPlans`. Raise the `discoveredSkillCleanup` eviction from 30 minutes to 24 hours; it still keeps at most 10 reports.
  5. `applyPluginChange`: remove the age check, and re-verify before running. `installedClaudePluginIds()` must still list the plugin (`pluginIsInstalled`); otherwise return `{ ok: false, error: 'That add-on is no longer installed, so nothing was changed. Check this computer again to see the current list.' }`. Replace the raw-stderr error with `` `Claude Code could not ${plan.action} this add-on. Open the activity details to see why, then try again.` ``, and log the stderr with `emit('installer:output', { stream: 'stderr', text: … })`.
  6. Replace every remaining user-facing `Run the checkup again` / `Run the project checkup again` in `main.js` with `Check this computer again`. Adapt the sentence so it still reads naturally; for project messages use "Check this project again". Do not change the meaning of any message.

- [ ] **Step 3: Run the tests and confirm they pass.** Run: `node scripts/test-inventory-main.js && node scripts/test-setup-manager.js && node scripts/run-duplicate-skill-ui-test.js && node scripts/validate-desktop-ui.js`.

  If `test-setup-manager.js` or the duplicate-skill UI test asserts the old keeper (newest wins across scopes) or old message text, update only those assertions. Record each one in the report with the reason: the documented personal-over-project rule, or the plain-language rule.

- [ ] **Step 4: Commit.** Message: `fix(cleanup): keep the personal skill copy Claude Code uses; re-verify instead of expiring reviews`.

---

### Task 5: Main-process wiring for add-on and connection duplicates

**Files:**
- Modify: `desktop/src/main.js`, `desktop/src/preload.js`, `desktop/src/inventory/reconcile.js`
- Create: `scripts/test-inventory-resolution-main.js`
- Modify: `desktop/package.json` (`inventory:check`)

**Interfaces:**
- Discovery adds `duplicateGroups: Group[]` (from Tasks 1 and 2) to the scan passed into reconcile. `reconcileInventory` turns each add-on or connection group into the row for that key:
  - It sets `state: 'duplicate'` and `copies: group.copies.map(c => ({ scope: c.label, path: '' }))`.
  - It adds `resolution: { groupKey: '<kind>:<key>', needsChoice, keeper /* index or null */, options: group.copies.map(c => c.label) }`.
  - `resolvable` stays skill-only. A row with `resolution` is resolvable through the new flow.
  - If no scan row exists for the key (for example, an add-on the text parser missed), add one.
- IPC `inventory:review-resolution` `{ discoveryId, groupKey, keep? }`:
  1. Look up the group in the stored discovery report (store `duplicateGroups` on the `discoveredSkillCleanup` entry by `groupKey`).
  2. Call `planResolution`.
  3. On success, store `{ plan, group, createdAt }` under a new `reviewId` in a `reviewedResolutions` Map, pruned at 24 hours.
  4. Return `{ ok: true, reviewId, name, keepLabel, changes: [{ label, undo }] }`. No `args` leave the main process.
  5. When planning fails, return a plain message:
     - `needs-choice`: "Choose which copy to keep first."
     - `invalid-choice`: "CCTI only keeps the copy Claude Code uses for this one."
     - `nothing-to-do`: "There is only one copy now. Nothing needs to change."
- IPC `inventory:apply-resolution` `{ reviewId }`:
  1. Refuse while `activeInstall` is set, with the message "Another CCTI action is running. Wait for it to finish, then try again."
  2. Re-read the current state: `~/.claude.json`, `<project>/.mcp.json`, and `claude plugin list --json`. Rebuild the group for this `groupKey`.
  3. If the rebuilt group is missing or its `groupFingerprint` differs from the plan's, return `{ ok: false, changed: true, error: 'This changed since you looked at it, so nothing was changed. Here is how it looks now.' }` plus the new review payload from re-planning with the same keep, if still valid.
  4. Otherwise set `activeInstall`, then run each change's `args` with `runProcess(claude.path, args, { cwd: app.getPath('home'), env: claudeProcessEnv(), timeout: 20000 })`. Stop at the first failure. Log stdout and stderr to the activity output.
  5. Record resolutions for completed changes with `inventoryLedger().recordResolutions`, advisory:
     - MCP: `{ kind: 'mcp', key, scope: <removed scope>, projectPath, resolvedAt, action: 'remove' }`.
     - Plugin: `{ kind: 'plugin', key: <disabled id>, scope, projectPath, resolvedAt, action: 'disable' }`.
  6. Release the lock in `finally`.
  7. Return `{ ok: true, message }` or `{ ok: false, error, completed }`. Every message states a next action.
- Preload: `reviewResolution: (payload) => ipcRenderer.invoke('inventory:review-resolution', payload)` and `applyResolution: (payload) => ipcRenderer.invoke('inventory:apply-resolution', payload)`.
- Reading config files: use `readJsonIfPresent`-style raw text reads (`fs.readFile` wrapped in a catch for ENOENT, which gives `null`). Always read, never write. Run `plugin list --json` with a timeout of 8000. A failure or timeout means no add-on groups (not observed). It never throws out of discovery.

- [ ] **Step 1: Write the failing test.** Create `scripts/test-inventory-resolution-main.js`, modelled on `scripts/test-inventory-main.js`: stubbed Electron and a Node-based fake `claude` with a `.cmd` launcher on Windows. The fake:
  - reads and writes a state file `{ userMcp: {}, localMcp: {}, plugins: [...] }`;
  - rewrites `home/.claude.json` from that state after every mutation. User servers go in top-level `mcpServers`, local ones in `projects[home].mcpServers`;
  - implements `--version`, `plugin list` (text) and `plugin list --json`, `mcp list`, `mcp remove <name> --scope <s>`, and `plugin disable <id> --scope <s>`;
  - logs every call.

  Cases:
  1. `playwright` exists at local (home) and user scope. After `discover`, the `playwright` row has state `duplicate` and `resolution.needsChoice === false`. Review, then apply. The fake's log contains exactly `mcp remove playwright --scope user`, the local copy remains, the ledger has a `remove` resolution, and a re-discover shows no duplicate.
  2. `foo@market-a` (user) and `foo@market-b` (user) are both enabled. Review without `keep` gives "Choose which copy to keep first." Review with `keep: 1`, then apply. The log contains exactly `plugin disable foo@market-a --scope user`, and never `uninstall`.
  3. Check-then-act: review the `playwright` group, then mutate the fake state so the user copy is already gone. Apply returns `ok: false, changed: true`, and the fake log has no `mcp remove` call.
  4. Review `playwright` with `keep: 1`. It returns the invalid-choice message, and nothing runs.
  5. An unreadable `~/.claude.json` (invalid JSON): discovery still succeeds with no MCP duplicate groups.

- [ ] **Step 2: Implement** as described in Interfaces. Store `duplicateGroups` (a `Map` by `groupKey`) and `homePath` / `projectPath` on the `discoveredSkillCleanup` entry. Build the groups with `mcpDuplicateGroups(defs, { homePath: home })` and `pluginDuplicateGroups(installs)`.

- [ ] **Step 3: Run the tests and confirm they pass.** Run: `node scripts/test-inventory-resolution-main.js && node scripts/test-inventory-main.js && node scripts/test-setup-manager.js && cd desktop && npm run inventory:check`.

- [ ] **Step 4: Commit.** Message: `feat(inventory): review and apply add-on and connection duplicate resolution with check-then-act`.

---

### Task 6: Resolve dialog and view model

**Files:**
- Modify: `desktop/src/inventory/manage-view.js`, `scripts/test-inventory-manage-view.js`
- Modify: `desktop/src/renderer/index.html`, `desktop/src/renderer/app.js`, `desktop/src/renderer/styles.css`, `scripts/validate-desktop-ui.js`, `scripts/audit-duplicate-skill-accessibility.js` (the live-region allowlist, if you add a status region)

**Interfaces:**
- manage-view:
  - A `duplicate` row with a `resolution` gets `action: { type: 'resolve-duplicate', label: 'Resolve', groupKey, needsChoice, options, keeper }`.
  - Its detail is:
    - when `needsChoice` is false: `` `Claude Code uses the copy saved for ${options[keeper]}. Resolve removes the other ${n - 1 === 1 ? 'copy' : 'copies'}.` ``
    - when `needsChoice` is true: `` `This add-on is turned on from ${options.length} places. Claude Code doesn’t say which one it uses, so choose the one to keep.` ``
  - Skill duplicate rows are unchanged (the existing `resolve` action).
- A new `<dialog id="resolve-duplicate-dialog">` contains:
  - a heading with the item name;
  - for `needsChoice`, a radio group listing `options`, with no default selected. The confirm button stays disabled until one is chosen;
  - for a fixed keeper, one sentence naming it;
  - a "Review changes" button that calls `reviewResolution` and then shows each change's `label` and `undo` text as a list, with a "Make these changes" button that calls `applyResolution`;
  - a Cancel button;
  - a status line (`role="status"`, `aria-live="polite"`).

  On success the dialog closes and CCTI runs `scanSetup()`. On `changed: true` it shows the updated review in place. All text is set with `textContent`. Follow `#duplicate-skill-dialog`'s markup and ARIA conventions (heading id, `aria-labelledby`, `aria-describedby`, and restoring focus to the invoking button on close).

- [ ] **Step 1: Write the failing tests.**
  - In `scripts/test-inventory-manage-view.js`, add fixture rows for an MCP duplicate (`needsChoice: false`, keeper 0, two options) and an add-on duplicate (`needsChoice: true`, three options). Assert the action shape and both detail sentences.
  - In `scripts/validate-desktop-ui.js`, add contract checks:
    - `#resolve-duplicate-dialog` exists;
    - the renderer calls `window.installer.reviewResolution` and `window.installer.applyResolution`;
    - the confirm button starts disabled for `needsChoice`;
    - `main.js` handles both IPC channels.

  Run them and confirm they fail.

- [ ] **Step 2: Implement** the view model, then the dialog and wiring. Add `runInventoryAction` handling for `resolve-duplicate` that opens the dialog.

- [ ] **Step 3: Run the checks and confirm they pass.** Run: `cd desktop && npm run check`. Expected: exit 0. If the accessibility audit's live-region allowlist needs the new status region, add it, and note it in the report.

- [ ] **Step 4: Commit.** Message: `feat(inventory): Resolve dialog for duplicate add-ons and connections`.

---

## Out of scope

- Removing Claude.ai connectors or add-on-provided connections. Claude Code already hides a connector shadowed by an added server, and add-on connections go with their add-on.
- Unverified same-name skills (different content): they stay informational. A keeper-choice flow for them is a follow-up.
- Organization-managed (`managedMcpServers`, managed `enabledPlugins`) conflicts. CCTI shows what it finds and never changes managed settings.
