# CCTI Release Integrity Operations Report

**Date:** 2026-09-11  
**Scope:** Public release accuracy, cross-platform installer safety, GitHub release controls, cache delivery, and release-drift notifications.

## Executive Summary

CCTI now has a **verified direct macOS download path** and a **safe Windows delivery posture**. The public macOS endpoint exposes the `v2026.09.11` ARM64 DMG with the GitHub Release SHA-256 digest. A fresh validation confirmed that the downloaded DMG matches that digest, carries a stapled notarization ticket, is signed by the expected Developer ID identity, and is accepted by Gatekeeper.

Windows is intentionally **not** offered as a GitHub ZIP, EXE, or test MSIX download. The website now treats Windows as Microsoft Store-only and displays a pending state until the official Store listing is live. The Store bundle and clean Windows install/lifecycle workflows both passed, but there is no evidence of a public Microsoft Store listing yet. Therefore, Windows users do not currently have a proper public installation file, which is the correct and safer state until certification and listing publication complete.

## Verified Platform Status

| Platform | Public route | Current public state | Verification evidence | User outcome |
|---|---|---|---|---|
| macOS | Direct GitHub Release DMG | Available: `v2026.09.11` ARM64 DMG | Uploaded GitHub asset, SHA-256, stapled notarization, nested-signature validation, Developer ID identity, and Gatekeeper acceptance | Users can download the signed, notarized DMG. |
| Windows | Microsoft Store only | Pending Store publication | Store MSIX build passed; clean Windows bundle/install/launch/uninstall workflow passed | No public installer is shown until the official Store listing is live. |
| Linux | Direct GitHub Release archive | Available: `v2026.09.11` x64 archive | Uploaded GitHub asset with published SHA-256 digest | Users can download the verified Linux archive. |

## macOS Release Verification

The release API lists the `Claude.Code.Tools.Installer-2026.9.11-mac-arm64.dmg` asset as uploaded with a size of 130,553,157 bytes and SHA-256 digest `65edada3e3de06d0dfc3e6db6b087c51e684033fb3837d8853c709b08dca45a9`.[1] The published file was downloaded independently and produced the same SHA-256 digest.

The DMG trust check passed all required stages. Apple’s stapler validated the notarization ticket. `codesign --verify --deep --strict` validated the application bundle and nested code. The displayed signing chain terminated at Apple Root CA and identified **Developer ID Application: Stephen Kinzey (949XJPESM2)**. Gatekeeper accepted the mounted application with `source=Notarized Developer ID`.

> **Release decision:** The macOS download link may remain public because its downloaded bytes, signature, notarization ticket, and Gatekeeper assessment were all verified.

## Windows Release Policy and Readiness

The previous public site behavior exposed the historical `v2026.08.12` `claude-code-tools-installer-windows.zip` as a Windows download. This was removed from current-download selection and from the retained release catalog. The frontend now selects no direct Windows asset, labels the route **Microsoft Store release pending**, and links users to release-status information rather than offering an archive that may not be a safe or supported installer.

The Windows engineering path is ready for Store publication. The `Build Microsoft Store MSIX bundle` workflow completed successfully, including x64 and ARM64 package builds, bundle validation, and Store-bundle upload. The `Test Microsoft Store MSIX on clean Windows` workflow also completed successfully, including protected identity input validation and bundle install, launch, and uninstall lifecycle checks.[2] These results validate the package candidate. They do not prove that a consumer-facing Microsoft Store listing exists.

| Condition for public Windows delivery | Status | Required next action |
|---|---|---|
| Store MSIX bundle built | Passed | Retain build evidence. |
| Clean Windows lifecycle test | Passed | Retain release test evidence. |
| Protected Partner Center identity | Validated in workflow | Continue to protect identity values. |
| Microsoft Store listing published | Not verified | Complete Partner Center submission and obtain the canonical Store URL. |
| Site shows Store install link | Blocked intentionally | Add the approved Store URL to the site only after the listing is live. |

## Website and CDN Delivery

The WebDev project checkpoint `e3d9bb7c` was saved and synchronized to `SteveKinzey/claude-code-tools-installer-site` `main`. The production endpoint, queried with a cache-busting value, now returns HTTP 503 for Windows with `Release data is unavailable.` This is intentional: it prevents a download from starting before an official Store listing exists. The production macOS endpoint returns the verified `v2026.09.11` DMG.

