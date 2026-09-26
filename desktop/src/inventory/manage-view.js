// Turns reconciled inventory rows into what the Manage list shows: a plain-word
// badge, one sentence of detail, and at most one action. A path or a command is
// never the thing a person acts on. Pure; also loaded by the renderer.

const MANAGE_SECTIONS = [['skill', 'Skills'], ['plugin', 'Add-ons'], ['mcp', 'Connections']];

function installedDate(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : '';
}

function scopeList(copies) {
  return [...new Set((copies || []).map((copy) => copy.scope).filter(Boolean))].join(', ') || 'more than one place';
}

function uncheckedDetail(reason) {
  if (reason === 'project') return 'You installed this into a project that wasn’t part of this check. Choose “Also check a project” to include it.';
  if (reason === 'folder') return 'CCTI couldn’t read the folder this lives in. Nothing was changed. Check again, or run Diagnostics if it keeps happening.';
  return 'CCTI couldn’t ask Claude Code about this right now. Nothing was changed. Check again in a moment.';
}

function rowView(row) {
  if (row.state === 'installed') {
    const date = installedDate(row.installedAt);
    return { badge: date ? `Installed by CCTI · ${date}` : 'Installed by CCTI', tone: 'ok', detail: `Ready for Claude Code (${row.scope}).`, action: null };
  }
  if (row.state === 'missing') {
    const plan = row.reinstall || { available: false, message: '' };
    return {
      badge: 'Missing',
      tone: 'attention',
      detail: ['You installed this with CCTI, but it is no longer on this computer.', plan.message].filter(Boolean).join(' '),
      action: plan.available ? { type: 'reinstall', label: 'Reinstall', id: plan.id, note: plan.changed ? plan.message : '' } : null,
    };
  }
  if (row.state === 'duplicate') {
    return {
      badge: `${row.copies.length} copies`,
      tone: 'attention',
      detail: row.resolvable
        ? `Identical copies are saved in: ${scopeList(row.copies)}. Resolve shows which copy stays before anything moves, and the others go to a backup you can restore.`
        : `Copies with this name are saved in: ${scopeList(row.copies)}. CCTI can’t confirm they are identical, so it won’t move either one.`,
      action: row.resolvable ? { type: 'resolve', label: 'Resolve' } : null,
    };
  }
  if (row.state === 'unchecked') {
    return { badge: 'Not checked', tone: 'neutral', detail: uncheckedDetail(row.uncheckedReason), action: null };
  }
  const fromAccount = row.origin === 'claude.ai';
  return {
    badge: fromAccount ? 'From your Claude.ai account' : 'Found on this computer',
    tone: 'neutral',
    detail: fromAccount ? 'Managed in your Claude.ai account. CCTI will not change it.' : 'CCTI did not install this, so it will not change it.',
    action: null,
  };
}

function manageSections(inventory) {
  const rows = Array.isArray(inventory?.rows) ? inventory.rows : [];
  const sections = MANAGE_SECTIONS
    .map(([kind, title]) => ({ kind, title, rows: rows.filter((row) => row.kind === kind).map((row) => ({ rowId: row.rowId, name: row.name, ...rowView(row) })) }))
    .filter((section) => section.rows.length > 0);
  const missing = rows.filter((row) => row.state === 'missing').length;
  const duplicates = rows.filter((row) => row.state === 'duplicate').length;
  const notes = [missing ? `${missing} missing` : '', duplicates ? `${duplicates} with extra copies` : ''].filter(Boolean);
  const summary = rows.length
    ? `${rows.length} item${rows.length === 1 ? '' : 's'} found${notes.length ? ` — ${notes.join(', ')}` : ''}.`
    : 'No skills, add-ons, or connections were found in the places checked.';
  const notice = inventory?.historyStatus === 'corrupt'
    ? {
      text: 'CCTI couldn’t read its record of what it installed. Everything still works; items are shown as found on this computer. Starting a fresh record keeps a copy of the old one.',
      action: { type: 'reset-history', label: 'Start a fresh record' },
    }
    : null;
  return { summary, notice, sections };
}

const manageViewApi = { manageSections };

if (typeof module !== 'undefined' && module.exports) module.exports = manageViewApi;
if (typeof window !== 'undefined') window.CCTIManageView = manageViewApi;
