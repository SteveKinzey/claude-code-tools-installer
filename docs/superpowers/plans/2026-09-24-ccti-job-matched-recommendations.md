# CCTI Job-Matched Recommendations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Project Interview's 8 name-matching regex rules with offline job matching over all 181 catalog items, show why each suggestion matched, and let the user add suggestions to the existing Step 2 review lists.

**Architecture:** A new pure module `desktop/src/tool-matcher.js` scores interview text against each item's `chooseWhen` / `example` / `plainPurpose` / `category` text from `catalog-details.json` (weighted, IDF-scaled keyword overlap). `project-interview.js` uses it in place of `createRecommendations`' regex rules, and gains a pure `queueInterviewSuggestions` helper. The renderer loads the matcher the same way it loads `project-interview.js` and adds one button that moves suggestions into `state.selected` (tools) and `state.componentPlan` (project components). Installing still goes through the existing Step 3 confirmation.

**Tech Stack:** Plain Node/CommonJS + browser-global modules (no bundler), Electron renderer, plain `node:assert` test scripts under `scripts/`, wired into `desktop/package.json` `check`.

**Spec:** `docs/ccti-tool-management-design-2026-09-23.md`, section "Interview bridge and job matching". This is plan 1 of 3. Plan 2 (inventory, ledger, reconcile, Manage screen, Reinstall) and plan 3 (plugin and MCP duplicate resolution) are separate and do not depend on this one.

## Global Constraints

- Matching is fully offline: "Any network call in the recommendation path" is a non-goal. `tool-matcher.js` must not require `electron`, `fs`, `http`, or call `fetch`.
- "Auto-installing anything" is a non-goal: "Every install still passes the Step 3 confirmation." The interview may add to review lists only; it never calls `runInstall` or `installComponents`.
- "Every match displays the `chooseWhen` sentence that matched it."
- "Low confidence is stated, not hidden": when a same-category rival is within 15% of an item's score, show both and quote the rival's own `chooseWhen`.
- "Tools and components stay separated": components go only to `state.componentPlan`, tools only to `state.selected`.
- "No curation layer in v1."
- Follow repo test convention: plain Node scripts in `scripts/`, run by `npm run check` from `desktop/`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` when made by Claude.
- Out of scope, already done: the spec's "Data hazard" catalog sync assertion already exists in `scripts/validate-catalog-details.js` (ids resolve, counts match `catalogCounts`). Do not duplicate it.

## Deviation from spec (final-review fix wave, 2026-09-24)

The spec's bridge says matches **pre-select** into the Step 2 queue. This branch keeps an **explicit, per-item opt-in** instead: each suggestion is shown with its own checkbox and stated `chooseWhen` reason, only the Planning with Files baseline starts checked, and nothing reaches `state.selected` or `state.componentPlan` until the user clicks "Add selected to my review list". Installing still goes through Step 3.

Why: probes with realistic beginner answers showed the offline matcher still produces some noise, and a pre-selected wrong item is exactly the "confidently wrong answer" the spec warns against. One extra click is cheaper for a beginner than silently queued packages they did not ask for (ruling in `progress.md`, Important 3). The same wave also tightened matching (two-word evidence per answer, per-answer scoring, hedge stripping, harness/reference demotion, top-match-only close alternatives) and added `scripts/test-interview-fixtures.js`, a realistic-beginner fixture run by `npm run check`.

## Review Focus

Each line below is pinned by a test in the task that owns the code.

1. **Blank or skipped interview answers**: the draft fills skipped answers with the placeholder `Not decided yet.`. The placeholder must not produce matches. Expect only the baseline "Planning with Files" (Task 2).
2. **Gibberish, stop-word-only, or empty answer text**: expect no matches, not a best guess (Task 1).
3. **Catalog details failed to load** (`details` undefined or empty): expect the baseline suggestion only, with no throw (Tasks 1 and 2).
4. **A matched id missing from `catalog.json` / `convex-components.json`**: expect it dropped, because the installer can't act on it (Task 2).
5. **Clicking "Add suggestions" twice, or after hand-picking tools**: expect existing selections kept and no duplicates. A second click adds nothing (Task 2).

---

## File Structure

| File | Responsibility |
|---|---|
| `desktop/src/tool-matcher.js` (create) | Pure ranking: `matchTools(answerText, details, { limit })` → reasoned matches. No I/O. |
| `scripts/test-tool-matcher.js` (create) | Ranking behavior against the real `catalog-details.json`. |
| `desktop/src/project-interview.js` (modify) | Uses the matcher; filters to installable ids; adds `queueInterviewSuggestions`. |
| `scripts/test-project-interview.js` (modify) | Interview behavior against the real catalogs. |
| `desktop/src/renderer/index.html` (modify) | Loads `tool-matcher.js`; adds the "Add suggestions" button and status line. |
| `desktop/src/renderer/app.js` (modify) | Passes catalog details to the interview; wires the button to the review lists. |
| `scripts/validate-desktop-ui.js` (modify) | String contract for the new wiring. |
| `desktop/package.json` (modify) | `tool-matcher:check` script, added to `check` and `node --check`. |

---

### Task 1: Offline job matcher

**Files:**
- Create: `desktop/src/tool-matcher.js`
- Create: `scripts/test-tool-matcher.js`
- Modify: `desktop/package.json` (scripts `tool-matcher:check`, `check`)

**Interfaces:**
- Consumes: `desktop/catalog-details.json` `items[]`, each `{ id, name, kind: 'tool'|'component', category, scope: 'This computer'|'This project', plainPurpose, chooseWhen, example, ... }`.
- Produces: `matchTools(answerText: string, details: DetailItem[] | undefined, options?: { limit?: number = 6 }) → Match[]`, where `Match = { id, name, kind, scope, category, reason: string /* the item's chooseWhen */, score: number, closeTo: null | { id, name, reason } }`. The module is exported via CommonJS and `window.CCTIToolMatcher`, and also exports `tokens(text) → string[]`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-tool-matcher.js`:

