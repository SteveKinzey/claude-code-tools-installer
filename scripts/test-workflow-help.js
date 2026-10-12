#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const helperPath = path.join(root, 'desktop', 'src', 'renderer', 'workflow-help.js');
const rendererPath = path.join(root, 'desktop', 'src', 'renderer', 'app.js');
const htmlPath = path.join(root, 'desktop', 'src', 'renderer', 'index.html');

delete globalThis.CCTIWorkflowHelp;
require(helperPath);
const help = globalThis.CCTIWorkflowHelp;
assert.ok(help && typeof help.answerQuestion === 'function', 'Desktop must expose the bundled private workflow helper.');

const recovery = help.answerQuestion('How do I recover GitHub and gstack after Complete setup?');
assert.match(recovery, /Complete setup/);
assert.match(recovery, /Verify setup/);
assert.match(recovery, /gstack is reported as unavailable on Windows/);
assert.doesNotMatch(recovery, /GitHub connection/i, 'Recovery must win over a catalog suggestion.');

assert.match(help.answerQuestion('Should gstack use global or project scope?'), /taste-skill and Planning with Files/);
assert.match(help.answerQuestion('Can I restore a backup over an active skill?'), /does not overwrite an active folder/);
assert.match(help.answerQuestion('What happens if my duplicate review expired?'), /check again and make a fresh review/);
assert.match(help.answerQuestion('Does Start fresh make a backup?'), /no automatic backup/);
assert.match(help.answerQuestion('How do I permanently delete turned-off copies?'), /exact word DELETE/);
assert.match(help.answerQuestion('How do I permanently delete turned-off copies?'), /irreversible/);

const manifest = help.answerQuestion('Can I save, drop, and compare two checksummed manifest files?');
assert.match(manifest, /Save Installation Manifest/);
assert.match(manifest, /Choose Manifest and Verify/);
assert.match(manifest, /Drop a saved manifest here to verify/);
assert.match(manifest, /Compare Two Saved Manifests/);
assert.match(manifest, /both must be readable and pass their recorded checksums/);
assert.match(manifest, /does not include credentials, raw settings, logs, or absolute folder paths/);

const uninstall = help.answerQuestion('Does Uninstall This App remove Claude Code too?');
assert.match(uninstall, /exact confirmation UNINSTALL CCTI/);
assert.match(uninstall, /leaves the Claude Code CLI/);
assert.match(uninstall, /Remove Claude Code from this computer is a separate action/);
assert.match(uninstall, /does not remove Claude Desktop, browser data, or other Anthropic apps/);

const packageRemoval = help.answerQuestion('How do I remove a project package or managed extras?');
assert.match(packageRemoval, /Check this computer with the project selected/);
assert.match(packageRemoval, /REMOVE PROJECT PACKAGE exactly/);
assert.match(packageRemoval, /package scripts stay disabled/);
assert.match(packageRemoval, /separately managed items remain for manual review/);
for (const question of ['How do I uninstall a project package?', 'Can I uninstall managed extras?']) {
  assert.equal(help.answerQuestion(question), help.answers.removal, `${question} must not route to app uninstall`);
}
for (const question of ['How do I uninstall CCTI?', 'How do I uninstall Claude Code?', 'CCTI uninstall steps']) {
  assert.equal(help.answerQuestion(question), help.answers.uninstall);
}
assert.equal(help.answerQuestion('How do I uninstall Python?'), null, 'an unrelated uninstall must not imply app-removal guidance');

const customAddOn = help.answerQuestion('How do I review a custom add-on source?');
assert.match(customAddOn, /direct local folder containing SKILL.md/);
assert.match(customAddOn, /trusted HTTPS marketplace link ending in marketplace.json/);
assert.match(customAddOn, /Review this add-on/);
assert.match(customAddOn, /not a plugin from it/);

const missingClaude = help.answerQuestion('Claude Code is not found. Should I run Diagnostics?');
assert.match(missingClaude, /Yes, install Claude Code/);
assert.match(missingClaude, /official installer/);
assert.match(missingClaude, /Run Diagnostics is a separate local path and runtime check/);
assert.match(missingClaude, /does not install or change Claude Code/);

assert.match(help.answerQuestion('How do Linux updates work?'), /manual update checks/);
assert.match(help.answerQuestion('Where are diagnostics?'), /Run Diagnostics/);
assert.match(help.answerQuestion('Can online Compass install this remotely?'), /never authorizes a remote install/);

const app = fs.readFileSync(rendererPath, 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8');
assert.ok(app.indexOf('const workflowAnswer = getWorkflowHelpApi().answerQuestion(question);') < app.indexOf('if (/compare|overlap|versus'), 'Desktop workflow answers must run before comparisons.');
assert.match(app, /function minimizeCompass\(\)[\s\S]*state\.compass\.invoker[\s\S]*focus/);
assert.match(app, /function closeComponentLibrary\(\)[\s\S]*componentLibraryInvoker[\s\S]*focus/);
assert.ok(html.indexOf('src="workflow-help.js"') < html.indexOf('src="app.js"'), 'The helper must load before app.js.');
assert.match(html, /Consent does not authorize remote installation, commands, configuration changes, or access to credentials/);
assert.match(html, /aria-controls="compass-panel" aria-expanded="false"/);
assert.match(html, /aria-controls="component-library" aria-expanded="false"/);

console.log('workflow help checks passed');
