# CCTI Microsoft Store Readiness Verification

> **Verification status:** **Pass for draft listing inputs and release controls.** This review verifies the exact intended keyword set, the screenshot-provenance template, and the presentation script. It does **not** verify a Partner Center entry, an MSIX package, a clean-Windows test, a Store certification result, or publication.

## Decision summary

The proposed CCTI keyword set passes the current Microsoft Store MSIX rules. It contains **seven** relevant generic keywords, each under **40 characters**, with **16 total words** against a **21-word** maximum. It contains no pricing term and no separate third-party product title. Microsoft now labels this field **Keywords**, formerly **Search terms**. [1] [2]

The capture manifest is appropriately locked in **template-only** status. Its new controls bind future screenshots to the exact bundle, identity, manifest, and clean-Windows test record. It rejects mocked, staged, browser, generated, composited, old-build, macOS, and Linux images. The manifest is an evidence checklist, not a technical attestation system; it still requires a human release reviewer or a future validator to verify the observed values before upload.

The presentation script is accurate and now surfaces the three material review gates that should not be omitted in a release discussion: exact keyword limits, product-name and trademark confirmation, and final-manifest confirmation before reusing any restricted-capability rationale.

## 1. Exact Partner Center keyword verification

Microsoft allows no more than seven keywords, each no longer than 40 characters, and no more than 21 separate words across the full set. Policy also requires relevance, prohibits pricing terms, and prohibits other product titles unless the publisher also publishes those products. [1] [2]

| # | Exact intended keyword | Characters, including spaces | Words | 40-character limit | Relevance and policy result |
|---:|---|---:|---:|---|---|
| 1 | `developer tools` | 15 | 2 | Pass | Generic and relevant. |
| 2 | `local development workflow` | 26 | 3 | Pass | Generic and relevant. |
| 3 | `project setup helper` | 20 | 3 | Pass | Generic and relevant. |
| 4 | `developer utility` | 17 | 2 | Pass | Generic and relevant. |
| 5 | `tool catalog` | 12 | 2 | Pass | Generic and relevant. |
| 6 | `change preview` | 14 | 2 | Pass | Relevant to the documented review-before-change workflow. |
| 7 | `setup review` | 12 | 2 | Pass | Generic and relevant. |
| **Total** | **7 keywords** | **116 characters across all keywords** | **16** | **Pass** | **Within the 7-keyword and 21-word limits.** |

**Keyword decision: Pass.** Enter these as seven separate Keywords fields. Do not add an eighth value. Do not reintroduce `Claude Code setup` or another third-party product title into the Keywords field unless CCTI becomes the publisher of that product. This review confirms the proposed inputs only; it does not confirm that they have been entered or saved in Partner Center.

## 2. Screenshot provenance inspection

### Current control posture

| Provenance control | Result | Review finding |
|---|---|---|
| Explicit template status | Pass | `capture_mode` is `template_only` and `submission_status` is `not_captured_not_for_upload`. |
| Exact candidate requirement | Pass | The only permitted origin is the native app window from the exact installed, clean-Windows-tested MSIX. |
| Bundle-to-image linkage | Pass | The template requires source commit, bundle SHA-256, bundle filename, package identity name, full package name, and manifest SHA-256. |
| Clean-Windows proof | Pass | The manifest now carries a test record ID, timestamp, and individual install, launch, real-adapter, and clean-uninstall outcomes. |
| Per-image traceability | Pass | Every planned PNG now records origin, timestamp, native window title, SHA-256, dimensions, and byte size. |
| File requirements | Pass | PNG only; at least 1366×768; no larger than 50 MB; captions must be factual, optional, 200 characters or fewer, and not rendered into the PNG. [3] |
| Reference-only separation | Pass | Browser pages, renderer-only sessions, mocks, fixtures, forced states, injected results, composites, generated mockups, old builds, macOS, and Linux sessions are explicitly prohibited as submission sources. |
| Final upload condition | Pass as a block | The `do_not_upload_until` list requires all evidence, all per-file checks, no prohibited source, and an asset-audit pass. |

