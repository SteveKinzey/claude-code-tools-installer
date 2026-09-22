# Setup Verification Controls: Session TODO

## Scope

Validate the relocated Setup Check controls across supported renderer widths, make the Complete setup action visibly and accessibly indicate execution, and cover the resulting announcements in the real Electron renderer fixture.

## Work items

- [x] Inspect the current Complete setup execution path, verification rendering, and Electron renderer fixture conventions.
- [x] Add a motion-safe, in-button spinner and an explicit busy label while Complete setup runs.
- [x] Add responsive containment and button-reflow assertions at 390 × 844, 768 × 1024, and 1280 × 720.
- [x] Assert native button semantics, accessible names, busy state, and `setup-verification-summary` live announcements before, during, and after execution.
- [x] Run targeted checks, the complete desktop validation suite, and `git diff --check`.
