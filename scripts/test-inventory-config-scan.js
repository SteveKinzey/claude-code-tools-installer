#!/usr/bin/env node
const assert = require('node:assert/strict');
const { mcpDefinitions, pluginInstalls } = require('../desktop/src/inventory/config-scan');

const home = '/Users/me';
const project = '/work/app';
const claudeJsonText = JSON.stringify({
  mcpServers: { playwright: { command: 'npx', args: ['@playwright/mcp@latest'] }, docs: { type: 'http', url: 'https://x.test' } },
  projects: {
    [home]: { mcpServers: { playwright: { args: ['@playwright/mcp@latest'], command: 'npx' }, repomix: { command: 'npx', args: ['-y', 'repomix', '--mcp'] } } },
    [project]: { mcpServers: { Docs: { type: 'http', url: 'https://y.test' } } },
    '/elsewhere': { mcpServers: { unrelated: { command: 'x' } } },
  },
});
const projectMcpJsonText = JSON.stringify({ mcpServers: { docs: { type: 'http', url: 'https://z.test' } } });

const all = mcpDefinitions({ claudeJsonText, projectMcpJsonText, homePath: home, projectPath: project });
assert.equal(all.ok, true);
const rows = all.definitions.map((d) => [d.key, d.scope, d.projectPath]).sort((a, b) => (a.join('|') < b.join('|') ? -1 : 1));
assert.deepEqual(rows, [
  ['docs', 'local', project],
  ['docs', 'project', project],
  ['docs', 'user', ''],
  ['playwright', 'local', home],
  ['playwright', 'user', ''],
  ['repomix', 'local', home],
], 'user, local (home and the checked project), and project scopes are all read; other projects are ignored');
const [userPw, localPw] = ['user', 'local'].map((scope) => all.definitions.find((d) => d.key === 'playwright' && d.scope === scope));
assert.equal(userPw.fingerprint, localPw.fingerprint, 'fingerprints ignore key order');
assert.equal(all.definitions.find((d) => d.key === 'docs' && d.scope === 'local').name, 'Docs', 'the original spelling is kept as the name');

const noProject = mcpDefinitions({ claudeJsonText, projectMcpJsonText: null, homePath: home, projectPath: '' });
assert.ok(noProject.definitions.every((d) => d.projectPath !== project), 'without a checked project only home-local and user are read');
assert.deepEqual(mcpDefinitions({ claudeJsonText: null, projectMcpJsonText: null, homePath: home, projectPath: '' }), { ok: true, definitions: [] }, 'missing files are empty, not errors');
const broken = mcpDefinitions({ claudeJsonText: '{"mcpServers":', projectMcpJsonText: null, homePath: home, projectPath: '' });
assert.equal(broken.ok, false, 'an unreadable config is reported, not thrown');
assert.deepEqual(broken.definitions, []);
assert.doesNotThrow(() => mcpDefinitions({ claudeJsonText: '[]', projectMcpJsonText: '"x"', homePath: home, projectPath: project }));

// The real shape: enabled, id, installPath, installedAt, lastUpdated, scope, version. No project folder.
const real = (id, scope, enabled) => ({ enabled, id, installPath: `/cache/${id}`, installedAt: '2026-09-01T00:00:00.000Z', lastUpdated: '2026-09-01T00:00:00.000Z', scope, version: '1.0.0' });
const pluginsText = JSON.stringify([
  real('Foo@market-a', 'user', true),
  real('foo@market-b', 'project', false),
  real('claude-hud@claude-hud', 'user', true),
  real('figma@synced', 'synced', true),
  { scope: 'user', enabled: true },
]);
const installs = pluginInstalls(pluginsText);
assert.equal(installs.ok, true);
assert.deepEqual(installs.installs.map((i) => [i.id, i.originalId, i.name, i.marketplace, i.scope, i.enabled, i.projectPath]), [
  ['foo@market-a', 'Foo@market-a', 'foo', 'market-a', 'user', true, ''],
  ['foo@market-b', 'foo@market-b', 'foo', 'market-b', 'project', false, ''],
  ['claude-hud@claude-hud', 'claude-hud@claude-hud', 'claude-hud', 'claude-hud', 'user', true, ''],
  ['figma@synced', 'figma@synced', 'figma', 'synced', 'synced', true, ''],
], 'without a checked project, a project install has no known folder');
const fromProject = pluginInstalls(pluginsText, { projectPath: project });
assert.deepEqual(fromProject.installs.map((i) => i.projectPath), ['', project, '', ''], 'only project and local installs take the folder the list ran from');
assert.equal(pluginInstalls('not json').ok, false);
assert.equal(pluginInstalls('{"id":"x"}').ok, false, 'a non-array is not a plugin list');

console.log('Inventory config scan passed: MCP scopes from config files and add-on installs from plugin list --json.');
