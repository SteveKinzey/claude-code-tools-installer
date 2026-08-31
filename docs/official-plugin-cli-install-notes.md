# Official Claude Code Plugin CLI Notes

## Source checked

- Anthropic, [Discover and install prebuilt plugins through marketplaces](https://code.claude.com/docs/en/discover-plugins), retrieved 2026-08-31.

## Findings used by CCTI

Anthropic documents the noninteractive `claude plugin install` shell command as an alternative to the interactive `/plugin` panel. It installs to user scope unless the caller supplies `--scope`. For a plugin backed by a command source, `--yes` accepts the displayed command. The plugin command can refresh a named marketplace before lookup and returns its own success or failure output.

The official marketplace uses the name `claude-plugins-official`. Anthropic documents known-plugin syntax such as `claude plugin install <plugin-name>@claude-plugins-official`. A marketplace must exist before CCTI can install a plugin from it.

## CCTI boundary

The desktop app may execute a fixed, reviewed marketplace-add or plugin-install command after a person enables the named item, reviews the plain-language change, and confirms it. It must not run an arbitrary command supplied by a catalog, silently install credential-sensitive integrations, collect credentials, or claim that a plugin is active in an already-open Claude Code session. It should state when a restart or Claude Code’s own reload is still needed.
