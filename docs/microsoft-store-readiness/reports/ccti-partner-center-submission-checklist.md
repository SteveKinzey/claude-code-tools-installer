# Claude Code Tools Installer — Partner Center Submission Checklist

> **Submission status:** **Draft checklist — do not submit.** This document consolidates the verified Microsoft Store limits, CCTI draft metadata, screenshot-provenance rules, and Windows MSIX release gates. It does not prove a Partner Center listing is complete, a package is certified, or a submission is approved.

## Release decision

CCTI has a canonical Electron desktop source with MSIX build scripts, AppX assets, and successful Windows MSIX build workflow records. The present direct-download release remains a Windows ZIP and must continue to be described as a ZIP. The release owner confirms that the explicit policies and policy URLs, as well as a matching screenshot set, already exist. The Store route is therefore blocked by three final-candidate controls only: protected identity configuration, an independently verified final bundle, and a matching clean-Windows test record. Screenshots must be re-bound to the final candidate; recapture only if the protected-identity build changes the captured UI or candidate. [1] [2]

| Evidence area | Current position | Submission gate |
|---|---|---|
| Canonical desktop source | Located in `SteveKinzey/claude-code-tools-installer` | Record the exact release commit or tag. |
| MSIX build contract | `msix:prepare` and `dist:win:store` scripts exist; Store workflow builds x64 + ARM64 packages | Build the selected release commit on Windows. |
| Existing workflow evidence | Successful build workflow run `34330631222` at commit `f62ef8b55e9aaabadb336f8677c588c0fbc5b2e4`; its pre-final unsigned bundle and x64/ARM64 structure were inspected | This proves the build path only. After protected identity configuration, independently verify the newly produced final bundle and its companion checksum; do not treat the pre-final artifact as the submission candidate. |
| Clean-Windows evidence | A later clean-install workflow has a recorded success at a different commit | Run or retain a successful clean-Windows test tied to the exact selected bundle SHA-256. |
| Policies, policy URLs, and screenshot set | **Owner-confirmed available** | Record exact public URLs and bind each existing PNG to the final candidate; recapture only if the final candidate differs in the captured UI. |
| Current direct Windows artifact | Legacy ZIP release | Preserve truthful ZIP language until Store certification is complete. New Windows distribution uses the Store MSIX route. |
| Partner Center submission | Not performed | Owner must approve the exact payload and consequential choices. |

## Mandatory Partner Center metadata readiness

**Review result: owner-confirmed complete except for final-candidate dependencies.** The release owner confirms that explicit policies/policy URLs and the matching screenshot set already exist and that no other metadata gaps remain. This workspace has not directly fetched those URLs or files, so they are recorded as **owner-confirmed**, not independently verified. Do not mark the submission complete until the three final-candidate controls below are closed.

| Partner Center area | Mandatory field | CCTI readiness | Exact remaining action |
|---|---|---|---|
| Pricing and availability | Markets | **Owner-confirmed complete** | Preserve exact Partner Center selection in the final payload review. |
| Pricing and availability | Audience | **Owner-confirmed complete** | Preserve exact Partner Center selection in the final payload review. |
| Pricing and availability | Discoverability | **Owner-confirmed complete** | Preserve exact Partner Center selection in the final payload review. |
| Pricing and availability | Schedule | **Owner-confirmed complete** | Preserve exact Partner Center selection in the final payload review. |
| Pricing and availability | Base price | **Owner-confirmed complete** | Preserve exact Partner Center selection in the final payload review. |
| Properties | Category | **Owner-confirmed complete** | Reconfirm live taxonomy at final entry. |
| Properties | Privacy policy URL, if applicable | **Owner-confirmed available** | Record and fetch the exact canonical HTTPS URL before submission. |
| Properties | Business contact details | **Owner-confirmed complete** | Reconfirm in final payload review. |
| Age ratings | All IARC questions | **Owner-confirmed complete** | Reconfirm returned rating and answers in final payload review. |
| Packages | At least one package | **Blocked by final bundle gate** | Upload only the exact independently verified unsigned MSIX/AppX candidate. |
| Store listing | Description | **Owner-confirmed complete** | Revalidate against final tested candidate. |
| Store listing | At least one screenshot | **Owner-confirmed available** | Bind existing PNGs to final candidate in final manifest; recapture only if needed. |
| Store listing | Store logos, where current OS slot requires them | **Owner-confirmed complete** | Reconfirm required live slots before final entry. |
| Submission options | Restricted-capability declaration, if declared | **Owner-confirmed complete** | Reconfirm `runFullTrust` rationale against final manifest. |

