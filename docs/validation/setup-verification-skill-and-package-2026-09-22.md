# Setup Check Validation and Package Evidence

**Date:** 2026-09-22
**Repository:** `SteveKinzey/claude-code-tools-installer`
**Source condition:** `318485b feat: improve setup verification feedback` plus the pre-existing uncommitted Setup Check scope and layout work preserved in the local worktree. This report does not represent a committed or published release.

## Reusable Skill

The new Manus skill, `ccti-setup-verification-qa`, captures the repeatable process for relocating and validating Setup Check controls. It covers native control placement, busy spinner behavior, install-scope choices, responsive Electron fixture tests, ordered `aria-live` evidence, regression gates, and a packaged `app.asar` verifier. The skill passed `quick_validate.py`.

## Responsive Electron Renderer Evidence

The real CCTI renderer fixture executed the full simulated device matrix. Every viewport passed document containment, Setup Check containment, visible and ordered controls, and minimum button target-height assertions. At widths below 980 CSS pixels, the Setup Check resolved to one column; the two desktop widths retained the two-column layout.

| Device group | Simulated viewports | Result |
| --- | --- | --- |
| Compact phones | 320×568, 375×812, 390×844, 412×915 | Passed |
| Tablets | 600×960, 768×1024, 820×1180, 1024×768 | Passed |
| Desktop | 1280×720, 1440×900 | Passed |

At every viewport, `Complete setup` appeared before `Verify setup`, neither button overflowed horizontally, and both retained a target height of at least 40 CSS pixels.

## Live-Region Mutation Log

The test observed the rendered `#setup-verification-summary` element with a `MutationObserver`. The region retains `role="status"` and `aria-live="polite"`. Its ordered message log was:

1. `Complete setup is running. CCTI is installing prerequisites, Claude Code, and recommended tools locally.`
2. `CCTI verified 3 of 10 setup items. 7 items need attention. Select Complete setup to retry; no terminal commands are required.`
3. `Checking your CCTI setup locally. Nothing is being changed.`
4. `CCTI verified all 10 setup items. Everything is ready.`

This is rendered-DOM evidence of the polite live region’s mutations. It does not substitute for a manual VoiceOver, NVDA, or other assistive-technology listening session.

## Validation Commands

The following checks passed:

```text
npm --prefix desktop run setup-verification:check
npm --prefix desktop run check
git diff --check
python3 /home/ubuntu/skills/skill-creator/scripts/quick_validate.py ccti-setup-verification-qa
```

The full desktop check includes the Complete Setup verification contract, renderer UI contract, duplicate-skill accessibility audit, terminal adapters, update metadata checks, release contract checks, and dependency security audit.

## Local macOS Package Candidate

`npm --prefix desktop run dist:mac` completed without publishing. The build produced a macOS arm64 ZIP and DMG at the paths below.

| Artifact | Size | SHA-256 |
| --- | ---: | --- |
| `Claude-Code-Tools-Installer-2026.9.22-mac-arm64.zip` | 120 MB | `605ba669c4c4cdca569f2b4a5db4860d925ddbc951e23e87e6cc381d70fa457d` |
| `Claude-Code-Tools-Installer-2026.9.22-mac-arm64.dmg` | 126 MB | `349f73154c9b828ae34786ed5671c8b7ced8d47f9f04fef8e411e46f471101c0` |

The ZIP was extracted to a temporary directory. Its `app.asar` contains the Complete setup and Verify setup controls, the Setup Check live summary, spinner markup and runtime state, responsive action-group styles, and reduced-motion handling. `codesign --verify --deep --strict --verbose=2` passed for the packaged app. The candidate was signed by **Developer ID Application: Stephen Kinzey (949XJPESM2)**.

> The local candidate was not notarized. Electron Builder explicitly skipped notarization because this command did not set `NOTARIZE=1` with managed Apple credentials. It must not be characterized as a notarized or public release.
