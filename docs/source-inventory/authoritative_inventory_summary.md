# Authoritative Inventory Summary

## Counting rule

A **standalone choice** is something a user can select or install independently. A **bundled capability** is a skill, agent, hook, monitor, or MCP server delivered as part of the Convex Claude Code plugin. These must not be presented as separate one-click installations.

| Inventory layer | Count | Counting treatment |
|---|---:|---|
| Initial curated Claude Code catalog | 30 | Standalone catalog entries |
| Convex Claude Code plugin | 1 | Standalone catalog entries |
| Convex plugin bundled capability | 24 | Bundled capabilities |
| Convex Components Directory | 145 | Standalone catalog entries |

**Total source records:** 200
**Standalone choices:** 176
**Bundled Convex-plugin capabilities:** 24

## Sources

1. Current installer catalog: `desktop/catalog.json`.
2. Convex Claude Code documentation: https://docs.convex.dev/ai/using-claude-code.
3. Convex plugin overview: https://docs.convex.dev/ai/convex-plugins.
4. Claude Code-specific Convex plugin source: https://github.com/get-convex/convex-backend-skill.
5. Convex Components Directory: https://www.convex.dev/components/components.md.

## External-source evidence captured 2026-08-26

| Source | Verified finding | URL |
|---|---|---|
| Convex Components Directory | The machine-readable directory lists **145 components**. Its **26 official Convex components** are a subset of those 145 and are not added again to the standalone total. | https://www.convex.dev/components/components.md |
| Convex Claude Code documentation | The official parent install is `convex@claude-plugins-official`; it bundles deployment tools, hooks/monitors, skills, and specialized agents. | https://docs.convex.dev/ai/using-claude-code |
| Convex plugin overview | The plugin maps natural-language work to skills such as quickstart, auth, agent, migrate, add, and reviewer; new skills can land over time. | https://docs.convex.dev/ai/convex-plugins |
| Claude Code-specific plugin source | The current source includes 16 skill directories, 2 subagents, the Convex MCP server, 2 hooks, and 3 named monitors in addition to the parent plugin. | https://github.com/get-convex/convex-backend-skill |

> The component directory is a live catalog. The installer must show its source date and must never silently install newly discovered component packages.