```js
#!/usr/bin/env node
const assert = require('node:assert/strict');
const path = require('node:path');
const { matchTools } = require('../desktop/src/tool-matcher');
const details = require(path.join(__dirname, '..', 'desktop', 'catalog-details.json')).items;

const rank = (results, name) => results.findIndex((item) => item.name === name);

const book = matchTools('I want to sell a digital book', details);
assert.equal(book[0]?.name, 'Stripe', 'selling a digital book must rank Stripe first');
assert.ok(rank(book, 'Autumn') === -1 || rank(book, 'Autumn') > rank(book, 'Stripe'), 'Autumn must not outrank Stripe for a one-time sale');

const gate = matchTools('limit free users to 10 messages per day', details);
assert.equal(gate[0]?.name, 'Autumn', 'per-feature limits must rank Autumn first');
assert.ok(rank(gate, 'Stripe') === -1 || rank(gate, 'Stripe') > rank(gate, 'Autumn'), 'Stripe must not outrank Autumn for feature gating');

assert.ok(rank(matchTools('send text message reminders to customers', details), 'Twilio SMS') !== -1, 'text reminders must surface Twilio SMS');
assert.equal(matchTools('users log in with google', details)[0]?.name, 'Better Auth', 'sign-in must rank Better Auth first');

// Review Focus 2: no guessing on empty, gibberish, or stop-word-only text.
for (const empty of ['', '   ', 'xyzzy', 'the and of to']) {
  assert.deepEqual(matchTools(empty, details), [], `"${empty}" must return no matches rather than a guess`);
}
// Review Focus 3: missing details degrade to no matches.
assert.deepEqual(matchTools('sell a book', []), [], 'missing catalog details must return no matches');
assert.deepEqual(matchTools('sell a book', undefined), [], 'undefined catalog details must return no matches');

const sample = ['A booking app for dog walkers with sign-in', 'an AI chat assistant for support teams', 'sell a digital book', 'test my site in a browser'];
for (const text of sample) {
  const results = matchTools(text, details, { limit: 4 });
  assert.ok(results.length <= 4, 'the limit must be respected');
  for (const item of results) {
    assert.match(item.reason, /^Choose this when /, `${item.name} must carry its own chooseWhen sentence as the reason`);
    assert.ok(['tool', 'component'].includes(item.kind), `${item.name} must carry its kind`);
    assert.ok(['This computer', 'This project'].includes(item.scope), `${item.name} must carry its scope`);
    if (item.closeTo) {
      assert.notEqual(item.closeTo.id, item.id, 'a close match must name a different item');
      assert.match(item.closeTo.reason, /^Choose this when /, 'a close match must quote the rival’s own reason');
    }
  }
}

const hostile = matchTools('<script>alert(1)</script> '.repeat(500), details);
assert.ok(Array.isArray(hostile), 'very long or markup-like answers must not throw');

console.log('Tool matcher passed: job-level ranking, honest empty results, stated reasons, and close-match comparisons.');
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node scripts/test-tool-matcher.js`
Expected: FAIL with `Cannot find module '../desktop/src/tool-matcher'`

