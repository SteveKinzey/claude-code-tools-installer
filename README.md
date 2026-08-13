![Claude Code Tools Installer by SK America](assets/claude-code-tools-logo.png)

# Claude Code Tools Installer

Safe interactive installers for a curated Claude Code tools stack on macOS, Linux, and Windows, including Claude Code skills, plugins, MCP servers, memory utilities, harnesses, developer tools, and cost-monitoring helpers.

This repository is designed for developers and AI consultants who want a repeatable Claude Code setup without blindly installing every popular third-party extension.

## What This Installs

The platform installers help install or queue setup steps for 30 Claude Code-related tools from Charlie Hills' curated list. They classify each item before installing it because these tools are not all the same kind of software.

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

The problem is not that Claude Code lacks useful extensions. The problem is that the extension ecosystem is fragmented. A single screenshot or social post may include:

- Skills that belong in `~/.claude/skills`
- Claude Code plugins that must be installed from inside Claude Code
- MCP servers that register external tool access
- Global npm CLIs that change a machine's command environment
- Persistent memory systems that add hooks or background state
- Agent frameworks that change planning, delegation, and execution style
- Catalogs or reference repositories that are useful but not really installers

Those categories have different risk profiles. Treating all of them as equivalent "Claude installs" creates three practical problems:

1. You may install redundant tools that fight for the same workflow.
2. You may register MCP servers or memory systems before you understand their credential and data behavior.
3. You may lose track of what changed on your machine and how to undo it.

This installer gives you:

- A curated default Claude Code setup
- Interactive category and item selection
- macOS, Linux, and Windows entrypoints
- Dependency checks
- Dry-run mode
- Existing-install detection where feasible
- Source and version logging
- Rollback manifest
- A generated plugin-command queue for Claude Code slash commands
- A README matrix showing how each item is installed

## The Plausible Solution

This project takes a controlled-installation approach instead of a bulk-installation approach.

The installer does four things:

1. Classifies every listed tool before acting on it.
2. Installs only a conservative default set.
3. Queues plugin commands when Claude Code requires interactive slash commands.
4. Logs actions and writes a rollback manifest where feasible.

That does not make third-party extensions risk-free. It does make the setup repeatable, reviewable, and easier to debug. The result is a practical Claude Code starter environment that can grow over time instead of a pile of untracked one-off installs.

## Benefits

Use this installer when you want:

- A faster Claude Code setup without copying dozens of commands manually
- A safer default selection for real developer work
- A clear distinction between skills, plugins, MCP servers, CLIs, memory tools, and catalogs
- Repeatable setup across macOS, Linux, and Windows
- Dry-run output before any changes are made
- A record of what was installed and where
- A rollback path for shell-installed items
- A generated list of Claude Code plugin commands to run manually
- A public, auditable repository instead of private notes or random terminal history

The main trade-off is that the installer is intentionally conservative. It will not silently configure credentials, start self-hosted systems, or install every optional tool by default.

## Quick Start by Platform

macOS:

```bash
chmod +x setup-my-claude.sh
./setup-my-claude.sh --dry-run --defaults
./setup-my-claude.sh --defaults
```

Linux:

```bash
chmod +x setup-my-claude-linux.sh
./setup-my-claude-linux.sh --dry-run --defaults
./setup-my-claude-linux.sh --defaults
```

Windows PowerShell 7+:

```powershell
pwsh -ExecutionPolicy Bypass -File .\setup-my-claude.ps1 -DryRun -Defaults
pwsh -ExecutionPolicy Bypass -File .\setup-my-claude.ps1 -Defaults
```

The dry-run command checks what would happen. The install command performs the default install.

## Platform Support

| Platform | Installer | Distribution | Status |
|---|---|---|---|
| macOS | `setup-my-claude.sh` | GitHub, ZIP, notarized DMG | Primary supported platform |
| Linux | `setup-my-claude-linux.sh` | GitHub, ZIP, Linux tarball | Supported for Bash-compatible environments |
| Windows | `setup-my-claude.ps1` | GitHub, ZIP, Windows archive | Supported for PowerShell 7+; test on target Windows machines |

