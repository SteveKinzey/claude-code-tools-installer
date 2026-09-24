# Local Claude.ai-Synced Plugin Inventory

**Observed:** 2026-09-24
**Source:** `claude plugin list` in the local macOS environment.
**Interpretation:** These are plugins synchronized from the signed-in Claude.ai account. They are not marketplace installations and are managed from Claude.ai. [1]

## Summary

The local environment has **17 Claude.ai-synced plugins**. **15 are loaded** and **2 are disabled**. Productivity is one of the loaded plugins and is excluded from the “other plugins” table below.

## Other loaded plugins

| Plugin | Version | Status |
| --- | ---: | --- |
| Operations | 1.3.0 | Loaded |
| GitKraken | 1.0.0 | Loaded |
| Brand Voice | 1.1.0 | Loaded |
| Searchfit SEO | 1.0.0 | Loaded |
| Design | 1.2.0 | Loaded |
| Small Business | 1.35.1 | Loaded |
| Engineering | 1.2.0 | Loaded |
| Product Management | 1.2.0 | Loaded |
| Legal | 1.3.0 | Loaded |
| Sales | 2.0.1 | Loaded |
| Customer Support | 1.3.0 | Loaded |
| Marketing | 1.2.0 | Loaded |
| Data | 1.1.0 | Loaded |
| Cowork Plugin Management | 0.2.2 | Loaded |

## Disabled synced plugins

| Plugin | Version | Status |
| --- | ---: | --- |
| Zoom Plugin | 1.1.0 | Disabled |
| Bio Research | 1.2.0 | Disabled |

## Productivity record

| Plugin | Version | Status | User-invocable commands |
| --- | ---: | --- | --- |
| Productivity | 1.3.1 | Loaded | `/productivity:start`, `/productivity:update`, `/productivity:update --comprehensive` |

## Operating notes

A synced plugin is shown by Claude Code as `<name>@synced`. It is downloaded from Claude.ai into the local synced plugin directory when Claude Code starts with a qualifying Claude.ai sign-in. This is a background sync process. If Claude Code reports that plugins changed, run `/reload-plugins` in the active session; otherwise, start a new Claude Code session. [1]

To temporarily disable a synced plugin on this computer, use `claude plugin disable <name>@synced`. To enable it again, use `claude plugin enable <name>@synced`. To remove a synced plugin from the account-controlled set, disable it in Claude.ai. The local commands `claude plugin install`, `update`, and `uninstall` do not manage synced plugins. [1]

## References

[1]: https://code.claude.com/docs/en/plugins-reference "Claude Code Plugins Reference — Plugins synced from claude.ai"
