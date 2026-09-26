# Claude Code precedence rules for duplicates (researched 2026-09-26)

These are the documented rules that CCTI's duplicate resolution relies on. The spec says: "Until that order is verified for a given kind, CCTI does not guess: it presents both locations and asks the user which to keep." Each rule below is verified against Claude Code's documentation and the installed CLI's `--help` output, or marked **not documented**.

## MCP servers

Source: https://code.claude.com/docs/en/mcp.md

- **Where each scope is stored:** local → `~/.claude.json` (under the project's entry); project → `.mcp.json` in the project root; user → `~/.claude.json`.
- **One definition wins; nothing is merged.** "When the same server is defined in more than one place, Claude Code connects to it once, using the definition from the highest-precedence source. The entire server entry from that source is used; fields are not merged across scopes."
- **Order, highest first:** local, project, user, plugin-provided servers, claude.ai connectors. An organization's `managedMcpServers` entry outranks all of them.
- **How duplicates are matched:** local, project, and user servers are matched by **name**. Plugin and connector servers are matched by **endpoint** (the same URL or command).
- **When a connector loses:** a server you added outranks a claude.ai connector at the same URL. `/mcp` shows that connector as hidden.
- **CLI:**
  - Remove from one scope: `claude mcp remove <name> --scope <local|project|user>`.
  - Omitting `--scope` "removes from whichever scope it exists in". What happens when the name exists at several scopes is **not documented**, so CCTI always passes `--scope`.
  - `claude mcp list` / `get` have **no documented JSON output** and **do not document printing the scope**. CCTI reads the scope from the config files.

## Plugins

Sources: https://code.claude.com/docs/en/plugins/loading.md, https://code.claude.com/docs/en/plugins/cli-reference.md

- **A plugin is identified as `name@marketplace`.** "When two marketplaces offer the same name, use the qualified form." Two installs such as `foo@market-a` and `foo@market-b` are separate installs.
- **Which of them loads when both are enabled is not documented.** CCTI asks the user which one to keep.
- **Name conflicts across origin types**, highest first:
  1. managed `enabledPlugins`
  2. `--plugin-dir` / `--plugin-url`
  3. an installed marketplace plugin
  4. a skills-directory plugin
  5. a claude.ai-synced plugin

  A synced plugin that shares a name with any other enabled plugin is reported as not loaded.
- **Enable state across settings files:** the value from the highest-precedence source that mentions the id wins. The order is user < project < local < flag < managed.
- **CLI:**
  - `claude plugin disable <name@marketplace> --scope <user|project|local> [--json]`. It is reversible with `claude plugin enable … --scope …`, so CCTI's plugin resolution **disables**; it never uninstalls.
  - `claude plugin list --json` gives `id`, `version`, `scope`, `enabled`, `installPath`, `projectPath`, `mcpServers`, `errors`, and more.

## Skills

Source: https://code.claude.com/docs/en/skills.md

- **Personal beats project.** "Enterprise over personal, and personal over project. With `deploy` in both `~/.claude/skills/` and the project's `.claude/skills/`, `/deploy` runs the personal one."
- **Plugin skills never collide.** They are namespaced as `/plugin-name:skill-name`, so both load.
- **Consequence for cleanup:** when a personal copy and a project copy are identical, CCTI should keep the personal copy. Moving the personal copy would remove the skill from every other project. The existing cleanup keeps the newest copy instead; plan 3 (`docs/superpowers/plans/2026-09-26-ccti-duplicate-resolution.md`, Task 4) changes it to this rule.
