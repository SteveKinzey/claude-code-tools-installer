# Claude Code Tools Installer — Microsoft Store Listing Readiness Demonstration

> **Demonstration status:** **Listing preparation only — blocked before build.** This is a source-grounded example of the `microsoft-store-listing-readiness` skill. It is **not** a Partner Center draft, a certified package, or a submission request.

## Demonstration outcome

This package shows how the skill produces useful Store-ready copy **without inventing package evidence**. The public project and published release establish a credible product narrative, privacy and support contacts, and the existing Windows artifact type. They do **not** establish an MSIX package, exact Partner Center identity, a clean-Windows test result, or final-package screenshots. Those limits are preserved throughout.

| Outcome | Result | Why it matters |
|---|---|---|
| Listing copy | **Drafted** | Claims are restricted to the public product documentation and release record. |
| Current Windows distribution statement | **Verified** | The current release contains a legacy Windows ZIP for PowerShell 7+. New Windows distribution uses the Microsoft Store MSIX route. |
| Store category recommendation | **Ready for owner review** | `Developer tools` → `Utilities` fits the documented setup and local workflow utility. |
| Final Store screenshots | **Not created** | Browser/fixture captures would be reference-only and must never be uploaded. |
| MSIX bundle | **Not built** | The supplied project is a web companion rather than the canonical Electron desktop source. |
| Partner Center submission | **Blocked** | Identity values, Windows validation, public URLs, IARC answers, and owner approval remain outstanding. |

## Evidence ledger

| Item | Verified value | Confidence / source |
|---|---|---|
| Product name | Claude Code Tools Installer | Public website source and official GitHub release. [1] [2] |
| Website source snapshot | `67eb95b493b6c0ed98122d5332ff747d5ccc3522` | Attached read-only project clone, inspected 2026-09-09. |
| Supplied project type | React/Vite web companion | Attached read-only source clone: root `package.json` provides web build/check/test scripts only; `desktop/` is absent. No public repository URL was supplied for this clone. |
| Direct Windows release artifact | `claude-code-tools-installer-windows.zip` | Official release `v2026.08.12`; described for PowerShell 7+. [2] |
| Direct Windows artifact SHA-256 | `9811d14d9048440b77a96504197656aeb7411c45c8812d33916187957bd28a60` | GitHub release metadata. [2] |
| Direct-release boundary | Legacy ZIP archive; **not evidence of an MSIX, Store publication, or certification** | Artifact extension and release notes. [2] |
| MSIX state | **Not built / not validated** | No canonical Electron source, AppX manifest, MSIX build script, tile directory, or Windows test evidence supplied. [4] |
| Restricted-capability position | Draft rationale for `runFullTrust` only; must be checked against final manifest and Electron code | Project documentation labels the rationale as intended-product guidance, not final-manifest evidence. [4] |
| Support contact | `support@sk-america.com` | Public product disclaimer and terms source. [5] |
| Privacy contact | `privacy@sk-america.com` | Public privacy policy source. [5] |
| Public privacy URL | **Not yet verified** | Source exposes a relative `/privacy` route, but no canonical deployed hostname was provided in the evidence set. [5] |
| Public support URL | **Not yet verified** | A support email is documented; a distinct public support destination was not evidenced. [5] |

> **Important distinction:** the 2026.08.12 release is proof of a downloadable Windows ZIP and its hash. It is not proof that the app has an MSIX bundle, Store identity, Store signing state, Windows clean-device test, or certification status.

## Product identity

| Partner Center field | Demonstration value | Entry rule |
|---|---|---|
| Product name | **Claude Code Tools Installer** | Use only if the reserved Partner Center product name matches exactly. |
| Publisher / developer | **Unresolved** | Enter the exact `PublisherDisplayName` reserved in Partner Center; do not infer from the repository, email domain, or company name. |
| Primary category | **Developer tools** | Recommended by the skill taxonomy reference for a developer setup and workflow application. Reconfirm against the current Partner Center taxonomy. [6] |
| Subcategory | **Utilities** | Recommended pending owner confirmation. [6] |
| Secondary category | Leave blank | Add only if it accurately improves discovery. |
| Support email | `support@sk-america.com` | Source-grounded; verify that the mailbox is monitored before submission. [5] |
| Support URL | **Unresolved** | Publish and verify a product-specific support page, then enter its canonical HTTPS URL. |
| Privacy Policy URL | **Unresolved** | Deploy the existing privacy page and verify its canonical HTTPS URL before entry. |
| Xbox availability | Do not select | No tested Xbox support or owner direction exists. [6] |

