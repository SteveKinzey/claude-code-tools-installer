// CCTI's own record of what it installed, kept in userData/inventory.json.
// Advisory only: the disk scan always decides what exists. A missing or
// unreadable file never blocks the app. It reads as an empty record, and the
// next write keeps the unreadable file aside and starts fresh.

const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { skillKey } = require('./scanner');

const SCHEMA_VERSION = 1;

function emptyLedger() {
  return { schemaVersion: SCHEMA_VERSION, entries: [], resolutions: [] };
}

const isText = (value) => typeof value === 'string' && value.length > 0;
const KNOWN_KINDS = new Set(['skill', 'plugin', 'mcp']);
const validEntry = (entry) => Boolean(entry) && isText(entry.id) && KNOWN_KINDS.has(entry.kind) && isText(entry.key) && isText(entry.installedAt);
const validResolution = (item) => Boolean(item) && KNOWN_KINDS.has(item.kind) && isText(item.key) && isText(item.resolvedAt);

function parseLedger(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { status: 'corrupt', ledger: emptyLedger() };
  }
  if (!json || typeof json !== 'object' || Array.isArray(json) || json.schemaVersion !== SCHEMA_VERSION || !Array.isArray(json.entries) || !Array.isArray(json.resolutions)) {
    return { status: 'corrupt', ledger: emptyLedger() };
  }
  return {
    status: 'ok',
    ledger: { schemaVersion: SCHEMA_VERSION, entries: json.entries.filter(validEntry), resolutions: json.resolutions.filter(validResolution) },
  };
}

function newlyInstalledEntries(ids, before, after, { tracked, catalog, skillScope = 'global', projectPath = '', now = new Date() }) {
  const byId = new Map((Array.isArray(catalog) ? catalog : []).map((item) => [item.id, item]));
  const installedAt = now.toISOString();
  return [...new Set(Array.isArray(ids) ? ids : [])].flatMap((id) => {
    const item = Object.prototype.hasOwnProperty.call(tracked || {}, id) ? tracked[id] : null;
    if (!item || before.has(id) || !after.has(id)) return [];
    const scope = item.kind === 'skill' && skillScope === 'project' ? 'project' : 'user';
    return [{
      id,
      kind: item.kind,
      key: item.key,
      name: byId.get(id)?.name || id,
      scope,
      projectPath: scope === 'project' ? String(projectPath || '') : '',
      installedAt,
      source: 'ccti-catalog',
      catalogAction: byId.get(id)?.action || '',
    }];
  });
}

function skillBackupResolutions(moves, { projectPath = '', now = new Date() } = {}) {
  return (Array.isArray(moves) ? moves : []).map((move) => {
    const scope = move.scope === 'This project' ? 'project' : 'user';
    return {
      kind: 'skill',
      key: skillKey(move.name),
      scope,
      projectPath: scope === 'project' ? String(projectPath || '') : '',
      resolvedAt: now.toISOString(),
      action: 'backup',
      movedFrom: String(move.source || ''),
      movedTo: String(move.destination || ''),
    };
  });
}

// Resolutions for CCTI-managed extras the user deliberately removed (typed confirmation),
// so the next check does not show them as Missing. Takes the completed managed-extras
// manifest actions ({ kind, target, item }). Only actions that removed a tracked skill folder
// ('skill' or 'path' lines for a tracked skill) or a tracked MCP connection ('mcp' lines)
// count; everything else is untracked. Manifest skill paths always live in ~/.claude/skills,
// so skill resolutions are user scope.
function extrasRemovalResolutions(actions, { tracked = {}, now = new Date() } = {}) {
  return (Array.isArray(actions) ? actions : []).flatMap((action) => {
    const item = action && Object.prototype.hasOwnProperty.call(tracked || {}, action.item) ? tracked[action.item] : null;
    if (!item) return [];
    const removesSkill = item.kind === 'skill' && (action.kind === 'skill' || action.kind === 'path');
    const removesMcp = item.kind === 'mcp' && action.kind === 'mcp';
    if (!removesSkill && !removesMcp) return [];
    return [{
      kind: item.kind,
      key: item.key,
      scope: 'user',
      projectPath: '',
      resolvedAt: now.toISOString(),
      action: 'remove',
      removed: String(action.target || ''),
    }];
  });
}

const entryIdentity = (entry) => [entry.id, entry.scope, entry.projectPath || ''].join('\u0000');

function createLedgerStore(filePath, { now = () => new Date() } = {}) {
  let queue = Promise.resolve();

  async function read() {
    let text;
    try {
      text = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return { status: 'missing', ledger: emptyLedger() };
      if (error.code === 'EISDIR') return { status: 'corrupt', ledger: emptyLedger() };
      return { status: 'unavailable', ledger: emptyLedger() };
    }
    return parseLedger(text);
  }

  async function keepUnreadable() {
    const stamp = now().toISOString().replace(/[:.]/g, '-');
    // The random suffix keeps two recoveries in the same millisecond from colliding.
    const preservedAs = path.join(path.dirname(filePath), `inventory.unreadable-${stamp}-${randomUUID().slice(0, 8)}.json`);
    await fs.rename(filePath, preservedAs);
    return preservedAs;
  }

  async function write(ledger) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.tmp`;
    try {
      await fs.writeFile(temporary, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
      await fs.rename(temporary, filePath);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  function update(change) {
    const run = queue.then(async () => {
      const current = await read();
      if (current.status === 'unavailable') {
        throw Object.assign(new Error('CCTI could not open its record right now.'), { code: 'LEDGER_UNAVAILABLE' });
      }
      const next = change(current.ledger, current.status);
      if (next === null) return { ok: true, preservedAs: '', unchanged: true };
      const preservedAs = current.status === 'corrupt' ? await keepUnreadable() : '';
      await write(next);
      return { ok: true, preservedAs };
    });
    queue = run.catch(() => {});
    return run;
  }

  return {
    read,
    recordInstalls: (entries) => update((ledger) => {
      const replaced = new Set(entries.map(entryIdentity));
      return { ...ledger, entries: [...ledger.entries.filter((entry) => !replaced.has(entryIdentity(entry))), ...entries] };
    }),
    recordResolutions: (resolutions) => update((ledger) => ({ ...ledger, resolutions: [...ledger.resolutions, ...resolutions] })),
    reset: () => update((_ledger, status) => (status === 'corrupt' ? emptyLedger() : null)),
  };
}

module.exports = { SCHEMA_VERSION, emptyLedger, parseLedger, newlyInstalledEntries, skillBackupResolutions, extrasRemovalResolutions, createLedgerStore };