Microsoft requires at least one screenshot for an MSIX Store listing, recommends four or more for a strong desktop presentation, and requires desktop screenshots to be PNG files at least 1366×768 and no larger than 50 MB. [3] [4] CCTI’s four core screenshot states remain an internal quality bar rather than a claim that Partner Center technically requires four.

### Remaining implementation limit

The template describes a strong audit trail but cannot prove provenance by itself. A completed JSON file can be edited manually. Before the package is production-ready, add a local or CI validator that performs the following checks against the actual `submission-ready/screenshots/` folder:

1. Match every final PNG’s SHA-256, byte size, and dimensions to the completed manifest.
2. Reject `null`, empty, or placeholder values in final-mode manifests.
3. Verify that the bundle hash, identity name, full package name, and manifest hash match the candidate recorded in the Windows test report.
4. Require a completed test record showing install, launch, real-adapter, and clean-uninstall success.
5. Treat any asset not linked to that candidate as reference-only and exclude it from upload.

## 3. Presentation script review

| Area | Result | Rationale |
|---|---|---|
| Opening status | Pass | Clearly frames the package as readiness work, not submission, certification, signing, or publication. |
| Product claims | Pass | Restricts CCTI to a review-before-change setup-helper position and retains third-party limitations. |
| Keyword policy | Pass | Updated to state 7 keywords, 40 characters each, 21 total words, no pricing terms, and no other product titles. |
| Product name and trademark | Pass with gate | Script now requires confirmation that the reserved Partner Center name and permitted trademark use support the selected product name. |
| Screenshot integrity | Pass | Rejects browser, renderer-only, mocked, injected, generated, composited, and old-build imagery. |
| Package evidence | Pass | Updated to require package identity, full package name, unpacked manifest hash, bundle hash, and clean-Windows test record. |
| Restricted capability | Pass with gate | Requires the final manifest to declare the capability before any `runFullTrust` response is reused. |
| Owner approval | Pass | Keeps exact Partner Center payload review and owner approval as the final gate before certification submission. |

## 4. Release-gate decision

| Gate | Current disposition | Required exit evidence |
|---|---|---|
| Keywords | **Ready as draft** | Enter the seven verified phrases separately in Partner Center. |
| Product name and trademark | **Conditional** | Exact reserved name and permitted use of third-party branding confirmed by the owner. |
| Canonical Electron source | **Blocked** | Canonical repository, fixed commit or tag, packaging scripts, and final manifest. |
| Partner Center identity | **Blocked** | Exact Identity name, Publisher, and PublisherDisplayName supplied through protected inputs. |
| MSIX candidate | **Blocked** | Windows-built bundle with independent SHA-256 and inspected identity. |
| Clean-device test | **Blocked** | Test record tied to the candidate showing install, launch, real adapters, and uninstall. |
| Final screenshots | **Blocked** | Native candidate PNGs, completed manifest, and passing audit. |
| Public support and privacy | **Blocked** | Product-specific, reachable HTTPS URLs. |
| Restricted capability | **Conditional** | Final manifest and desktop behavior support the declaration and response wording. |
| Certification submission | **Blocked** | Owner has reviewed the exact final payload and explicitly approved submission. |

## Conclusion

**The exact keyword inputs are ready for later Partner Center entry. The capture manifest now gives CCTI an auditable path to truthful screenshots, but not proof until an actual Windows candidate and test record exist. The presentation script accurately communicates those boundaries and should be used as the release-review narrative.**

## References

[1]: https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/add-additional-information "Add additional information for MSIX app"

[2]: https://learn.microsoft.com/en-us/windows/apps/publish/store-policies "Microsoft Store Policies — Accurate Representation and Search Terms"

[3]: https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/screenshots-and-images "Add app screenshots, images, and trailers for MSIX apps"

[4]: https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/create-app-submission "Create app submission for MSIX apps"
