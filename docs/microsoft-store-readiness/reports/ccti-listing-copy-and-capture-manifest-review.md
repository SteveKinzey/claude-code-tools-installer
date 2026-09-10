# CCTI Microsoft Store Listing Copy and Capture Manifest Review

> **Review conclusion:** The revised short and long descriptions are **conditionally compliant and claim-bounded** for an initial Microsoft Store listing draft. They must be revalidated against the final installed MSIX candidate before Partner Center entry. The capture manifest is a **non-upload template** with explicit no-mock safeguards; it is not a final submission manifest.

## Executive assessment

The original listing language had a sound review-before-change position, accurate direct-release boundaries, and an appropriate non-affiliation disclaimer. Two changes were necessary for Microsoft Store policy alignment. First, the eight original search terms exceeded the policy limit of seven. Second, one search term used the title of a third-party product, which Microsoft prohibits unless that product is also published by the same publisher. The revised copy removes that search term, keeps exactly seven relevant generic terms, and avoids asserting the unverified final-desktop behavior that discovery is read-only by default. [1]

The revised capture manifest correctly identifies itself as `template_only` and `not_captured_not_for_upload`. It now requires provenance, hash, pixel dimensions, and byte size for every future screenshot. It also expressly prohibits screenshots from a browser preview, a renderer outside the installed MSIX, mocked or fixture-driven IPC, forced UI states, injected results, generated mockups, composites, old builds, macOS, and Linux. These controls directly support the requirement that Store metadata accurately represents the product. [1] [2]

## Copy compliance review

| Element | Decision | Compliance and accuracy assessment | Required condition |
|---|---|---|---|
| Product title | **Conditional** | The name is the documented product name, but it includes an external brand reference. The existing no-affiliation language helps prevent a misleading relationship claim. | Confirm that the exact reserved Partner Center name and permitted trademark use match the final product decision. |
| Short description | **Approved draft** | It describes a setup helper, curated options, and a preview-before-approval workflow. It makes no certification, automation, package, or affiliation claim. | Reconfirm that the final MSIX retains the plan-preview workflow. |
| Long description | **Approved draft** | It describes documented flows and limits. The prior unverified “discovery is read-only by default” claim was removed from final listing copy. | Revalidate every feature statement against the canonical Electron source and clean-Windows candidate. |
| Third-party relationship | **Approved draft** | The description states that referenced third-party names belong to their owners and that no affiliation or endorsement is claimed. | Keep this disclaimer if third-party names remain in the listing. |
| What’s new | **Correct** | It remains blank for the initial submission. | Add only package-specific verified changes on a later update. |
| Search terms | **Corrected** | The final set has seven unique, product-relevant generic phrases. It contains no price term and no other product title. | Do not add an eighth term or reintroduce a third-party title. |
| Unsupported claims | **Excluded** | The package rejects “Microsoft-certified,” “signed,” “Store-ready,” “Windows EXE,” silent installation, and affiliation claims. | Preserve these exclusions unless direct evidence later exists. |

### Approved short description

> A desktop setup helper for reviewing developer-tool options, exploring curated extras, and previewing planned changes before you approve them.

**Why this is safe:** It identifies the product category and visible user workflow without claiming automation, installation success, certification, security guarantees, or a relationship with another company. The wording remains subject to a final candidate check because the canonical desktop source was not available in this review.

### Approved long description

> Claude Code Tools Installer helps you work through setup in clear steps. It keeps shared developer-tool choices separate from project-level choices for one selected folder, so you can decide what belongs where.
>
> Review a curated set of extras, check what is already configured, and use the plan view before approving a proposed change. For eligible local skill folders, the documented cleanup behavior is backup-first rather than silent deletion.
>
> **What it helps with**
>
> - Reviewing setup status and opening the documented setup path when you choose it.
> - Reviewing curated tool and project-feature choices one at a time.
> - Viewing a plan before a selected change is applied.
> - Checking known local setup locations and, when you choose one, a single project folder.
> - Reviewing certain discovered local skills with a backup-first cleanup option where eligible.
>
> This app is a setup helper, not a guarantee that every third-party tool, command, package, license, or service is right for your project. Review each proposed action and the original source before approving a change. Claude Code, Anthropic, GitHub, Convex, npm, and other third-party names belong to their respective owners; no affiliation or endorsement is claimed.

### Approved search terms

