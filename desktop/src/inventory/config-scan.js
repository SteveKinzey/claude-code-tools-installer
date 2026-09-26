// Reads where each MCP connection is defined (user, local, project) from Claude
// Code's own config files, and which add-ons are installed from
// `claude plugin list --json`. Pure: callers pass file text in. CCTI only reads
// these files; changes always go through the claude CLI.

function parseObject(text) {
  if (text === null || text === undefined) return { ok: true, value: null };
  try {
    const value = JSON.parse(text);
    return { ok: true, value: value && typeof value === 'object' && !Array.isArray(value) ? value : null };
  } catch {
    return { ok: false, value: null };
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function serversOf(container, scope, projectPath) {
  const servers = container && typeof container.mcpServers === 'object' && container.mcpServers && !Array.isArray(container.mcpServers) ? container.mcpServers : {};
  return Object.entries(servers).map(([name, definition]) => ({
    name,
    key: name.toLowerCase(),
    scope,
    projectPath,
    fingerprint: stableJson(definition),
  }));
}

// Claude Code keys local-scope servers by folder path. On Windows it writes those keys with
// forward slashes ("C:/Users/jane", "D:/work/my project") while Node paths use backslashes, and
// drive letters can differ in case. Compare normalized forms so a folder is found either way.
function folderKey(value) {
  const forward = String(value || '').replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[A-Za-z]:\//.test(forward) ? forward.toLowerCase() : forward;
}

function projectEntry(projects, folder) {
  if (Object.prototype.hasOwnProperty.call(projects, folder)) return projects[folder];
  const wanted = folderKey(folder);
  const match = Object.keys(projects).find((key) => folderKey(key) === wanted);
  return match === undefined ? undefined : projects[match];
}

function mcpDefinitions({ claudeJsonText = null, projectMcpJsonText = null, homePath = '', projectPath = '' } = {}) {
  const claudeJson = parseObject(claudeJsonText);
  const projectJson = parseObject(projectMcpJsonText);
  const definitions = [];
  const config = claudeJson.value;
  if (config) {
    definitions.push(...serversOf(config, 'user', ''));
    const projects = config.projects && typeof config.projects === 'object' ? config.projects : {};
    for (const localPath of [...new Set([homePath, projectPath].filter(Boolean))]) {
      definitions.push(...serversOf(projectEntry(projects, localPath), 'local', localPath));
    }
  }
  if (projectPath && projectJson.value) definitions.push(...serversOf(projectJson.value, 'project', projectPath));
  return { ok: claudeJson.ok && projectJson.ok, definitions };
}

// `claude plugin list --json` entries carry enabled, id, installPath, installedAt,
// lastUpdated, scope and version, but no project folder. A project or local install belongs
// to the folder the list was run from, so the caller passes that folder only when it ran the
// list from a checked project; otherwise those installs have no known folder.
function pluginInstalls(jsonText, { projectPath = '' } = {}) {
  let list;
  try {
    list = JSON.parse(jsonText);
  } catch {
    return { ok: false, installs: [] };
  }
  if (!Array.isArray(list)) return { ok: false, installs: [] };
  const installs = list
    .filter((entry) => entry && typeof entry.id === 'string' && entry.id.includes('@'))
    .map((entry) => {
      const id = entry.id.toLowerCase();
      const [name, marketplace] = id.split('@');
      const scope = typeof entry.scope === 'string' ? entry.scope : 'user';
      return {
        id,
        originalId: entry.id,
        name,
        marketplace,
        scope,
        enabled: entry.enabled !== false,
        projectPath: scope === 'project' || scope === 'local' ? projectPath : '',
      };
    });
  return { ok: true, installs };
}

module.exports = { mcpDefinitions, pluginInstalls, stableJson };
