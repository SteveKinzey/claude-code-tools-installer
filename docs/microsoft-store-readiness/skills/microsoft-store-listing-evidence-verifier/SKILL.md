---
name: microsoft-store-listing-evidence-verifier
description: Validate evidence-backed Microsoft Store MSIX listing readiness. Use when auditing Partner Center keywords, truthful screenshot provenance, capture manifests, MSIX/AppX bundles, bundle checksums, clean-Windows test evidence, or final submission checklists for Windows desktop apps.
---

# Microsoft Store Listing Evidence Verifier

Use this skill to keep Microsoft Store metadata, screenshots, and package evidence tied to the same tested Windows candidate. It complements `microsoft-store-listing-readiness` and `windows-msix-store-release`.

## Boundaries

- Never claim a package is signed, certified, submitted, or published without direct evidence.
- A ZIP, DMG, MSI, EXE, or test-signed copy is not evidence for an unsigned Store MSIX bundle.
- Do not create a Partner Center account, set price or availability, enter tax/business data, or submit certification without explicit owner approval.
- Never create final Store screenshots from a browser, mock, fixture, renderer-only session, composite, generated image, older build, macOS, or Linux session.
- Do not print, commit, or place exact Partner Center Identity/Publisher values in chat, reports, source, or workflow inputs. Validator output must redact identity values.

## Required inputs

1. Read `references/partner-center-rules.md` for current keyword and screenshot rules.
2. Locate the canonical desktop source, exact release commit, unsigned candidate, checksum companion, and clean-Windows test record.
3. Copy `templates/capture-manifest.template.json` for a new capture set. Keep it in template mode until actual evidence exists.
4. Treat the request as one of: **draft audit**, **template-to-candidate verification**, **final capture validation**, or **submission checklist**.

## Evidence states

Keep two states separate in every report. **Owner-confirmed available** means the release owner says an asset or field exists, such as policy URLs, completed listing metadata, or a matching screenshot set. **Independently verified** means the current task directly checked the asset against the exact final candidate.

Do not label owner-confirmed policies, URLs, or screenshots as missing merely because they were not supplied to the sandbox. Record them as owner-confirmed and list only the verification needed to bind them to the exact candidate. If a protected-identity change produces a different package or UI, recapture screenshots; otherwise preserve the existing set and record its hash, dimensions, capture origin, and candidate linkage in the final manifest.

## Workflow

### 1. Audit listing language and keywords

Verify that product claims match tested behavior. For MSIX Keywords, allow no more than seven relevant values, no more than 40 characters each, and no more than 21 words across the set. Exclude pricing language and third-party product titles unless the same publisher owns those titles. Leave **What’s new** blank for a first submission.

### 2. Establish package evidence

Record the exact source commit. Build x64 and ARM64 AppX packages and bundle them on Windows. Independently verify the bundle SHA-256 and inspect each package manifest. Store exact identity values only in protected build inputs. Keep a temporary test-signed bundle separate from the unsigned submission candidate.

### 3. Test before capture

Install the exact candidate on clean Windows. Record a test ID, UTC time, and explicit results for install, launch, real workflow adapters, clean uninstall, and removal of the temporary test certificate. Do not capture Store screenshots until this record is complete.

### 4. Capture truthfully

Use native app windows from the exact installed test candidate. Capture at least four internally distinct customer states when available: readiness/setup, primary workflow, project or review state, and a distinct management/review state. Use bounded non-sensitive data. Keep key content in the upper two-thirds. Use PNG at least 1366×768 and no larger than 50 MB. Put factual captions of 200 characters or fewer in Partner Center, not into the image pixels.

### 5. Validate evidence

Run the deterministic validator. It never prints identities.

```bash
# Template check against an actual candidate: succeeds only as a non-uploadable template check.
python scripts/validate_listing_evidence.py \
  --manifest /path/to/capture-manifest.template.json \
  --bundle /path/to/store-submission-candidate.msixbundle \
  --checksum-file /path/to/store-submission-candidate.msixbundle.sha256 \
  --allow-template \
  --report /path/to/template-evidence-report.json

# Final capture check: verifies bundle, manifests, test record, and actual PNG hashes/dimensions.
python scripts/validate_listing_evidence.py \
  --manifest /path/to/capture-manifest.json \
  --bundle /path/to/store-submission-candidate.msixbundle \
  --checksum-file /path/to/store-submission-candidate.msixbundle.sha256 \
  --screenshots-dir /path/to/screenshots \
  --build-commit <exact-commit> \
  --report /path/to/final-evidence-report.json
```

A template **passing** means its structure and the candidate archive were inspected. It never makes the template uploadable. Read `checksum_verification.status` in every report: `verified` means the companion file’s SHA-256 and filename matched; `not_provided` means the report contains only a locally computed digest, not an independent companion-file comparison. A final manifest requires `--checksum-file` and passes only when the candidate and screenshot evidence match.

### 6. Produce the submission handoff

Deliver a standalone Markdown package containing an evidence ledger, final listing copy, keyword count and limits, screenshot inventory, capture manifest, asset audit, public support/privacy URLs, age-rating and category gates, restricted-capability evidence, and the exact remaining owner decisions. Present the final Partner Center payload for explicit owner approval before certification submission.

## Final gate

Do not call the package submission-ready until all are true:

- [ ] Product claims, title, category, and Keywords match the tested app.
- [ ] Keywords satisfy the 7-keyword, 40-character, and 21-word limits.
- [ ] Unsigned candidate bundle and companion SHA-256 are independently verified.
- [ ] x64 and ARM64 manifests match one protected identity.
- [ ] Clean-Windows test record confirms install, launch, real workflows, uninstall, and temporary test-certificate removal.
- [ ] Every Store PNG is a native capture from that exact candidate and passes manifest hash, dimensions, and size checks.
- [ ] Public support and privacy URLs are reachable and product-specific.
- [ ] IARC, availability, price, restricted capabilities, and owner approval are complete.

## Resources

- Read `references/partner-center-rules.md` before auditing terms or screenshots.
- Use `templates/capture-manifest.template.json` to start a non-uploadable capture plan.
- Run `scripts/validate_listing_evidence.py` against an actual candidate; its report intentionally hashes identity values instead of exposing them.