Claude Code itself and third-party tools may have their own platform limitations. The installers avoid automating platform-specific desktop apps when the upstream project does not document a safe cross-platform install path.

## Quick Start

Download this repository or the latest release, then run:

```bash
chmod +x setup-my-claude.sh
./setup-my-claude.sh --dry-run --defaults
./setup-my-claude.sh --defaults
```

The example above is for macOS. Use the Linux or Windows commands from the platform section when appropriate.

## Install from GitHub

Clone the repository:

```bash
git clone https://github.com/SteveKinzey/claude-code-tools-installer.git
cd claude-code-tools-installer
chmod +x setup-my-claude.sh
```

For Linux:

```bash
chmod +x setup-my-claude-linux.sh
```

Preview the curated default install:

```bash
./setup-my-claude.sh --dry-run --defaults
```

Run the curated default install:

```bash
./setup-my-claude.sh --defaults
```

Linux users can run:

```bash
./setup-my-claude-linux.sh --dry-run --defaults
./setup-my-claude-linux.sh --defaults
```

Windows users can run:

```powershell
pwsh -ExecutionPolicy Bypass -File .\setup-my-claude.ps1 -DryRun -Defaults
pwsh -ExecutionPolicy Bypass -File .\setup-my-claude.ps1 -Defaults
```

Open the generated Claude Code plugin command queue:

```bash
open ~/.setup-my-claude/claude-plugin-commands.md
```

Some Claude Code plugins must be installed from inside Claude Code using slash commands. This script writes those commands to the plugin queue instead of trying to execute them from Bash.

## Install from DMG, ZIP, or Tarball

Download the latest release:

https://github.com/SteveKinzey/claude-code-tools-installer/releases

Then:

1. Open the DMG, unzip the ZIP, or extract the Linux tarball.
2. Open Terminal.
3. Change into the extracted folder.
4. Run the command for your platform.

macOS:

```bash
chmod +x setup-my-claude.sh
./setup-my-claude.sh --dry-run --defaults
./setup-my-claude.sh --defaults
```

Linux:

```bash
chmod +x setup-my-claude-linux.sh
./setup-my-claude-linux.sh --dry-run --defaults
./setup-my-claude-linux.sh --defaults
```

Windows:

```powershell
pwsh -ExecutionPolicy Bypass -File .\setup-my-claude.ps1 -DryRun -Defaults
pwsh -ExecutionPolicy Bypass -File .\setup-my-claude.ps1 -Defaults
```

The macOS DMG is submitted to Apple notarization and stapled for Gatekeeper distribution. Review scripts before running them, especially when enabling optional memory, routing, MCP, or credential-sensitive tools.

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

Windows equivalents use PowerShell flags:

```powershell
pwsh -File .\setup-my-claude.ps1 -Help
pwsh -File .\setup-my-claude.ps1 -Item playwright-mcp
pwsh -File .\setup-my-claude.ps1 -Category tools
pwsh -File .\setup-my-claude.ps1 -Uninstall
```

## Installing Extras

The curated defaults are meant to be the starting point, not the whole ecosystem. Extras should be installed by category or by item after you know what problem you are solving.

Install one extra item:

```bash
./setup-my-claude.sh --item github-mcp
```

Install several extra items:

```bash
./setup-my-claude.sh --item firecrawl,claude-code-router,codegraph
```

Install a whole category:

```bash
./setup-my-claude.sh --category memory
```

Preview before installing:

```bash
./setup-my-claude.sh --dry-run --item github-mcp
./setup-my-claude.sh --dry-run --category tools
```

Linux users should replace `setup-my-claude.sh` with:

```bash
./setup-my-claude-linux.sh
```

Windows users should use PowerShell:

