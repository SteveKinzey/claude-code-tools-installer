// The one place CCTI encodes which duplicate Claude Code actually uses. Every rule
// here is documented; see docs/claude-code-precedence-2026-09-26.md. Where Claude
// Code documents no rule (the same add-on from two marketplaces), CCTI does not
// guess: the group needs the user's choice. Pure.

const MCP_SCOPE_PRECEDENCE = ['local', 'project', 'user'];
const SKILL_SCOPE_PRECEDENCE = ['Just you', 'This project'];
const PLUGIN_SCOPE_LABELS = { user: 'Just you', project: 'This project', local: 'Only you in this project' };

function mcpLabel(definition, homePath) {
  if (definition.scope === 'user') return 'Just you, everywhere';
  if (definition.scope === 'project') return 'Everyone on this project';
  return definition.projectPath && definition.projectPath === homePath ? 'Only you, in this folder' : 'Only you, in this project';
}

function groupBy(items, keyOf) {
  const groups = new Map();
  for (const item of items) groups.set(keyOf(item), [...(groups.get(keyOf(item)) || []), item]);
  return groups;
}

function mcpDuplicateGroups(definitions, { homePath } = {}) {
  const list = Array.isArray(definitions) ? definitions : [];
  const home = homePath || (list.find((d) => d.scope === 'local')?.projectPath ?? '');
  return [...groupBy(list, (d) => d.key)]
    .filter(([, copies]) => copies.length > 1)
    .map(([key, copies]) => {
      const ordered = [...copies].sort((a, b) => MCP_SCOPE_PRECEDENCE.indexOf(a.scope) - MCP_SCOPE_PRECEDENCE.indexOf(b.scope));
      return {
        kind: 'mcp',
        key,
        name: ordered[0].name,
        copies: ordered.map((d) => ({ scope: d.scope, projectPath: d.projectPath, fingerprint: d.fingerprint, label: mcpLabel(d, home) })),
        keeper: 0,
        needsChoice: false,
        identical: new Set(ordered.map((d) => d.fingerprint)).size === 1,
      };
    });
}

function pluginDuplicateGroups(installs) {
  const enabled = (Array.isArray(installs) ? installs : []).filter((install) => install.enabled);
  return [...groupBy(enabled, (install) => install.name)]
    .filter(([, copies]) => new Set(copies.map((c) => c.marketplace)).size > 1)
    .map(([name, copies]) => ({
      kind: 'plugin',
      key: name,
      name,
      copies: copies.map((c) => ({ id: c.id, scope: c.scope, projectPath: c.projectPath, marketplace: c.marketplace, label: `${c.marketplace} (${PLUGIN_SCOPE_LABELS[c.scope] || c.scope})` })),
      keeper: null,
      needsChoice: true,
      identical: false,
    }));
}

function compareSkillKeeper(left, right) {
  const rank = (item) => {
    const index = SKILL_SCOPE_PRECEDENCE.indexOf(item.scope);
    return index === -1 ? SKILL_SCOPE_PRECEDENCE.length : index;
  };
  const byScope = rank(left) - rank(right);
  if (byScope !== 0) return byScope;
  const byDate = (Date.parse(right.updatedAt || '') || 0) - (Date.parse(left.updatedAt || '') || 0);
  if (byDate !== 0) return byDate;
  return String(left.path || '').localeCompare(String(right.path || ''));
}

module.exports = { MCP_SCOPE_PRECEDENCE, SKILL_SCOPE_PRECEDENCE, mcpDuplicateGroups, pluginDuplicateGroups, compareSkillKeeper };