- [ ] **Step 3: Write the implementation**

Create `desktop/src/tool-matcher.js`:

```js
// Offline job matching for the Project Interview. Scores the user's own words
// against each catalog item's plain-language "choose this when" text so items
// in the same category that do different jobs are told apart. No network, no I/O.

const FIELD_WEIGHTS = [['chooseWhen', 3], ['example', 2], ['plainPurpose', 1]];
const CATEGORY_WEIGHT = 0.5;
const CLOSE_MATCH_RATIO = 0.85;
const MIN_SCORE = 6;
const RELATIVE_FLOOR = 0.45;
const STOP_WORDS = new Set(('a an and any are as at be but by can do does for from get has have how i if in into is it its just let lets like make me more my need needs not of on one or our out over should so some such than that the their them then there these they this those to too up us use using via want wants was we what when where which while who why will with without would you your yours choose example site website app apps project people person thing things way also only each every first new simple easy easily time get gets work works pick lets run runs keep keeps give gives help helps start store stores add adds show shows call calls create creates build builds support supports feature features small quick quickly fast launch')
  .split(' '));

function stem(word) {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function tokens(text) {
  return String(text || '').toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => word.length > 1 && !STOP_WORDS.has(word)).map(stem) || [];
}

function buildIndex(details) {
  const documentFrequency = new Map();
  const entries = details.map((detail) => {
    const fields = FIELD_WEIGHTS.map(([field, weight]) => ({ weight, words: new Set(tokens(detail[field])) }));
    const category = new Set(tokens(detail.category));
    const all = new Set([...fields.flatMap((field) => [...field.words]), ...category]);
    for (const word of all) documentFrequency.set(word, (documentFrequency.get(word) || 0) + 1);
    return { detail, fields, category };
  });
  const total = details.length;
  const idf = (word) => Math.log((total + 1) / ((documentFrequency.get(word) || 0) + 1)) + 1;
  return { entries, idf };
}

function scoreEntry(entry, queryWords, idf) {
  let score = 0;
  for (const word of queryWords) {
    const fieldWeight = entry.fields.reduce((best, field) => (field.words.has(word) ? Math.max(best, field.weight) : best), 0);
    const weight = fieldWeight || (entry.category.has(word) ? CATEGORY_WEIGHT : 0);
    score += weight * idf(word);
  }
  return score;
}

function matchTools(answerText, details, { limit = 6 } = {}) {
  const queryWords = [...new Set(tokens(answerText))];
  if (!queryWords.length || !Array.isArray(details) || !details.length) return [];
  const { entries, idf } = buildIndex(details);
  const ranked = entries
    .map((entry) => ({ entry, score: scoreEntry(entry, queryWords, idf) }))
    .filter((result) => result.score >= MIN_SCORE)
    .sort((left, right) => right.score - left.score || left.entry.detail.name.localeCompare(right.entry.detail.name));
  const floor = (ranked[0]?.score || 0) * RELATIVE_FLOOR;
  const kept = ranked.filter((result) => result.score >= floor);
  return kept.slice(0, limit).map(({ entry, score }, index) => {
    const detail = entry.detail;
    // Same category, similar score: state the difference instead of faking a winner.
    const rival = ranked.find((other, otherIndex) => otherIndex !== index
      && other.entry.detail.category === detail.category
      && other.score >= score * CLOSE_MATCH_RATIO
      && other.score <= score / CLOSE_MATCH_RATIO);
    return {
      id: detail.id,
      name: detail.name,
      kind: detail.kind,
      scope: detail.scope,
      category: detail.category,
      reason: detail.chooseWhen,
      score: Math.round(score * 100) / 100,
      closeTo: rival ? { id: rival.entry.detail.id, name: rival.entry.detail.name, reason: rival.entry.detail.chooseWhen } : null,
    };
  });
}

const toolMatcherApi = { matchTools, tokens };

if (typeof module !== 'undefined' && module.exports) module.exports = toolMatcherApi;
if (typeof window !== 'undefined') window.CCTIToolMatcher = toolMatcherApi;
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node scripts/test-tool-matcher.js`
Expected: `Tool matcher passed: job-level ranking, honest empty results, stated reasons, and close-match comparisons.`

