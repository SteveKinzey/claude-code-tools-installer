// Turns a duplicate group and a keeper into the exact, reversible changes CCTI
// will make. The CLI arguments are for main.js; the labels are what people read.
// Pure.

const PLUGIN_SCOPE_LABELS = { user: 'Just you', project: 'This project', local: 'Only you in this project' };

function groupFingerprint(group) {
  return JSON.stringify([group.kind, group.key, (group.copies || []).map((copy) => [copy.name || '', copy.scope, copy.projectPath || '', copy.fingerprint || '', copy.originalId || copy.id || ''])]);
}

function changeFor(group, copy, keep) {
  if (group.kind === 'mcp') {
    return {
      // Each copy keeps its own spelling; the CLI matches the name as saved.
      args: ['mcp', 'remove', copy.name || group.name, '--scope', copy.scope],
      label: `Remove the copy saved for ${copy.label}`,
      undo: `The same connection is still saved for ${keep.label}, so nothing stops working.`,
    };
  }
  return {
    args: ['plugin', 'disable', copy.originalId || copy.id, '--scope', copy.scope],
    label: `Turn off ${copy.marketplace}'s copy (${PLUGIN_SCOPE_LABELS[copy.scope] || copy.scope})`,
    undo: 'You can turn it back on later; nothing is uninstalled.',
  };
}

function planResolution(group, { keep } = {}) {
  const copies = Array.isArray(group?.copies) ? group.copies : [];
  if (copies.length < 2) return { ok: false, reason: 'nothing-to-do' };
  if (group.informational) return { ok: false, reason: 'informational' };
  let keeper;
  if (group.needsChoice) {
    if (keep === undefined || keep === null) return { ok: false, reason: 'needs-choice' };
    keeper = keep;
  } else {
    if (keep !== undefined && keep !== null && keep !== group.keeper) return { ok: false, reason: 'invalid-choice' };
    keeper = group.keeper;
  }
  if (!Number.isInteger(keeper) || keeper < 0 || keeper >= copies.length) return { ok: false, reason: 'invalid-choice' };
  const kept = copies[keeper];
  // Defensive: never turn off a copy that shares the kept copy's id (the same add-on saved at
  // another scope), since that would turn off the add-on CCTI keeps. duplicates.js already
  // makes such groups informational. Each change carries its copy so callers never realign.
  const idOf = (copy) => String(copy.id || copy.originalId || '').toLowerCase();
  const targets = copies.filter((copy, index) => index !== keeper && !(idOf(kept) && idOf(copy) === idOf(kept)));
  if (targets.length === 0) return { ok: false, reason: 'nothing-to-do' };
  return {
    ok: true,
    kind: group.kind,
    name: group.name,
    keep: kept,
    changes: targets.map((copy) => ({ ...changeFor(group, copy, kept), copy })),
    fingerprint: groupFingerprint(group),
  };
}

module.exports = { planResolution, groupFingerprint };
