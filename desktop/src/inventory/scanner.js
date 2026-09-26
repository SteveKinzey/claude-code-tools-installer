// Turns what the checkup already collects into inventory scan items: skill
// folders from discovery findings, and plugins and MCP connections from Claude
// Code's own `plugin list` / `mcp list` output. Pure: no I/O.

const PLUGIN_ID = /^[a-z0-9][a-z0-9._-]*(?:@[a-z0-9][a-z0-9._-]*)?$/i;
const PLUGIN_SCOPES = { user: 'Just you', project: 'This project', local: 'Only you in this project' };
const CLAUDE_AI_SCOPE = 'Your Claude.ai account';

function skillKey(name) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function textLines(text) {
  return String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function parsePluginList(text) {
  const plugins = new Map();
  let inClaudeAiSection = false;
  let current = null;
  for (const line of textLines(text)) {
    if (line.endsWith(':')) {
      inClaudeAiSection = /claude\.ai/i.test(line);
      current = null;
      continue;
    }
    const detail = line.match(/^([A-Za-z]+):\s*(.*)$/);
    if (detail) {
      const scope = PLUGIN_SCOPES[detail[2].trim().toLowerCase()];
      if (current && detail[1].toLowerCase() === 'scope' && scope && current.origin === 'local') current.scope = scope;
      continue;
    }
    const id = line.replace(/^[❯•*+-]\s+/, '').split(/\s+/)[0];
    if (!PLUGIN_ID.test(id) || /^no$/i.test(id)) {
      current = null;
      continue;
    }
    const key = id.toLowerCase();
    const fromClaudeAi = inClaudeAiSection || key.endsWith('@synced');
    current = plugins.get(key) || {
      kind: 'plugin',
      key,
      name: id,
      scope: fromClaudeAi ? CLAUDE_AI_SCOPE : 'Claude Code',
      origin: fromClaudeAi ? 'claude.ai' : 'local',
      path: '',
      contentHash: '',
    };
    plugins.set(key, current);
  }
  return [...plugins.values()];
}

function parseMcpList(text) {
  const connections = new Map();
  for (const line of textLines(text)) {
    if (/^checking mcp server health/i.test(line) || /^no mcp servers/i.test(line)) continue;
    const listed = line.match(/^(.+?):\s+\S.*?\s+-\s+\S/);
    const name = listed ? listed[1].trim() : /^[\w.@-]+$/.test(line) ? line : '';
    if (!name) continue;
    const key = name.toLowerCase();
    if (connections.has(key)) continue;
    const fromClaudeAi = key.startsWith('claude.ai ');
    connections.set(key, {
      kind: 'mcp',
      key,
      name,
      scope: fromClaudeAi ? CLAUDE_AI_SCOPE : 'Claude Code',
      origin: fromClaudeAi ? 'claude.ai' : 'local',
      path: '',
      contentHash: '',
    });
  }
  return [...connections.values()];
}

function isSkillFinding(item) {
  if (!item) return false;
  if (item.type === 'skill' || item.type === 'skill-link-excluded') return true;
  return item.type === 'attention' && String(item.id || '').startsWith('skill:');
}

function skillsFromFindings(findings) {
  return (Array.isArray(findings) ? findings : []).filter(isSkillFinding).map((item) => ({
    kind: 'skill',
    key: skillKey(item.name),
    name: item.name,
    scope: item.scope,
    origin: 'local',
    path: item.path || '',
    contentHash: item.type === 'skill' ? String(item.contentHash || '') : '',
  }));
}

function buildScan({ findings = [], pluginList = null, mcpList = null, projectPath = '' } = {}) {
  const pluginsObserved = Boolean(pluginList && pluginList.ok);
  const mcpObserved = Boolean(mcpList && mcpList.ok);
  const unreadableSkillScopes = [...new Set((Array.isArray(findings) ? findings : [])
    .filter((item) => item && item.type === 'attention' && String(item.id || '').startsWith('skill-root:'))
    .map((item) => item.scope))];
  return {
    projectPath: String(projectPath || ''),
    observed: { skill: true, plugin: pluginsObserved, mcp: mcpObserved },
    unreadableSkillScopes,
    items: [
      ...skillsFromFindings(findings),
      ...(pluginsObserved ? parsePluginList(pluginList.text) : []),
      ...(mcpObserved ? parseMcpList(mcpList.text) : []),
    ],
  };
}

module.exports = { buildScan, parsePluginList, parseMcpList, skillsFromFindings, skillKey };
