# Claude Code Plugin Architecture and Namespace Separation

**Presenter:** Manus AI
**Audience:** CCTI users and maintainers
**Estimated duration:** 7 minutes
**Purpose:** Explain why installing Claude Code does not install every plugin, why `/productivity:start` and `/productivity:update` are namespaced, and how CCTI should present Claude.ai-synced plugins truthfully.

## Slide 1 — The outcome

**On screen:** A simple three-layer diagram: *Claude Code CLI* → *plugin sources* → *namespaced commands*.

**Speaker script:**

> Claude Code is the runtime. Plugins are optional capability packages that the runtime loads. This distinction is the reason installing Claude Code does not automatically create commands such as `/productivity:start`.
>
> CCTI installs and verifies the Claude Code runtime. It can install selected marketplace plugins through a reviewed path. But a plugin that comes from a user’s Claude.ai account is neither a marketplace package nor a local CCTI install. CCTI must discover it and explain how it is activated, rather than pretending it can install it.

**Transition:** “Now let’s separate the runtime from the sources that supply extensions.”

## Slide 2 — Three distinct plugin sources

**On screen:** A comparison table.

| Source | Who controls it | Where Claude Code gets it | CCTI action |
| --- | --- | --- | --- |
| Marketplace plugin | User chooses a marketplace and plugin | Local plugin cache after `claude plugin install` | CCTI can run its reviewed install plan |
| Skills-directory plugin | User or project owns the files | `.claude/skills/` | CCTI can install only reviewed local skills |
| Claude.ai-synced plugin | User or organization enables it in Claude.ai | `~/.claude/plugins/synced/` | CCTI can detect and guide; it must not run `plugin install` |

**Speaker script:**

> Claude Code supports more than one plugin source. The install semantics depend on the source.
>
> A marketplace plugin has a local installation record. CCTI can add a known marketplace and run a reviewed `claude plugin install` command for that type of plugin.
>
> A skills-directory plugin is local or project-owned. CCTI can place or verify carefully reviewed files in the appropriate skills directory.
>
> A Claude.ai-synced plugin is account-managed. Claude Code checks the signed-in Claude.ai account when it starts, downloads enabled plugins into its synced directory, and identifies them with the `@synced` source. The correct control plane is Claude.ai, not a local installer command. [1]

**Transition:** “With the source clear, the command prefix makes sense.”

## Slide 3 — Why commands use namespaces

**On screen:**

```text
Plugin manifest name: productivity
Skill directory:      skills/start/
Claude Code command:  /productivity:start
```

**Speaker script:**

> Plugins are namespaces. The `name` in a plugin manifest becomes the prefix for the plugin’s user-invocable skills. A skill stored as `skills/start/SKILL.md` in the Productivity plugin becomes `/productivity:start`. The update skill becomes `/productivity:update`.
>
> The prefix avoids collisions. One plugin can provide `start`, and another plugin can also provide a `start` skill, without either command overwriting the other. Claude Code reserves the unprefixed command space for built-in commands and standalone project or user customizations. [2]

**Transition:** “This is the key distinction between the Claude Code product and an individual Productivity command.”

## Slide 4 — Claude Code is not Productivity

**On screen:** Two side-by-side cards.

| Claude Code | Productivity plugin |
| --- | --- |
| CLI runtime and plugin host | Optional Anthropic plugin |
| Installed by the official Claude Code installer | Enabled in the user’s Claude.ai account |
| Provides the command system | Provides `/productivity:start` and `/productivity:update` |
| Can load many plugin sources | Is loaded as `productivity@synced` when account sync succeeds |

**Speaker script:**

> Claude Code owns the command system. Productivity contributes commands to that system only when the plugin is present and loaded.
>
> This avoids a bad product promise. “Claude Code installed successfully” means the runtime is ready. It does not mean every optional plugin in the Claude ecosystem is now present.
>
> For Productivity, the readiness check is `claude plugin list`. The important identifier is `productivity@synced`, not a marketplace installation record. If Claude Code reports a changed synced plugin during an active session, the user runs `/reload-plugins`, or starts a new session. [1]

**Transition:** “Here is the actual first-use flow.”

## Slide 5 — Productivity activation and first use

**On screen:** A four-step flow.

```text
1. Enable Productivity in Claude.ai
2. Start Claude Code while signed in
3. Run /reload-plugins if Claude Code says plugins changed
4. In the project folder: /productivity:start
```

**Speaker script:**

> First, enable Productivity in Claude.ai. Second, start Claude Code with the account that has the plugin enabled. Claude Code synchronizes account-managed plugins in the background.
>
> Third, if Claude Code announces a plugin change, run `/reload-plugins`. Fourth, start Claude Code from the repository where the task system should live, then run `/productivity:start`.
>
> The plugin’s current commands are `/productivity:start` for initialization and `/productivity:update` for task and context refresh. The optional comprehensive mode is `/productivity:update --comprehensive`.
>
> If the plugin is missing, do not run `claude plugin install productivity`. Anthropic documents that install, update, and uninstall do not apply to synced plugins. The user must manage it in Claude.ai. [1]

**Transition:** “That source boundary drives the CCTI product behavior.”

## Slide 6 — CCTI behavior after the catalog change

**On screen:** A CCTI catalog card mockup with these labels: *Productivity*, *Claude.ai-synced plugin*, *No local install command*.

**Speaker script:**

> CCTI now lists Productivity in its catalog as a **Claude.ai-synced plugin**. It is intentionally not a recommended default because CCTI cannot enable it for the user’s Claude.ai account.
>
> When users select it in CCTI, the platform adapters record the exact next step: enable it in Claude.ai, restart Claude Code, reload plugins if prompted, then use the namespaced commands.
>
> Setup verification treats a missing Productivity plugin as **optional**, not an installation failure. When `productivity@synced` appears in `claude plugin list`, CCTI reports it as ready and names the first commands. That keeps the installer honest and makes the capability discoverable.

## Slide 7 — Maintainer rule set

**On screen:** Five rules.

1. **Do not turn account sync into a fake marketplace install.**
2. **Never call `claude plugin install productivity` for a synced plugin.**
3. **Detect exact source identity:** `productivity@synced`.
4. **Keep optional sync separate from required setup health.**
5. **Show the namespaced first actions:** `/productivity:start` and `/productivity:update`.

**Speaker script:**

> The lasting rule is simple: CCTI may install only what it has a valid local installation authority to install. For everything else, CCTI should clearly identify the owner, detect local readiness without changing state, and give the user the shortest accurate next step.
>
> For account-synced plugins, Claude.ai is the control plane. Claude Code is the runtime. Namespacing identifies which plugin owns each capability. CCTI is the installer and guide that keeps those boundaries visible.

## Optional live demo

> Run `claude plugin list` and point out the **Synced from claude.ai** section. Show `productivity@synced`.
>
> Start Claude Code at a project root. Run `/productivity:start` to create the project task system. Then run `/productivity:update` to demonstrate the ongoing maintenance command.
>
> End by opening CCTI and showing that the Productivity catalog card says **Claude.ai-synced plugin** rather than promising a local installation.

## References

[1]: https://code.claude.com/docs/en/plugins-reference "Claude Code Plugins Reference — Plugins synced from claude.ai"
[2]: https://code.claude.com/docs/en/plugins "Create plugins — Plugin skill namespaces"