## Example listing copy

### Short description

> A desktop setup helper for reviewing developer-tool options, exploring curated extras, and previewing planned changes before you approve them.

### Long description

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
> This app is a setup helper, not a guarantee that every third-party tool, command, package, license, or service is right for your project. Review each proposed action and the original source before approving a change. Claude Code, Anthropic, GitHub, Convex, npm, and other third-party names belong to their respective owners; no affiliation or endorsement is claimed. [5]

### What’s new

**Leave blank.** This is an initial Store submission demonstration. Do not add release notes until a later MSIX update has verified changes.

### Search terms

Enter as separate Partner Center Keyword entries. This set is **7 of 7** allowed entries, each within the 40-character maximum, and totals 16 of 21 allowed words. [9]

- developer tools
- local development workflow
- project setup helper
- developer utility
- tool catalog
- change preview
- setup review

### Copy review: claim-to-source mapping

| Listing claim | Supporting evidence | Safe? |
|---|---|---|
| Clear setup steps and curated choices | User manual and public product documentation. [5] | Yes |
| Review a plan before approving changes | User manual and terms. [5] | Yes |
| Discovery is read-only by default | Draft `runFullTrust` rationale; final desktop source was not supplied. [4] | **Not included pending final-code verification** |
| Backup-first cleanup for eligible local skills | User manual, product disclaimer, and rationale. [4] [5] | Yes, with “where eligible” boundary |
| Microsoft-certified / signed / Store-ready | No evidence | **Do not use** |
| Windows EXE installer | No evidence; current release is a ZIP | **Do not use** |
| Automatic / silent installation | Contradicted by review-before-change documentation | **Do not use** |
| Affiliated with Anthropic or Claude | Terms disclaim affiliation | **Do not use** |

## Visual asset handoff — correctly separated

No screenshots or tiles are included as final Store assets. The current web project can provide useful **reference-only** studies, but it cannot provide the required genuine captures from the exact installed, clean-Windows-tested MSIX candidate.

| Asset | Required evidence | Current status | Correct next step |
|---|---|---|---|
| `01-readiness.png` | Installed candidate showing real readiness/setup state | Pending | Capture from the final Windows MSIX at ≥1366×768. |
| `02-catalog.png` | Real app catalog and choice controls | Pending | Capture only after final MSIX validation. |
| `03-project-library.png` | Real project library with scope boundary | Pending | Use bounded, non-sensitive demo data. |
| `04-review.png` | Real review-before-change state | Pending | Show no fabricated completion or credential state. |
| `05-management-or-advisor.png` | Distinct real management/advisor feature | Optional / pending | Include only if present and tested in the candidate. |
| Listing tile | 300×300 PNG with a clean app mark | Pending | Derive from an approved master mark after final brand approval. |
| AppX tiles | Manifest-referenced 150×150, 44×44, optional 310×150, and 50×50 PNGs | Pending | Export only from the approved master and retain exact manifest filenames. |

### Safe capture plan

1. Build the canonical Electron source on Windows with the exact reserved Partner Center identity values held in protected inputs.
2. Create the x64 and ARM64 packages, bundle them, and record a SHA-256 hash.
3. Install the exact candidate on a clean Windows device. Test launch, the real local workflow adapters, and clean uninstall.
4. Capture four or five native-app PNGs from that installed candidate. Use realistic, non-sensitive demo data and keep key content in the upper two-thirds.
5. Record source commit, bundle SHA-256, architecture, Windows version, native resolution, UTC capture time, filenames, and factual Partner Center captions in the capture manifest.
6. Validate every PNG is at least 1366×768 and no larger than 50 MB. Do not upload reference captures, fixture data, browser pages, mockups, device frames, title cards, or composited screenshots. [7]

The accompanying folders intentionally contain only a **capture-manifest template** and **asset audit**. They do not contain fake Store screenshots.

