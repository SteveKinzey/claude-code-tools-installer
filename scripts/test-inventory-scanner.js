#!/usr/bin/env node
const assert = require('node:assert/strict');
const { buildScan, parsePluginList, parseMcpList, skillsFromFindings, skillKey } = require('../desktop/src/inventory/scanner');

// Captured from `claude plugin list` (Claude Code, 2026-09-26).
const pluginText = [
  'Installed plugins:',
  '',
  '  ❯ claude-hud@claude-hud',
  '    Version: 0.8.0',
  '    Scope: user',
  '    Status: ✔ enabled',
  '',
  '  ❯ superpowers@superpowers-marketplace',
  '    Version: 6.4.1',
  '    Scope: project',
  '    Status: ✔ enabled',
  '',
  'Synced from claude.ai:',
  '',
  '  ❯ operations@synced',
  '    Version: 1.3.0',
  '    Path: /Users/example/.claude/plugins/synced/abc/operations',
  '    Status: ✔ loaded',
].join('\n');

// Captured from `claude mcp list` (Claude Code, 2026-09-26).
const mcpText = [
  'Checking MCP server health…',
  '',
  'claude.ai Slack: https://mcp.slack.com/mcp - ✔ Connected',
  'playwright: npx @playwright/mcp@latest - ✔ Connected',
  'repomix: npx -y repomix --mcp - ✗ Failed to connect',
].join('\n');

const plugins = parsePluginList(pluginText);
assert.deepEqual(plugins.map((item) => item.key), ['claude-hud@claude-hud', 'superpowers@superpowers-marketplace', 'operations@synced'], 'only real plugin entries are items; detail lines and headers are not');
assert.equal(plugins[0].scope, 'Just you');
assert.equal(plugins[1].scope, 'This project');
assert.equal(plugins[2].origin, 'claude.ai', 'synced plugins belong to the Claude.ai account');
assert.equal(plugins[2].scope, 'Your Claude.ai account');
assert.ok(plugins.every((item) => item.kind === 'plugin'));

assert.deepEqual(parsePluginList(pluginText.replace(/\n/g, '\r\n')), plugins, 'CRLF output must parse identically');
assert.deepEqual(parsePluginList('frontend-design@claude-plugins-official enabled\nfrontend-design@claude-plugins-official enabled').map((item) => item.key), ['frontend-design@claude-plugins-official'], 'bare legacy lines parse and de-duplicate');
assert.deepEqual(parsePluginList('No plugins installed.'), [], 'an empty-list message is not a plugin');
assert.deepEqual(parsePluginList(''), []);

const connections = parseMcpList(mcpText);
assert.deepEqual(connections.map((item) => item.name), ['claude.ai Slack', 'playwright', 'repomix'], 'names with spaces survive and the health banner is ignored');
assert.equal(connections[0].origin, 'claude.ai');
assert.equal(connections[1].key, 'playwright');
assert.equal(connections[1].origin, 'local');
assert.deepEqual(parseMcpList(mcpText.replace(/\n/g, '\r\n')), connections, 'CRLF output must parse identically');
assert.deepEqual(parseMcpList('shared-connection\nshared-connection').map((item) => item.key), ['shared-connection'], 'bare legacy lines parse and de-duplicate');
assert.deepEqual(parseMcpList('No MCP servers configured. Use `claude mcp add` to add a server.'), []);

assert.equal(skillKey('Design Taste_Frontend'), 'design-taste-frontend');
const findings = [
  { id: 'skill:/h/.claude/skills/graphify', type: 'skill', name: 'graphify', scope: 'Just you', path: '/h/.claude/skills/graphify', contentHash: 'abc' },
  { id: 'skill-link-excluded:/h/.claude/skills/linked', type: 'skill-link-excluded', name: 'linked', scope: 'Just you', path: '/h/.claude/skills/linked' },
  { id: 'skill:/p/.claude/skills/odd', type: 'attention', name: 'odd', scope: 'This project', path: '/p/.claude/skills/odd' },
  { id: 'plugin:/h/.claude/settings.json:x', type: 'plugin', name: 'x', scope: 'Just you', path: '/h/.claude/settings.json' },
  { id: 'skill-root:/p/.claude/skills', type: 'attention', name: 'Skills folder needs attention', scope: 'This project', path: '/p/.claude/skills' },
];
const skills = skillsFromFindings(findings);
assert.deepEqual(skills.map((item) => [item.key, item.scope, item.contentHash]), [['graphify', 'Just you', 'abc'], ['linked', 'Just you', ''], ['odd', 'This project', '']], 'hashed, linked, and unverifiable skill folders all count as present; settings findings do not');

