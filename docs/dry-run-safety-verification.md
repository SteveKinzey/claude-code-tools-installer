# Installer dry-run safety verification

## Verified on 2026-08-28

The macOS adapter was executed with `--complete --dry-run --no-launch` in a newly created temporary home directory. The exact test body was:

```bash
tmp=$(mktemp -d /tmp/ccti-dry-run.XXXXXX)
HOME="$tmp" bash setup-my-claude.sh --complete --dry-run --no-launch
find "$tmp" -mindepth 1 -maxdepth 4 -print
rm -rf "$tmp"
```

The command returned exit code `0` and listed these planned actions: prepare a managed Node.js runtime when missing; wait for the official Claude Code bootstrap before selected tools; prepare the review-only plugin checklist; queue review-only commands for Superpowers, Anthropic Agent Skills, and Claude HUD; and check for Repomix and Playwright MCP servers without executing Claude Code.

The temporary home directory was empty after the command finished. It contained no `.claude.json`, `.claude` directory, backup, installer manifest, plugin checklist, or installer log. The test directory and its captured output were removed after inspection.

The verification was repeated after the dry-run guards were applied. It again returned exit code `0` and reported `temporary_home_entries=0`. The dry-run output confirmed planned Node.js preparation, Claude Code bootstrap, plugin checklist preparation, review-only plugin commands, and non-executing Repomix/Playwright MCP existence checks.

## Defect corrected

An earlier dry run created a Claude settings file indirectly by calling `claude mcp list` to check whether MCP servers already existed. It also created installer state and logs before the dry-run guard was applied. The three platform adapters now do both of the following when in dry-run mode:

1. They do not create installer directories, manifests, logs, plugin checklists, or cloned skill paths.
2. They do not call the Claude CLI to discover MCP servers; instead they clearly report that the check would occur in a real run.

This change preserves dry-run output while preventing setup-state mutations. The macOS and Linux shell adapters use the shared guard pattern; the Windows PowerShell adapter has the corresponding `DryRun` guards and is ready for Windows-host validation.
