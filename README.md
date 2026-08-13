# Claude Code Tools Installer

Generated: 2026-08-12

This package builds a safer macOS setup path for the 30 Claude Code tools in Charlie Hills' current list. It does not blindly install everything. The default set is intentionally small:

- Superpowers
- gstack
- taste-skill
- anthropics/skills
- planning-with-files
- Repomix
- Playwright MCP
- Claude HUD

Several items are queued as Claude Code slash commands because Claude's plugin marketplace is operated from inside Claude Code, not from a normal shell script.

## Files

- `setup-my-claude.sh` - interactive installer
- `README.md` - this guide
- Runtime output after running the installer:
  - `~/.setup-my-claude/logs/` - command and version logs
  - `~/.setup-my-claude/manifest.tsv` - rollback manifest
  - `~/.setup-my-claude/claude-plugin-commands.md` - commands to paste into Claude Code

## Quick Start

```bash
chmod +x setup-my-claude.sh
./setup-my-claude.sh --dry-run --defaults
./setup-my-claude.sh --defaults
```

For fully interactive selection:

```bash
./setup-my-claude.sh
```

Rollback recorded shell-installed items:

```bash
./setup-my-claude.sh --uninstall
```

## Dependency Checks

The script checks for:

- `claude`
- `node`
- `npm`
- `npx`
- `git`

It does not install those dependencies for you.

## Important Risks

Third-party Claude Code extensions can include executable scripts, hooks, MCP servers, persistent memory workers, and credentials-handling logic. Review repositories before installing high-impact items.

The installer treats these as higher-risk and does not install them by default:

- `claude-mem` - persistent memory worker and hooks
- `github-mcp` - credential-sensitive
- `claude-code-router` - routes model/provider traffic
- `cc-switch` - desktop app/provider manager
- `vibe-kanban` - repository currently says the product is sunsetting
- `multica` - larger self-hosted platform
- `firecrawl` - requires API key for meaningful use
- `ecc` - broad harness/security/plugin framework

## How Plugin Items Work

Claude Code plugin marketplace installs use slash commands such as:

```text
/plugin marketplace add owner/repo
/plugin install plugin-name@marketplace
```

Those commands must be run inside Claude Code. The Bash installer writes them to:

```text
~/.setup-my-claude/claude-plugin-commands.md
```

Open Claude Code and paste the commands for the plugin items you selected.

## Classification and Install Matrix

