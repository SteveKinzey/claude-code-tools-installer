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

const pluginsText = JSON.stringify([
  { id: 'Foo@market-a', scope: 'user', enabled: true, version: '1.0.0' },
  { id: 'foo@market-b', scope: 'project', enabled: false, projectPath: project },
  { id: 'claude-hud@claude-hud', scope: 'user', enabled: true },
  { scope: 'user', enabled: true },
]);
const installs = pluginInstalls(pluginsText);
assert.equal(installs.ok, true);
assert.deepEqual(installs.installs.map((i) => [i.id, i.name, i.marketplace, i.scope, i.enabled, i.projectPath]), [
  ['foo@market-a', 'foo', 'market-a', 'user', true, ''],
  ['foo@market-b', 'foo', 'market-b', 'project', false, project],
  ['claude-hud@claude-hud', 'claude-hud', 'claude-hud', 'user', true, ''],
]);
assert.equal(pluginInstalls('not json').ok, false);
assert.equal(pluginInstalls('{"id":"x"}').ok, false, 'a non-array is not a plugin list');

console.log('Inventory config scan passed: MCP scopes from config files and add-on installs from plugin list --json.');