- [ ] **Step 5: Wire it into `npm run check`**

In `desktop/package.json`:
- Add the script `"tool-matcher:check": "node ../scripts/test-tool-matcher.js",` right after `"project-interview:check"`.
- In `"check"`, insert `npm run tool-matcher:check && ` immediately before `npm run project-interview:check`, and insert `node --check src/tool-matcher.js && ` immediately before `node --check src/project-interview.js`.

Run: `cd desktop && npm run check`
Expected: exit 0, with the tool-matcher line in the output.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/tool-matcher.js scripts/test-tool-matcher.js desktop/package.json
git commit -m "feat(interview): add offline job matcher over catalog details"
```

---

### Task 2: Interview uses the matcher, plus the queue helper

**Files:**
- Modify: `desktop/src/project-interview.js` (replace `createRecommendations` at lines 18–37; `buildProjectInterviewDraft` signature and suggestion line; exports)
- Modify: `scripts/test-project-interview.js` (full replacement)

**Interfaces:**
- Consumes: `matchTools` from Task 1, via `window.CCTIToolMatcher` in the renderer or `require('./tool-matcher')` in Node.
- Produces:
  - `buildProjectInterviewDraft(answers, catalog = [], components = [], details = []) → { draft: string, recommendations: Recommendation[], values }`, where `Recommendation = { id, name, scope: 'This computer'|'Selected project', reason: string, closeTo: null|{ id, name, reason }, packageName: string }`.
  - `queueInterviewSuggestions(recommendations, selected: Set<string>, componentPlan: Set<string>) → { selected: Set<string>, componentPlan: Set<string>, addedTools: number, addedComponents: number }`. It returns new Sets and never mutates its inputs.
  - Exported on `window.CCTIProjectInterview` and via CommonJS.

- [ ] **Step 1: Write the failing test**

Replace the whole of `scripts/test-project-interview.js`:

```js
#!/usr/bin/env node
const assert = require('node:assert/strict');
const path = require('node:path');
const desktop = path.resolve(__dirname, '..', 'desktop');
const { PROJECT_INTERVIEW_QUESTIONS, buildProjectInterviewDraft, queueInterviewSuggestions } = require(path.join(desktop, 'src', 'project-interview'));