| Item | Category | Classification | Default | Installer action | Verified source |
|---|---:|---|---:|---|---|
| learn-claude-code | Harness | Harness/framework | No | Clone reference repo | `https://github.com/shareAI-lab/learn-claude-code` |
| karpathy-skills | Harness | Memory/context utility | No | Clone reference repo | `https://github.com/multica-ai/andrej-karpathy-skills` |
| superpowers | Harness | Plugin/skills framework | Yes | Queue Claude plugin marketplace commands | `https://github.com/obra/superpowers`, `https://github.com/obra/superpowers-marketplace` |
| ponytail | Harness | Skill | No | `npx skills add ... --skill ponytail --agent claude-code` | `https://github.com/DietrichGebert/ponytail` |
| gstack | Harness | Skill pack/harness | Yes | Clone to `~/.claude/skills/gstack` and run `./setup` | `https://github.com/garrytan/gstack` |
| ECC | Harness | Plugin/harness/security | No | Queue Claude plugin marketplace commands | `https://github.com/affaan-m/ECC` |
| taste-skill | Skills | Skill | Yes | `npx skills add ... --skill design-taste-frontend --agent claude-code` | `https://github.com/Leonxlnx/taste-skill` |
| anthropics/skills | Skills | Official skills marketplace | Yes | Queue Claude plugin marketplace commands | `https://github.com/anthropics/skills` |
| wshobson/agents | Skills | Plugin marketplace/subagents | No | Queue Claude plugin marketplace commands | `https://github.com/wshobson/agents` |
| claude-plugins-official | Skills | Official plugin marketplace | No | Queue browse/install note | `https://github.com/anthropics/claude-plugins-official` |
| ui-ux-pro-max | Skills | Skill/reference | No | Clone reference repo | `https://github.com/nextlevelbuilders/ui-ux-pro-max` |
| awesome-claude-skills | Skills | Catalog/reference | No | Clone reference repo | `https://github.com/ComposioHQ/awesome-claude-skills` |
| planning-with-files | Memory | Skill | Yes | `npx skills add ... --skill planning-with-files --agent claude-code` | `https://github.com/OthmanAdi/planning-with-files` |
| claude-mem | Memory | Memory/context utility | No | `npx claude-mem install` | `https://github.com/thedotmack/claude-mem` |
| CodeGraph | Memory | CLI/tool | No | `npm install -g @colbymchenry/codegraph` | `https://github.com/colbymchenry/codegraph` |
| Graphify | Memory | Skill/CLI | No | `npx skills add ... --skill graphify --agent claude-code` | `https://github.com/Graphify-Labs/graphify` |
| Repomix | Memory | CLI/MCP server | Yes | `npm install -g repomix`; `claude mcp add repomix -- npx -y repomix --mcp` | `https://github.com/yamadashy/repomix` |
| Multica | Tools | Harness/framework | No | Clone reference repo only | `https://github.com/multica-ai/multica` |
| Firecrawl | Tools | Plugin/MCP/CLI | No | Install `firecrawl-cli`; queue plugin note | `https://github.com/firecrawl/firecrawl-claude-plugin`, `https://github.com/firecrawl/firecrawl-mcp-server` |
| CC Switch | Tools | Desktop CLI/tool | No | `brew install --cask cc-switch` if Homebrew exists | `https://github.com/farion1231/cc-switch` |
| Vibe Kanban | Tools | Desktop/web tool | No | Document only; project says sunsetting | `https://github.com/BloopAI/vibe-kanban` |
| GitHub MCP | Tools | MCP server | No | Queue credential-sensitive setup note | `https://github.com/github/github-mcp-server` |
| Playwright MCP | Tools | MCP server | Yes | `claude mcp add playwright npx @playwright/mcp@latest` | `https://github.com/microsoft/playwright-mcp` |
| Claude Code Router | Tools | CLI/router | No | `npm install -g @musistudio/claude-code-router` | `https://github.com/musistudio/claude-code-router` |
| awesome-mcp-servers | Tools | Catalog/reference | No | Clone reference repo | `https://github.com/punkpeye/awesome-mcp-servers` |
| system-prompts-ai | Cost | Reference/research | No | Clone reference repo | `https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools` |
| claude-code-best-practice | Cost | Reference/workflows | No | Clone reference repo | `https://github.com/shanraisshan/claude-code-best-practice` |
| Codex in Claude | Cost | CLI/plugin integration | No | Manual review note | `https://github.com/openai/codex` |
| Claude HUD | Cost | Plugin/monitoring | Yes | Queue Claude plugin marketplace commands | `https://github.com/jarrodwatts/claude-hud` |
| Caveman | Cost | Cost/token workflow | No | Clone reference repo | `https://github.com/JuliusBrussel/caveman` |

## Recommended Operating Procedure

1. Run `--dry-run --defaults`.
2. Install the defaults.
3. Open `~/.setup-my-claude/claude-plugin-commands.md`.
4. Paste only the queued plugin commands you actually want into Claude Code.
5. Use optional items one at a time. Do not enable every memory, router, agent, and cost tool at once.

## Notes on Evidence

The source list came from the current text version of Charlie Hills' top-30 post because the referenced image payload was not available in the imported conversation preview. Installation methods were checked against official Claude Code docs or the linked repositories where possible. Some repos are catalogs or reference material, not installable Claude extensions; those are cloned only when selected.
