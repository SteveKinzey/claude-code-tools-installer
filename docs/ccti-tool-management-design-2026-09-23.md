# CCTI Tool Management — Design

**Date:** 2026-09-23
**Status:** Approved design, not yet planned or implemented
**Scope:** Turn CCTI from a one-shot installer into an ongoing management surface for Claude Code and its tools.

---

## Purpose

CCTI exists to help a **new user make smart decisions** about Claude Code and its tools. Today it installs well but cannot help anyone *manage* what they have: it has no memory of what it installed, it can only de-duplicate skills, and its project interview deliberately stops short of acting on its own advice.

This design closes those three gaps without changing what CCTI already does well. The Step 1 / Step 2 / Step 3 install flow is untouched. The safety doctrine is untouched: *the app never installs anything just because it is shown.*

### Success criteria

A user can:

1. Open CCTI and see every Claude Code skill, plugin, and MCP connection on their machine — whether CCTI installed it or not.
2. See when something they installed through CCTI has gone missing, and reinstall it.
3. Find duplicate skills, plugins, and MCP connections and resolve them safely.
4. Describe their project in plain words and get tool suggestions that match *their situation*, with the reason stated, and load those suggestions into the existing review-and-confirm queue.

### Ease of use is a requirement, not a preference

The whole path — first install, the Windows convenience of never opening PowerShell, and now management — must stay **easy**. That conflicts with CCTI's deliberate safety friction, so the two are separated explicitly:

**Keep friction that protects the user.** The Step 3 confirmation before any install. The typed `UNINSTALL CCTI`. Re-verifying state immediately before moving or removing anything. This friction is the product's integrity and the README's promise.

**Remove friction that is the app leaking its internals:**

| Today | Problem | Change |
|---|---|---|
| 10-minute plan TTL → *"This review has expired. Run the checkup again."* | A user who steps away returns to a dead screen and a chore. The real goal — never act on stale state — is already met by re-verifying at action time. | Refresh silently instead of scolding. |
| *"Run the checkup again"* | App-speak. The user does not know what a checkup is or why it expired. | Plain language, or no message at all. |
| Multi-step review for read-only actions | Ceremony without risk. | Reading state needs no confirmation. |

**No terminal surface in management.** A path, a JSON fragment, or a `claude mcp remove` command is never the thing the user acts on. Technical detail belongs in the existing activity log. This is what "no more PowerShell" has to mean on the management screens too, not only during install.

**Errors state a next action.** Every failure message says what to do next in plain words. No stack traces, no error codes as the primary text.

### Non-goals

- Replacing or restyling the existing install flow.
- Managing settings files, Node runtimes, or project packages as de-duplicable items. They are shown read-only.
- Any network call in the recommendation path. Matching is fully offline.
- Auto-installing anything. Every install still passes the Step 3 confirmation.

---

## Sequencing

Management work starts on a clean tree. Before any of it:

1. Commit the in-flight diagnostics panel (`runtime-path-health`) and its tests.
2. Merge the RC commit `fix(setup): recover MCP registration and stage signed Windows release`.
3. Delete the ~20 `.tmp-*` scratch files in the repo root.
4. Cut and publish the release.

Both in-flight streams touch `desktop/src/main.js` and `desktop/src/renderer/app.js` — the same files this work lands in. Landing them first avoids sustained conflict.

---

## Architecture

New module `desktop/src/inventory/`, split by testability. `main.js` is already 3,389 lines; adding inventory, three-kind de-duplication, and interview wiring inline would make it unmaintainable.

| File | Responsibility | Depends on |
|---|---|---|
| `scanner.js` | Observe what is on disk now — skills, plugins, MCP. Extracted from existing checkup logic, not rewritten. | fs, `claude` CLI |
| `ledger.js` | Durable record of what **CCTI** installed. Reads/writes `userData/inventory.json`. | fs |
| `reconcile.js` | Merge scan and ledger into display rows. **Pure function.** | nothing |
| `matcher.js` | Rank catalog items against interview answers. **Pure function.** | nothing |

`reconcile.js` and `matcher.js` hold the logic most likely to be subtly wrong, so both are pure — testable with fixtures, no Electron boot required. `scanner.js` and `ledger.js` stay thin enough to be obvious by inspection.

### Ledger format

`app.getPath('userData')/inventory.json`. Plain JSON, no schema migrations in v1.