| # | Search term | Policy check |
|---:|---|---|
| 1 | developer tools | Relevant generic phrase |
| 2 | local development workflow | Relevant generic phrase |
| 3 | project setup helper | Relevant generic phrase |
| 4 | developer utility | Relevant generic phrase |
| 5 | tool catalog | Relevant generic phrase |
| 6 | change preview | Relevant generic phrase |
| 7 | setup review | Relevant generic phrase |

> Microsoft Store policy limits search terms to **seven unique terms or phrases**, requires relevance, excludes pricing terms, and forbids other product titles unless the same publisher owns those products. [1]

## Capture manifest review

### Current template status

| Requirement | Result | Evidence in the corrected template |
|---|---|---|
| Non-submittable status | **Pass** | `capture_mode` is `template_only`; `submission_status` is `not_captured_not_for_upload`. |
| Package identity evidence | **Pending by design** | Commit, package SHA-256, architecture, Windows version, resolution, and capture time are `null` until observed. |
| Native candidate provenance | **Pass as a gate** | The required origin is `native_app_window_from_exact_installed_clean_windows_tested_msix`. |
| No mocked or staged UI | **Pass as a gate** | The prohibited-source list rejects browser previews, fixture/mock IPC, forced states, injected results, generated mockups, and composites. |
| Per-file auditability | **Pass as a template** | Every planned PNG has fields for capture origin, SHA-256, dimensions, and byte size. |
| Screenshot state coverage | **Pass as an internal plan** | Four core states and one optional distinct management/advisor state are named. |
| Official screenshot specifications | **Pending until capture** | Final files must be real PNGs, each at least 1366×768 and no larger than 50 MB. [2] |
| Final upload readiness | **Fail / intentionally blocked** | No final MSIX, Windows test, actual PNG, or completed manifest exists. |

### Capture rules for truthful screenshots

A final screenshot must come from the exact installed MSIX bundle that was built from the recorded commit, installed on a clean Windows device, and tested for launch, real local workflow adapters, and uninstall. Its UI state must be something a normal customer can actually reach. Realistic, bounded, non-sensitive demo data is allowed. A browser page, a renderer opened outside the package, a mocked IPC bridge, injected chat or completion output, an AI image, or a composite must remain reference-only and must never be uploaded.

The final screenshot should retain the native window state that users normally see. Critical visual content belongs in the upper two-thirds. Captions, if used, belong in Partner Center and must be factual and no longer than 200 characters. Do not burn captions, logos, marketing messages, arrows, or device frames into the PNG. [2]

### Official minimum versus internal quality standard

Microsoft requires at least **one** screenshot for a Store listing and recommends four or more for a strong desktop listing. CCTI’s four named core captures are therefore an **internal quality standard**, not a claim that Partner Center technically requires four. The optional fifth image should be used only when it shows a tested, distinct feature. [2] [3]

## Remaining release gates

| Gate | Current state | Exit evidence |
|---|---|---|
| Canonical desktop source | Blocked | Canonical Electron repository, exact commit or tag, build scripts, and `Package.appxmanifest`. |
| Partner Center identity | Blocked | Exact Identity name, Publisher, and PublisherDisplayName present only in protected build inputs. |
| MSIX candidate | Blocked | Windows-built x64 and ARM64 packages and bundle with independently verified SHA-256. |
| Clean-Windows proof | Blocked | Install, launch, real workflow, and clean-uninstall record tied to that hash. |
| Screenshots and logos | Blocked | Native PNGs, completed manifest, audit pass, and required tiles/logos. |
| Public support and privacy URLs | Blocked | Reachable product-specific canonical HTTPS destinations. |
| Age rating and commercial decisions | Blocked | Accurate IARC answers plus explicit owner decisions for availability, markets, and price. |
| Restricted capability | Conditional | Final manifest declares `runFullTrust`; response exactly matches final desktop behavior. |
| Final certification action | Blocked | Owner has reviewed and explicitly approved the exact Partner Center payload. |

## Review decision

**Use the corrected descriptions and seven-term set as internal draft copy. Do not enter them as final Store metadata until the final Windows candidate proves the described behavior. Do not generate or upload any screenshot until the canonical MSIX is built, tested, and recorded in the completed manifest.**

## References

[1]: https://learn.microsoft.com/en-us/windows/apps/publish/store-policies "Microsoft Store Policies — Accurate Representation and Search Terms"

[2]: https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/screenshots-and-images "Add app screenshots, images, and trailers for MSIX apps"

[3]: https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/create-app-submission "Create app submission for MSIX apps"

[4]: https://github.com/SteveKinzey/claude-code-tools-installer/releases/tag/v2026.08.12 "Claude Code Tools Installer v2026.08.12 release"
