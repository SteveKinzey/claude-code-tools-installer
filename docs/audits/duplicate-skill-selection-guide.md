# Duplicate Skill Resolution & Granular Selection Guide

## Overview
The Claude Code Tools Installer (CCTI) provides two flexible, safety-gated ways to resolve duplicate skills discovered during a computer checkup:
1. **Bulk De-duplication ("Back up verified duplicates"):** Automatically keeps the newest discovered copy by date and moves every older identical verified copy to a timestamped backup folder.
2. **Selective De-duplication ("Move this copy to backup"):** Allows the user to choose exactly which duplicate copy to move to backup and which copy to keep active, directly within the duplicate review dialog or from the checkup inventory.

## Safeguards Enforced
- **Identical Content Verification:** Only skill folders whose content hash matches byte-for-byte across all files are offered for backup. Informational same-name overlaps never expose removal or backup actions.
- **Reversible Non-Destructive Backup:** Skills are moved to `.claude/ccti-backups/` or `.setup-my-claude/disabled-skills/`. No files are deleted or overwritten.
- **Exact File-Level Preview:** Before any action executes, a preview lists every single file path, destination, byte size, and SHA-256 hash.
- **One-Click Safe Restore:** Backed-up skills are tracked and can be restored back to their original locations with a single click.