```powershell
pwsh -File .\setup-my-claude.ps1 -Item github-mcp -DryRun
pwsh -File .\setup-my-claude.ps1 -Item github-mcp
```

After installing or queueing extras, open the plugin command file:

```bash
open ~/.setup-my-claude/claude-plugin-commands.md
```

On Linux:

```bash
xdg-open ~/.setup-my-claude/claude-plugin-commands.md
```

On Windows:

```powershell
notepad "$HOME\.setup-my-claude\claude-plugin-commands.md"
```

Some extras only generate instructions because they require credentials, Docker, platform-specific desktop installers, or Claude Code slash commands.

## Recommended Add-On Paths

Start with defaults. Then add extras based on the workflow you actually use.

| Workflow | Recommended extras | Why |
|---|---|---|
| GitHub-heavy coding | `github-mcp`, `codegraph`, `awesome-mcp-servers` | Better repo operations, project graphing, and MCP discovery |
| Browser automation and QA | `playwright-mcp`, `firecrawl` | Browser control, scraping, QA, and research workflows |
| Long-running project memory | `claude-mem`, `planning-with-files`, `repomix` | Persistent context, explicit planning files, and compact repo packaging |
| Frontend/UI work | `taste-skill`, `ui-ux-pro-max`, `graphify` | Better UI judgment, design review, and visual/code structure support |
| Agent and workflow experimentation | `wshobson-agents`, `ecc`, `multica` | Subagents, harnesses, and larger orchestration experiments |
| Cost and usage awareness | `claude-hud`, `caveman`, `best-practice` | Session visibility, token/cost habits, and usage discipline |

For most users, the best sequence is:

1. Install the defaults.
2. Add `github-mcp` only after creating a scoped GitHub token or choosing a secure authentication path.
3. Add `firecrawl` only when you have a Firecrawl account/API key and a real scraping or research workflow.
4. Add `claude-mem` only when you want persistent memory and understand the data implications.
5. Add router/framework tools only after the base Claude Code setup is stable.

Avoid installing multiple tools that solve the same problem until you have tested the first one.

## Requirements

The installer checks for these dependencies:

- Claude Code: `claude`
- Node.js: `node`
- npm: `npm`
- npx: `npx`
- Git: `git`
- PowerShell 7+ on Windows: `pwsh`

It does not install Claude Code, Node.js, npm, npx, Git, PowerShell, Homebrew, Docker, or API keys.

Recommended dependency check:

```bash
claude --version
node --version
npm --version
npx --version
git --version
```

On Windows:

```powershell
claude --version
node --version
npm --version
npx --version
git --version
pwsh --version
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

Those commands must be run inside Claude Code. Bash and PowerShell cannot reliably execute Claude Code slash commands because they are part of the interactive Claude Code interface.

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
| CC Switch | Tools | Desktop CLI/tool | No | macOS Homebrew cask when available; Linux/Windows manual review | `https://github.com/farion1231/cc-switch` |
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

## Tool Guide

This section explains what each included item is for and when to install it.

