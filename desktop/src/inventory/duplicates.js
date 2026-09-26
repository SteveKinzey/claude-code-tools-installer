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

// Which copy CCTI keeps. MCP_SCOPE_PRECEDENCE is still Claude Code's runtime order inside
// one folder (local, then project, then user), and copies are listed in that order. But the
// spec's rule is "Removing the winning copy would silently change behavior", and local and
// project copies apply only in their folder while a user copy applies everywhere. So:
// - identical copies that are all local or user: keep the user copy (the broadest reach) and
//   remove the narrower local copies. In the folder, Claude Code then uses the user copy,
//   which is the same definition, so behavior is unchanged everywhere;
// - copies set up differently: removing either one changes behavior somewhere, so the group
//   is informational ('different-setup');
// - a project copy (.mcp.json) is shared with the team, so a group with one is informational
//   ('team-shared') and CCTI never removes it;
// - local copies saved for different folders never meet ('separate-folders').
function mcpDuplicateGroups(definitions, { homePath } = {}) {
  const list = Array.isArray(definitions) ? definitions : [];
  const home = homePath || (list.find((d) => d.scope === 'local')?.projectPath ?? '');
  return [...groupBy(list, (d) => d.key)]
    .filter(([, copies]) => copies.length > 1)
    .map(([key, copies]) => {
      const ordered = [...copies].sort((a, b) => MCP_SCOPE_PRECEDENCE.indexOf(a.scope) - MCP_SCOPE_PRECEDENCE.indexOf(b.scope));
      const identical = new Set(ordered.map((d) => d.fingerprint)).size === 1;
      const userIndex = ordered.findIndex((d) => d.scope === 'user');
      const reason = ordered.some((d) => d.scope === 'project')
        ? 'team-shared'
        : !identical
          ? 'different-setup'
          : userIndex === -1
            ? 'separate-folders'
            : '';
      return {
        kind: 'mcp',
        key,
        name: ordered[0].name,
        copies: ordered.map((d) => ({ name: d.name, scope: d.scope, projectPath: d.projectPath, fingerprint: d.fingerprint, label: mcpLabel(d, home) })),
        keeper: reason ? null : userIndex,
        needsChoice: false,
        identical,
        informational: Boolean(reason),
        reason,
      };
    });
}

const isSynced = (install) => install.scope === 'synced' || install.marketplace === 'synced';

// Claude.ai-synced add-ons (`name@synced`, scope "synced") never join a group. Per
// docs/claude-code-precedence-2026-09-26.md, a synced plugin that shares a name with another
// enabled plugin is already not loaded, and synced plugins are managed in the Claude.ai
// account, not by CCTI. A project or local copy whose folder is unknown (no project was
// checked) cannot be changed safely, so its group is informational ('project-unknown').
function pluginDuplicateGroups(installs) {
  const enabled = (Array.isArray(installs) ? installs : []).filter((install) => install.enabled && !isSynced(install));
  return [...groupBy(enabled, (install) => install.name)]
    .filter(([, copies]) => new Set(copies.map((c) => c.marketplace)).size > 1)
    .map(([name, copies]) => {
      const folderUnknown = copies.some((c) => c.scope !== 'user' && !c.projectPath);
      return {
        kind: 'plugin',
        key: name,
        name,
        copies: copies.map((c) => ({ id: c.id, originalId: c.originalId || c.id, scope: c.scope, projectPath: c.projectPath, marketplace: c.marketplace, label: `${c.marketplace} (${PLUGIN_SCOPE_LABELS[c.scope] || c.scope})` })),
        keeper: null,
        needsChoice: !folderUnknown,
        identical: false,
        informational: folderUnknown,
        reason: folderUnknown ? 'project-unknown' : '',
      };
    });
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