const catalog = require(path.join(desktop, 'catalog.json'));
const components = require(path.join(desktop, 'convex-components.json')).components;
const details = require(path.join(desktop, 'catalog-details.json')).items;

const result = buildProjectInterviewDraft({
  idea: 'A shop that sells a digital book',
  users: 'Readers',
  problem: 'People cannot pay online',
  firstVersion: 'Sell the book and let users log in with google',
  constraints: 'Send text message reminders',
}, catalog, components, details);

assert.equal(PROJECT_INTERVIEW_QUESTIONS.length, 5);
assert.match(result.draft, /Private early draft/i);
assert.match(result.draft, /Nothing has been selected or installed/i);
assert.match(result.draft, /Readers/);
const names = result.recommendations.map((item) => item.name);
assert.ok(names.includes('Planning with Files'), 'Planning with Files stays the baseline suggestion');
assert.ok(names.includes('Stripe'), `selling a book must suggest Stripe; got ${names.join(', ')}`);
assert.ok(result.recommendations.every((item) => ['This computer', 'Selected project'].includes(item.scope)));
assert.ok(result.recommendations.every((item) => item.reason.trim().length > 0), 'every suggestion states its reason');
const stripe = result.recommendations.find((item) => item.name === 'Stripe');
assert.equal(stripe.scope, 'Selected project');
assert.equal(stripe.packageName, '@convex-dev/stripe');
assert.match(result.draft, /Stripe — Selected project\. Choose this when/);

// Review Focus 1: the "Not decided yet." placeholder must not produce matches.
const empty = buildProjectInterviewDraft({}, catalog, components, details);
assert.deepEqual(empty.recommendations.map((item) => item.name), ['Planning with Files'], 'blank answers must not invent matches from placeholder text');

// Review Focus 3: no catalog details → baseline only, no throw.
const noDetails = buildProjectInterviewDraft({ idea: 'sell a digital book' }, catalog, components);
assert.deepEqual(noDetails.recommendations.map((item) => item.name), ['Planning with Files'], 'missing catalog details degrade to the baseline, never throw');

// Review Focus 4: a match the installer cannot act on is dropped.
const orphan = buildProjectInterviewDraft({ idea: 'sell a digital book' }, catalog, [], details);
assert.ok(!orphan.recommendations.some((item) => item.name === 'Stripe'), 'a match missing from the install catalogs must be dropped');

// Review Focus 5: queueing keeps existing picks, separates kinds, and is idempotent.
const queued = queueInterviewSuggestions(result.recommendations, new Set(['context7']), new Set());
assert.ok(queued.selected.has('context7'), 'existing tool selections are kept');
assert.ok(queued.selected.has('planning-with-files'));
assert.ok(queued.componentPlan.has(stripe.id), 'project components go to the component plan');
assert.ok(!queued.selected.has(stripe.id), 'components never enter the local-tool queue');
assert.ok(result.recommendations.filter((item) => item.scope === 'This computer').every((item) => !queued.componentPlan.has(item.id)), 'tools never enter the component plan');
const again = queueInterviewSuggestions(result.recommendations, queued.selected, queued.componentPlan);
assert.equal(again.addedTools + again.addedComponents, 0, 'adding the same suggestions twice changes nothing');
assert.equal(queueInterviewSuggestions(undefined, new Set(), new Set()).addedTools, 0);

console.log('Project Interview behavior passed: job-matched, reasoned suggestions stay unselected until the user adds them to the review lists.');
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node scripts/test-project-interview.js`
Expected: FAIL with `TypeError: queueInterviewSuggestions is not a function`, or an assertion failure that Stripe is not suggested.

- [ ] **Step 3: Replace `createRecommendations` and add the queue helper**

In `desktop/src/project-interview.js`, keep `findByName`. Replace the entire `createRecommendations` function (lines 18–37) with:

```js
function getToolMatcher() {
  if (typeof window !== 'undefined' && window.CCTIToolMatcher) return window.CCTIToolMatcher;
  if (typeof require === 'function') return require('./tool-matcher');
  return { matchTools: () => [] };
}

