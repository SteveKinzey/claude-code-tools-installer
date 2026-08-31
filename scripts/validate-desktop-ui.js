#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'desktop', 'src', 'renderer', 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'desktop', 'src', 'renderer', 'app.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'desktop', 'src', 'preload.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'desktop', 'src', 'main.js'), 'utf8');

const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const selectorIds = new Set([...renderer.matchAll(/querySelector\(['"]#([^'"]+)['"]\)/g)].map((match) => match[1]));
const missingIds = [...selectorIds].filter((id) => !ids.has(id));
if (missingIds.length) throw new Error(`Renderer selectors with no HTML ID: ${missingIds.join(', ')}.`);

const calledMethods = new Set([...renderer.matchAll(/window\.installer\.([A-Za-z0-9_]+)/g)].map((match) => match[1]));
const exposedMethods = new Set([...preload.matchAll(/^\s{2}([A-Za-z0-9_]+):/gm)].map((match) => match[1]));
const missingBridgeMethods = [...calledMethods].filter((method) => !exposedMethods.has(method));
if (missingBridgeMethods.length) throw new Error(`Renderer calls missing preload methods: ${missingBridgeMethods.join(', ')}.`);

const componentCatalogResource = /from": "convex-components\.json",\s*"to": "convex-components\.json"/.test(fs.readFileSync(path.join(root, 'desktop', 'package.json'), 'utf8'));
if (!componentCatalogResource) throw new Error('Component catalog is missing from the packaged resource list.');

for (const asset of ['StoreLogo.png', 'Square44x44Logo.png', 'Square150x150Logo.png', 'Wide310x150Logo.png']) {
  if (!fs.existsSync(path.join(root, 'desktop', 'build', 'appx', asset))) throw new Error(`Missing required Microsoft Store AppX asset: ${asset}.`);
}

for (const channel of [
  'claude:install-only',
  'setup:complete',
  'components:get',
  'components:choose-project',
  'components:preview',
  'components:install',
  'telemetry:report-setup-success',
  'compass:status',
  'compass:ask',
  'setup-manager:choose-project',
  'setup-manager:discover',
  'setup-manager:choose-custom-source',
  'setup-manager:review-custom',
  'setup-manager:apply-custom',
  'setup-manager:review-cleanup',
  'setup-manager:apply-cleanup',
  'setup-manager:review-plugin-change',
  'setup-manager:apply-plugin-change',
]) {
  if (!main.includes(`'${channel}'`)) throw new Error(`Missing main-process handler for ${channel}.`);
}

if (renderer.includes('startBootstrap') || preload.includes('startBootstrap') || main.includes("'bootstrap:start'")) {
  throw new Error('The user-facing Claude Code check must not use the background bootstrap-only path.');
}
if (!renderer.includes('installClaudeOnly') || !main.includes("spawnInstaller('claude-only')") || !main.includes("option('-ClaudeOnly', '--claude-only')")) {
  throw new Error('The in-app Claude-only installation path must wait for the official installer and re-check the result.');
}
if (!renderer.includes("setAttribute('role', 'switch')") || !renderer.includes("toggle.textContent = state.selected.has(tool.id) ? 'On' : 'Off'")) {
  throw new Error('Curated extra tools must use clear accessible On/Off controls.');
}
if (!main.includes('const reviewedPluginPlans') || !main.includes('installReviewedPlugins(selectedIds)') || !main.includes("runProcess('claude', args")) {
  throw new Error('Supported fixed plugin choices must run inside CCTI after the approved tool plan succeeds.');
}
if (!main.includes('const reviewedPluginChanges') || !main.includes("['plugin', plan.action, plan.name, '--scope', plan.scope]") || !renderer.includes("reviewAndApplyPluginChange(item, action)")) {
  throw new Error('Installed plugin changes must use a reviewed, scope-aware Electron action rather than renderer shell access.');
}
if (!html.includes('aria-busy="false"') || !renderer.includes("runStatusElement.classList.add('is-loading')") || !renderer.includes("runStatusElement.setAttribute('aria-busy', 'true')") || !fs.readFileSync(path.join(root, 'desktop', 'src', 'renderer', 'styles.css'), 'utf8').includes('prefers-reduced-motion')) {
  throw new Error('Extra installation must show an accessible loading state that respects reduced-motion preferences.');
}
for (const adapter of ['setup-my-claude.ps1', 'setup-my-claude.sh', 'setup-my-claude-linux.sh']) {
  const source = fs.readFileSync(path.join(root, adapter), 'utf8');
  const claudeOnlyOption = adapter.endsWith('.ps1') ? source.includes('-ClaudeOnly') : source.includes('--claude-only');
  if (!claudeOnlyOption || !source.includes('Ensure-ClaudeReady') && !source.includes('ensure_claude_ready')) {
    throw new Error(`${adapter} must support the Claude-only mode and wait for Claude Code readiness.`);
  }
}

if (preload.includes('connectCompass') || preload.includes('disconnectCompass') || main.includes("'compass:connect'") || main.includes("'compass:disconnect'")) {
  throw new Error('Visitor-owned Compass API-key handlers must not be present.');
}

if (!main.includes('reportAnonymousSetupSuccess') || !main.includes("JSON.stringify({ '0': { json: { kind, consent: true } } })") || !html.includes('no name, email, device ID, folder path, tool list, log, or event ID')) {
  throw new Error('Anonymous success telemetry must remain explicit and payload-minimal.');
}

console.log(`Desktop UI contract passed: ${selectorIds.size} renderer IDs and ${calledMethods.size} secure bridge methods verified.`);
