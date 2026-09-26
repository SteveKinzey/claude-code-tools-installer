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

function backedUpSinceInstall(entry, resolutions) {
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
    return { id: entry.id, available: false, changed: false, message: `${name} is no longer offered by CCTI, so it can't be reinstalled from here.` };
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
  const items = Array.isArray(scan?.items) ? scan.items : [];
  const record = ledgerStatus === 'corrupt' ? {} : ledger || {};
  const entries = Array.isArray(record.entries) ? record.entries : [];
  const resolutions = Array.isArray(record.resolutions) ? record.resolutions : [];
  const catalogItems = Array.isArray(catalog) ? catalog : [];

  const groups = new Map();
  for (const item of items) {
    const groupKey = `${item.kind}:${item.key}`;
    groups.set(groupKey, [...(groups.get(groupKey) || []), item]);
  }

  const rows = [];
  for (const [groupKey, copies] of groups) {
    const first = copies[0];
    const matched = entries
      .filter((entry) => entry.kind === first.kind && keyMatches(first.kind, first.key, entry.key) && entryPresent(entry, copies, view))
      .sort((left, right) => (Date.parse(right.installedAt) || 0) - (Date.parse(left.installedAt) || 0));
    const duplicate = copies.length > 1;
    const hashes = new Set(copies.map((copy) => copy.contentHash || ''));
    rows.push({
      rowId: groupKey,
      kind: first.kind,
      key: first.key,
      name: matched[0]?.name || first.name,
      state: duplicate ? 'duplicate' : matched.length ? 'installed' : 'external',
      scope: first.scope,
      origin: first.origin || 'local',
      installedAt: matched[0]?.installedAt || '',
      installedByCcti: matched.length > 0,
      copies: copies.map((copy) => ({ scope: copy.scope, path: copy.path || '' })),
      resolvable: first.kind === 'skill' && duplicate && !hashes.has('') && hashes.size === 1,
      reinstall: null,
      uncheckedReason: '',
    });
  }

  for (const entry of entries) {
    if (entryPresent(entry, items, view)) continue;
    const reason = uncheckedReason(entry, view);
    if (!reason && backedUpSinceInstall(entry, resolutions)) continue;
    rows.push({
      rowId: `record:${entry.id}:${entry.scope}:${entry.projectPath || ''}`,
      kind: entry.kind,
      key: entry.key,
      name: entry.name || entry.id,
      state: reason ? 'unchecked' : 'missing',
      scope: entryScopeLabel(entry),
      origin: 'local',
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
