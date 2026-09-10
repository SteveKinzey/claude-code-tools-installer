# CCTI Actual MSIX Template-Evidence Validation

> **Result:** **Pass — template evidence check only.** The CCTI capture-manifest template was validated against an actual unsigned MSIX bundle retrieved from the successful Windows Store build workflow. This result proves the template structure, bundle checksum, and package metadata were inspected. It does **not** make the template or bundle ready for Partner Center upload.

## Candidate inspected

| Item | Verified value |
|---|---|
| Canonical repository | `SteveKinzey/claude-code-tools-installer` |
| Build workflow | [Build Microsoft Store MSIX bundle #34330631222](https://github.com/SteveKinzey/claude-code-tools-installer/actions/runs/34330631222) |
| Build commit | `f62ef8b55e9aaabadb336f8677c588c0fbc5b2e4` |
| Candidate file | `claude-code-tools-installer-store-submission.msixbundle` |
| Candidate size | 282,521,502 bytes |
| Candidate SHA-256 | `47a98fd0f72305f4bd29f2fc5d0a63687f74abe11f09209afc8d73bcd0aa0d06` |
| Checksum companion | Present and matched the downloaded bundle |
| Package count | 2 |
| Architectures | x64 and ARM64 |
| App version | `2026.8.26.0` in both inspected package manifests |
| Identity result | One shared redacted identity fingerprint: `b45526a7a486862f` |
| Declared capabilities | `internetClient`, `runFullTrust` |

## Automated validation performed

The reusable validator ran against the actual bundle, checksum companion, and the CCTI template manifest with `--allow-template`. It passed the following controls:

| Control | Result |
|---|---|
| Bundle is a readable MSIX bundle | Pass |
| Checksum companion matches bundle SHA-256 | Pass |
| Bundle contains x64 and ARM64 packages | Pass |
| Both packages have the same redacted identity fingerprint | Pass |
| Template remains `template_only` and `not_captured_not_for_upload` | Pass |
| Template requires native capture from the exact installed clean-Windows-tested MSIX | Pass |
| Template blocks browser, fixture, mock, injected, generated, composite, old-build, macOS, and Linux sources | Pass |
| Template requires per-PNG origin, timestamp, native-window title, hash, dimensions, and byte size | Pass |
| Template requires PNG ≥1366×768 and ≤50 MB | Pass |

## Evidence boundary

The automated result is intentionally **not** a final-submission validation. The manifest remains a template and has no final screenshots, package identity linkage, clean-Windows test record, capture timestamps, or per-file PNG hashes. The validator reports this condition explicitly:

> Template validated against candidate metadata only; it is not linked to the candidate and cannot be uploaded.

## Remaining gates

- [ ] Select this exact commit and bundle as the intended Store candidate, or rerun build and validation for a newer exact commit.
- [ ] Record the exact Partner Center identity only in protected build inputs; do not place it in the manifest or report.
- [ ] Complete a clean-Windows test for this exact bundle SHA-256 and record install, launch, real-adapter, and clean-uninstall evidence.
- [ ] Capture native PNG screenshots from that installed test candidate only.
- [ ] Fill the manifest in `submission` mode and validate each final PNG against the bundle, test record, and file requirements.
- [ ] Verify public support and privacy URLs, complete IARC and commercial settings, and obtain explicit owner approval for the exact Partner Center payload.

## Machine-readable evidence

- [Automated JSON validation result](/home/ubuntu/deliverables/ccti-msix-template-evidence-validation.json)
- [Reusable validator](/home/ubuntu/skills/microsoft-store-listing-evidence-verifier/scripts/validate_listing_evidence.py)
- [CCTI capture manifest template](/home/ubuntu/deliverables/ccti-listing-assets-demo/submission-ready/capture-manifest.template.json)

## References

[1]: https://github.com/SteveKinzey/claude-code-tools-installer/actions/runs/34330631222 "CCTI successful Microsoft Store MSIX build workflow"

[2]: https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/screenshots-and-images "Add app screenshots, images, and trailers for MSIX apps"

[3]: https://learn.microsoft.com/en-us/windows/apps/publish/store-policies "Microsoft Store Policies — Accurate Representation and Search Terms"
