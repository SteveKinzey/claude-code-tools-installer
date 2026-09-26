// Catalog items whose install leaves something the inventory can observe: a
// skill folder, a Claude Code plugin, or an MCP connection. Everything else CCTI
// installs (reference clones, npm globals, marketplaces) is not tracked. Keys must
// match the adapters and reviewedPluginPlans in main.js; the
// test-inventory-tracked-items.js check enforces that.

const TRACKED_ITEMS = Object.freeze({
  ponytail: Object.freeze({ kind: 'skill', key: 'ponytail' }),
  gstack: Object.freeze({ kind: 'skill', key: 'gstack' }),
  'taste-skill': Object.freeze({ kind: 'skill', key: 'design-taste-frontend' }),
  'planning-with-files': Object.freeze({ kind: 'skill', key: 'planning-with-files' }),
  graphify: Object.freeze({ kind: 'skill', key: 'graphify' }),
  repomix: Object.freeze({ kind: 'mcp', key: 'repomix' }),
  'playwright-mcp': Object.freeze({ kind: 'mcp', key: 'playwright' }),
  superpowers: Object.freeze({ kind: 'plugin', key: 'superpowers@superpowers-marketplace' }),
  ecc: Object.freeze({ kind: 'plugin', key: 'ecc@ecc' }),
  'wshobson-agents': Object.freeze({ kind: 'plugin', key: 'claude-code-essentials' }),
  'frontend-design': Object.freeze({ kind: 'plugin', key: 'frontend-design@claude-plugins-official' }),
  'code-review': Object.freeze({ kind: 'plugin', key: 'code-review@claude-plugins-official' }),
  context7: Object.freeze({ kind: 'plugin', key: 'context7@claude-plugins-official' }),
  'skill-creator': Object.freeze({ kind: 'plugin', key: 'skill-creator@claude-plugins-official' }),
  convex: Object.freeze({ kind: 'plugin', key: 'convex@claude-plugins-official' }),
  'claude-hud': Object.freeze({ kind: 'plugin', key: 'claude-hud' }),
});

function trackedItem(id) {
  return Object.prototype.hasOwnProperty.call(TRACKED_ITEMS, id) ? TRACKED_ITEMS[id] : null;
}

module.exports = { TRACKED_ITEMS, trackedItem };