```json
{
  "schemaVersion": 1,
  "entries": [
    {
      "id": "playwright-mcp",
      "kind": "mcp",
      "name": "Playwright MCP",
      "scope": "user",
      "installedAt": "2026-09-14T10:22:31Z",
      "source": "ccti-catalog",
      "version": "1.4.0",
      "pathHint": "~/.claude.json#mcpServers"
    }
  ],
  "resolutions": [
    {
      "id": "seo-tools",
      "kind": "skill",
      "resolvedAt": "2026-09-20T14:02:11Z",
      "action": "backup",
      "movedFrom": "~/.claude/skills/seo-tools",
      "movedTo": "~/.claude/skills/.ccti-backup-20260920-140211/seo-tools"
    }
  ]
}
```

### Reconciliation states

| In ledger | On disk | State | Presented as |
|---|---|---|---|
| yes | yes | `installed` | "CCTI · 2026-09-14" |
| yes | no | `missing` | "you installed it, it's gone" → Reinstall |
| no | yes | `external` | "outside CCTI" — visible, never auto-touched |
| — | 2+ copies | `duplicate` | both locations listed → Resolve |

### Two invariants

**1. The scan always wins.** The ledger is a claim about the past, never an authority over the present. Where they disagree about existence, disk is correct and the ledger is stale. The ledger contributes provenance and history only.

**2. A corrupt or missing ledger degrades, never blocks.** An unreadable `inventory.json` renders every row as `external`, the app works normally, and CCTI offers to rebuild. Losing the ledger must never cost a user the ability to manage their tools. This is why the ledger is advisory plain JSON rather than a precious store.

**Resolved duplicates are not losses.** When CCTI backs up a duplicate, that artifact leaves disk. Without the `resolutions` record, the next reconcile would report it as `missing` — alarming and wrong. Reconcile treats a resolved duplicate as expected absence.

---

## Duplicate resolution

Three kinds, three removal semantics. This is why de-duplication cannot be one code path.

| Kind | What a duplicate is | Resolution | Never |
|---|---|---|---|
| **Skill** | Same `SKILL.md` name in two folders | Move shadowed copy to timestamped backup dir | Delete outright |
| **Plugin** | Same plugin from two marketplaces | Disable one *source* | Delete cache files — they are re-fetched |
| **MCP** | Same server registered at two scopes | `claude mcp remove <name> --scope <scope>` | Hand-edit `.claude.json` — the CLI owns it |

The skill path already exists (`duplicateSkillGroups`, `duplicateSkillCleanupGroups`, backup moves, symlink exclusion). It is **extended, not rewritten**: plugins and MCP become two more resolvers behind a shared interface.

**Which copy survives.** CCTI keeps the copy Claude Code actually resolves at runtime and backs up the shadowed ones. Removing the winning copy would silently change behavior.

The precedence order must be read from Claude Code's documented resolution rules per kind — project scope versus user scope versus plugin-provided — and encoded in one place, not inferred per call site. **Until that order is verified for a given kind, CCTI does not guess: it presents both locations and asks the user which to keep.** A wrong automatic choice here silently changes which tool runs, which is worse than one extra question. The manage screen names the keeper before the user confirms in either case.

**Check-then-act discipline is inherited.** Existing code re-verifies state between preview and action (*"This skill changed after the preview. Nothing was moved."*) under a 10-minute plan TTL. Plugins and MCP adopt the same pattern. No resolver acts on a stale plan.

### Reinstall behavior

`Reinstall` on a `missing` item **re-resolves through the current catalog** rather than replaying the recorded install action. A recorded action can point at a version or URL that no longer exists, and catalog entries get corrected — replaying a stale one can reinstall a known-broken version. A user clicking Reinstall wants the tool working now.

Two guards:
- If the catalog entry changed since the recorded install, say so in one line before acting.
- If the id is no longer in the catalog at all, say that plainly. Never fail silently or half-install.

### Manage screen

One list grouped by kind, four state badges, one action per row: `Reinstall` for `missing`, `Resolve` for `duplicate`, none for `external`. Settings, runtimes, and project packages appear read-only — multiple Node versions and multiple settings files are normal, not duplicates, and there is no safe generic rule for them.

It replaces no existing screen.

---

## Interview bridge and job matching

### The problem with category-level recommendation

The catalog holds 12 payment components. They do **different jobs**, as their own `chooseWhen` text shows:

| Component | Job |
|---|---|
| Stripe | one-time sales or recurring memberships |
| Polar | membership levels, or pay-what-you-want |
| Autumn | check whether a user has paid for a specific feature before allowing it |
| RevenueCat | mobile subscription honored on the website |
| Adyen | card checkout for a store |