## 1. Release boundary and source control

- [ ] Select the canonical desktop commit or release tag for this Store submission.
- [ ] Record the selected commit in the evidence ledger, capture manifest, MSIX build artifact record, and release review notes.
- [ ] Confirm the selected source includes `desktop/package.json`, `msix:prepare`, `dist:win:store`, AppX assets, and the final intended `Package.appxmanifest` behavior.
- [ ] Treat the Microsoft Store MSIX route as the only maintained Windows distribution route.
- [ ] Do not describe a legacy ZIP as an MSIX, Store package, or certified download.
- [ ] Record whether this is an initial submission or an update. For an initial submission, leave **What’s new in this version** blank. [3]

## 2. Protected Partner Center identity and MSIX build

The following exact values must come from the **reserved** Partner Center product identity. Do not infer, normalize, commit, paste into chat, place in a workflow-dispatch field, or display them in build logs.

| Protected build input | Partner Center source | Checklist |
|---|---|---|
| `CCTI_APPX_IDENTITY_NAME` | `Package/Identity/Name` | [ ] Stored as a protected environment secret. |
| `CCTI_APPX_PUBLISHER` | `Package/Identity/Publisher` | [ ] Stored as a protected environment secret. |
| `CCTI_APPX_PUBLISHER_DISPLAY_NAME` | `Package/Properties/PublisherDisplayName` | [ ] Stored as a protected environment secret. |

- [ ] Use a protected GitHub environment or equivalent secret store. Do not use workflow-dispatch inputs for identity values.
- [ ] Run the no-secret preflight from the canonical desktop repository.
- [ ] Run `npm ci` and `npm run check` from the selected commit.
- [ ] Build both x64 and ARM64 Store AppX packages on Windows.
- [ ] Bundle the packages with `MakeAppx bundle` into an **unsigned** MSIX bundle.
- [ ] Independently recompute the SHA-256 and verify the companion checksum file.
- [ ] Unpack the bundle and inspect both manifests. Confirm one x64 and one ARM64 package, one shared protected identity, correct application ID, and only the declared capabilities.
- [ ] Keep the unsigned submission bundle, isolated test copy, and legacy release artifacts separate. [4]

## 3. Windows candidate and clean-device evidence

- [ ] Record the bundle filename, SHA-256, source commit, build date, and Windows runner or workstation version.
- [ ] Create an isolated test copy only after the unsigned candidate passes independent verification.
- [ ] Test the isolated copy on a clean Windows device or isolated Windows runner.
- [ ] Record a test ID and UTC date tied to the selected bundle SHA-256.
- [ ] Confirm package installation.
- [ ] Confirm AUMID or normal app launch.
- [ ] Confirm real workflow adapters, not fixture or mocked integrations.
- [ ] Confirm clean uninstall and package removal.
- [ ] Remove the test package and its one-run local trust material after testing. Do not distribute or upload the isolated test copy.

## 4. Partner Center properties and product identity

| Partner Center field | Draft / required action | Final check |
|---|---|---|
| Product name | `Claude Code Tools Installer` only if it exactly matches a reserved name | [ ] Confirm reserved name and approved third-party trademark use. |
| Publisher display name | Exact Partner Center `PublisherDisplayName` | [ ] Pull from protected identity record; do not infer. |
| Primary category | **Developer tools** | [ ] Confirm current Partner Center taxonomy matches tested product. |
| Subcategory | **Utilities** | [ ] Confirm owner accepts this descriptive fit. |
| Secondary category | Leave blank | [ ] Add only if it accurately improves discovery. |
| Product website | Public product-specific HTTPS URL | [ ] Reachable and current. |
| Support contact and URL | `support@sk-america.com` plus public product-specific HTTPS support destination | [ ] Verify monitored support mailbox and reachable URL. |
| Privacy Policy URL | Public product-specific HTTPS URL | [ ] Reachable, current, and accurately describes the final app’s information practices. |
| Xbox | Do not select | [ ] Change only with tested Xbox support and explicit product decision. |
| Age ratings | Complete IARC questionnaire from the final product | [ ] Do not guess or pre-state a rating. |

