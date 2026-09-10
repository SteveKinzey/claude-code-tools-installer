# CCTI Microsoft Store Readiness Review — Speaker Script

This script provides the detailed narrative for the 10-slide readiness review deck.

## Slide 1: CCTI Microsoft Store Readiness
"Today’s output is a Store-listing readiness package for Claude Code Tools Installer. It includes reviewed draft copy, a screenshot capture system, and an operator sequence. It does not claim that CCTI is in the Store, certified, signed for Store distribution, or ready for submission. First, here is the product story we can truthfully tell today."

## Slide 2: The Truthful Product Story
"CCTI helps people work through developer-tool setup in clear steps. It keeps shared choices separate from project-level choices, surfaces curated extras, and shows a plan before a proposed change. The copy also states the boundary: CCTI is a setup helper, not a guarantee about third-party tools or services. That product story is useful, but only if the wording remains accurate and policy-safe."

## Slide 3: Listing Copy: Conditional Draft Approval
"The short and long descriptions now avoid unsupported claims. They do not say that CCTI is Microsoft-certified, signed, Store-ready, a Windows EXE installer, or affiliated with Anthropic or Claude. We also removed the unverified claim that discovery is read-only by default from the final description. The product name itself requires confirmation against the reserved Partner Center name and approved trademark use. Every remaining feature claim must be checked again against the final Electron build. Search terms needed a concrete correction."

## Slide 4: Keywords: All Limits Passed
"The original draft had eight terms and included a third-party product title. Microsoft allows at most seven keywords, each with a 40-character maximum and no more than 21 total words. Store policy also prohibits pricing terms and other product titles unless the same publisher owns them. The corrected CCTI set passes: seven terms, 12 to 26 characters each, and 16 total words. The biggest integrity risk is not the text. It is the screenshots."

## Slide 5: Screenshots Must Be Evidence
"A Store screenshot is proof of the product experience. A browser preview, a renderer outside the package, mocked IPC, injected chat output, an AI mockup, a composite, or an image from an old build can look convincing but is not valid Store evidence. The only acceptable source is the normal native app window from the exact installed, clean-Windows-tested MSIX candidate. The manifest converts that principle into a release control."

## Slide 6: Capture Manifest Creates Traceability
"The template is explicitly marked not for upload. When we reach the capture step, we replace placeholders with observed evidence: the canonical source commit, bundle SHA-256, package identity, full package name, unpacked manifest hash, and clean-Windows test record. Each PNG then records its native window title, UTC capture time, origin, dimensions, byte size, and SHA-256. This lets a reviewer reject a screenshot that came from the wrong build or a mock environment. We plan four strong customer views, even though the formal minimum is lower."

## Slide 7: What the Current Evidence Proves
"The canonical Electron source is available, and the latest successful Store workflow produced an unsigned bundle at commit f62ef8b55e9aaabadb336f8677c588c0fbc5b2e4. The release owner confirms that the policies, public policy URLs, matching screenshots, and required metadata already exist. The remaining work is limited to protected identity configuration, independent verification of the final bundle, and a clean-Windows test record tied to that exact bundle."

## Slide 8: Five Sequential Release Gates
"There are only three final-candidate controls. First, keep the exact Partner Center identity values in protected build inputs, never in workflow-dispatch inputs which expose them in run history. Second, independently verify the final unsigned bundle, including its checksum and manifests. Third, run the clean-Windows test on that exact bundle SHA-256 and confirm the temporary test certificate is removed. Existing policies and screenshots are not missing; they need to be bound to the final candidate in the evidence record."

## Slide 9: Partner Center Checklist
"The left column is available by owner confirmation: explicit policies, policy URLs, a matching screenshot set, and the required listing metadata. The three controls on the right are the full evidence-production scope. Configure the protected identity, independently verify the resulting final unsigned bundle and its companion checksum, then produce a clean-Windows record tied to that exact bundle SHA-256. Keep the existing screenshots; re-capture only if the final identity build changes their visible UI."

## Slide 10: Decision: Prepare, Then Prove
"The order is bind, verify, then test. Apply the protected Partner Center identity to the selected commit. Verify the checksum and package manifests for that resulting final unsigned bundle, not merely the earlier pre-final workflow artifact. Then run installation, launch, real workflow, and uninstall checks on clean Windows against the same bundle SHA-256. Finally record the existing policy URLs and screenshot provenance in the final manifest. No separate asset-production phase is needed unless the UI changes."
