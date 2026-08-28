# Deduplication Decisions

## Result

The unified source inventory contains **200 records**. It resolves to **176 standalone selections** and **24 bundled Convex-plugin capabilities**. No standalone selection was removed solely because of a similar display name.

| Similar name | Decision | Rationale |
|---|---|---|
| `convex-api-keys` and `Convex Api Keys` | **Retain both.** | They are separate directory entries with different package and publisher identities. The final catalog must key these by package identifier, not display name. |
| `convex-authz` skill and `convex-authz` component | **Retain both, with different layers.** | The skill is bundled inside the Convex Claude Code plugin. The directory entry is a separately installable application component. |
| `crons` skill and `Crons` component | **Retain both, with different layers.** | The skill guides Claude Code. The component adds runtime Convex functionality. |
| Firecrawl plugin/CLI and Firecrawl component | **Retain both, with different products.** | The curated installer entry is a Claude Code-oriented plugin/CLI path. The directory entry is a Convex backend component. |

## Catalog IDs

The expanded catalog must not use a human-readable name as its primary key. Each item should have a stable ID derived from its installation identity, such as the Claude Code marketplace name or the npm package name. This prevents similarly named items from being collapsed or installed incorrectly.

## Counting rule

> A standalone selection is something a user can independently choose or install. A bundled capability is delivered after the parent Convex Claude Code plugin is installed and must be shown as included detail, not as a separate installation checkbox.

## Sources

[1]: https://docs.convex.dev/ai/using-claude-code "Using Claude Code with Convex"
[2]: https://docs.convex.dev/ai/convex-plugins "Convex Agent Plugins"
[3]: https://github.com/get-convex/convex-backend-skill "Convex Plugin for Claude Code"
[4]: https://www.convex.dev/components/components.md "Convex Components Directory"
