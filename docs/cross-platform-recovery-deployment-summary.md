---
title: Cross-Platform Recovery Deployment Summary
author: Manus AI
date: 2026-09-10
status: Verified implementation record
---

# Cross-Platform Recovery Deployment Summary

## Executive Summary

The Claude Code Tools Installer now has a **bounded desktop diagnostic-sharing path**, a **notice-only background release status indicator**, and a **non-intrusive mobile offline experience**. The desktop work addresses CLI-readiness failures caused by missing GUI PATH entries or commands that do not resolve promptly. The mobile work ensures a dropped connection is communicated without blocking the interface or escalating into a full-page error. The public site was probed with cache-bypass headers and returned **HTTP 200** from `https://claudetool.app/` during this verification.

The final review found and corrected one lifecycle edge case in the diagnostics cache. Previously, eviction from the five-report cache could remove a report without clearing its already-scheduled expiry timer. The implementation now tracks expiry timers by diagnostic ID and clears the associated handle during eviction and explicit expiry. Each report is also truncated at **64 KiB** before retention, preventing unusually long environment data from expanding in-memory storage. These limits preserve local-only diagnostic sharing without turning it into a long-lived log store.

## Deployment State

| Surface | Source of truth | Verified state | Evidence |
|---|---|---|---|
| Desktop application | `SteveKinzey/claude-code-tools-installer` | Source changes validated locally; baseline sharing feature previously pushed as `b590e27` | Desktop test suite and source review |
| Public web application | WebDev project `claude-code-tools-installer-site` | Public custom domain responded successfully | Cache-bypassed HTTP request, 2026-09-10 |
| Custom domain | `https://claudetool.app/` | HTTP 200; `Cache-Control: no-cache, no-store, must-revalidate` | Live response headers |
| Always-on runtime | WebDev Autoscale | Deliberately unchanged | Autoscale remains suitable while avoiding Reserved Hosting cost |
| Reusable incident process | `ccti-cross-platform-recovery` skill | Validated with the skill validator | `quick_validate.py` completed successfully |

> **Release boundary:** A validated source commit is not a downloadable desktop release. A platform artifact must be built, published in GitHub Releases, and accompanied by an SHA-256 digest before the website exposes it as a download.[1]

## Source Review

### Mobile Offline Banner

The offline banner is a client-only React component mounted at the application shell level. It initializes from `navigator.onLine`, then subscribes to `online` and `offline` browser events. It renders nothing when online. When offline, it presents a concise `role="status"` notification that explains that downloads and connected Compass functionality will resume after reconnection. A visitor can dismiss the notice, and the dismissal state resets when network state changes.

The implementation does not poll external services, persist browser state, or obstruct the application route. It unregisters both event listeners in its effect cleanup. This avoids stale listener duplication as routes or development hot-reloads remount the application. The production shell also isolates the optional Compass widget in a separate error boundary, so a widget failure cannot take down the offline recovery path.

| Review item | Result | Reason |
|---|---|---|
| Initial online/offline state | Pass | Derived through a defensive browser capability check. |
| Network event lifecycle | Pass | `online` and `offline` listeners are removed on unmount. |
| Dismissal behavior | Pass | Notice remains dismissed until an actual connectivity transition. |
| Network flapping | Pass | Rapid `offline → online → offline → online → offline` events leave one visible status banner, then hide it on recovery. |
| Accessibility | Pass | Uses `role="status"`, `aria-live="polite"`, and a labelled button. |
| Scope | Pass | No storage, API polling, or route-blocking behavior is introduced. |

### Desktop Diagnostic Memory Cleanup

The desktop main process retains diagnostic reports behind random opaque IDs. The renderer receives the report for display and only sends the ID back when it asks to save a text copy. It cannot supply raw diagnostic content or an arbitrary output path. The main process uses the native save dialog, writes plain UTF-8 output, and reports only the selected filename to the renderer.

The report is limited to paths and version/readiness evidence needed to diagnose CLI discovery. The user home directory is displayed as `~`. Secrets, raw configuration files, project content, account names, and unrelated environment variables are excluded.