| Tool | What it is | When to use it | Default |
|---|---|---|---:|
| Learn Claude Code | Reference/training repository for learning Claude Code workflows. | Use when onboarding yourself or a team to Claude Code patterns. | No |
| Karpathy Skills | Reference/context material inspired by Andrej Karpathy-style AI engineering workflows. | Use as learning material or workflow inspiration, not as a required extension. | No |
| Superpowers | Claude Code plugin/skills framework that adds a structured productivity layer. | Use when you want a stronger default Claude Code operating environment. | Yes |
| Ponytail | Claude Code skill. | Use when you specifically want that skill's workflow; keep optional until needed. | No |
| gstack | Skill pack/harness for improving Claude Code project workflow. | Use as part of the default setup for stronger planning and execution habits. | Yes |
| ECC | Extension/harness focused on broader Claude Code workflow control and safety patterns. | Use only after reviewing its repository and understanding the behavior it adds. | No |
| taste-skill | Frontend/design taste skill. | Use for UI, UX, and visual product work where judgment matters. | Yes |
| Anthropic skills | Official Anthropic skills repository/marketplace entrypoint. | Use to browse and install official or example skills through Claude Code. | Yes |
| wshobson/agents | Collection of Claude Code subagents and workflow helpers. | Use when you want specialized agents for code review, security, docs, or implementation tasks. | No |
| claude-plugins-official | Official Claude Code plugin marketplace. | Use to browse supported plugins from inside Claude Code. | No |
| ui-ux-pro-max | UI/UX-oriented skill/reference repository. | Use for deeper frontend/product design review workflows. | No |
| awesome-claude-skills | Catalog of Claude skills. | Use for discovery; do not treat every catalog item as safe to install. | No |
| planning-with-files | Skill that encourages explicit planning through files. | Use for larger changes where persistent plans beat one-off chat context. | Yes |
| Claude-Mem | Persistent memory/context utility. | Use when you want Claude Code to remember project context across sessions and you accept the data trade-offs. | No |
| CodeGraph | CLI for generating or working with code graphs. | Use for larger repositories where structural understanding matters. | No |
| Graphify | Skill/CLI-oriented graphing tool. | Use when visualizing project structure or dependencies helps planning. | No |
| Repomix | CLI and MCP server for packaging repository context. | Use to compress repo context for AI workflows and expose it through MCP. | Yes |
| Multica | Larger self-hosted harness/framework. | Use only for advanced experimentation with self-hosted AI workflows. | No |
| Firecrawl | Web crawling/scraping tool with Claude integration paths. | Use for research, crawling, and web-data workflows after setting up API credentials. | No |
| CC Switch | Desktop/provider switching tool. | Use only if you need its provider switching workflow and your platform is supported. | No |
| Vibe Kanban | Desktop/web project planning tool. | Use cautiously; the upstream project has indicated sunsetting. | No |
| GitHub MCP | MCP server for GitHub operations. | Use when Claude Code needs structured GitHub access; configure credentials carefully. | No |
| Playwright MCP | MCP server for browser automation through Playwright. | Use for browser testing, UI QA, page interaction, and automation. | Yes |
| Claude Code Router | CLI/router for model/provider routing. | Use only when you intentionally want to route Claude Code through alternate providers. | No |
| awesome-mcp-servers | Catalog of MCP servers. | Use for discovery after you understand MCP security boundaries. | No |
| system-prompts-ai | Reference collection of system prompts and AI tool prompts. | Use for research and prompt-pattern study, not as a default install. | No |
| claude-code-best-practice | Reference/workflow repository for Claude Code habits. | Use for process improvement, team standards, and prompt/workflow examples. | No |
| Codex in Claude | Manual review note for OpenAI Codex/Claude integration ideas. | Use only when you have a specific Codex integration workflow. | No |
| Claude HUD | Plugin/monitoring tool for Claude Code usage visibility. | Use to improve awareness of session behavior and cost/usage patterns. | Yes |
| Caveman | Cost/token workflow reference. | Use when you want lightweight cost discipline and token-usage habits. | No |

## What Comes With the App

The repository includes:

- `setup-my-claude.sh` - macOS Bash installer
- `setup-my-claude-linux.sh` - Linux Bash installer
- `setup-my-claude.ps1` - Windows PowerShell installer
- `README.md` - full documentation
- `assets/claude-code-tools-logo.png` - GitHub README/header image
- `releases/claude-code-tools-installer.dmg` - notarized/stapled macOS DMG
- `releases/claude-code-tools-installer.zip` - all-platform ZIP
- `releases/claude-code-tools-installer-linux.tar.gz` - Linux tarball
- `releases/claude-code-tools-installer-windows.zip` - Windows ZIP

The installer itself does not contain the third-party tools. It installs, clones, registers, or queues them from their upstream sources so users can inspect where each component came from.

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
- Claude Code Linux setup
- Claude Code Windows setup
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
