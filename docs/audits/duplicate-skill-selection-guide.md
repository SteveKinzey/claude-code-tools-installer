# Duplicate Skill Resolution & Granular Selection Guide

## Purpose

Claude Code Tools Installer (CCTI) identifies duplicate skill folders during a Full Checkup and provides **reversible backup workflows** rather than deletion. A duplicate is eligible for a cleanup action only when CCTI has verified that its skill-folder content is identical. An overlapping name alone is never enough to make a copy actionable.

> **Definition:** A *verified duplicate* is a discovered skill folder whose full content manifest matches another discovered skill folder by content hash. A same-name overlap with different or unverified content is informational only.

## Usage Examples

### Bulk de-duplication: keep the newest copy automatically

Use this workflow when every verified duplicate group can follow the default rule: keep the newest discovered copy by last-edited date and move all other verified copies to backup.

1. Run **Full Checkup**, then select **Review duplicate copies**.
2. Confirm that each group is labeled as having **identical verified content**. The dialog labels the newest discovered copy as **Keep newest discovered copy by date**.
3. Select **Back up verified duplicates**.
4. Review the exact file-level preview, including every source path, backup destination, file size, and SHA-256 value.
5. Select **Back up listed verified duplicates** and approve the final confirmation.
6. Re-run the checkup when prompted. CCTI then lists any safely restorable backup copies.

### Selective de-duplication: choose the exact copy to move

Use this workflow when the automatic newest-copy decision is not the copy you want to retain. It is useful when an older user-level skill is the version you want to archive, or when you want to remove a project-local copy while retaining a global copy.

1. Run **Full Checkup**, then select **Review duplicate copies**.
2. In the verified duplicate group, locate the exact path and scope to change.
3. Select **Move this copy to backup** beside that specific copy. CCTI offers this only for eligible **Just you** or **This project** skill folders.
4. Inspect the single-skill file preview and its proposed backup destination.
5. Select **Move this skill to a backup**, then approve the final confirmation.
6. If the preview is not correct, select **Back to review**. CCTI returns to the duplicate group without making a change.

### Restore a safely backed-up skill

Use restore only when the original location is empty and the listed backup is the copy you intend to bring back.

1. In the checkup actions, select **Review safe backups**.
2. Inspect the restore preview. CCTI shows the backup source and the original target path.
3. Select **Restore listed backup copies** and approve the final confirmation.
4. CCTI restores only to an empty original location and does not overwrite an active skill.

## Safety Contract

| Safeguard | Enforcement |
|---|---|
| **Content verification** | Backup actions appear only for skill folders with matching verified content hashes. Same-name overlaps remain informational and never show a backup or removal control. |
| **Scoped discovery** | CCTI acts only on absolute skill folders discovered during the current checkup and bounded to the Claude Code roots it inspected. |
| **No destructive deletion** | A cleanup action moves a selected skill folder to a CCTI backup location. It does not delete the skill, merge folders, overwrite files, or alter plugins, settings, connections, or project files. |
| **Exact-file preview** | Before a move or restore, CCTI lists the source path, destination path, byte size, and SHA-256 hash for every reviewed file. |
| **Explicit confirmation** | The final action states the exact file count and says that the operation backs up rather than deletes the skill. |
| **Safe restore** | Restore is offered only for tracked backup copies and only into an empty original location; an active skill is never overwritten. |
| **Keyboard and screen-reader clarity** | The duplicate dialog uses modal semantics, labeled controls, a live status announcement for the preview, and focus moves to the preview heading. |

## What CCTI Does Not Do

CCTI does not treat a matching name as proof that two skills are identical. It does not remove add-ons, plugins, connections, credentials, or project packages through the duplicate-skill workflow. It also does not silently run a backup or restore action: each change requires an exact-file review and final confirmation.
