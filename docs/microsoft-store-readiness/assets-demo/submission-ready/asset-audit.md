# CCTI Microsoft Store Asset Audit — Demonstration

> **Status:** **Not submission-ready.** This folder contains a manifest template only. It intentionally contains no screenshots, tiles, mockups, or browser captures.

## Audit result

| Audit item | Result | Evidence / action |
|---|---|---|
| Final screenshot count | **Fail / 0 of 4 internal planning shots** | Microsoft requires at least one desktop screenshot; this package sets four distinct capture states as the internal quality standard. No final MSIX candidate exists, so no genuine screenshots were created. |
| Screenshot provenance | **Not applicable** | Do not create browser, fixture, or composited captures as substitutes. |
| Per-file evidence | **Pending** | Record capture origin, SHA-256, pixel dimensions, and byte size for every final PNG. |
| Screenshot format and size | **Not applicable** | Validate each final PNG is a PNG at ≥1366×768 and ≤50 MB after capture; captions are optional, factual, no longer than 200 characters, and entered in Partner Center rather than rendered in the image. |
| Screenshot content | **Not applicable** | Final images must show real native-app states with bounded, non-sensitive data. |
| Listing tile | **Pending** | Supply one 300×300 PNG derived from an approved app mark. |
| AppX tiles | **Pending** | Supply manifest-referenced tiles at their required dimensions and filenames. |
| Source commit | **Pending** | Record the canonical Electron source commit, not the web companion commit. |
| MSIX bundle SHA-256 | **Pending** | Build and independently verify on Windows. |
| Candidate identity linkage | **Pending** | Record bundle filename, Package Identity name, Package Full Name, and unpacked manifest SHA-256. |
| Windows test record | **Pending** | Record a clean-Windows test ID and UTC date with install, launch, real-adapter, and clean-uninstall results. |
| Capture manifest | **Template only** | Fill only after the previous evidence exists. |

## Asset boundary

The `reference-only/` directory may hold mockups, fixture studies, and planning compositions. It must remain separate from `submission-ready/` and must never be uploaded to Partner Center.

The `submission-ready/screenshots/` and `submission-ready/logos/` directories stay empty until the final MSIX candidate is installed and tested on clean Windows. An empty folder is safer than an attractive but invalid Store screenshot.

When this template becomes a final manifest, replace every `null` capture value with observed evidence. Record the bundle filename, identity name, full package name, unpacked manifest hash, and clean-Windows test record before capture. Each screenshot must identify its native-app capture origin, UTC timestamp, native window title, SHA-256, PNG dimensions, and byte size. Reject a PNG if it originated from a browser preview, renderer outside the installed MSIX, fixture or mocked IPC, forced state, injected result, AI-generated mockup, composite, old build, macOS session, or Linux session.

## Submission block

**Do not upload this folder.** Complete the package-specific capture manifest and rerun this audit after final Windows validation.
