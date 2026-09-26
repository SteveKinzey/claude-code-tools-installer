// Merges the disk scan with CCTI's install record into display rows. The scan
// always wins: the record adds provenance, never existence. Where the scan could
// not look, a recorded item is "unchecked", not "missing". Pure.

const KIND_ORDER = { skill: 0, plugin: 1, mcp: 2 };
const STATE_ORDER = { missing: 0, duplicate: 1, unchecked: 2, installed: 3, external: 4 };
const SKILL_SCOPE_LABELS = { user: 'Just you', project: 'This project' };

function keyMatches(kind, scannedKey, recordedKey) {
  if (scannedKey === recordedKey) return true;
  return kind === 'plugin' && !recordedKey.includes('@') && scannedKey.split('@')[0] === recordedKey;
}

function entryScopeLabel(entry) {
  return entry.kind === 'skill' ? SKILL_SCOPE_LABELS[entry.scope] || 'Just you' : 'Claude Code';
}

function entryPresent(entry, items, scan) {
  return items.some((item) => {
    if (item.kind !== entry.kind || !keyMatches(item.kind, item.key, entry.key)) return false;
    if (entry.kind !== 'skill') return true;
    if (entry.scope === 'project') return item.scope === 'This project' && scan.projectPath === entry.projectPath;
    return item.scope === 'Just you';
  });
}

function uncheckedReason(entry, scan) {
  if (!scan.observed?.[entry.kind]) return 'claude-code';
  if (entry.kind !== 'skill') return '';
  if (entry.scope === 'project' && (!scan.projectPath || scan.projectPath !== entry.projectPath)) return 'project';
  if ((scan.unreadableSkillScopes || []).includes(entryScopeLabel(entry))) return 'folder';
  return '';
}

function resolvedSinceInstall(entry, resolutions) {
  const installed = Date.parse(entry.installedAt) || 0;
  return resolutions.some((item) => item.kind === entry.kind
    && item.key === entry.key
    && (item.scope || 'user') === entry.scope
    && (item.projectPath || '') === (entry.projectPath || '')
    && (Date.parse(item.resolvedAt) || 0) >= installed);
}

function reinstallPlan(entry, catalog, tracked) {
  const item = catalog.find((candidate) => candidate.id === entry.id);
  const current = Object.prototype.hasOwnProperty.call(tracked, entry.id) ? tracked[entry.id] : null;
  const name = entry.name || entry.id;
  if (!item || !current) {
    return { id: entry.id, available: false, changed: false, message: `${name} is no longer offered by CCTI, so it can’t be reinstalled from here.` };
  }
  // Reinstall runs the normal install, which puts skills in ~/.claude/skills. A project
  // skill would stay missing there, so point the user at that project's Complete setup.
  if (entry.scope === 'project') {
    return { id: entry.id, available: false, changed: false, message: `${name} was installed into a project. Run Complete setup for that project to put it back.` };
  }
  const changed = current.key !== entry.key || (Boolean(entry.catalogAction) && item.action !== entry.catalogAction);
  return {
    id: entry.id,
    available: true,
    changed,
    message: changed ? `CCTI now installs ${item.name} differently than when you first installed it. Reinstall uses the current steps.` : '',
  };
}

