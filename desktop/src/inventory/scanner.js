// Turns what the checkup already collects into inventory scan items: skill
// folders from discovery findings, and plugins and MCP connections from Claude
// Code's own `plugin list` / `mcp list` output. Pure: no I/O.

const PLUGIN_ID = /^[a-z0-9][a-z0-9._-]*(?:@[a-z0-9][a-z0-9._-]*)?$/i;
const PLUGIN_SCOPES = { user: 'Just you', project: 'This project', local: 'Only you in this project' };
const CLAUDE_AI_SCOPE = 'Your Claude.ai account';
const NOISE_WORDS = new Set(['error', 'errors', 'warning', 'warnings', 'warn']);

function isNoiseWord(name) {
  return NOISE_WORDS.has(String(name || '').trim().toLowerCase());
}

function skillKey(name) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function textLines(text) {
  return String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

// `claude plugin list` prints a section header ("Installed plugins:"), then one
// "❯ name@marketplace" entry per plugin followed by indented "Key: value" detail
// lines. Older builds printed bare "name@marketplace status" lines.
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
    const bulleted = /^[❯•*+-]\s+/.test(line);
    const id = line.replace(/^[❯•*+-]\s+/, '').split(/\s+/)[0];
    if (!PLUGIN_ID.test(id) || /^no$/i.test(id) || isNoiseWord(id) || (!bulleted && !id.includes('@'))) {
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
      addOn: '',
      path: '',
      contentHash: '',
    };
    plugins.set(key, current);
  }
  return [...plugins.values()];
}

// `claude mcp list` prints a health banner, then "name: target - status" per
// server. Names may contain spaces ("claude.ai Slack") or colons
// ("plugin:add-on:server"), so the name ends at the first ": " followed by the
// target. Older builds printed bare names only; those are accepted only when the
// whole output is in that bare format.
const ADD_ON_CONNECTION = /^plugin:([^:]+):/;
// A server line ends with " - <status>". Claude Code's statuses either start with
// a status symbol (✔ Connected, ✗ Failed to connect, ! Needs authentication,
// ⏸ Pending approval) or are one of a few plain phrases ("Not configured").
// Requiring that shape keeps an error sentence such as
// "Failed to connect: server - error" from becoming a connection.
// The status symbol differs by platform: macOS and Linux print ✔ / ✗, Windows prints √ / ×.
// Any symbol (not a letter, digit or space) counts, as do the plain-word statuses.
const LISTED_LINE = /^(.+?):\s+\S.*?\s+-\s+(?:[^\p{L}\p{N}\s]|(?:not configured|pending approval|connected|failed|needs authentication|disabled)\b)/iu;

function parseMcpList(text) {
  const connections = new Map();
  const lines = textLines(text).filter((line) => !/^checking mcp server health/i.test(line) && !/^no mcp servers/i.test(line));
  const listedFormat = lines.some((line) => LISTED_LINE.test(line));
  for (const line of lines) {
    const listed = line.match(LISTED_LINE);
    const name = listed ? listed[1].trim() : !listedFormat && /^[\w.@-]+$/.test(line) ? line : '';
    if (!name || isNoiseWord(name)) continue;
    const key = name.toLowerCase();
    if (connections.has(key)) continue;
    const addOn = name.match(ADD_ON_CONNECTION)?.[1] || '';
    const fromClaudeAi = key.startsWith('claude.ai ');
    connections.set(key, {
      kind: 'mcp',
      key,
      name,
      scope: fromClaudeAi ? CLAUDE_AI_SCOPE : addOn ? `Part of the ${addOn} add-on` : 'Claude Code',
      origin: fromClaudeAi ? 'claude.ai' : addOn ? 'plugin' : 'local',
      addOn,
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
    addOn: '',
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