The product title, description, screenshots, category, keywords, and third-party relationship must accurately represent the tested product. Do not imply an affiliation or endorsement by Anthropic, Claude, GitHub, Convex, npm, or another third party without permission. [5]

## 5. Store listing copy and features

### Short description

> A desktop setup helper for reviewing developer-tool options, exploring curated extras, and previewing planned changes before you approve them.

- [ ] Confirm the final desktop candidate retains every workflow stated above.
- [ ] Do not add certification, signing, installation-success, security-guarantee, or third-party affiliation claims without direct evidence.

### Long description

> Claude Code Tools Installer helps you work through setup in clear steps. It keeps shared developer-tool choices separate from project-level choices for one selected folder, so you can decide what belongs where.
>
> Review a curated set of extras, check what is already configured, and use the plan view before approving a proposed change. For eligible local skill folders, the documented cleanup behavior is backup-first rather than silent deletion.
>
> The app helps users review setup status and a documented setup path, compare curated tool and project-feature choices, preview a selected change, check known local setup locations plus one selected project folder, and review certain discovered local skills with a backup-first cleanup option where eligible.
>
> This app is a setup helper, not a guarantee that every third-party tool, command, package, license, or service is right for a customer’s project. Review each proposed action and original source before approval. Third-party names belong to their respective owners; no affiliation or endorsement is claimed.

- [ ] Revalidate every sentence against the final tested Windows candidate.
- [ ] Keep the initial **What’s new in this version** field blank.
- [ ] Do not place URLs, HTML, source code, or claims that require a later release in the description field. [3]

### Verified Keywords

Enter each value as a separate Partner Center **Keyword**. The Microsoft limit is seven Keywords, 40 characters per Keyword, and 21 separate words across the full set. Policy also requires relevance and prohibits pricing terms and third-party product titles unless the publisher also publishes those products. [5] [6]

| # | Exact Keyword | Characters | Words | Entry check |
|---:|---|---:|---:|---|
| 1 | `developer tools` | 15 | 2 | [ ] Enter exactly. |
| 2 | `local development workflow` | 26 | 3 | [ ] Enter exactly. |
| 3 | `project setup helper` | 20 | 3 | [ ] Enter exactly. |
| 4 | `developer utility` | 17 | 2 | [ ] Enter exactly. |
| 5 | `tool catalog` | 12 | 2 | [ ] Enter exactly. |
| 6 | `change preview` | 14 | 2 | [ ] Enter exactly. |
| 7 | `setup review` | 12 | 2 | [ ] Enter exactly. |
| **Total** | **7 Keywords** | **116** | **16** | **[ ] Within every verified limit.** |

- [ ] Do not add an eighth Keyword.
- [ ] Do not add `Claude Code setup`, a pricing term, or another product title to the Keyword field.

## 6. Screenshot and Store-logo evidence

Microsoft requires at least one screenshot, recommends four or more for a desktop listing, and requires desktop screenshots to be PNG files at least 1366×768 and no larger than 50 MB. CCTI’s internal quality standard is four core screenshots plus one optional distinct management/advisor view. [7] [3]

### Capture provenance rules

- [ ] Capture only from the normal native app window of the **exact installed, clean-Windows-tested MSIX candidate**.
- [ ] Use bounded, non-sensitive real app data.
- [ ] Keep key content in the upper two-thirds.
- [ ] Keep native window chrome only when normally visible.
- [ ] Use factual Partner Center captions of 200 characters or fewer, if captions are used.
- [ ] Do not burn captions, marketing messages, arrows, logos, claims, or device frames into a PNG.
- [ ] Do not include unrelated desktop content.
- [ ] Do not use browser previews, web pages, renderer-only sessions, fixture or mocked IPC, forced status/button states, injected chat/discovery/completion data, AI-generated mockups, composites, old builds, macOS captures, or Linux captures.

### Required capture inventory

