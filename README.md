# Claude Code Tools Installer for macOS

Safe interactive Bash installer for a curated Claude Code tools stack, including Claude Code skills, plugins, MCP servers, memory utilities, harnesses, developer tools, and cost-monitoring helpers.

This repository is designed for developers and AI consultants who want a repeatable Claude Code setup without blindly installing every popular third-party extension.

## What This Installs

`setup-my-claude.sh` helps install or queue setup steps for 30 Claude Code-related tools from Charlie Hills' curated list. It classifies each item before installing it because these tools are not all the same kind of software.

The installer separates tools into:

- Claude Code skills
- Claude Code plugins
- MCP servers
- CLI tools
- Memory and context utilities
- Harnesses and agent frameworks
- Cost and monitoring tools
- Reference repositories and catalogs

The default installation is intentionally conservative. It installs or queues only a practical starter set:

- Superpowers
- gstack
- taste-skill
- Anthropic skills
- planning-with-files
- Repomix
- Playwright MCP
- Claude HUD

## Why This Exists

Many Claude Code extension lists mix together skills, plugins, MCP servers, CLIs, memory tools, and full frameworks. Installing them all with one copied command is risky.

This installer gives you:

- A curated default Claude Code setup
- Interactive category and item selection
- macOS-friendly Bash support
- Dependency checks
- Dry-run mode
- Existing-install detection where feasible
- Source and version logging
- Rollback manifest
- A generated plugin-command queue for Claude Code slash commands
- A README matrix showing how each item is installed

## Quick Start

Download this repository or the latest release, then run:

```bash
chmod +x setup-my-claude.sh
./setup-my-claude.sh --dry-run --defaults
./setup-my-claude.sh --defaults
```

The first command checks what would happen. The second command performs the default install.

## Install from GitHub

Clone the repository:

```bash
git clone https://github.com/SteveKinzey/claude-code-tools-installer.git
cd claude-code-tools-installer
chmod +x setup-my-claude.sh
```

Preview the curated default install:

```bash
./setup-my-claude.sh --dry-run --defaults
```

Run the curated default install:

```bash
./setup-my-claude.sh --defaults
```

Open the generated Claude Code plugin command queue:

```bash
open ~/.setup-my-claude/claude-plugin-commands.md
```

Some Claude Code plugins must be installed from inside Claude Code using slash commands. This script writes those commands to the plugin queue instead of trying to execute them from Bash.

## Install from DMG or ZIP

Download the latest release:

https://github.com/SteveKinzey/claude-code-tools-installer/releases

Then:

1. Open the DMG or unzip the ZIP.
2. Open Terminal.
3. Change into the extracted folder.
4. Run:

```bash
chmod +x setup-my-claude.sh
./setup-my-claude.sh --dry-run --defaults
./setup-my-claude.sh --defaults
```

Because the DMG and Bash script are not Apple-notarized, macOS may show a security warning. For public use, review the script before running it.

## Commands

Interactive selection:

```bash
./setup-my-claude.sh
```

Curated defaults:

```bash
./setup-my-claude.sh --defaults
```

Dry run:

```bash
./setup-my-claude.sh --dry-run
```

Dry run with defaults:

```bash
./setup-my-claude.sh --dry-run --defaults
```

Install a specific item:

```bash
./setup-my-claude.sh --item playwright-mcp
```

Install multiple specific items:

```bash
./setup-my-claude.sh --item playwright-mcp,repomix,planning-with-files
```

Install a whole category:

```bash
./setup-my-claude.sh --category tools
```

Install multiple categories:

```bash
./setup-my-claude.sh --category skills,memory
```

Select every installable item:

```bash
./setup-my-claude.sh --all
```

Rollback recorded installs:

```bash
./setup-my-claude.sh --uninstall
```

Show help:

```bash
./setup-my-claude.sh --help
```

## Requirements

The installer checks for these dependencies:

- Claude Code: `claude`
- Node.js: `node`
- npm: `npm`
- npx: `npx`
- Git: `git`

It does not install Claude Code, Node.js, npm, npx, Git, Homebrew, Docker, or API keys.

Recommended dependency check:

```bash
claude --version
node --version
npm --version
npx --version
git --version
```

## Runtime Files

After the installer runs, it writes operational files under:

```text
~/.setup-my-claude/
```

Important files:

```text
~/.setup-my-claude/logs/
~/.setup-my-claude/manifest.tsv
~/.setup-my-claude/claude-plugin-commands.md
```

The log records commands and source versions where practical.

The manifest records installed paths, MCP registrations, npm packages, and cask installs where practical.

The plugin command file contains Claude Code slash commands that must be run manually inside Claude Code.

## Claude Code Plugin Setup

Claude Code plugin marketplace installs use slash commands such as:

```text
/plugin marketplace add owner/repo
/plugin install plugin-name@marketplace
/reload-plugins
```

Those commands must be run inside Claude Code. Bash cannot reliably execute Claude Code slash commands because they are part of the interactive Claude Code interface.

This installer writes plugin commands to:

```text
~/.setup-my-claude/claude-plugin-commands.md
```

After running the installer:

```bash
open ~/.setup-my-claude/claude-plugin-commands.md
```

Then paste the relevant commands into Claude Code.

## Safety Model

This project is conservative by design.

Third-party Claude Code extensions can include executable scripts, hooks, MCP servers, persistent memory workers, routing layers, and credentials-handling logic. That creates real security and operational risk.

The installer does not install every item by default. Higher-impact tools are opt-in.

Higher-risk or more invasive items include:

- `claude-mem` - persistent memory worker and hooks
- `github-mcp` - credential-sensitive MCP server
- `claude-code-router` - provider/model routing layer
- `cc-switch` - desktop app/provider manager
- `vibe-kanban` - repository currently says the product is sunsetting
- `multica` - larger self-hosted platform
- `firecrawl` - requires API key for meaningful use
- `ecc` - broad harness/security/plugin framework

Review each repository before enabling optional tools.

## Recommended Workflow

Use this process for a safe Claude Code tools setup:

1. Run the dry run.
2. Install the curated defaults.
3. Review the generated plugin command file.
4. Paste only the plugin commands you actually want into Claude Code.
5. Use Claude Code for a few real projects.
6. Add optional memory, routing, GitHub, Firecrawl, and framework tools one at a time.
7. Keep credentials out of shell history whenever possible.
8. Re-run dry-run mode before adding new categories.

Avoid installing every memory system, agent framework, MCP server, and cost tool at once. Overlapping tools can make Claude Code harder to debug.

## Item IDs

Use these IDs with `--item`:

```text
learn-claude-code
karpathy-skills
superpowers
ponytail
gstack
ecc
taste-skill
anthropic-skills
wshobson-agents
claude-plugins-official
ui-ux-pro-max
awesome-claude-skills
planning-with-files
claude-mem
codegraph
graphify
repomix
multica
firecrawl
cc-switch
vibe-kanban
github-mcp
playwright-mcp
claude-code-router
awesome-mcp-servers
system-prompts-ai
best-practice
codex-plugin-cc
claude-hud
caveman
```

Categories:

```text
harness
skills
memory
tools
cost
```

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

## Rollback

Rollback uses the manifest written during installation:

```bash
./setup-my-claude.sh --uninstall
```

The rollback removes recorded paths, MCP registrations, global npm installs, and Homebrew casks where feasible.

Manual review may still be required for:

- Plugin commands installed inside Claude Code
- Credential-bearing MCP servers
- Tool-specific data directories
- Persistent memory stores

## SEO Keywords

This project is relevant to:

- Claude Code tools installer
- Claude Code macOS setup
- Claude Code skills installer
- Claude Code plugins
- Claude Code MCP servers
- Anthropic Claude Code extensions
- Claude Code Playwright MCP
- Claude Code Repomix MCP
- Claude Code memory tools
- Claude Code cost monitoring
- AI developer workflow automation

## Evidence and Limitations

The source list came from the current text version of Charlie Hills' top-30 Claude Code tools list because the original uploaded image was not available in the imported conversation preview.

Installation methods were checked against official Claude Code documentation or linked repository documentation where possible. Some repositories are catalogs or reference material rather than installable Claude extensions, so the installer clones those only when selected.

Repository installation instructions can change. Run dry-run mode first and review source repositories before installing optional tools.

## License

No license has been added yet. Until a license is added, this repository is public but not explicitly open-source licensed.
