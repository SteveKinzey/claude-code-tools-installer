# Microsoft Store Listing Package

> **Status:** Listing copy is ready for Partner Center entry. This document does not claim that an MSIX package has been submitted, certified, or published. It does not create or provide product screenshots.

## Product identity

| Partner Center field | Value |
|---|---|
| Product name | Claude Code Tools Installer |
| Publisher / developer | Use the exact Partner Center PublisherDisplayName. Do not substitute an inferred value. |
| Store category | Developer tools, if available in the selected Partner Center taxonomy. |
| Support email | [support@sk-america.com](mailto:support@sk-america.com) |
| Support URL | https://claudetool.app/user-manual |
| Privacy Policy URL | https://claudetool.app/privacy |
| Public product site | https://claudetool.app/ |
| Source repository | https://github.com/SteveKinzey/claude-code-tools-installer |

The support email is published in the product Terms and Product Disclaimer. The privacy URL is the published SK America LLC policy for the product website.[^terms][^privacy]

## Short description

**Paste into Partner Center:**

> Guided desktop setup for Claude Code: review tool choices, preview changes, and add Convex components only to the project you choose.

## Long description

**Paste into Partner Center:**

> Claude Code Tools Installer is a desktop setup app for people who want a clear way to set up Claude Code, choose optional workflow tools, check what is already installed, and add Convex packages to the correct project.
>
> The app checks whether Claude Code can run on your computer. If it is not ready, you can choose an in-app setup option that uses Anthropic’s official installer. The first-run path is designed so you do not need to find a terminal, choose a package manager, visit an installation page, or paste a command.
>
> CCTI keeps two kinds of choices separate. Claude Code tools improve the local workflow on your computer. Convex Components are project packages that belong only in the application folder you choose. A choice appearing in the app does not install itself: you can read the details, review the plan, preview changes, and confirm the exact action before it runs.
>
> Features include:
>
> • Claude Code readiness checks and an in-app official setup path.
> • A curated catalog of 35 Claude Code workflow choices, including a recommended starting set and individual On/Off controls.
> • A separate searchable library of 145 Convex project packages.
> • Project-folder selection, project-plan preview, and review before a project package installation.
> • A read-only checkup for skills, add-ons, and saved connections found in the usual Claude Code locations and one selected project.
> • Possible-duplicate skill review with a backup-first move for eligible discovered skill folders.
> • Review-first addition of a local skill, trusted GitHub owner/repository source, or trusted marketplace source.
> • Compass, which starts with private, catalog-based help and offers optional online help only after a clear handoff notice.
> • Project Interview, which creates a private, reviewable first-draft product requirements document without selecting tools or installing anything.
>
> CCTI does not install an item merely because it is shown. Features that need a sign-in, credential, license, or unsupported platform remain a visible follow-up step rather than being reported as complete. Claude Code Tools Installer is a setup helper; it is not Claude Code and does not claim affiliation with or endorsement by Anthropic, Convex, GitHub, npm, or other third-party providers.

## What’s new in this version

Use this only for the **first Microsoft Store submission**:

> Initial Microsoft Store submission. Includes Claude Code readiness checks, review-first setup choices, a 35-item local workflow catalog, a separate 145-item project component library, setup checkup, Compass guidance, and private Project Interview drafts.

If the Partner Center field is optional and the submission is the first Store submission, leaving it blank is also consistent with Partner Center guidance shown in the listing form. Do not use this text for a later update; replace it with the verified changes in that submitted package.

## Search terms

Enter these as separate search terms, subject to the limits shown in Partner Center:

- Claude Code
- Claude Code tools
- developer tools
- workflow tools
- Convex Components
- project components
- development setup

## Screenshot inventory

**No Microsoft Store screenshots are included or created by this listing package.** Capture each image from the final, installed Windows MSIX candidate after the remaining prerequisites below are complete. Do not use mockups, composited UI, marketing overlays, a macOS/Linux window, or an older ZIP-release screen.

| Order | Required final Windows capture | Source-grounded UI basis | Status |
|---:|---|---|---|
| 1 | Claude Code readiness check and in-app setup choice | `desktop/src/renderer/index.html` — “Set up Claude Code” | Needs capture from final MSIX |
| 2 | Curated local-tool catalog with individual controls and details | `desktop/src/renderer/index.html` — “Choose your Claude Code tools”; `desktop/catalog.json` | Needs capture from final MSIX |
| 3 | Convex Components Library search and project-only planning controls | `desktop/src/renderer/index.html` — “Convex Components Library”; `desktop/convex-components.json` | Needs capture from final MSIX |
| 4 | Preview changes / review-and-run state | `desktop/src/renderer/index.html` — “Review and run” | Needs capture from final MSIX |
| 5 (optional) | Read-only setup checkup or private Project Interview draft | `desktop/src/renderer/index.html` — “See what you already have” or “Project Interview” | Needs capture from final MSIX |

The source defines Store tile assets in `desktop/build/appx/`, but those are package assets, not substitute listing screenshots.[^readiness]

## Explicit remaining submission prerequisites

1. **Merge and rebuild from the runtime-fix source.** The current desktop runtime startup correction is in [PR #2](https://github.com/SteveKinzey/claude-code-tools-installer/pull/2). Build from the merged commit rather than from the earlier branch state.
2. **Use exact Partner Center identity values.** Copy the exact `Identity name`, `Publisher`, and `PublisherDisplayName` from Partner Center Product identity. Do not guess, normalize, or commit those values to source control.[^readiness]
3. **Build the Store package on Windows.** With those exact values supplied only to the build environment, run `npm run msix:prepare` and `npm run dist:win:store` from `desktop/`. The resolver must reject blank or placeholder values.[^readiness]
4. **Test the exact MSIX package on a clean Windows machine.** Confirm that the app launches, the installer adapters are present, and the app uninstalls cleanly. Capture the final Store screenshots only from this tested package.[^readiness]
5. **Complete Partner Center metadata.** Enter the descriptions, search terms, support URL, Privacy Policy URL, age-rating answers, availability answers, and final screenshots. Listing and certification are not yet started in the current readiness record.[^readiness]
6. **Keep public release claims accurate.** The current direct Windows release is a ZIP download, not a signed EXE installer. A Store route does not sign a separately hosted EXE; Microsoft signs the Store-delivered package after certification.[^readiness]
7. **Submit only after the above checks.** The Store build command creates an AppX/MSIX target; it does not create a Partner Center account, submit the package, set pricing, replace the public ZIP, or itself certify the app.[^readiness]

## Source basis

| Topic | Repository or published source |
|---|---|
| Product scope, 35 local choices, 145 project components, setup checkup, Compass, Project Interview, review-first behavior | [`README.md`](../README.md) |
| Store identity, build, clean-Windows test, listing, certification, and current direct-ZIP boundaries | [`windows-msix-store-readiness.md`](windows-msix-store-readiness.md) |
| Support contact and third-party non-affiliation statement | https://claudetool.app/terms and https://claudetool.app/disclaimer |
| Privacy URL and SK America LLC privacy contact | https://claudetool.app/privacy |

[^terms]: [Terms and Conditions](https://claudetool.app/terms)
[^privacy]: [Privacy Policy](https://claudetool.app/privacy)
[^readiness]: [Microsoft Store MSIX readiness](windows-msix-store-readiness.md)