| File | Native candidate state | Required visible truth | Checklist |
|---|---|---|---|
| `01-readiness.png` | Readiness/setup | Real readiness state and real setup choice | [ ] Captured from selected candidate. |
| `02-catalog.png` | Curated catalog | Actual catalog, individual choice controls, truthful descriptions | [ ] Captured from selected candidate. |
| `03-project-library.png` | Project library | Real project-level library, detail/filter, and scope boundary | [ ] Captured from selected candidate. |
| `04-review.png` | Plan/review flow | Actual review-before-change state; no fabricated completion or credentials | [ ] Captured from selected candidate. |
| `05-management-or-advisor.png` | Optional management/advisor | Distinct real tested feature only | [ ] Include only if it adds genuine value. |

### Manifest and audit completion

- [ ] Complete `capture-manifest.json` in **submission** mode, not template mode.
- [ ] Record source commit, bundle SHA-256, architecture, Windows version, native resolution, and UTC capture time.
- [ ] Record bundle filename, package identity name, Package Full Name, and each unpacked manifest SHA-256.
- [ ] Record clean-Windows test ID, date, and install/launch/real-adapter/uninstall results.
- [ ] For every PNG, record capture origin, native window title, capture time, SHA-256, dimensions, and byte size.
- [ ] Validate the final manifest against the actual bundle and screenshots with the evidence validator.
- [ ] Store only final assets in `submission-ready/`; keep planning, fixture, or composition studies in `reference-only/`.
- [ ] Supply a 300×300 PNG listing tile and all manifest-referenced AppX tile assets from one approved master mark.

## 7. Capability declaration, package upload, and commercial fields

- [ ] Inspect the final package manifest before declaring restricted capabilities.
- [ ] If `runFullTrust` is present, attach a response that exactly describes final desktop behavior and never claims elevation, drivers, services, arbitrary scanning, silent installation, or unrestricted command execution.
- [ ] Confirm no undeclared restricted capability is present.
- [ ] Upload only the final validated unsigned MSIX/AppX package to Partner Center.
- [ ] Select markets, audience, discoverability, schedule, and base price only with explicit owner direction.
- [ ] Complete the IARC questionnaire accurately from the final app behavior.
- [ ] Use current category and taxonomy values shown in Partner Center.

## 8. Final owner review and certification gate

Before clicking **Submit for certification**, show the owner the exact payload and material choices:

- [ ] Final bundle filename and independently verified SHA-256.
- [ ] Exact source commit and clean-Windows test record.
- [ ] Exact listing title, category, short description, long description, product features, and seven Keywords.
- [ ] All final screenshot PNGs, captions, manifest, and asset audit.
- [ ] Public website, support, and privacy URLs.
- [ ] IARC responses and returned ratings.
- [ ] Markets, pricing, availability, schedule, and discoverability settings.
- [ ] Restricted-capability declaration and rationale, if applicable.
- [ ] Confirmation that the package is the final validated candidate, not an isolated test copy.
- [ ] Explicit owner approval to submit the displayed payload for certification.

## Validation command

Run this command only after the actual final candidate, final manifest, and PNGs exist. It does not print identity values.

```bash
python /home/ubuntu/skills/microsoft-store-listing-evidence-verifier/scripts/validate_listing_evidence.py \
  --manifest /path/to/submission-ready/capture-manifest.json \
  --bundle /path/to/store-submission-candidate.msixbundle \
  --checksum-file /path/to/store-submission-candidate.msixbundle.sha256 \
  --screenshots-dir /path/to/submission-ready/screenshots \
  --build-commit <exact-source-commit> \
  --report /path/to/submission-ready/final-evidence-report.json
```

## References

[1]: https://github.com/SteveKinzey/claude-code-tools-installer "Claude Code Tools Installer canonical desktop source repository"

[2]: https://github.com/SteveKinzey/claude-code-tools-installer/actions/runs/34330631222 "CCTI successful Windows MSIX build workflow run"

[3]: https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/add-and-edit-store-listing-info "Add and edit Store listing info for MSIX app"

[4]: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options "Microsoft Store package delivery guidance"

[5]: https://learn.microsoft.com/en-us/windows/apps/publish/store-policies "Microsoft Store Policies — Accurate Representation and Search Terms"

[6]: https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/add-additional-information "Add additional information for MSIX app"

[7]: https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/screenshots-and-images "Add app screenshots, images, and trailers for MSIX apps"
