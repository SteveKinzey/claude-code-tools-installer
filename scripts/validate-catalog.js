#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const desktopCatalog = JSON.parse(fs.readFileSync(path.join(root, 'desktop', 'catalog.json'), 'utf8'));
const macScript = fs.readFileSync(path.join(root, 'setup-my-claude.sh'), 'utf8');
const linuxScript = fs.readFileSync(path.join(root, 'setup-my-claude-linux.sh'), 'utf8');
const windowsScript = fs.readFileSync(path.join(root, 'setup-my-claude.ps1'), 'utf8');

function unique(values) {
  return [...new Set(values)].sort();
}

function bashIds(script) {
  return unique([...script.matchAll(/^([a-z0-9-]+)\|[^\n]+$/gm)].map((match) => match[1]));
}

function windowsIds(script) {
  return unique([...script.matchAll(/\bId="([a-z0-9-]+)"/g)].map((match) => match[1]));
}

function compare(label, expected, actual) {
  const missing = expected.filter((id) => !actual.includes(id));
  const extra = actual.filter((id) => !expected.includes(id));
  if (missing.length || extra.length) {
    throw new Error(`${label} catalog mismatch. Missing: ${missing.join(', ') || 'none'}. Extra: ${extra.join(', ') || 'none'}.`);
  }
}

const desktopIds = unique(desktopCatalog.map((tool) => tool.id));
if (desktopIds.length !== desktopCatalog.length) {
  throw new Error('The desktop catalog contains duplicate IDs.');
}

compare('macOS', desktopIds, bashIds(macScript));
compare('Linux', desktopIds, bashIds(linuxScript));
compare('Windows', desktopIds, windowsIds(windowsScript));

const defaultIds = desktopCatalog.filter((tool) => tool.default).map((tool) => tool.id).sort();
const measuredTools = desktopCatalog.filter((tool) => tool.metric);
for (const tool of measuredTools) {
  const metric = tool.metric;
  if (metric.label !== 'Installs' || !Number.isInteger(metric.value) || metric.value <= 0) {
    throw new Error(`The popularity metric for ${tool.name} must be a positive whole-number install count.`);
  }
  if (!/^https:\/\/claude\.com\/plugins\//.test(metric.sourceUrl) || !/^\d{4}-\d{2}-\d{2}$/.test(metric.retrievedAt)) {
    throw new Error(`The popularity metric for ${tool.name} needs an official Anthropic plugin source URL and YYYY-MM-DD retrieval date.`);
  }
}
console.log(`Catalog parity passed: ${desktopIds.length} tools; ${defaultIds.length} recommended defaults.`);
console.log(`Popularity provenance passed: ${measuredTools.length} official install metrics with source URLs and retrieval dates.`);