A single curated pick per category would confidently misdirect: answering "payments → Autumn" sends someone selling a digital book to a feature-gating library. For an app whose purpose is helping beginners decide well, a confidently wrong answer is worse than a list.

### Matching on the job

`matcher.js` scores interview answers against `catalog-details.json`, which has complete coverage — 180/180 entries, 35 tools and 145 components, each with `plainPurpose`, `chooseWhen`, `example`, `cctiAction`, `userAction`, `kind`, `scope`.

Weighting, highest first:

1. **`chooseWhen`** — the field is literally "choose this when…", the closest thing to a stated job.
2. **`example`** — concrete scenarios match how people describe their own projects.
3. **`plainPurpose`** — general fallback.
4. **`category`** — small boost, never decisive.

This replaces the 8 regex rules in `createRecommendations`, which match against tool *names* only and leave most of the 180 items unreachable. No hand-authored keyword triggers are needed; the descriptive text already exists.

**Every match displays the `chooseWhen` sentence that matched it.** For a beginner an unexplained recommendation is one more thing to take on faith. The stated reason is the decision aid, not the ranking.

**No curation layer in v1.** A curated pick-list is a second opinion-store that drifts from the catalog, and `chooseWhen` already separates same-category items cleanly. Ship matching first; curate only the pairs that genuinely tie in practice, which may be none.

**Low confidence is stated, not hidden.** When the top match is not clearly ahead of the second, CCTI shows both and states how they differ, quoting their own `chooseWhen` text. For a beginner, "these two differ like this" is a better decision aid than a confident pick that may be wrong. Fabricating a winner to look decisive is the failure mode this avoids.

### The bridge

The interview currently ends at *"It does not select or install anything."* That becomes: matches **pre-select** into the existing Step 2 queue, and the Step 3 confirmation still runs. The interview gains the power to propose, never to install.

**Tools and components stay separated.** `catalog-details.json` carries `kind` and `scope`. Components require a chosen project folder and are never mixed into the local-tool queue. The bridge respects that split.

### Data hazard

Matching reads `catalog-details.json` (180 entries, full descriptions). Installing reads `catalog.json` (35) and `convex-components.json` (145, which carries no description field at all). Three files, one identity space. If they drift, the interview recommends items the installer cannot install.

A sync assertion belongs in the test suite: every `catalog-details.json` id resolves in one of the other two files, and the counts match its own `catalogCounts` block.

---

## Testing

Follows the existing repo convention — plain Node scripts under `scripts/`, run in `.github/workflows/desktop-validation.yml`.

| Target | Tests |
|---|---|
| `reconcile.js` | Fixture ledger × fixture scan produces all four states; corrupt ledger degrades to all-`external` without throwing; resolved duplicate does not report as `missing` |
| `matcher.js` | "sell a digital book" ranks Stripe above Autumn; "limit free users to 10 messages" inverts that; every returned match carries a non-empty reason |
| Resolvers | Failure injection per kind, following the existing `test-duplicate-skill-ui.js` pattern |
| Catalog sync | Every `catalog-details.json` id resolves; counts match `catalogCounts` |

---

## Decisions on record

| Decision | Choice | Why |
|---|---|---|
| Source of truth | Reconciled scan + ledger | Only option that distinguishes CCTI-installed from hand-installed, which is what makes uninstall and de-duplication safe |
| De-duplication scope | Skills, plugins, MCP | The three that actually collide and that CCTI already detects. Settings and runtimes have no safe duplicate rule |
| Recommendation engine | Offline scoring over existing description fields | Preserves private-first, needs no API key, fully testable |
| Curation model | Match on job; no curation layer in v1 | Category-level picks misdirect, because same-category items do different jobs. `chooseWhen` already separates them |
| Low-confidence matches | Show both and state the difference | A confident wrong answer is worse than an honest comparison for a beginner |
| Reinstall | Re-resolve through current catalog | Recorded actions go stale; the user wants it working now, not replayed |
| Ease of use | Keep protective friction, remove internal-leak friction | The two conflict; separating them is the only honest resolution |
| Sequencing | Land diagnostics + RC first | Both touch the same files this work lands in |

## Open questions

- The runtime precedence order per kind (project vs user vs plugin scope) must be read from Claude Code's documented resolution rules before any automatic keeper selection ships. Until verified per kind, CCTI asks.
- Whether the silent TTL refresh introduces any case where a plan could be acted on against state the action-time re-verify does not cover. Reviewed during planning.
