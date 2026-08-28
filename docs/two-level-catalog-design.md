# Two-Level Catalog Design

## Product Decision

The installer uses a **two-level catalog**. The first level remains intentionally small and simple: the original 30 curated Claude Code tools plus the single **Convex for Claude Code** parent plugin. The second level is a searchable **Convex Components Library** containing the current 145 entries from Convex’s public directory. The 24 skills, agents, hooks, monitors, and MCP capability delivered by the Convex plugin are displayed as included detail rather than separate installation choices.

## Level One: Claude Code Tool Stack

The main installer screen uses the existing three-step flow. Step 2 shows the curated 31 choices, grouped by user-oriented purpose. It includes a clear **Browse Convex Components (145)** button rather than mixing backend packages into the initial selection grid.

| User action | Result |
|---|---|
| Select a curated tool | Adds that tool to the ordinary installer plan. |
| Select Convex for Claude Code | Queues the official Claude Code plugin installation and reveals its included skills, agents, MCP access, hooks, and monitors. |
| Select **Browse Convex Components** | Opens the second-level library without changing the tool plan. |

## Level Two: Convex Components Library

The library is a separate view with category filters, search, and a details drawer. Each component record contains a stable ID, display name, category, npm installation identity, documentation URL, and source classification. Components with similar names remain distinct because the catalog uses the package identity rather than display text as its key.

| Library control | User-facing behavior |
|---|---|
| Search | Filters by name, package name, category, or use case. |
| Category filter | Narrows to AI, authentication, backend, collaboration, database, durable functions, integrations, messaging, storage, or payments. |
| Component detail | Explains what the component adds, shows its npm package, flags any external credential or service requirement, and links to its documentation. |
| Add to project plan | Adds the component to a **project-specific plan**, not the desktop tool-installation queue. |
| Review project plan | Shows exact commands and prerequisites for the selected Convex project before any action is taken. |

## Safety Boundary

A Convex Component is code that belongs in a **specific Convex application**, not a generic Claude Code extension. The desktop installer must therefore never run a component installation automatically when a user merely selects it from the library. It must first require a user-selected project folder and show the exact project-level plan. This prevents a Windows user from accidentally installing backend dependencies in the wrong directory.

## Tool Advisor Requirements

The advisor is visible from both levels and is minimizable. Its job is to ask one short proactive question at a time, suggest tools or components based on the user’s stated goal, compare named options in plain language, explain why each suggestion was made, and add items only after the user explicitly confirms. It must distinguish:

- **Claude Code tool:** installed for the local Claude Code workflow.
- **Convex plugin:** one parent Claude Code plugin that includes multiple capabilities.
- **Convex Component:** a package to add to one Convex application after a project is selected.
- **Credential-sensitive item:** an option that needs a third-party account, token, or environment variable and therefore requires an explicit follow-up step.

## Source and Refresh Model

The 145-component library must carry a source date and source URL. A future catalog-refresh command can regenerate the data from Convex’s machine-readable component directory. It must never silently add or install newly discovered packages. Any refreshed entry should first appear as a reviewed library item with the source and package identity visible.

## References

[1]: https://docs.convex.dev/ai/using-claude-code "Using Claude Code with Convex"
[2]: https://docs.convex.dev/ai/convex-plugins "Convex Agent Plugins"
[3]: https://github.com/get-convex/convex-backend-skill "Convex Plugin for Claude Code"
[4]: https://www.convex.dev/components/components.md "Convex Components Directory"

## Compass: Dual-Mode Tool Advisor

The in-app advisor is named **Compass**. The name is deliberate: it helps a user decide where to go without taking control of the journey. Compass starts in **Private Guide** mode on every screen. It is present but minimizable, and its minimized control uses the installer’s question-mark help mark.

| Mode | When it is used | Data boundary | What it can do |
|---|---|---|---|
| **Private Guide** | Default for every user | No network request. It uses the bundled, verified catalog only. | Ask short proactive questions, match stated goals to catalog entries, compare selected options, explain prerequisites, and build a proposed plan. |
| **Connected Compass** | Only when a user asks for broader help or selects **Ask connected AI** | The user explicitly connects an AI provider and accepts the provider notice. The API key is held only for the current app session. | Answer open-ended questions, explain unfamiliar workflows, and refine recommendations using the verified catalog as grounding context. |

### Private Guide Conversation Model

Compass opens with one practical question: **“What are you trying to build or improve?”** It then follows with only the next question needed to narrow the choices, such as whether the user is working on an existing project, needs a backend, or expects to use external services. It always labels its recommendations as suggestions and gives a short reason for each one.

The Private Guide has four fixed response patterns: a recommendation card, a compare card, a prerequisite warning, and a project-component clarification. It may add items to a proposed plan only after the user selects **Add to plan**. It never installs anything and it never treats a bundled Convex capability as a separate install.

### Connected Compass Handoff

Compass should offer the handoff only after a meaningful question cannot be answered by the local catalog, for example: **“Want a deeper answer from connected AI?”** The handoff view must state the AI provider, that the user’s question and the selected-tool context will leave the device, that provider usage may incur charges, and that the user must supply their own API key. The default connected-provider choice is **Anthropic**, because this application prepares Claude Code; the interface should be adapter-based so another provider can be added later without changing the private advisor.

The initial connected implementation must preserve the following boundaries. The renderer never receives the API key. The key is submitted to the Electron main process over the existing secure bridge, stored in memory only, cleared when the app exits or the user chooses **Disconnect**, and never written to the catalog, log, preview, or command file. Connected answers must be grounded in the bundled inventory and must state clearly when a question goes beyond that inventory.

### Proactive Guidance Rules

Compass can be proactive without becoming intrusive. It may ask a contextual question when the user opens the Convex library, selects a credential-sensitive option, or has an empty plan after browsing. It must not interrupt installation, repeat the same prompt after dismissal, or automatically switch to Connected Compass. It must not send a user’s question anywhere until the user has chosen the connected handoff and confirmed the provider notice.

