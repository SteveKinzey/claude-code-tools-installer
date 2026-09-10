# CCTI Microsoft Store Evidence Audit

> **Decision:** The CCTI Partner Center metadata, explicit policies and policy URLs, and matching screenshot set are **owner-confirmed available**. The release is **not submission-ready** because three final-candidate controls remain: protected identity configuration, independent verification of the resulting final unsigned bundle, and a matching clean-Windows test record.

## Scope and evidence states

This audit separates **owner-confirmed available** evidence from evidence independently checked in this workspace. Owner-confirmed assets are not treated as missing simply because they were not supplied to the sandbox. They must be recorded against the exact final candidate before submission.

| Evidence state | Meaning in this audit |
|---|---|
| Owner-confirmed available | The release owner confirms that the policies, policy URLs, screenshot set, and Partner Center metadata already exist. |
| Independently verified | This workspace computed or compared a value directly from the inspected artifact. |
| Final-candidate control | A release dependency that must be completed after protected identity values are configured. |

## ARM64 template-evidence review

The ARM64 package report passed in `template_evidence_check` mode. It establishes that the extracted package is readable, declares ARM64 architecture, and exposes the redacted manifest evidence shown below. It is not an uploadable manifest validation and does not prove clean-Windows installation.

| Item | Result |
|---|---|
| Extracted package | `ccti-arm64-candidate.appx` |
| Architecture | `arm64` |
| Package version | `2026.8.26.0` |
| Computed ARM64 SHA-256 | `7c9eea7ad59b39a86768dcd587996a98ba0106e25552cbc8b8a26a048f0c1580` |
| ARM64 manifest SHA-256 | `82047cd9aa2c3260dc5027c81a4ff1530585be6a8a4c34849444912ea61eaca0` |
| Declared capabilities | `internetClient`, `runFullTrust` |
| Identity handling | Redacted fingerprint only: `b45526a7a486862f` |
| Result | Pass — template metadata inspection only |

### Checksum interpretation

The ARM64 report records `checksum_verification.status: not_provided`. This is correct: the extracted nested AppX did not have its own companion checksum file. Its SHA-256 was **computed**, but not independently compared to an ARM64-specific published digest.

The full pre-final MSIX bundle did have a companion checksum file. The verifier independently recomputed and compared it:

| Full-bundle checksum control | Result |
|---|---|
| Bundle SHA-256 | `47a98fd0f72305f4bd29f2fc5d0a63687f74abe11f09209afc8d73bcd0aa0d06` |
| Companion SHA-256 | Same value |
| Hash comparison | Pass |
| Companion filename comparison | Pass |
| Scope | Pre-final workflow artifact only; not the final protected-identity submission candidate |

> The pre-final full-bundle comparison validates the build-artifact handoff. It does **not** close the final-bundle gate because applying the reserved Partner Center identity produces the candidate that must be verified and tested for submission.

## Mandatory Partner Center metadata review

Microsoft requires markets, audience, discoverability, schedule, base price, category, applicable privacy policy, business contact details for business accounts, IARC answers, at least one package, a listing description, at least one screenshot, required Store-logo slots, and a restricted-capability declaration when applicable.[^microsoft]

The release owner confirms that every metadata and policy item is already available. The checklist correctly records those items as **owner-confirmed complete** or **owner-confirmed available**. It does not claim that this workspace independently opened a Partner Center draft or fetched the public URLs.

| Required area | CCTI status | Remaining handling |
|---|---|---|
| Pricing and availability | Owner-confirmed complete | Preserve exact selections in final payload review. |
| Category, contacts, IARC, description, logos, and restricted-capability response | Owner-confirmed complete | Reconfirm against the final candidate and live Partner Center entry. |
| Policies and policy URLs | Owner-confirmed available | Record exact canonical URLs in the final evidence manifest and confirm reachability before submission. |
| Screenshot set | Owner-confirmed available | Record PNG hashes, dimensions, capture origin, and linkage to the final candidate; recapture only if its UI differs. |
| Uploadable package | Open final-candidate control | Produce and independently verify the protected-identity unsigned bundle. |

## Remaining release gates

These are the only remaining **evidence-production** controls:

1. **Protect the identity.** Store the exact reserved Partner Center identity, publisher, and publisher display name in a protected secret store. Build the selected commit without exposing those values in source, chat, logs, or dispatch inputs.
2. **Verify the final bundle.** Independently recompute the final unsigned MSIX bundle SHA-256, compare it with its companion checksum file, and inspect x64 and ARM64 manifests for one protected identity and only declared capabilities.
3. **Run the matching clean-Windows test.** Use a temporary test-signed copy only for testing. Record the final bundle SHA-256, test identifier, UTC time, installation, launch, real-workflow adapter, and clean-uninstall results. Do not upload the test-signed copy.

After those controls close, bind the existing policy URLs and screenshots to the final manifest. This records provenance; it is not a separate asset-production gate unless the final build changes the UI shown in the screenshots.

## Slide 9 and 10 speaker-note review

**Slide 9** now distinguishes the owner-confirmed assets on the left from the three final-candidate controls on the right. It expressly says to retain the existing screenshots and only recapture if the identity build changes their visible UI.

**Slide 10** gives the correct order: **Bind → Verify → Test**. It requires the clean-Windows record to cover installation, launch, real workflow, and uninstall against the exact final bundle SHA-256. It also states that adding existing screenshot and URL provenance to the manifest follows the test; no separate asset-production phase is required unless the UI changes.

## Reusable skill improvement

The reusable `microsoft-store-listing-evidence-verifier` skill now emits a `checksum_verification` object in every report. Its statuses distinguish a verified companion check from a computed digest with no companion supplied. Final submission-manifest validation now requires `--checksum-file`; a template check may run without one but explicitly reports that it is not an independent checksum comparison.

[^microsoft]: [Microsoft, “Create app submission for MSIX apps”](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/create-app-submission), accessed 2026-09-09.
