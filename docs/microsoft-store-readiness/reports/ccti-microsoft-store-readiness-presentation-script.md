# CCTI Microsoft Store Listing Readiness — Presentation Script

**Audience:** Product owner and release operator
**Duration:** Approximately five minutes
**Purpose:** Explain what is ready, what is deliberately blocked, and what proof is required before a Microsoft Store certification submission.

## Presenter framing

> “This is a readiness demonstration, not a Store submission. The point is to make the final submission easy to trust because every listing claim, screenshot, and package record is tied to evidence.”

## Slide-by-slide script

| Slide | On-screen content | Speaker script | Transition |
|---:|---|---|---|
| 1. Readiness, not launch | **CCTI Microsoft Store Listing Readiness**
Draft copy complete. Submission blocked by evidence gates. | “Today’s output is a Store-listing readiness package for Claude Code Tools Installer. It includes reviewed draft copy, a screenshot capture system, and an operator sequence. It does not claim that CCTI is in the Store, certified, signed for Store distribution, or ready for submission.” | “First, here is the product story we can truthfully tell today.” |
| 2. The truthful product story | **CCTI is a review-before-change setup helper.**
Curated options. Project-aware choices. A visible plan before approval. | “CCTI helps people work through developer-tool setup in clear steps. It keeps shared choices separate from project-level choices, surfaces curated extras, and shows a plan before a proposed change. The copy also states the boundary: CCTI is a setup helper, not a guarantee about third-party tools or services.” | “That product story is useful, but only if the wording remains accurate and policy-safe.” |
| 3. Copy review outcome | **Short and long descriptions: approved as conditional drafts**
No certification, installer, or affiliation claims. | “The short and long descriptions now avoid unsupported claims. They do not say that CCTI is Microsoft-certified, signed, Store-ready, a Windows EXE installer, or affiliated with Anthropic or Claude. We also removed the unverified claim that discovery is read-only by default from the final description. The product name itself requires confirmation against the reserved Partner Center name and approved trademark use. Every remaining feature claim must be checked again against the final Electron build.” | “Search terms needed a concrete correction.” |
| 4. Search term correction | **Seven relevant, generic terms**
12–26 characters each · 16 total words · no pricing terms or other product titles. | “The original draft had eight terms and included a third-party product title. Microsoft allows at most seven keywords, each with a 40-character maximum and no more than 21 total words. Store policy also prohibits pricing terms and other product titles unless the same publisher owns them. The corrected CCTI set passes: seven terms, 12 to 26 characters each, and 16 total words.” | “The biggest integrity risk is not the text. It is the screenshots.” |
| 5. Screenshot truthfulness rule | **No mocks. No browser captures. No fixture state.**
Only native UI from the exact tested MSIX candidate. | “A Store screenshot is proof of the product experience. A browser preview, a renderer outside the package, mocked IPC, injected chat output, an AI mockup, a composite, or an image from an old build can look convincing but is not valid Store evidence. The only acceptable source is the normal native app window from the exact installed, clean-Windows-tested MSIX candidate.” | “The manifest converts that principle into a release control.” |
| 6. Evidence-tied capture manifest | **Every PNG carries provenance.**
Commit. Bundle and manifest hashes. Package identity. Windows test record. Origin. Dimensions. File hash. | “The template is explicitly marked not for upload. When we reach the capture step, we replace placeholders with observed evidence: the canonical source commit, bundle SHA-256, package identity, full package name, unpacked manifest hash, and clean-Windows test record. Each PNG then records its native window title, UTC capture time, origin, dimensions, byte size, and SHA-256. This lets a reviewer reject a screenshot that came from the wrong build or a mock environment.” | “We plan four strong customer views, even though the formal minimum is lower.” |
| 7. Screenshots: policy minimum and CCTI standard | **Microsoft: at least one screenshot.**
**CCTI standard: four core states, plus one optional distinct state.** | “Microsoft requires at least one screenshot and recommends four or more for a quality desktop listing. CCTI’s internal standard is four core views: readiness and setup, curated catalog, project library, and plan or review. A fifth management or advisor view is optional and only belongs in the listing if it is real, tested, and distinct. Every PNG must be at least 1366 by 768, PNG format, and no larger than 50 megabytes.” | “Here is why we cannot build or submit yet.” |
| 8. Current release decision | **Three final-candidate controls remain**
Policies, policy URLs, matching screenshots, and metadata are owner-confirmed available. | “The canonical Electron source is available, and the latest successful Store workflow produced an unsigned bundle at commit `f62ef8b55e9aaabadb336f8677c588c0fbc5b2e4`. The release owner confirms that the policies, public policy URLs, matching screenshots, and required metadata already exist. The remaining work is limited to protected identity configuration, independent verification of the final bundle, and a clean-Windows test record tied to that exact bundle.” | “The three controls are sequential.” |
| 9. Final-candidate controls | **1. Protected identity** → **2. Independently verified final bundle** → **3. Matching clean-Windows test record** | “First, place the exact Partner Center identity values in protected build inputs. Second, build the final unsigned bundle and independently verify its checksum and package manifests. Third, run install, launch, real-workflow, and uninstall checks on clean Windows against that exact bundle SHA-256. The existing policy URLs and screenshots are retained; link them to the final evidence manifest and recapture screenshots only if the final build changes their captured UI.” | “Once those three controls are complete, the release package is evidence-complete.” |
| 10. Decision and next action | **Bind → Verify → Test**
Use existing policies and screenshots; rebind them to the final candidate. | “Do not rebuild the listing assets from scratch. Bind the protected identity configuration to the selected commit, independently verify the resulting unsigned bundle, and run the matching clean-Windows test. Then record the existing policy URLs and screenshot hashes against that final candidate. The final submission review is a confirmation of the now-complete payload, not a fourth evidence gap.” | “Questions should focus only on the identity, final-bundle, and clean-Windows controls.” |

## Closing statement

> “The standard is simple: the product, listing copy, screenshots, package metadata, and release claims must all describe the same tested Windows artifact. Until they do, CCTI remains in listing preparation, not submission.”

## Presenter reference facts

| Topic | Reference fact |
|---|---|
| Accurate representation | Product metadata, including descriptions, screenshots, search terms, and category, must accurately reflect product source, functionality, and features. [1] |
| Search terms | Maximum seven relevant keywords; 40 characters each; 21 total words; no pricing terms or other product titles unless published by the same publisher. [1] [5] |
| Screenshots | At least one is required; Microsoft recommends four or more. Desktop images are PNGs at least 1366×768 and no larger than 50 MB. [2] [3] |
| Existing Windows artifact | The v2026.08.12 release contains a Windows ZIP. It is not evidence of an MSIX or Store status. [4] |

## References

[1]: https://learn.microsoft.com/en-us/windows/apps/publish/store-policies "Microsoft Store Policies — Accurate Representation and Search Terms"

[2]: https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/screenshots-and-images "Add app screenshots, images, and trailers for MSIX apps"

[3]: https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/create-app-submission "Create app submission for MSIX apps"

[4]: https://github.com/SteveKinzey/claude-code-tools-installer/releases/tag/v2026.08.12 "Claude Code Tools Installer v2026.08.12 release"

[5]: https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/add-additional-information "Add additional information for MSIX app"