## Example `runFullTrust` restricted-capability response

Use this only after the final desktop manifest proves that `runFullTrust` is actually declared and no material statement has changed:

> Claude Code Tools Installer is a packaged Electron/Win32 desktop application. It requires `runFullTrust` so the app can run its native desktop process at the standard Windows user level and complete local, user-approved setup workflows. These workflows include checking whether Claude Code is available, opening the official Claude Code installation path when the user chooses it, reading only known Claude Code locations plus at most one folder the user explicitly selects, and preparing user-approved tool or project-package changes after a visible preview step.
>
> The capability is not used for elevation, administrator access, background persistence, arbitrary disk scanning, silent installation, or unrestricted command execution. Discovery is read-only by default. Any change is shown in a reviewable plan and requires an explicit user action; eligible cleanup moves a reviewed local skill folder to a backup instead of deleting it.

**Current gate:** The public web companion’s rationale explicitly says the canonical Electron source and final `Package.appxmanifest` were not available there. Treat this text as a draft, not a declaration. [4]

## Remaining submission prerequisites

- [ ] Identify the canonical Electron desktop repository and record the exact source commit or release tag.
- [ ] Obtain the exact Partner Center **Identity name**, **Publisher**, and **PublisherDisplayName**. Store them only as protected Windows build inputs; never commit or paste the values into this package.
- [ ] Verify `msix:prepare` and `dist:win:store` scripts in the canonical desktop package.
- [ ] Create the manifest-referenced AppX tile assets from an approved master mark.
- [ ] Build x64 and ARM64 packages on Windows and assemble an MSIX bundle.
- [ ] Independently verify the bundle SHA-256 and manifest identity fields.
- [ ] Test install, launch, real adapters, and clean uninstall on a clean Windows device. Do not distribute an isolated test copy.
- [ ] Capture final PNG screenshots from that exact candidate and complete the manifest and audit.
- [ ] Publish and externally verify the product-specific privacy and support HTTPS URLs.
- [ ] Complete the IARC questionnaire accurately; do not pre-state a rating.
- [ ] Reconfirm category, availability, pricing, restricted capability declaration, and current Partner Center fields with the owner.
- [ ] Present the exact final Partner Center payload to the owner and obtain explicit approval before certification submission.

## Recommended operator sequence

| Phase | Owner / operator action | Success signal |
|---|---|---|
| 1. Source recovery | Attach the canonical Electron repository, not the website companion. | Desktop package, manifest, and Store scripts are inspectable. |
| 2. Identity control | Load the three exact reserved values as protected CI secrets. | CI proves values are present without printing them. |
| 3. Windows candidate | Build and bundle x64 + ARM64 MSIX artifacts on a Windows runner. | Bundle and independently checked SHA-256 exist. |
| 4. Clean-device proof | Install, launch, exercise genuine workflows, and uninstall the exact candidate. | Test record names Windows build/version and package hash. |
| 5. Capture | Take native screenshots from that candidate only. | PNGs, manifest, and asset audit all validate. |
| 6. Listing review | Replace unresolved URLs and re-check every claim. | Final Partner Center payload is ready for owner review. |
| 7. Submission | Obtain explicit owner approval. | Owner approves the exact payload; only then submit. |

## References

[1]: https://github.com/SteveKinzey/claude-code-tools-installer "Claude Code Tools Installer source repository"

[2]: https://github.com/SteveKinzey/claude-code-tools-installer/releases/tag/v2026.08.12 "Claude Code Tools Installer v2026.08.12 release"

[4]: https://github.com/SteveKinzey/claude-code-tools-installer "Official product repository; source-specific `runFullTrust` draft rationale was inspected in the attached read-only web companion"

[5]: https://github.com/SteveKinzey/claude-code-tools-installer "Official product repository; user manual, privacy policy, terms, and disclaimer were inspected in the attached read-only web companion"

[6]: https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/categories-and-subcategories "Microsoft Store categories and subcategories"

[7]: https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/screenshots-and-images "Microsoft Store screenshots and images guidance"

[8]: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options "Microsoft Store package delivery guidance"

[9]: https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/add-additional-information "Add additional information for MSIX app"
