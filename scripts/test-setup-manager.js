#!/usr/bin/env node
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
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
let saveDialogResult = { canceled: true, filePath: '' };
let openDialogResult = { canceled: true, filePaths: [] };
const notifications = [];

class NotificationStub {
  static isSupported() { return true; }
  constructor(options) { this.options = options; notifications.push(options); }
  on() { return this; }
  show() { this.shown = true; }
}

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
  dialog: { showOpenDialog: async () => openDialogResult, showSaveDialog: async () => saveDialogResult },
  shell: { showItemInFolder: () => true, openPath: async () => '' },
  Notification: NotificationStub,
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
  const previewComponents = handlers.get('components:preview');
  const reviewAppUninstall = handlers.get('app:review-uninstall');
  const exportInstallationManifest = handlers.get('app:export-installation-manifest');
  const openManifestFolder = handlers.get('app:open-manifest-folder');
  const getManifestVerificationCommand = handlers.get('app:get-manifest-verification-command');
  const verifyInstallationManifest = handlers.get('app:verify-installation-manifest');
  const verifyDroppedInstallationManifest = handlers.get('app:verify-dropped-installation-manifest');
  const compareInstallationManifests = handlers.get('app:compare-installation-manifests');
  const applyAppUninstall = handlers.get('app:apply-uninstall');

  assert.ok(reviewCustom && applyCustom && discover && reviewCleanup && applyCleanup && reviewPluginChange && applyPluginChange && previewComponents && reviewAppUninstall && exportInstallationManifest && openManifestFolder && getManifestVerificationCommand && verifyInstallationManifest && verifyDroppedInstallationManifest && compareInstallationManifests && applyAppUninstall, 'all handlers including app uninstall and manifest verification should be registered');

  const componentCatalog = JSON.parse(await fsp.readFile(path.join(root, 'desktop', 'convex-components.json'), 'utf8'));
  const componentPreview = await previewComponents(null, { projectPath: project, componentIds: [componentCatalog.components[0].id] });
  assert.equal(componentPreview.ok, true);
  assert.equal(componentPreview.packageState, 'missing');
  assert.match(componentPreview.note, /create package\.json/i);
  await assert.rejects(fsp.access(path.join(project, 'package.json')));

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
  assert.ok(report.findings.some((item) => item.type === 'attention' && item.name === 'Project package file will be created when needed' && item.scope === 'This project'), 'the inventory should explain automatic package initialization for a selected project');
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

  
  // Verify app uninstallation behavior
  const fakeCctiDir = path.join(home, '.setup-my-claude');
  await fsp.mkdir(fakeCctiDir, { recursive: true });
  await fsp.writeFile(path.join(fakeCctiDir, 'test-ccti.json'), JSON.stringify({ active: true }), 'utf8');

  const manifestPath = path.join(tempRoot, 'ccti-installation-manifest.md');
  saveDialogResult = { canceled: false, filePath: manifestPath };
  const manifestResult = await exportInstallationManifest();
  assert.equal(manifestResult.ok, true, 'installation manifest export should succeed');
  assert.equal(manifestResult.filename, 'ccti-installation-manifest.md');
  const manifestText = await fsp.readFile(manifestPath, 'utf8');
  assert.match(manifestText, /review-tool@marketplace/);
  assert.ok(!manifestText.includes(tempRoot), 'manifest must omit private absolute paths');
  assert.match(manifestText, /does not contain credentials/i);
  assert.match(manifestText, /Payload SHA-256: [0-9a-f]{64}/i, 'manifest must include a SHA-256 checksum');
  assert.match(manifestText, /Export timestamp:/, 'manifest must include export timestamp');
  const recordedDigest = manifestText.match(/Payload SHA-256: ([0-9a-f]{64})/i)?.[1];
  const payloadOffset = manifestText.indexOf('## Manifest payload\n');
  assert.ok(recordedDigest && payloadOffset >= 0, 'manifest must identify a canonical payload to verify');
  const calculatedDigest = createHash('sha256').update(manifestText.slice(payloadOffset), 'utf8').digest('hex');
  assert.equal(calculatedDigest, recordedDigest, 'manifest SHA-256 digest must cover the exact exported payload');

  const folderOpenResult = await openManifestFolder();
  assert.equal(folderOpenResult.ok, true, 'openManifestFolder should succeed after export');
  const verificationCommand = await getManifestVerificationCommand();
  assert.equal(verificationCommand.ok, true, 'manifest verification command should be available');
  assert.match(verificationCommand.command, /Manifest payload|Payload SHA-256/);

  openDialogResult = { canceled: false, filePaths: [manifestPath] };
  const manifestVerification = await verifyInstallationManifest();
  assert.equal(manifestVerification.ok, true, 'exported manifest should be readable for local verification');
  assert.equal(manifestVerification.matched, true, 'exported manifest payload must match its checksum');
  await fsp.appendFile(manifestPath, 'changed after export\n', 'utf8');
  const tamperedVerification = await verifyInstallationManifest();
  assert.equal(tamperedVerification.ok, true, 'tampered manifest should still be readable');
  assert.equal(tamperedVerification.matched, false, 'tampered manifest payload must fail checksum verification');

  const comparisonBeforePath = path.join(tempRoot, 'comparison-before.md');
  const comparisonAfterPath = path.join(tempRoot, 'comparison-after.md');
  const makeManifest = (tools, { generatedAt, unix, claudeVersion } = {}) => {
    const payload = `## Manifest payload\n\nGenerated: ${generatedAt || '2026-09-10T00:00:00.000Z'} (Unix: ${unix || 1788998400})\nPlatform: test\nCCTI version: test\n\n## Privacy boundary\n\nNo private paths.\n\n## External developer tool\n\n- Claude Code: ${claudeVersion || 'test'}\n\n## Active tools and additions\n\n${tools.map((tool) => `- ${tool}`).join('\n')}\n\n## Uninstall boundary\n\nCCTI-only data is removable.\n`;
    const digest = createHash('sha256').update(payload, 'utf8').digest('hex');
    return `# CCTI installation manifest\n\n## Integrity\n\n- Export timestamp: 2026-09-10T00:00:00.000Z\n- Payload SHA-256: ${digest}\n\n${payload}`;
  };
  await fsp.writeFile(comparisonBeforePath, makeManifest(['Tool Alpha (tool · This computer)', 'Tool Removed (skill · This computer)'], { unix: 1788998400, claudeVersion: '1.0.0' }), 'utf8');
  await fsp.writeFile(comparisonAfterPath, makeManifest(['Tool Alpha (tool · This computer)', 'Tool Added (plugin · This computer)'], { generatedAt: '2026-09-11T00:00:00.000Z', unix: 1789084800, claudeVersion: '2.0.0' }), 'utf8');
  const droppedVerification = await verifyDroppedInstallationManifest(null, { filePath: comparisonBeforePath });
  assert.equal(droppedVerification.ok, true, 'a user-dropped manifest path should be verified through the narrow main-process handler');
  assert.equal(droppedVerification.matched, true, 'an untouched dropped manifest must pass checksum verification');
  openDialogResult = { canceled: false, filePaths: [comparisonAfterPath, comparisonBeforePath] };
  const comparison = await compareInstallationManifests();
  assert.equal(comparison.ok, true, 'two verified manifests should compare successfully');
  assert.equal(comparison.ordering, 'export-timestamp', 'manifests must be compared chronologically rather than in file-picker order');
  assert.equal(comparison.beforeFilename, 'comparison-before.md');
  assert.equal(comparison.afterFilename, 'comparison-after.md');
  assert.deepEqual(comparison.added, ['Tool Added (plugin · This computer)']);
  assert.deepEqual(comparison.removed, ['Tool Removed (skill · This computer)']);
  assert.deepEqual(comparison.unchanged, ['Tool Alpha (tool · This computer)'], 'external Claude Code version changes are excluded from the active additions diff');
  await fsp.appendFile(comparisonAfterPath, 'tampered\n', 'utf8');
  const rejectedComparison = await compareInstallationManifests();
  assert.equal(rejectedComparison.ok, false, 'comparison must reject a manifest that no longer passes checksum verification');

  const uninstallReview = await reviewAppUninstall();
  assert.equal(uninstallReview.ok, true, 'reviewAppUninstall should succeed');
  assert.ok(uninstallReview.reviewId, 'reviewId must be returned');
  assert.ok(uninstallReview.removable.some((item) => item.path === fakeCctiDir), 'CCTI state directory must be flagged for removal');
  assert.ok(uninstallReview.protected.some((p) => p.includes('Claude Code')), 'Claude Code must be in protected list');

  const badAck = await applyAppUninstall(null, { reviewId: uninstallReview.reviewId, confirmation: 'WRONG_CONFIRM' });
  assert.equal(badAck.ok, false, 'Invalid acknowledgment confirmation must be rejected');
  assert.match(badAck.error, /UNINSTALL CCTI/);
  await fsp.access(fakeCctiDir); // Must still exist

  const goodAck = await applyAppUninstall(null, { reviewId: uninstallReview.reviewId, confirmation: 'UNINSTALL CCTI' });
  assert.equal(goodAck.ok, true, 'Valid acknowledgment must trigger complete removal');
  assert.match(goodAck.cleanupGuidance, /Claude Code and your tools remain untouched/i, 'cleanup guidance must preserve the named protected boundary');
  if (process.platform === 'darwin') assert.match(goodAck.cleanupGuidance, /Applications.*Trash/i, 'macOS cleanup guidance must describe the Applications-to-Trash step');
  else if (process.platform === 'win32') assert.match(goodAck.cleanupGuidance, /Installed apps|empty extracted/i, 'Windows cleanup guidance must describe the installed-apps or extracted-folder step');
  else assert.match(goodAck.cleanupGuidance, /empty/i, 'Linux cleanup guidance must describe the empty extracted-folder step');
  assert.ok(notifications.some((notification) => /CCTI app data removed/.test(notification.title) && /Claude Code/.test(notification.body)), 'a native cleanup notification should be queued');
  await assert.rejects(fsp.access(fakeCctiDir), 'CCTI state folder should be completely deleted');
  // Claude Code and skills must still exist untouched
  await fsp.access(path.join(home, '.claude'));
  await fsp.access(path.join(home, '.claude', 'settings.json'));

  console.log('Setup-manager and App Uninstall behavior passed: complete removal without affecting Claude Code is verified.');
}

run().finally(async () => {
  Module._load = originalLoad;
  await fsp.rm(tempRoot, { recursive: true, force: true });
}).catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