| Retention control | Final behavior | Verification |
|---|---|---|
| Time to live | Each report expires after 10 minutes | Timer-driven expiry test |
| Capacity | Maximum five reports retained | Sixth report evicts the oldest |
| Timer cleanup | Timer is cleared when its report is evicted or expired | Capacity-eviction assertion |
| Report-size cap | Maximum 64 KiB UTF-8 | Oversized unique-PATH fixture is truncated with an explicit notice |
| Process lifetime | Timers call `unref()` when available | Diagnostics never hold the application open |
| Export authorization | Opaque ID must still map to retained report | Expired/unknown IDs are rejected |

## Validation Record

All listed commands completed successfully after the final source updates.

| Gate | Command | Result |
|---|---|---|
| Desktop end-to-end validation | `cd desktop && npm run check` | Pass: catalog, UI bridge, diagnostics, release-status, project prerequisite, interview, and macOS release validations passed. |
| Diagnostic retention regression | `node scripts/test-desktop-diagnostics-services.js` | Pass: save-cancel, text export, expiry, capacity eviction, timer cleanup, and 64 KiB cap passed. |
| Mobile network-flapping regression | `pnpm vitest run client/src/components/OfflineStatusBanner.test.ts` | Pass: 3 tests, including rapid online/offline event sequence. |
| Web full suite | `pnpm check && pnpm test && pnpm build` | Pass: TypeScript check, **31 test files / 153 tests**, and production build completed. |
| Public domain probe | Cache-bypassed `curl` request | Pass: HTTPS `200` and no-cache response policy received. |
| Skill package validation | `quick_validate.py ccti-cross-platform-recovery` | Pass. |

The website production build emitted a chunk-size warning for one JavaScript bundle larger than 500 kB. This does not block deployment or the recovery changes. It is a separate performance optimization candidate, best addressed by reviewing code splitting around the large client bundle rather than changing reliability behavior in this release.

## Operational Documentation

### Desktop Support Flow

1. Ask the user to choose **Run Diagnostics** from the desktop troubleshooting/settings panel.
2. Confirm that the generated report says it is local-only and that the `Claude Code` readiness status is meaningful.
3. Use **Copy to Clipboard** for support chat or **Save Diagnostics (.txt)** for offline review.
4. If the actions have expired, run diagnostics again. Expiration is intentional and occurs after 10 minutes.
5. Compare the resolved Claude path and the displayed CCTI PATH with the path available in the user's terminal.
6. Keep manual confirmation available for browsing and planning. Guard actual CLI actions with a new real readiness check.

### Mobile Support Flow

1. Confirm whether the visitor is offline or switching between Wi-Fi and mobile data.
2. Verify that the offline banner appears once and does not block the page.
3. Reconnect and confirm that the banner disappears after the `online` event.
4. If a feature still fails, identify the individual browser API call rather than treating the root error boundary as the diagnosis.
5. Preserve `try/catch` guards around browser storage and history APIs for private-mode and embedded-WebView compatibility.

### Update Status Behavior

Desktop update polling is deliberately **background-only**. The app asks the owned GitHub Releases endpoint for metadata at startup and on a six-hour interval. The UI displays a spinner and `aria-busy="true"` only while a check is active. An available release enables a verified external release-page button. The implementation does not download packages, invoke an auto-updater, restart the app, or install an update.[2]

## Hosting Decision

The site remains on **WebDev Autoscale**. It stays publicly accessible but can cold-start after inactivity. That is the correct cost-sensitive choice for the current static and request-driven workload. No hosting configuration changed in this deployment record.

If the product later requires no cold starts, persistent WebSockets, an in-memory worker, or always-on sub-minute polling, WebDev Reserved Hosting provides one persistent 1 vCPU / 512 MB process. It is usage-billed and has a full-utilization ceiling of approximately $37.50 per month before the included $10 monthly credit; it should be enabled only when the workload justifies that cost.[3]

## Follow-Up Priorities

The next reliability work should be operational rather than feature-expansive. First, collect anonymized categories of diagnostic outcomes only if users explicitly opt in; do not transmit diagnostic reports. Second, add a performance task to split the large web bundle identified during production build. Third, release signed desktop artifacts only after platform validation and SHA-256 digest generation, then let the release API drive the public download cards.

## References

[1]: https://github.com/SteveKinzey/claude-code-tools-installer "Claude Code Tools Installer source repository"
[2]: https://docs.github.com/en/rest/releases/releases "GitHub REST API documentation: Releases"
[3]: https://help.manus.im "Manus Help Center"
