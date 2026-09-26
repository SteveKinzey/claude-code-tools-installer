// The one place CCTI encodes duplicate rules for connections, add-ons, and skills. See
// docs/claude-code-precedence-2026-09-26.md for the documented runtime order: local beats
// project beats user for a connection inside one folder, and a personal skill beats a
// project skill. CCTI never removes the copy Claude Code resolves at runtime, because a
// local or project connection applies only in its own folder while a user copy applies
// everywhere; identical local/user connection copies with the exact same saved name instead
// keep the broadest-reach copy (user) and remove the narrower one, so nothing stops working
// anywhere. A connection group is left alone (informational) when its copies are set up
// differently or saved under names that differ only by letter case (tool names come from the
// exact name), when a project copy is involved (team-shared: .mcp.json is shared with the
// team), or when local copies belong to different folders that never meet
// (separate-folders).
//
// Add-ons follow the same reach principle. Which of two marketplaces' copies loads is not
// documented, so the user chooses, but only when every copy is saved for "Just you,
// everywhere" (user scope) and each id appears once. Turning off a non-user copy either edits
// the team-shared project settings or can remove the add-on from other folders, and turning
// off a user copy while keeping a narrower copy removes it everywhere else. So a group with a
// project copy is 'team-shared', and any other mix (a local copy, the same id at two scopes,
// a copy whose folder is unknown) is 'different-reach'. Claude.ai-synced add-ons never join a
// group. Pure.

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
// - copies set up differently, or saved under names that differ only by letter case (tool
//   names derive from the exact name): removing either one changes behavior somewhere, so
//   the group is informational ('different-setup');
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
      const sameName = new Set(ordered.map((d) => d.name)).size === 1;
      const userIndex = ordered.findIndex((d) => d.scope === 'user');
      const reason = !ordered.every((d) => isSafeMcpName(d.name))
        ? 'unusual-name'
        : ordered.some((d) => d.scope === 'project')
        ? 'team-shared'
        : !identical || !sameName
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

// Names and ids CCTI will pass to the claude CLI. On Windows the CLI is a .cmd launcher that
// runs through the command shell, so anything outside this plain alphabet could be read as
// shell syntax. A group containing any other name is informational ('unusual-name').
const SAFE_MCP_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SAFE_PLUGIN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9._-]*$/;
const isSafeMcpName = (value) => SAFE_MCP_NAME.test(String(value || ''));
const isSafePluginId = (value) => SAFE_PLUGIN_ID.test(String(value || ''));

const isSynced = (install) => install.scope === 'synced' || install.marketplace === 'synced';

// Claude.ai-synced add-ons (`name@synced`, scope "synced") never join a group. Per
// docs/claude-code-precedence-2026-09-26.md, a synced plugin that shares a name with another
// enabled plugin is already not loaded, and synced plugins are managed in the Claude.ai
// account, not by CCTI. A group is resolvable only when every copy is user scope and each id
// appears once (see the header): a project copy makes it 'team-shared', and any other mix
// (local, the same id at two scopes, an unknown folder) makes it 'different-reach'.
function pluginReachReason(copies) {
  if (!copies.every((c) => isSafePluginId(c.originalId || c.id))) return 'unusual-name';
  if (copies.some((c) => c.scope === 'project')) return 'team-shared';
  const allUser = copies.every((c) => c.scope === 'user');
  const idsOnce = new Set(copies.map((c) => c.id)).size === copies.length;
  return allUser && idsOnce ? '' : 'different-reach';
}

function pluginDuplicateGroups(installs) {
  const enabled = (Array.isArray(installs) ? installs : []).filter((install) => install.enabled && !isSynced(install));
  return [...groupBy(enabled, (install) => install.name)]
    .filter(([, copies]) => new Set(copies.map((c) => c.marketplace)).size > 1)
    .map(([name, copies]) => {
      const reason = pluginReachReason(copies);
      return {
        kind: 'plugin',
        key: name,
        name,
        copies: copies.map((c) => ({ id: c.id, originalId: c.originalId || c.id, scope: c.scope, projectPath: c.projectPath, marketplace: c.marketplace, label: `${c.marketplace} (${PLUGIN_SCOPE_LABELS[c.scope] || c.scope})` })),
        keeper: null,
        needsChoice: !reason,
        identical: false,
        informational: Boolean(reason),
        reason,
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

module.exports = { MCP_SCOPE_PRECEDENCE, SKILL_SCOPE_PRECEDENCE, mcpDuplicateGroups, pluginDuplicateGroups, compareSkillKeeper, isSafeMcpName, isSafePluginId };