const full = buildScan({ findings, pluginList: { ok: true, text: pluginText }, mcpList: { ok: true, text: mcpText }, projectPath: '/p' });
assert.deepEqual(full.observed, { skill: true, plugin: true, mcp: true });
assert.deepEqual(full.unreadableSkillScopes, ['This project']);
assert.equal(full.projectPath, '/p');
assert.equal(full.items.length, skills.length + plugins.length + connections.length);

// Review Focus 1: an unavailable or failing CLI is "not observed", never "observed empty".
for (const [pluginList, mcpList] of [[null, null], [{ ok: false, text: pluginText }, { ok: false, text: mcpText }]]) {
  const scan = buildScan({ findings, pluginList, mcpList });
  assert.deepEqual(scan.observed, { skill: true, plugin: false, mcp: false });
  assert.ok(scan.items.every((item) => item.kind === 'skill'), 'unobserved kinds contribute no items');
}
assert.doesNotThrow(() => buildScan(), 'no input must not throw');
assert.deepEqual(buildScan().items, []);

// Review Focus 2: lone words and error sentences are not entries.
assert.deepEqual(parsePluginList(['Installed plugins:', '', '  ❯ claude-hud@claude-hud', '    Scope: user', 'Marketplace', 'Error loading marketplace cache'].join('\n')).map((item) => item.key), ['claude-hud@claude-hud'], 'only bulleted entries or legacy name@marketplace lines are plugins');
assert.deepEqual(parseMcpList(['Checking MCP server health…', 'playwright: npx @playwright/mcp@latest - ✔ Connected', 'Error', 'warning'].join('\n')).map((item) => item.key), ['playwright'], 'a lone word inside real health output is not a connection');
assert.deepEqual(parseMcpList('shared-connection\nother-one').map((item) => item.key), ['shared-connection', 'other-one'], 'bare names still parse when the whole output is the legacy bare format');

// Review Focus 2b: a bulleted or bare noise word is never mistaken for a real name.
assert.deepEqual(parsePluginList('- Error loading plugin'), [], 'a bulleted noise-word line is not a plugin');
assert.deepEqual(parseMcpList('Error\nwarning'), [], 'bare-format noise words are not connections');

// Review Focus 3: add-on-provided connections carry their add-on.
const fromAddOn = parseMcpList('plugin:brand-voice:box: https://example.test/mcp - ✔ Connected\nplugin:data:google calendar: npx x - ✔ Connected');
assert.deepEqual(fromAddOn.map((item) => [item.name, item.origin, item.addOn, item.scope]), [
  ['plugin:brand-voice:box', 'plugin', 'brand-voice', 'Part of the brand-voice add-on'],
  ['plugin:data:google calendar', 'plugin', 'data', 'Part of the data add-on'],
]);
assert.equal(parseMcpList('playwright: npx x - ✔ Connected')[0].addOn, '', 'ordinary connections have no add-on');

// Statuses without a symbol are real entries; error sentences shaped like an entry are not.
assert.deepEqual(parseMcpList(['Checking MCP server health…', 'plugin:data:hex: https://x.test/mcp - Not configured', 'playwright: npx x - ✔ Connected', 'Failed to connect: server - error'].join('\n')).map((item) => item.key), ['plugin:data:hex', 'playwright'], 'plain-word statuses parse; an error sentence does not');
// Real Windows output (Claude Code on windows-2022, 2026-09-26): √ / × status symbols.
const windowsMcp = [
  'Checking MCP server health…',
  '',
  'probe-home: npx -y @playwright/mcp@latest - √ Connected',
  'probe-project: npx -y example-mcp - × Failed to connect — CONNECTION_CLOSED: Connection closed',
].join('\r\n');
assert.deepEqual(parseMcpList(windowsMcp).map((item) => item.key), ['probe-home', 'probe-project'], 'Windows √ / × status lines are real connections');
assert.deepEqual(parseMcpList('Failed to connect: server - error').map((item) => item.key), [], 'an error sentence is still not a connection');

console.log('Inventory scanner passed: real Claude Code output, CRLF, Claude.ai items, and unobserved sources.');