function reconcileInventory({ scan, ledger, ledgerStatus = 'ok', catalog = [], tracked = {} } = {}) {
  const view = {
    projectPath: String(scan?.projectPath || ''),
    observed: scan?.observed || { skill: true, plugin: false, mcp: false },
    unreadableSkillScopes: Array.isArray(scan?.unreadableSkillScopes) ? scan.unreadableSkillScopes : [],
  };
  const scanItems = Array.isArray(scan?.items) ? scan.items : [];
  const duplicateGroups = (Array.isArray(scan?.duplicateGroups) ? scan.duplicateGroups : [])
    .filter((group) => group && ['mcp', 'plugin'].includes(group.kind) && group.key && Array.isArray(group.copies) && group.copies.length > 1);
  // Each add-on or connection duplicate group becomes one row, keyed `<kind>:<key>`. For an
  // add-on the scan lists each install (`foo@market-a`, `foo@market-b`) separately, so
  // those items fold into the group's row. A group the text list missed still gets a row.
  const groupFor = new Map();
  for (const group of duplicateGroups) {
    const ids = new Set(group.copies.map((copy) => String(copy.id || '').toLowerCase()).filter(Boolean));
    for (const item of scanItems) {
      if (item.kind !== group.kind) continue;
      if (group.kind === 'mcp' ? item.key === group.key && item.origin === 'local' : ids.has(item.key)) groupFor.set(item, group);
    }
  }
  const foundGroups = new Set(groupFor.values());
  const items = [
    ...scanItems,
    ...duplicateGroups.filter((group) => !foundGroups.has(group)).map((group) => {
      const item = { kind: group.kind, key: group.kind === 'plugin' ? String(group.copies[0].id || group.key) : group.key, name: group.name || group.key, scope: 'Claude Code', origin: 'local', addOn: '', path: '', contentHash: '' };
      groupFor.set(item, group);
      return item;
    }),
  ];
  const record = ledgerStatus === 'corrupt' || ledgerStatus === 'unavailable' ? {} : ledger || {};
  const entries = Array.isArray(record.entries) ? record.entries : [];
  const resolutions = Array.isArray(record.resolutions) ? record.resolutions : [];
  const catalogItems = Array.isArray(catalog) ? catalog : [];

  const groups = new Map();
  const resolutionGroups = new Map();
  for (const item of items) {
    const duplicateGroup = groupFor.get(item);
    const groupKey = duplicateGroup ? `${duplicateGroup.kind}:${duplicateGroup.key}` : `${item.kind}:${item.key}`;
    if (duplicateGroup) resolutionGroups.set(groupKey, duplicateGroup);
    groups.set(groupKey, [...(groups.get(groupKey) || []), item]);
  }

  const rows = [];
  for (const [groupKey, copies] of groups) {
    const first = copies[0];
    const matched = entries
      .filter((entry) => entry.kind === first.kind && copies.some((copy) => keyMatches(first.kind, copy.key, entry.key)) && entryPresent(entry, copies, view))
      .sort((left, right) => (Date.parse(right.installedAt) || 0) - (Date.parse(left.installedAt) || 0));
    const duplicateGroup = resolutionGroups.get(groupKey);
    const duplicate = copies.length > 1 || Boolean(duplicateGroup);
    const hashes = new Set(copies.map((copy) => copy.contentHash || ''));
    const row = {
      rowId: groupKey,
      kind: first.kind,
      key: duplicateGroup ? duplicateGroup.key : first.key,
      name: matched[0]?.name || duplicateGroup?.name || first.name,
      state: duplicate ? 'duplicate' : matched.length ? 'installed' : 'external',
      scope: first.scope,
      origin: first.origin || 'local',
      addOn: first.addOn || '',
      installedAt: matched[0]?.installedAt || '',
      installedByCcti: matched.length > 0,
      copies: duplicateGroup
        ? duplicateGroup.copies.map((copy) => ({ scope: copy.label, path: '' }))
        : copies.map((copy) => ({ scope: copy.scope, path: copy.path || '' })),
      resolvable: first.kind === 'skill' && duplicate && !hashes.has('') && hashes.size === 1,
      reinstall: null,
      uncheckedReason: '',
    };
    if (duplicateGroup) {
      row.resolution = {
        groupKey,
        needsChoice: Boolean(duplicateGroup.needsChoice),
        keeper: Number.isInteger(duplicateGroup.keeper) ? duplicateGroup.keeper : null,
        options: duplicateGroup.copies.map((copy) => copy.label),
      };
    }
    rows.push(row);
  }

  for (const entry of entries) {
    if (entryPresent(entry, items, view)) continue;
    const reason = uncheckedReason(entry, view);
    if (!reason && resolvedSinceInstall(entry, resolutions)) continue;
    rows.push({
      rowId: `record:${entry.id}:${entry.scope}:${entry.projectPath || ''}`,
      kind: entry.kind,
      key: entry.key,
      name: entry.name || entry.id,
      state: reason ? 'unchecked' : 'missing',
      scope: entryScopeLabel(entry),
      origin: 'local',
      addOn: '',
      installedAt: entry.installedAt,
      installedByCcti: true,
      copies: [],
      resolvable: false,
      reinstall: reason ? null : reinstallPlan(entry, catalogItems, tracked || {}),
      uncheckedReason: reason,
    });
  }

  rows.sort((left, right) => (KIND_ORDER[left.kind] - KIND_ORDER[right.kind])
    || (STATE_ORDER[left.state] - STATE_ORDER[right.state])
    || String(left.name).localeCompare(String(right.name)));
  return { historyStatus: ledgerStatus, rows };
}

module.exports = { reconcileInventory };