A host-scoped cache-purge workflow was manually dispatched after the site synchronization. The workflow completed successfully, but its `Purge the production hostname cache` step was skipped. No Cloudflare cache invalidation was therefore performed by that run. The likely operational cause is that the required Cloudflare purge credentials are not configured for the workflow. The deployed origin is correct, but normal cache behavior should be rechecked after credentials are supplied and a real host purge completes.

| Delivery control | Result | Interpretation |
|---|---|---|
| WebDev deployment | Completed | The updated release policy is deployed. |
| GitHub site mirror | Synchronized at `e3d9bb7c` | Source history matches the reviewed checkpoint. |
| Cache-bypassed Windows API | HTTP 503 | Correct safe unavailable state. |
| Cache-bypassed macOS API | `v2026.09.11` signed DMG | Correct verified direct-download state. |
| Cloudflare host purge | Skipped | Credential configuration remains incomplete. |

## Release-Drift Detection and Alerts

The desktop repository now contains a reusable release-artifact drift check. It examines dated tags, matches them to published GitHub Releases, and requires at least one uploaded, positive-size, recognized platform artifact with a valid `sha256:<64-hex>` digest. A strict 24-hour grace period prevents false failures while a release pipeline uploads and notarizes artifacts. Manual checks derive age from the tag commit timestamp rather than dispatch time.

The workflow triggers on release-shaped tag creation, daily scheduled audit, and manual dispatch. Its tests cover verified assets, source-only records, missing releases, malformed digests, and grace-period behavior. The latest manual check completed successfully.

A failure-only alert helper was added and published in desktop repository commit `d807cde5`. It supports both Slack and Discord incoming webhooks while keeping GitHub Actions as the authoritative failure record. The helper was verified in dry-run mode for both providers and is invoked only after the drift check fails.

| Alert configuration | Required value | Current verification state |
|---|---|---|
| Webhook secret | `CCTI_RELEASE_ALERT_WEBHOOK` | Not confirmed; repository secret listing is inaccessible to the current token. |
| Provider variable | `CCTI_RELEASE_ALERT_PROVIDER` = `slack` or `discord` | Not confirmed; repository variable listing is inaccessible to the current token. |
| Safe behavior without configuration | No outbound alert; job failure remains visible in GitHub Actions | Verified in helper tests. |
| Dry-run validation | `CCTI_RELEASE_ALERT_DRY_RUN=1` | Verified for Slack and Discord payload modes. |

## Reusable Skill Review

The reusable **CCTI Release Integrity Operations** skill was validated with the `/skill-creator` validator. Its execution contract now covers source-only release handling, verified per-platform artifacts, direct macOS trust validation, Windows Microsoft Store-only routing, host-scoped cache purging, 24-hour drift grace behavior, and safe Slack or Discord alert configuration.

## Required Follow-up

1. Configure `CLOUDFLARE_ZONE_ID` and `CLOUDFLARE_CACHE_PURGE_TOKEN` in the site repository, then rerun the host-scoped cache-purge workflow and verify normal, non-cache-busted production requests.
2. Complete Microsoft Partner Center submission and wait for the public product listing. Verify the final Store URL and install experience from a clean Windows device before adding it to the website.
3. Configure `CCTI_RELEASE_ALERT_WEBHOOK` and `CCTI_RELEASE_ALERT_PROVIDER` in a protected repository environment. Run the helper in dry-run mode first, then deliberately test delivery with a non-production test webhook.
4. Keep the `v2026.09.11` macOS DMG as the direct download until a newer release repeats the full checksum, signing, stapling, and Gatekeeper verification sequence.

## References

[1]: https://github.com/SteveKinzey/claude-code-tools-installer/releases/tag/v2026.09.11 "CCTI v2026.09.11 GitHub Release"
[2]: https://github.com/SteveKinzey/claude-code-tools-installer/actions/runs/34631928257 "Build Microsoft Store MSIX bundle workflow run"
[3]: https://github.com/SteveKinzey/claude-code-tools-installer/actions/runs/34631930784 "Test Microsoft Store MSIX on clean Windows workflow run"
[4]: https://github.com/SteveKinzey/claude-code-tools-installer-site/actions/runs/34632723546 "Purge claudetool.app cache workflow run"
