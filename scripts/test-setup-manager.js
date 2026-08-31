#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-setup-manager-test-'));
const home = path.join(tempRoot, 'home');
const project = path.join(tempRoot, 'project');
const sourceSkill = path.join(tempRoot, 'my-skill');
const handlers = new Map();
let readyCallback;

const electronStub = {
  app: {
    getPath: (name) => name === 'home' ? home : tempRoot,
    isPackaged: false,
    whenReady: () => ({ then: (callback) => { readyCallback = callback; } }),
    on: () => {},
    quit: () => {},
  },
  BrowserWindow: class {
    static getAllWindows() { return []; }
    constructor() { this.webContents = { send: () => {} }; }
    async loadFile() {}
    isDestroyed() { return false; }
  },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') return electronStub;
  return originalLoad.call(this, request, parent, isMain);
};

async function writeSkill(folder, name) {
  await fsp.mkdir(folder, { recursive: true });
  await fsp.writeFile(path.join(folder, 'SKILL.md'), `# ${name}\n`, 'utf8');
}

async function run() {
  await fsp.mkdir(home, { recursive: true });
  await fsp.mkdir(project, { recursive: true });
  await writeSkill(path.join(home, '.claude', 'skills', 'duplicate-skill'), 'Duplicate');
  await writeSkill(path.join(project, '.claude', 'skills', 'duplicate-skill'), 'Duplicate');
  await writeSkill(sourceSkill, 'My skill');
  await fsp.mkdir(path.join(home, '.claude'), { recursive: true });
  await fsp.writeFile(path.join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'review-tool@marketplace': true } }), 'utf8');

  require(path.join(root, 'desktop', 'src', 'main.js'));
  await readyCallback();

  const reviewCustom = handlers.get('setup-manager:review-custom');
  const applyCustom = handlers.get('setup-manager:apply-custom');
  const discover = handlers.get('setup-manager:discover');
  const reviewCleanup = handlers.get('setup-manager:review-cleanup');
  const applyCleanup = handlers.get('setup-manager:apply-cleanup');
  const reviewPluginChange = handlers.get('setup-manager:review-plugin-change');
  const applyPluginChange = handlers.get('setup-manager:apply-plugin-change');

  assert.ok(reviewCustom && applyCustom && discover && reviewCleanup && applyCleanup && reviewPluginChange && applyPluginChange, 'all setup-manager handlers should be registered');

  const missingProject = await reviewCustom(null, { source: sourceSkill, scope: 'project', projectPath: '' });
  assert.equal(missingProject.ok, false);
  assert.match(missingProject.error, /Choose a project folder/);

  const invalidSource = await reviewCustom(null, { source: path.join(tempRoot, 'missing'), scope: 'user' });
  assert.equal(invalidSource.ok, false);

  const githubSource = await reviewCustom(null, { source: 'owner/trusted-marketplace', scope: 'project', projectPath: project });
  assert.equal(githubSource.ok, true);
  assert.equal(githubSource.kind, 'marketplace');
  assert.equal(githubSource.scope, 'user');
  assert.match(githubSource.description, /after one final confirmation/);
  assert.doesNotMatch(githubSource.description, /checklist|terminal|PowerShell/i);

  const report = await discover(null, { projectPath: project });
  assert.ok(report.discoveryId, 'a discovery session is required for cleanup');
  assert.equal(report.duplicates.length, 1);
  const userSkill = report.findings.find((item) => item.type === 'skill' && item.scope === 'Just you');
  assert.ok(userSkill, 'the user skill should be found');
  const userPlugin = report.findings.find((item) => item.type === 'plugin' && item.scope === 'Just you');
  assert.ok(userPlugin, 'a user-scope plugin should be found');
  const forgedPlugin = await reviewPluginChange(null, { discoveryId: report.discoveryId, findingId: 'plugin:/etc', action: 'disable' });
  assert.equal(forgedPlugin.ok, false);
  const pluginPlan = await reviewPluginChange(null, { discoveryId: report.discoveryId, findingId: userPlugin.id, action: 'disable' });
  assert.equal(pluginPlan.ok, true);
  assert.equal(pluginPlan.scope, 'Just you');
  assert.match(pluginPlan.description, /does not uninstall/i);

  const forgedCleanup = await reviewCleanup(null, { discoveryId: report.discoveryId, findingId: 'skill:/etc' });
  assert.equal(forgedCleanup.ok, false);

  const cleanupPlan = await reviewCleanup(null, { discoveryId: report.discoveryId, findingId: userSkill.id });
  assert.equal(cleanupPlan.ok, true);
  assert.match(cleanupPlan.destination, /disabled-skills/);
  const cleanupResult = await applyCleanup(null, { reviewId: cleanupPlan.reviewId });
  assert.equal(cleanupResult.ok, true);
  await assert.rejects(fsp.access(userSkill.path));
  await fsp.access(path.join(cleanupPlan.destination, 'SKILL.md'));

  const copyReview = await reviewCustom(null, { source: sourceSkill, scope: 'project', projectPath: project });
  assert.equal(copyReview.ok, true);
  assert.equal(copyReview.kind, 'skill-copy');
  assert.equal(copyReview.destination, path.join(project, '.claude', 'skills', 'my-skill'));
  const copyResult = await applyCustom(null, { source: sourceSkill, scope: 'project', projectPath: project });
  assert.equal(copyResult.ok, true);
  await fsp.access(path.join(copyReview.destination, 'SKILL.md'));
  await fsp.access(path.join(sourceSkill, 'SKILL.md'));

  console.log('Setup-manager behavior passed: discovery sessions, backup-only cleanup, reviewed custom additions, and opaque plugin-change reviews are enforced.');
}

run().finally(async () => {
  Module._load = originalLoad;
  await fsp.rm(tempRoot, { recursive: true, force: true });
}).catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
