# Microsoft Store Listing Package

**Product:** Claude Code Tools Installer  
**Repository:** `SteveKinzey/claude-code-tools-installer`  
**Audience:** Windows 10/11 developers setting up Claude Code and choosing local/project developer tools  
**Version context:** Initial Microsoft Store MSIX package; direct Windows ZIP continues alongside this path.

---

## 1. Store Product Overview

### Title
`Claude Code Tools Installer`

### Short description (under 100 characters)
`A safe, guided desktop companion to set up Claude Code and choose useful developer tools.`

### Full description
```text
Claude Code Tools Installer is a guided desktop app for setting up Claude Code, choosing useful workflow tools, and adding project packages only where they belong.

The app checks whether Claude Code can run on your computer. If it is not ready, you can choose an in-app setup option that uses Anthropic’s official installer. Your guided setup path does not require you to find, copy, or type terminal commands.

CCTI keeps two kinds of choices separate: tools that help your local Claude Code workflow, and Convex Components that add a capability to one project folder you choose. You can read a plain-language explanation, turn an option on or off, preview the plan, and approve the exact action before anything changes.

Use CCTI to:
• Check whether Claude Code is ready and start an in-app setup when needed.
• Start with a recommended tool set or choose individual workflow tools.
• Review 35 curated Claude Code workflow choices with clear details and examples.
• Search 145 project-level Convex Components and add only the packages intended for your selected project.
• Preview local and project changes before installation.
• Check existing skills, add-ons, and saved connections without changing them.
• Review possible duplicate skills and move a selected copy to a backup instead of deleting it.
• Add a local skill or trusted source only after reviewing the result.
• Ask Compass for private, catalog-based guidance before making a choice.
• Turn a project idea into a private, reviewable first-draft PRD without installing anything.

CCTI does not install an item simply because you view it. Features that need a sign-in, credential, license, or unsupported platform stop at a clear in-app boundary instead of reporting false success. Claude Code Tools Installer is an independent setup companion for Claude Code; it is not the Claude Code product itself.
```

---

## 2. Store Metadata

### What’s new in this version
Leave blank for the initial submission (recommended by Microsoft Partner Center), or paste:
```text
Initial Microsoft Store release. Guided Claude Code readiness checks, in-app setup options, 35 curated workflow tools, 145 project components, backup-only cleanup, and a private Project Interview helper.
```

### Search terms (up to 7 terms)
1. `Claude Code`
2. `Claude Code tools`
3. `Claude setup`
4. `developer tools installer`
5. `Convex components`
6. `AI developer assistant`
7. `MCP tools installer`

### Category and platform declarations
- **Primary category:** Developer tools > Utilities
- **Secondary category:** Productivity
- **Pricing:** Free ($0.00)
- **Supported devices:** PC (Windows 10 version 17763.0 or higher, x64 / ARM64)
- **Content rating:** Everyone / General developer audience (no sensitive content)

### Official support and privacy URLs
- **Support email:** `support@getphame.app`
- **Support website:** `https://claudetool.app/#compass`
- **Privacy policy URL:** `https://claudetool.app/privacy`
- **Terms of service URL:** `https://claudetool.app/terms`
- **Copyright attribution:** `Copyright © 2026 SK America LLC. All rights reserved.`

---

## 3. Product Screenshot Inventory

Capture these views from the packaged Windows desktop build using the prepared 1366×768 or 1920×1080 desktop frame:

| Index | File name | Screen / State | Highlighted feature |
|---|---|---|---|
| 01 | `01-initial-readiness-check.png` | First launch view | Displays "Claude Code not installed" and the explicit, non-terminal setup option. |
| 02 | `02-recommended-tools-catalog.png` | Curated tool catalog | Shows the recommended eight-tool default set and plain-language tool summaries. |
| 03 | `03-tool-details-modal.png` | Expanded tool details | Demonstrates item explanations, what each tool does, and safety boundaries. |
| 04 | `04-convex-components-library.png` | Project component library | Displays the 145-package Convex library with project folder selection. |
| 05 | `05-compass-private-helper.png` | Compass advisor | Shows private, local-catalog-grounded recommendations without API keys. |
| 06 | `06-project-interview-prd.png` | Project Interview | Shows the private PRD drafting workflow producing scope-labeled project suggestions. |
| 07 | `07-backup-first-cleanup.png` | Discovery and cleanup | Demonstrates duplicate skill review and safe backup-only folder migration. |

---

## 4. Submission Prerequisites Checklist

- [x] **Desktop startup blocker resolved:** PR #2 merged (`2ae239b`) removing duplicate IPC handlers and identifier collisions.
- [x] **Desktop static contract suite:** `cd desktop && npm run check` passed all 8 checks.
- [x] **Store package tile assets present:** Store logo, Square 150, Square 44, and Wide 310×150 verified in `desktop/build/appx/`.
- [ ] **Partner Center app name reservation:** Reserve `Claude Code Tools Installer` in Partner Center.
- [ ] **Identity injection:** Export `CCTI_APPX_IDENTITY_NAME`, `CCTI_APPX_APPLICATION_ID`, and `CCTI_APPX_PUBLISHER` from Partner Center.
- [ ] **MSIX build execution:** Run `npm run dist:win:store` on a Windows runner or via `.github/workflows/build-windows-store-msix.yml`.
- [ ] **Clean-machine test:** Verify install, execution, and uninstall on a stock Windows machine before final submission.
