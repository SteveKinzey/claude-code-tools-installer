# CCTI Partner Center Mandatory Metadata Completeness Audit

> **Audit decision:** **Not ready for Partner Center submission; only three final-candidate controls remain open.** The release owner confirms the policies, policy URLs, matching screenshot set, and other required metadata are already available. These items were not directly attached or fetched in this workspace, so this audit records them as **owner-confirmed** rather than independently verified.

## Mandatory field matrix

Microsoft’s MSIX submission checklist requires the Pricing and availability choices for markets, audience, discoverability, schedule, and base price. It requires category, contact details for business accounts, all IARC age-rating questions, at least one package, a description, at least one screenshot, and restricted-capability information when declared. Privacy policy URL is required when the app collects or transmits personal information. Store logos may be mandatory depending on the operating-system slots. [1]

| Area | Mandatory item | CCTI current status | Evidence or missing action |
|---|---|---|---|
| Pricing and availability | Markets, audience, discoverability, schedule, base price | **Owner-confirmed complete** | Preserve the exact selections in final payload review. |
| Properties | Category, policy URLs if applicable, business contact details | **Owner-confirmed complete / available** | Record exact URLs and validate reachability before final submission. |
| Age ratings | IARC questionnaire | **Owner-confirmed complete** | Reconfirm final answers and returned rating. |
| Packages | At least one final MSIX/AppX package | **Open gate** | Build with protected identity configuration, then independently verify the exact unsigned bundle. |
| Store listing | Description and Store logos | **Owner-confirmed complete** | Reconfirm against final candidate and active listing slots. |
| Store listing | At least one matching screenshot | **Owner-confirmed available** | Bind existing PNGs to the exact final candidate; recapture only if final build changes captured UI. |
| Submission options | Restricted capabilities | **Owner-confirmed complete** | Reconfirm `runFullTrust` rationale against final manifest. |

## Ready but not entered

The seven intended Keywords pass the current MSIX limits: seven terms, 12–26 characters each, and 16 total words. Keywords are optional metadata, not a mandatory submission field. The release owner confirms the mandatory metadata and policy materials already exist; this workspace has not directly verified the final Partner Center draft.

The latest successful Store build workflow produced an unsigned candidate at commit `f62ef8b55e9aaabadb336f8677c588c0fbc5b2e4`. The inspected workflow artifact proves a candidate exists, but the release owner does not yet treat it as the independently verified final submission bundle. It also does not substitute for a clean-Windows test record tied to that exact bundle SHA-256. Existing screenshots remove asset production as a gap, but they must be linked to the final selected candidate.

## Required next sequence

1. Store exact Partner Center Identity/Publisher values as protected inputs and select the final source commit.
2. Build the final unsigned MSIX bundle and independently verify its checksum and package manifests.
3. Run the clean-Windows install, launch, real-workflow, and uninstall test against that exact bundle SHA-256.
4. Bind the existing matching screenshots and policy URLs to the final evidence manifest; recapture screenshots only if the final build changes their captured UI.
5. Review the exact final Partner Center payload and obtain owner approval before certification submission.

## References

[1]: https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/create-app-submission "Create app submission for MSIX apps"

[2]: https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/add-additional-information "Add additional information for MSIX app"

[3]: https://github.com/SteveKinzey/claude-code-tools-installer/actions/runs/34330631222 "CCTI successful Microsoft Store MSIX build workflow"
