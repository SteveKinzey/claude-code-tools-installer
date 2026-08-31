![Claude Code Tools Installer by SK America](assets/claude-code-tools-logo.png)

# Claude Code Tools Installer

**Claude Code Tools Installer** is a desktop setup app for people who want a clear way to install Claude Code, choose optional development tools, check what is already installed, and safely add Convex packages to the correct project. It is designed to remove terminal-first confusion, especially on Windows.

> The app never installs anything just because it is shown. You choose the item, review the plan, and confirm the exact action before it runs.

## Live Product Site and Current Releases

The public product site is [claudetool.app](https://claudetool.app/). It includes the plain-language walkthrough, searchable catalog, private-first Compass help, release sign-up, public user manual, Privacy Policy, Terms, Disclaimer, and four captioned product videos.

The current public release is [v2026.08.12](https://github.com/SteveKinzey/claude-code-tools-installer/releases/tag/v2026.08.12). Its Windows file is a **ZIP download**, not a signed EXE installer. The release provider reports the direct file as `claude-code-tools-installer-windows.zip`, 1,819,520 bytes. Its published SHA-256 is:

```text
9811d14d9048440b77a96504197656aeb7411c45c8812d33916187957bd28a60
```

Download only from the [release page](https://github.com/SteveKinzey/claude-code-tools-installer/releases/tag/v2026.08.12), then compare the file digest if you know how. The site and release record are checked separately. A release download is not evidence of a completed setup, active user, or vote.

## What You See in the GUI

The main window is a guided flow with a separate library for project-level Convex packages. The app treats a **Claude Code tool** and a **Convex Component** differently because they install in different places.
| Area | What you see | What it means |
|---|---|---|
| **Step 1 — Set up Claude Code** | A status check with a Complete setup action | The app can provision its managed Node.js runtime, Git if needed, Claude Code, and the recommended local-tool stack without sending users to a web page or requiring terminal commands. |
| **Optional checkup — See what you already have** | A read-only list of found skills, add-ons, and saved connections | Use it before or after other setup. You can also check one project folder. It changes nothing while checking. |
| **Step 2 — Choose your Claude Code tools** | A curated set of 35 workflow choices grouped by purpose | These choices improve your local Claude Code workflow. They are not project packages. |
| **Convex Components Library** | A separate searchable library of 145 current Convex packages | These packages belong to one specific application folder that you choose. They are never mixed into the local-tool installation queue. |
| **Step 3 — Review and run** | A selection total, preview toggle, confirmation dialog, and activity panel | You can inspect the selected tool actions before they run. |
| **Add your own skill or add-on** | A folder picker and trusted-source review | Choose a folder with `SKILL.md`, a trusted GitHub owner/name, or a trusted marketplace link. The app shows the result before you approve it. |
| **Compass** | A minimizable question-mark Tool Advisor on every screen | It helps you choose and compare tools privately first, then offers a free, site-powered online answer only when you request it. No key is needed. |
| **Installation activity** | A scrolling technical log | It explains what the app is checking, installing, previewing, or saving as a follow-up step. |

## Start Here: Windows, macOS, and Linux

Download the package for your computer from [Releases](https://github.com/SteveKinzey/claude-code-tools-installer/releases), open it, and launch **Claude Code Tools Installer**.

| Your computer | Package | What to do next |
|---|---|---|
| **Windows** | [ZIP download](https://github.com/SteveKinzey/claude-code-tools-installer/releases/download/v2026.08.12/claude-code-tools-installer-windows.zip) | Save the ZIP, unzip it into a folder you can find, read the included guide, then open the app. This is not a signed EXE installer. |
| **macOS** | `.dmg` | Open the DMG, drag the app to Applications, launch it, then use the same Step 1 choice. |
| **Linux** | `.tar.gz` application archive | Extract the archive, run the desktop app, then use the same Step 1 choice. |

The first-run path is intentionally plain: you do **not** need to find a terminal, choose a package manager, visit an installation page, or paste a command. The app checks first and answers **Yes, Claude Code is installed** or **No, Claude Code is not installed**. If the answer is no, choose **Yes, install Claude Code**. The app runs Anthropic’s official installer, waits for it to finish, then checks again before reporting that Claude Code is installed. It does not add optional tools in that path. [1]

## Step 1: Set Up Claude Code

The first screen gives the Claude Code answer before any optional tool choice appears. It does not send you to a Claude Code webpage.

| Choice | Use it when | Result |
|---|---|---|
| **Yes, install Claude Code** | The check says Claude Code is not installed and you want it | Runs Anthropic’s official installer inside the app, waits until the check can find Claude Code, and adds no extra tools. [1] |
| **Yes, Claude Code is installed** | The check found a working local installation | Opens the optional tool choices. Nothing is installed by this button. |
| **Set up Claude Code and recommended tools** | You want Claude Code plus the reviewed starter setup | Installs a verified Node.js 22 LTS runtime and Git when required, runs Anthropic’s official Claude Code installer, applies the recommended eight-tool setup, then opens Claude Code for sign-in. [1] |
| **Browse tools first** | You only want to understand the choices | Opens the catalogs but keeps local-tool installation disabled. Nothing changes. |
| **Start fresh** | A detected Claude Code installation needs a clean rebuild | Requires typing `DELETE CLAUDE DATA`, then removes local CLI versions, settings, session history, MCP configuration, the app-managed tool stack, and its managed Node.js runtime before Complete setup rebuilds them. It does not delete project files. [1] |

The status chip uses simple wording: **Claude Code installed**, **Claude Code not installed**, **Complete setup finished**, or **Setup needs attention**. Detailed output stays in the activity panel instead of blocking the user with terminal messages.

## Step 2: Choose Your Claude Code Tools

The first catalog contains **35 curated workflow choices**. These are grouped into Harness, Skills, Memory, Tools, MCP & Automation, Cost & Reference, and Popular Plugins. Every card shows its name, its type, and the specific action the app will take.

| Control | What it does |
|---|---|
| **Use recommended setup** | Selects eight practical starting tools: Superpowers, gstack, taste-skill, Anthropic Skills, Planning with Files, Repomix, Playwright MCP, and Claude HUD. **Complete setup** applies this same set automatically. |
| **Select all curated tools** | Selects all 35 local workflow choices. This is available for deliberate review, not recommended as a first run. |
| **Clear selection** | Removes every local-tool selection. |
| **Tick an individual card** | Adds or removes that exact local workflow tool. |
| **Browse Convex Components** | Opens the project-level component library without adding anything to the local-tool plan. |

### Curated Tool Catalog

| Group | Choices shown in the GUI |
|---|---|
| **Harness** | Learn Claude Code, Karpathy Skills, Superpowers, Ponytail, gstack, ECC |
| **Skills** | taste-skill, Anthropic Skills, wshobson/agents, Claude Plugins Official, UI UX Pro Max, Awesome Claude Skills |
| **Popular Plugins** | Frontend Design, Code Review, Context7, Skill Creator — optional official Anthropic plugins. The GUI shows source-backed install counts when a current official page reports them. |
| **Memory** | Planning with Files, Claude-Mem, CodeGraph, Graphify, Repomix |
| **Tools** | Convex for Claude Code, Multica, Firecrawl, CC Switch, Vibe Kanban, GitHub MCP |
| **MCP & Automation** | Playwright MCP, Claude Code Router, Awesome MCP Servers |
| **Cost & Reference** | System Prompts AI, Claude Code Best Practice, Codex in Claude, Claude HUD, Caveman |

Some cards run a supported local install. Others save a safe follow-up command or checklist item because a plugin must be installed **inside Claude Code**, or because a service needs credentials that this app should never collect automatically.

### Convex for Claude Code

**Convex for Claude Code** is one parent plugin choice, not a collection of separate checkboxes. The official plugin adds Convex-aware guidance, skills, subagents, MCP access to a development deployment, hooks, and monitors as part of one install. [2] [3]

> The included Convex capabilities are described as “included with the Convex plugin.” They are not individual installations, so the app does not falsely show them as 24 separate tools.

## Convex Components Library

The second-level library contains **145 current entries** from Convex’s machine-readable Components Directory. Those 145 include the 26 official Convex components; the official subset is not counted again. [4]

A Convex Component is a package added to one backend project. It can have its own database tables, functions, configuration, external service requirements, and documentation. It is **not** a generic local Claude Code extension. [5]

| Library control | What you do | What happens |
|---|---|---|
| **Find a component** | Search by component name, npm package name, or category | Filters the 145 entries without changing your plan. |
| **Category** | Filter by AI, authentication, backend, collaboration, database, durable functions, integrations, messaging, storage, payments, or another directory category | Narrows the library to the task you are considering. |
| **Details** | Open a component detail panel | Shows the package identity, version, source URL, and the exact project command. |
| **Add to project plan** | Mark one or more components | Creates a separate project plan. It does not install yet. |
| **Choose project folder** | Pick the application folder in the normal file picker | The app requires a folder containing `package.json` so it does not install packages in the wrong place. |
| **Preview project plan** | Review the project plan | Shows the exact `npm install` command without running it. |
| **Install project components** | Confirm the project path, named packages, and command | Runs the reviewed package install only in that chosen folder. Component-specific setup remains a separate, visible task. |

The complete generated component library is stored in [`desktop/convex-components.json`](desktop/convex-components.json). The underlying source inventory and deduplication decisions are preserved in [`docs/source-inventory/`](docs/source-inventory/).

## Compass: Your Tool Advisor

**Compass** is the in-app advisor. It is available on every screen and can be minimized to a styled question-mark button when you do not need it.

### Private Guide — the default

Compass starts as a private guide. It does not make a network request and it does not require a key. It uses the verified catalog to ask short, relevant questions, recommend a small set of choices, compare the items you selected, and explain the difference between local Claude Code tools and project-level Convex Components.

It may proactively ask a useful next question when you open the Convex library, select a credential-sensitive item, or finish browsing without a plan. It never adds an item or starts an installation without your explicit confirmation.

### Online Compass — optional deeper help

When the private guide cannot answer a broader, open-ended question, it offers **Ask online Compass**. You must choose that handoff and read the notice before your next question is sent. The online answer is paid for by the product during its first three months of normal use. You do not need to bring an API key.

| Online Compass rule | What it protects |
|---|---|
| You choose online help after using the private guide | The app does not silently send every question away from your computer. |
| The notice explains that your next question and a small amount of recent chat context leave the device | You can make an informed privacy decision before connecting. |
| No API key is requested | Visitors do not need an Anthropic account or key to ask Compass online. |
| The online answer is grounded in the verified catalog | Compass distinguishes catalog facts from questions that need independent research. |

Online Compass gives advice only. It does not execute installations, create accounts, add credentials, or modify a project without the same explicit confirmations used everywhere else in the app.

## Optional Setup Manager

The checkup is available before setup, after setup, or whenever you want to tidy a Claude Code workspace. It searches the usual user and project Claude Code locations for skills, enabled add-ons, and saved connections. It can also ask Claude Code for its own plugin and connection lists when Claude Code is available. The checkup is read-only.

| Checkup action | What happens |
|---|---|
| **Check this computer** | Looks in the usual Claude Code locations for the current user. It does not install, remove, or change anything. |
| **Also check a project** | Lets you choose one project folder and adds its `.claude` locations to the same read-only list. |
| **Possible duplicate skills** | Shows the same skill name found in more than one place, with each location. It does not assume that every duplicate is wrong. |
| **Review backup move** | Available only for a discovered skill folder. It shows the current and backup paths. When approved, it moves the skill to a backup folder instead of deleting it. |
| **Add your own skill or add-on** | Validates a local skill folder, trusted GitHub owner/name, or trusted marketplace source. You review the copy location or command before approval. Marketplace commands are saved to the checklist, not run without review. |

## Step 3: Review and Run

The final local-tool panel says how many curated tools are selected and whether you are previewing or installing.

| Control | What it does |
|---|---|
| **Preview changes only** | Shows planned local-tool changes without installing anything. Use this first if you are unsure. |
| **Install selected tools** | Opens a confirmation dialog listing every selected local tool. Nothing runs until you approve it. |
| **Installation activity** | Shows Claude Code preparation, install progress, queued follow-ups, project-component output, and plain-language errors. |

The confirmation dialog reminds you that slash-command plugins and credential-sensitive integrations can create a follow-up task instead of a silent configuration. This is intentional.

## After Installation: Completion Checklist

Some Claude Code plugins require a slash command inside Claude Code. The app saves those commands in a local completion checklist rather than trying to type into your active Claude Code session.

| Platform | Checklist location |
|---|---|
| macOS and Linux | `~/.setup-my-claude/claude-plugin-commands.md` |
| Windows | `%USERPROFILE%\.setup-my-claude\claude-plugin-commands.md` |

Open Claude Code, open the checklist, and run only the commands for plugins you chose. The app also records an activity log and rollback manifest under `~/.setup-my-claude/` so you can review local changes and remove supported shell-installed items later.

## Safety and Privacy Boundaries

| The app does | The app does not do |
|---|---|
| Uses Anthropic’s official Claude Code installer after you choose Complete setup or the Claude-only option | Bundle or redistribute an unknown Claude Code binary |
| Downloads a Node.js 22 LTS runtime only after verification against the official SHA-256 checksum | Use an unverified runtime download |
| Requires typed confirmation before Start fresh deletes local Claude Code state | Delete project files or silently remove Claude Code data |
| Installs only the recommended local stack during Complete setup, or only selected tools during manual setup | Install all catalog entries by default |
| Keeps Convex packages in a separately confirmed project plan | Install a backend package outside the folder you selected |
| Previews the exact package command | Run an unreviewed project command |
| Saves plugin commands and sensitive follow-up steps to a checklist | Paste slash commands or inject credentials silently |
| Offers free site-powered online Compass only after you choose it | Ask for a visitor API key or silently send every question online |
| Lets you voluntarily count a completed CCTI setup action | Send setup telemetry automatically, or include a name, email, device ID, path, tool list, log, or event ID |
| Lets you answer one optional post-download question | Store an individual response, a free-text comment, or browser identity with the answer |

Review each optional item before adding it. A memory utility, provider router, web-crawling tool, or package with an external integration can change local behavior, project dependencies, data flow, or permissions.

## Anonymous Success Counts and One-Question Feedback

After CCTI reports that a completed setup action ended without an error, the desktop app offers a separate **Count this anonymous success** button. It sends only one of three action labels: complete setup, selected tools, or project components. It does not send a name, email address, device ID, folder path, tool list, installation log, or event ID. This optional count is a product signal, not proof that an installation remains successful or that a person became an active user.

The website also offers one optional question: **After your download, were you able to open CCTI?** Its three answers are “I downloaded it and opened CCTI,” “I downloaded it but have not opened it yet,” and “I got stuck and need help.” The site stores only daily totals for the chosen answer. It has no free-text field and does not store an answer with a name, email, device ID, path, or browser identifier. The private owner summary keeps these totals separate from GitHub download counts and release-email signups.

## Dry-Run and Release Checks

The macOS, Linux, and Windows setup adapters support dry-run checking. A dry run exits without writing a setup directory, manifest, checklist, log, backup, or Claude Code state. The documented verification procedure uses a disposable home and project folder and confirms that the temporary home remains empty after the command finishes. See [`docs/dry-run-safety-verification.md`](docs/dry-run-safety-verification.md).

Before public release language is changed, verify the custom site domain, managed site domain, exact release asset, redirect response, byte size, and SHA-256. Keep counts distinct: GitHub file downloads are downloads; email opt-ins are signups; voluntary success counts are reported CCTI completion actions; survey answers are answers. None alone proves installations, active users, or demand.
## Development and Packaging

The desktop app is an Electron application in `desktop/`. Release resources include the curated catalog, the 145-entry Convex component library, and the macOS, Windows, and Linux setup adapters.

```bash
cd desktop
npm install
npm run start
```

Run checks before packaging:

```bash
npm run check
```

Build a local package:

```bash
npm run dist:mac
npm run dist:win
npm run dist:linux
```

Public releases must be code-signed and, on macOS, notarized before distribution. The app downloads Claude Code only after the user selects **Complete setup** or **Install or update Claude Code only**; it does not redistribute Claude Code inside this repository.

### Microsoft Store MSIX path

The repository includes the required AppX tile images under `desktop/build/appx/`, an identity-placeholder template, and a guarded `msix:prepare` command. It intentionally does **not** contain Partner Center identity values. The owner must reserve the app in Partner Center and provide the exact Identity name, Application ID, and Publisher value before a Windows build can happen. The generated local configuration is ignored by Git.

On a Windows build machine, only after those exact values are supplied, run:

```powershell
cd desktop
npm run msix:prepare
npm run dist:win:store
```

The command creates an AppX/MSIX package for Store review. It does not submit anything, set a price, replace the ZIP, or turn a separately hosted EXE into a signed file. Microsoft Store delivery signs a certified Store package; it does not sign the direct ZIP or an EXE. See [`docs/windows-msix-store-readiness.md`](docs/windows-msix-store-readiness.md) for the owner-controlled steps.
## Repository Layout

| Path | Purpose |
|---|---|
| `desktop/` | Electron desktop app and package configuration. |
| `desktop/catalog.json` | The 35 curated Claude Code workflow choices, including optional source-backed popular plugins. |
| `desktop/convex-components.json` | The current 145-entry Convex Components Library. |
| `docs/two-level-catalog-design.md` | Product, safety, and Compass design decisions. |
| `docs/claude-setup-manager-design.md` | Discovery, duplicate-review, custom-addition, and backup-only cleanup rules. |
| `docs/source-inventory/` | The source inventory, count summary, and deduplication decisions. |
| `setup-my-claude.sh` | macOS adapter. |
| `setup-my-claude-linux.sh` | Linux adapter. |
| `setup-my-claude.ps1` | Windows PowerShell adapter. |
| `scripts/validate-catalog.js` | Validates that each curated GUI tool exists in every platform adapter. |
| `scripts/prepare-msix-config.js` | Writes an ignored Store-only AppX/MSIX configuration only when all exact Partner Center values are present. |
| `docs/dry-run-safety-verification.md` | Records the no-write dry-run verification procedure and result. |
| `docs/windows-msix-store-readiness.md` | Explains the free Microsoft Store MSIX preparation and owner-controlled next steps. |
| `desktop/build/appx/` | The required 50×50, 44×44, 150×150, and 310×150 Microsoft Store tile images. |

## License

The source code in this repository is licensed under the [Apache License, Version 2.0](LICENSE). Copyright 2026 SK America LLC.

This license lets people use, copy, change, and share the repository source code under its terms. It includes a patent grant and requires the license and notices to remain with redistributed source. It does **not** grant rights to SK America LLC trademarks, Anthropic, Claude Code, Convex, GitHub, npm, or any other third-party name, logo, service, content, or separate add-on. Review third-party licenses and terms before using an add-on or redistributing a packaged build.

## References

[1]: https://code.claude.com/docs/en/setup "Claude Code setup"
[2]: https://docs.convex.dev/ai/using-claude-code "Using Claude Code with Convex"
[3]: https://github.com/get-convex/convex-backend-skill "Convex Plugin for Claude Code"
[4]: https://www.convex.dev/components/components.md "Convex Components Directory"
[5]: https://docs.convex.dev/components/overview "Convex Components overview"
[6]: https://docs.anthropic.com/en/api/messages "Anthropic Messages API"