function createRecommendations(answers, catalog, components, details) {
  const answerText = Object.values(answers).filter((value) => value !== 'Not decided yet.').join(' ');
  const installable = new Map([
    ...catalog.map((item) => [item.id, { scope: 'This computer', packageName: '' }]),
    ...components.map((item) => [item.id, { scope: 'Selected project', packageName: item.packageName || '' }]),
  ]);
  const results = [];
  const add = (id, name, reason, closeTo = null) => {
    const target = installable.get(id);
    // A suggestion the installer cannot act on is worse than no suggestion.
    if (!target || results.some((result) => result.id === id)) return;
    results.push({ id, name, scope: target.scope, reason, closeTo, packageName: target.packageName });
  };

  const planning = findByName(catalog, /^Planning with Files$/i);
  if (planning) add(planning.id, planning.name, 'Helps turn the agreed first version into small, saved work steps.');
  for (const match of getToolMatcher().matchTools(answerText, details)) {
    add(match.id, match.name, match.reason, match.closeTo);
  }
  return results;
}

/** Add interview suggestions to the Step 2 review lists. Nothing is installed here. */
function queueInterviewSuggestions(recommendations, selected, componentPlan) {
  const nextSelected = new Set(selected);
  const nextComponentPlan = new Set(componentPlan);
  let addedTools = 0;
  let addedComponents = 0;
  for (const item of recommendations || []) {
    if (item.scope === 'This computer' && !nextSelected.has(item.id)) {
      nextSelected.add(item.id);
      addedTools += 1;
    } else if (item.scope === 'Selected project' && !nextComponentPlan.has(item.id)) {
      nextComponentPlan.add(item.id);
      addedComponents += 1;
    }
  }
  return { selected: nextSelected, componentPlan: nextComponentPlan, addedTools, addedComponents };
}
```

- [ ] **Step 4: Update `buildProjectInterviewDraft` and the exports**

In the same file:

1. Change the signature line to:
   ```js
   function buildProjectInterviewDraft(answers, catalog = [], components = [], details = []) {
   ```
2. Change the recommendations line to:
   ```js
   const recommendations = createRecommendations(values, catalog, components, details);
   ```
3. Replace the `suggestionLines` mapping expression `recommendations.map((item) => ...).join('\n')` with:
   ```js
   recommendations.map((item) => `- ${item.name} — ${item.scope}. ${item.reason}${item.closeTo ? ` Close alternative: ${item.closeTo.name}. ${item.closeTo.reason}` : ''}${item.packageName ? ` Package: ${item.packageName}.` : ''}`).join('\n')
   ```
4. Change the export object to:
   ```js
   const projectInterviewApi = { PROJECT_INTERVIEW_QUESTIONS, buildProjectInterviewDraft, queueInterviewSuggestions };
   ```

Leave the draft sentence "Nothing has been selected or installed." unchanged, because `validate-desktop-ui.js` requires it. It stays true: the draft itself selects nothing.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `node scripts/test-project-interview.js && node scripts/test-tool-matcher.js`
Expected: both "passed" lines.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/project-interview.js scripts/test-project-interview.js
git commit -m "feat(interview): recommend by job match with stated reasons"
```

---

### Task 3: Renderer bridge to the review lists

**Files:**
- Modify: `desktop/src/renderer/index.html` (lines 272, 286, 490)
- Modify: `desktop/src/renderer/app.js` (element refs near line 147; `renderProjectInterview` about lines 302–319; `advanceProjectInterview` line 354; `beginProjectInterview`; event wiring near line 2418)
- Modify: `scripts/validate-desktop-ui.js` (lines 184–186)

**Interfaces:**
- Consumes: `window.CCTIToolMatcher` (Task 1), `window.CCTIProjectInterview.buildProjectInterviewDraft` / `queueInterviewSuggestions` (Task 2), and the existing `renderCatalog()`, `updateSummary()`, `renderComponents()`, `state.selected`, `state.componentPlan` and `state.catalogDetails` (a Map of id → detail).
- Produces: renderer function `queueInterviewSuggestionsFromDraft()`, plus DOM ids `queue-interview-suggestions-button` and `queue-interview-suggestions-note`.

- [ ] **Step 1: Write the failing contract check**

In `scripts/validate-desktop-ui.js`, replace the Project Interview recommendation check (the `if` block whose message is `'The Project Interview must draft recommendations without selecting or installing tools.'`) with:

```js
if (!fs.readFileSync(path.join(root, 'desktop', 'src', 'project-interview.js'), 'utf8').includes('Nothing has been selected or installed.') || !renderer.includes('buildProjectInterviewDraft(interview.answers, state.catalog, state.componentCatalog.components, [...state.catalogDetails.values()])')) {
  throw new Error('The Project Interview must draft job-matched recommendations without selecting or installing tools.');
}
if (!html.includes('../tool-matcher.js') || html.indexOf('../tool-matcher.js') > html.indexOf('../project-interview.js')) {
  throw new Error('The offline tool matcher must load before the Project Interview.');
}
if (!html.includes('id="queue-interview-suggestions-button"') || !renderer.includes('function queueInterviewSuggestionsFromDraft()') || !renderer.includes('queueInterviewSuggestions(state.projectInterview.result.recommendations, state.selected, state.componentPlan)')) {
  throw new Error('Interview suggestions must be added to the existing review lists only through an explicit user action.');
}
if (/queueInterviewSuggestionsFromDraft[\s\S]{0,1200}(runInstall|installComponents|runInstallation)\(/.test(renderer)) {
  throw new Error('Adding interview suggestions must never start an install; Step 3 confirmation still applies.');
}
```

- [ ] **Step 2: Run the check and confirm it fails**

Run: `cd desktop && npm run ui:check`
Expected: FAIL with `The Project Interview must draft job-matched recommendations without selecting or installing tools.`

- [ ] **Step 3: Update `index.html`**

1. Line 272: change the sentence `It does not select or install anything.` to `It never installs anything. You can add its suggestions to your review list, and every install still asks you first.`
2. After the `export-project-prd-button` line (line 286), add:
   ```html
               <button id="queue-interview-suggestions-button" class="button button-primary is-hidden" type="button">Add suggestions to my review list</button>
               <p id="queue-interview-suggestions-note" class="project-interview-help" role="status" aria-live="polite"></p>
   ```
3. Before `<script src="../project-interview.js"></script>` (line 490), add:
   ```html
       <script src="../tool-matcher.js"></script>
   ```

- [ ] **Step 4: Update `app.js`**

1. After `const exportProjectPrdButton = document.querySelector('#export-project-prd-button');` (line 147), add:
   ```js
   const queueInterviewSuggestionsButton = document.querySelector('#queue-interview-suggestions-button');
   const queueInterviewSuggestionsNoteElement = document.querySelector('#queue-interview-suggestions-note');
   ```
2. In `advanceProjectInterview`, change the draft line to:
   ```js
   interview.result = buildProjectInterviewDraft(interview.answers, state.catalog, state.componentCatalog.components, [...state.catalogDetails.values()]);
   ```
3. In `renderProjectInterview`, inside the `if (interview.result) {` branch, immediately before its `return;`, add:
   ```js
       queueInterviewSuggestionsButton.classList.toggle('is-hidden', !interview.result.recommendations.length);
   ```
   and in the question branch (after `exportProjectPrdButton.classList.add('is-hidden');`), add:
   ```js
     queueInterviewSuggestionsButton.classList.add('is-hidden');
     queueInterviewSuggestionsNoteElement.textContent = '';
   ```
4. Add this function right after `exportProjectPrd()`:
   ```js
   function queueInterviewSuggestionsFromDraft() {
     if (!state.projectInterview.result) return;
     const { queueInterviewSuggestions } = getProjectInterviewApi();
     const next = queueInterviewSuggestions(state.projectInterview.result.recommendations, state.selected, state.componentPlan);
     state.selected = next.selected;
     state.componentPlan = next.componentPlan;
     renderCatalog();
     renderComponents();
     updateSummary();
     const parts = [];
     if (next.addedTools) parts.push(`${next.addedTools} tool${next.addedTools === 1 ? '' : 's'} added to your review list`);
     if (next.addedComponents) parts.push(`${next.addedComponents} project package${next.addedComponents === 1 ? '' : 's'} added to your project plan. Choose a project folder before installing them`);
     queueInterviewSuggestionsNoteElement.textContent = parts.length
       ? `${parts.join('. ')}. Nothing is installed until you confirm.`
       : 'These suggestions are already on your review list. Nothing is installed until you confirm.';
   }
   ```
5. In `getProjectInterviewApi`, change the fallback object to include the helper so a missing script can't throw:
   ```js
   return window.CCTIProjectInterview || { PROJECT_INTERVIEW_QUESTIONS: [], buildProjectInterviewDraft: () => ({ draft: '', recommendations: [] }), queueInterviewSuggestions: (_items, selected, componentPlan) => ({ selected, componentPlan, addedTools: 0, addedComponents: 0 }) };
   ```
6. After `exportProjectPrdButton.addEventListener('click', exportProjectPrd);` (line 2418), add:
   ```js
   queueInterviewSuggestionsButton.addEventListener('click', queueInterviewSuggestionsFromDraft);
   ```

- [ ] **Step 5: Run the full suite and confirm it passes**

Run: `cd desktop && npm run check`
Expected: exit 0.

- [ ] **Step 6: Manual smoke test in the app**

Run: `cd desktop && npm start`
1. Click **Start Project Interview** and answer: "A shop that sells a digital book" / "Readers" / "People cannot pay online" / "Sell the book and let users log in with google" / "Send text message reminders".
2. The draft lists Stripe with its "Choose this when…" sentence, and **Add suggestions to my review list** is visible.
3. Click it. The note reports tools and project packages added and says nothing is installed. In the catalog, Planning with Files is checked. In the component library, Stripe is in the plan.
4. Click it again. The note says the suggestions are already on the list.
5. Click **Edit my answers**. The button hides.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/renderer/index.html desktop/src/renderer/app.js scripts/validate-desktop-ui.js
git commit -m "feat(interview): add job-matched suggestions to the review lists on request"
```

---

## Self-Review

- **Spec coverage:** matching on the job with `chooseWhen`/`example`/`plainPurpose`/`category` weighting → Task 1. Every match shows its `chooseWhen` → Tasks 1–2 (reason field, draft line). Low confidence stated → Task 1 `closeTo`, Task 2 draft line. No curation → none added. Bridge pre-selects into the Step 2 queue, Step 3 still runs → Task 3 plus the no-install contract check. Tools and components separated → Task 2 `queueInterviewSuggestions` test. Offline → Global Constraints; the module has no I/O. Catalog sync assertion → already in `validate-catalog-details.js`.
- **Out of this plan (plans 2 and 3):** `scanner.js` / `ledger.js` / `reconcile.js`, the Manage screen, Reinstall, plugin and MCP resolvers, and the silent TTL refresh.
- **Types:** `Recommendation.scope` is `'This computer'|'Selected project'` in Tasks 2–3. `Match.scope` is the catalog's `'This computer'|'This project'` and is only used inside Task 2's mapping, which re-derives scope from the install catalogs.
