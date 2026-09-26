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
const duplicateSourceSkill = path.join(tempRoot, 'duplicate-skill');
const linkedSkill = path.join(home, '.claude', 'skills', 'linked-skill');
const linkedSkillTarget = path.join(tempRoot, 'linked-skill-shared-section.md');
const fakeClaudeLog = path.join(tempRoot, 'fake-claude.log');
const handlers = new Map();
let readyCallback;
let saveDialogResult = { canceled: true, filePath: '' };
let openDialogResult = { canceled: true, filePaths: [] };
const notifications = [];
const originalAppData = process.env.APPDATA;
const originalLocalAppData = process.env.LOCALAPPDATA;

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

const spawnLog = [];
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') return electronStub;
  return originalLoad.call(this, request, parent, isMain);
};

async function writeSkill(folder, name, { contents, files = {} } = {}) {
  await fsp.mkdir(folder, { recursive: true });
  await fsp.writeFile(path.join(folder, 'SKILL.md'), contents || `# ${name}\n`, 'utf8');
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(folder, relativePath);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, content, 'utf8');
  }
}

async function run() {
  await fsp.mkdir(home, { recursive: true });
  await fsp.mkdir(project, { recursive: true });
  await writeSkill(path.join(home, '.claude', 'skills', 'duplicate-skill'), 'Duplicate');
  await writeSkill(path.join(project, '.claude', 'skills', 'duplicate-skill'), 'Duplicate');
  await writeSkill(path.join(home, '.claude', 'skills', 'bulk-duplicate-skill'), 'Bulk duplicate');
  await writeSkill(path.join(project, '.claude', 'skills', 'bulk-duplicate-skill'), 'Bulk duplicate');
  await fsp.utimes(path.join(home, '.claude', 'skills', 'bulk-duplicate-skill', 'SKILL.md'), new Date('2026-01-15T10:00:00.000Z'), new Date('2026-01-15T10:00:00.000Z'));
  await fsp.utimes(path.join(project, '.claude', 'skills', 'bulk-duplicate-skill', 'SKILL.md'), new Date('2026-08-15T10:00:00.000Z'), new Date('2026-08-15T10:00:00.000Z'));
  await writeSkill(path.join(home, '.claude', 'skills', 'project-backup-skill'), 'Project backup');
  await writeSkill(path.join(project, '.claude', 'skills', 'project-backup-skill'), 'Project backup');
  await fsp.utimes(path.join(home, '.claude', 'skills', 'project-backup-skill', 'SKILL.md'), new Date('2026-09-15T10:00:00.000Z'), new Date('2026-09-15T10:00:00.000Z'));
  await fsp.utimes(path.join(project, '.claude', 'skills', 'project-backup-skill', 'SKILL.md'), new Date('2026-01-15T10:00:00.000Z'), new Date('2026-01-15T10:00:00.000Z'));
  await writeSkill(path.join(home, '.claude', 'skills', 'same-name-different-content'), 'Same name global', { contents: '# Global instructions\n' });
  await writeSkill(path.join(project, '.claude', 'skills', 'same-name-different-content'), 'Same name project', { contents: '# Project instructions\n' });
  await writeSkill(linkedSkill, 'Linked skill');
  await fsp.writeFile(linkedSkillTarget, 'Shared linked section\n', 'utf8');
  await fsp.symlink(linkedSkillTarget, path.join(linkedSkill, 'shared-section.md'));
  const hashCollision = { contents: '# Same instructions\n', files: { 'references/guide.md': 'Identical guide\n' } };
  await writeSkill(path.join(home, '.claude', 'skills', 'global-revenue-playbook'), 'Global revenue playbook', hashCollision);
  await writeSkill(path.join(project, '.claude', 'skills', 'local-gtm-playbook'), 'Local go-to-market playbook', hashCollision);
  await fsp.utimes(path.join(home, '.claude', 'skills', 'global-revenue-playbook', 'SKILL.md'), new Date('2026-02-15T10:00:00.000Z'), new Date('2026-02-15T10:00:00.000Z'));
  await fsp.utimes(path.join(project, '.claude', 'skills', 'local-gtm-playbook', 'SKILL.md'), new Date('2026-09-15T10:00:00.000Z'), new Date('2026-09-15T10:00:00.000Z'));
  await writeSkill(sourceSkill, 'My skill');
  await writeSkill(duplicateSourceSkill, 'Duplicate source');
  await fsp.mkdir(path.join(home, '.claude'), { recursive: true });
  await fsp.writeFile(path.join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'review-tool@marketplace': true, 'frontend-design@claude-plugins-official': true } }), 'utf8');
  const fakeClaudePath = process.platform === 'win32'
    ? path.join(tempRoot, 'appdata', 'npm', 'claude.cmd')
    : path.join(home, '.local', 'bin', 'claude');
  const fakeClaudeContents = process.platform === 'win32'
    ? [
      '@echo off',
      `echo %*>>${JSON.stringify(fakeClaudeLog)}`,
      'if "%1"=="--version" (echo claude test& exit /b 0)',
      'if "%1"=="plugin" if "%2"=="list" (echo frontend-design@claude-plugins-official enabled& exit /b 0)',
      'if "%1"=="mcp" if "%2"=="list" (echo shared-connection& echo shared-connection& exit /b 0)',
      'exit /b 0',
      '',
    ].join('\r\n')
    : [
      '#!/bin/sh',
      `printf '%s\\n' "$*" >> ${JSON.stringify(fakeClaudeLog)}`,
      'if [ "$1" = "--version" ]; then echo "claude test"; exit 0; fi',
      'if [ "$1" = "plugin" ] && [ "$2" = "list" ]; then echo "frontend-design@claude-plugins-official enabled"; exit 0; fi',
      'if [ "$1" = "mcp" ] && [ "$2" = "list" ]; then echo "shared-connection"; echo "shared-connection"; exit 0; fi',
      'exit 0',
      '',
    ].join('\n');
  if (process.platform === 'win32') {
    process.env.APPDATA = path.join(tempRoot, 'appdata');
    process.env.LOCALAPPDATA = path.join(tempRoot, 'local-appdata');
  }
  await fsp.mkdir(path.dirname(fakeClaudePath), { recursive: true });
  await fsp.writeFile(fakeClaudePath, fakeClaudeContents, process.platform === 'win32' ? 'utf8' : { mode: 0o755 });

  // Records every process CCTI starts, so a test can prove a refused action never reached npm.
  const childProcess = require('node:child_process');
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = function recordingSpawn(command, args, options) {
    spawnLog.push({ command: String(command), args: Array.isArray(args) ? args.map(String) : [] });
    return originalSpawn.apply(this, arguments);
  };
  require(path.join(root, 'desktop', 'src', 'main.js'));
  await readyCallback();

  const reviewCustom = handlers.get('setup-manager:review-custom');
  const applyCustom = handlers.get('setup-manager:apply-custom');
  const discover = handlers.get('setup-manager:discover');
  const reviewCleanup = handlers.get('setup-manager:review-cleanup');
  const applyCleanup = handlers.get('setup-manager:apply-cleanup');
  const reviewAllDuplicates = handlers.get('setup-manager:review-all-duplicates');
  const applyAllDuplicates = handlers.get('setup-manager:apply-all-duplicates');
  const reviewAllSkillBackups = handlers.get('setup-manager:review-all-skill-backups');
  const applyAllSkillBackups = handlers.get('setup-manager:apply-all-skill-backups');
  const reviewSkillBackupReplacement = handlers.get('setup-manager:review-skill-backup-replacement');
  const applySkillBackupReplacement = handlers.get('setup-manager:apply-skill-backup-replacement');
  const reviewPluginChange = handlers.get('setup-manager:review-plugin-change');
  const applyPluginChange = handlers.get('setup-manager:apply-plugin-change');
  const reviewProjectPackageRemoval = handlers.get('setup-manager:review-project-package-removal');
  const applyProjectPackageRemoval = handlers.get('setup-manager:apply-project-package-removal');
  const reviewManagedExtrasRemoval = handlers.get('setup-manager:review-managed-extras-removal');
  const applyManagedExtrasRemoval = handlers.get('setup-manager:apply-managed-extras-removal');
  const runInstall = handlers.get('install:run');
  const previewComponents = handlers.get('components:preview');
  const reviewAppUninstall = handlers.get('app:review-uninstall');
  const exportInstallationManifest = handlers.get('app:export-installation-manifest');
  const openManifestFolder = handlers.get('app:open-manifest-folder');
  const getManifestVerificationCommand = handlers.get('app:get-manifest-verification-command');
  const verifyInstallationManifest = handlers.get('app:verify-installation-manifest');
  const verifyDroppedInstallationManifest = handlers.get('app:verify-dropped-installation-manifest');
  const compareInstallationManifests = handlers.get('app:compare-installation-manifests');
  const applyAppUninstall = handlers.get('app:apply-uninstall');
  const runDiagnostics = handlers.get('diagnostics:run');

  assert.ok(reviewCustom && applyCustom && discover && reviewCleanup && applyCleanup && reviewAllDuplicates && applyAllDuplicates && reviewPluginChange && applyPluginChange && reviewProjectPackageRemoval && applyProjectPackageRemoval && reviewManagedExtrasRemoval && applyManagedExtrasRemoval && runInstall && previewComponents && reviewAppUninstall && exportInstallationManifest && openManifestFolder && getManifestVerificationCommand && verifyInstallationManifest && verifyDroppedInstallationManifest && compareInstallationManifests && applyAppUninstall, 'all handlers including project package removal, CCTI-managed extras review, bulk duplicate cleanup and restore, app uninstall, and manifest verification should be registered');

  const componentCatalog = JSON.parse(await fsp.readFile(path.join(root, 'desktop', 'convex-components.json'), 'utf8'));
  const componentPreview = await previewComponents(null, { projectPath: project, componentIds: [componentCatalog.components[0].id] });
  assert.equal(componentPreview.ok, true);
  assert.equal(componentPreview.packageState, 'missing');
  assert.match(componentPreview.note, /create package\.json/i);
  await assert.rejects(fsp.access(path.join(project, 'package.json')));

  // Marketplace sources reach the claude command (cmd.exe on Windows); characters that quoting
  // cannot neutralize are refused with a plain next action.
  const percentMarketplace = await reviewCustom(null, { source: 'https://example.com/%PATH%/marketplace.json', scope: 'user' });
  assert.equal(percentMarketplace.ok, false, 'a marketplace link containing % must be refused');
  assert.match(percentMarketplace.error, /review it again/i);
  const bangMarketplaceFolder = path.join(tempRoot, 'market!place');
  await fsp.mkdir(path.join(bangMarketplaceFolder, '.claude-plugin'), { recursive: true });
  await fsp.writeFile(path.join(bangMarketplaceFolder, '.claude-plugin', 'marketplace.json'), '{}', 'utf8');
  const bangMarketplace = await reviewCustom(null, { source: bangMarketplaceFolder, scope: 'user' });
  assert.equal(bangMarketplace.ok, false, 'a local marketplace folder containing ! must be refused');
  assert.equal(bangMarketplace.reviewId, undefined);

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
  assert.ok(githubSource.reviewId, 'a custom marketplace review must issue an opaque apply token');
  if (process.platform !== 'win32') {
    await fsp.writeFile(fakeClaudeLog, '', 'utf8');
    const boundMarketplaceResult = await applyCustom(null, {
      reviewId: githubSource.reviewId,
      source: 'owner/different-marketplace',
      scope: 'project',
      projectPath: path.join(tempRoot, 'forged-project'),
    });
    assert.equal(boundMarketplaceResult.ok, true, 'the reviewed marketplace should remain applyable through its opaque token');
    const marketplaceCalls = await fsp.readFile(fakeClaudeLog, 'utf8');
    assert.match(marketplaceCalls, /plugin marketplace add owner\/trusted-marketplace/, 'apply must use the reviewed marketplace source');
    assert.doesNotMatch(marketplaceCalls, /different-marketplace/, 'editable renderer fields must not replace the reviewed marketplace source');
  }

  const report = await discover(null, { projectPath: project });
  assert.ok(report.discoveryId, 'a discovery session is required for cleanup');
  assert.ok(report.findings.some((item) => item.type === 'attention' && item.name === 'Project package file will be created when needed' && item.scope === 'This project'), 'the inventory should explain automatic package initialization for a selected project');
  assert.equal(report.duplicates.length, 5);
  const hashCollisionGroup = report.duplicates.find((group) => group.match === 'content-hash' && group.names.includes('global-revenue-playbook'));
  assert.ok(hashCollisionGroup, 'identical skill content with different folder names should be reported as a hash collision');
  assert.deepEqual(hashCollisionGroup.names, ['global-revenue-playbook', 'local-gtm-playbook']);
  assert.equal(hashCollisionGroup.items[0].contentHash, hashCollisionGroup.items[1].contentHash);
  assert.ok(hashCollisionGroup.items[0].files.some((file) => file.path === 'references/guide.md'), 'discovery should retain every verified file for the cleanup preview');
  const nameOverlapGroup = report.duplicates.find((group) => group.match === 'name' && group.name === 'same-name-different-content');
  assert.ok(nameOverlapGroup, 'same-name skill folders with different verified content should remain visible as an informational overlap');
  assert.notEqual(nameOverlapGroup.items[0].contentHash, nameOverlapGroup.items[1].contentHash, 'a name overlap must not be treated as matching content');
  // Review Focus: the settings.json record and Claude Code's own CLI report of the SAME plugin
  // ("frontend-design@claude-plugins-official") must never be treated as two overlapping copies.
  assert.ok(report.findings.some((item) => item.type === 'plugin' && item.name === 'frontend-design@claude-plugins-official' && item.id.startsWith('plugin:')), 'the settings.json record of the plugin should still be a finding');
  assert.ok(report.findings.some((item) => item.type === 'plugin' && item.name === 'frontend-design@claude-plugins-official' && item.id.startsWith('plugin-cli:')), 'the CLI report of the same plugin should still be a finding');
  assert.equal(report.duplicates.some((group) => group.type === 'plugin' && group.name === 'frontend-design@claude-plugins-official'), false, 'a CLI-sourced finding must never be grouped as a duplicate of its own settings.json record');
  if (report.findings.filter((item) => item.type === 'connection' && item.name === 'shared-connection' && item.scope === 'Claude Code').length !== 1) {
    const diagnostics = await runDiagnostics();
    console.error(JSON.stringify({
      diagnostic: 'setup-manager-cli-discovery',
      fakeClaudeExists: fs.existsSync(fakeClaudePath),
      appData: process.env.APPDATA || '',
      localAppData: process.env.LOCALAPPDATA || '',
      cliFindings: report.findings.filter((item) => item.scope === 'Claude Code').map((item) => ({ type: item.type, name: item.name })),
      claudeStatus: String(diagnostics.report || '').split('\n').filter((line) => /^(Status:|Resolved command:|PATH used by CCTI)/.test(line)),
    }));
  }
  assert.equal(report.findings.filter((item) => item.type === 'connection' && item.name === 'shared-connection' && item.scope === 'Claude Code').length, 1, 'repeated CLI output for the same location should produce one inventory item');
  const userSkill = report.findings.find((item) => item.type === 'skill' && item.scope === 'Just you' && item.name === 'duplicate-skill');
  assert.ok(userSkill, 'the user skill should be found');
  assert.match(userSkill.updatedAt, /^\d{4}-\d{2}-\d{2}T/, 'discovered skills should expose their SKILL.md last-edited time for a user-reviewed cleanup choice');
  const linkedSkillFinding = report.findings.find((item) => item.type === 'skill-link-excluded' && item.name === 'linked-skill');
  assert.ok(linkedSkillFinding, 'a skill with internal links should be shown as a cleanup exclusion, not a needs-attention finding');
  assert.match(linkedSkillFinding.description, /remains available to Claude Code/i);
  assert.match(linkedSkillFinding.description, /will not follow, compare, move, or delete linked files/i);
  assert.equal(report.duplicates.some((group) => group.items.some((item) => item.id === linkedSkillFinding.id)), false, 'linked skills must not enter duplicate grouping');
  const linkedSkillCleanup = await reviewCleanup(null, { discoveryId: report.discoveryId, findingId: linkedSkillFinding.id });
  assert.equal(linkedSkillCleanup.ok, false, 'linked skill cleanup exclusions must never receive a backup plan');
  await fsp.access(path.join(linkedSkill, 'SKILL.md'));
  await fsp.access(path.join(linkedSkill, 'shared-section.md'));
  const userPlugin = report.findings.find((item) => item.type === 'plugin' && item.scope === 'Just you');
  assert.ok(userPlugin, 'a user-scope plugin should be found');
  await fsp.writeFile(path.join(project, 'package.json'), JSON.stringify({
    name: 'checked-project',
    private: true,
    dependencies: { '@convex-dev/agent': '0.14.0' },
  }, null, 2), 'utf8');
  const packageReport = await discover(null, { projectPath: project });
  const projectPackage = packageReport.findings.find((item) => item.type === 'project-package' && item.name === '@convex-dev/agent');
  assert.ok(projectPackage, 'a selected project package should be available for a reviewed removal action');
  const forgedProjectPackageReview = await reviewProjectPackageRemoval(null, { discoveryId: packageReport.discoveryId, findingId: 'project-package:/etc:bad' });
  assert.equal(forgedProjectPackageReview.ok, false, 'project package removal must accept only the bounded checked finding');
  const expiredProjectPackageReview = await reviewProjectPackageRemoval(null, { discoveryId: packageReport.discoveryId, findingId: projectPackage.id });
  const originalDateNow = Date.now;
  Date.now = () => originalDateNow() + 10 * 60 * 1000 + 1;
  const expiredProjectPackageApply = await applyProjectPackageRemoval(null, { reviewId: expiredProjectPackageReview.reviewId, confirmation: 'REMOVE PROJECT PACKAGE' });
  Date.now = originalDateNow;
  assert.equal(expiredProjectPackageApply.ok, false, 'project package removal must reject a review that has expired');
  assert.match(expiredProjectPackageApply.error, /expired/i);
  const unchangedProjectManifest = JSON.parse(await fsp.readFile(path.join(project, 'package.json'), 'utf8'));
  assert.equal(unchangedProjectManifest.dependencies?.['@convex-dev/agent'], '0.14.0', 'an expired review must not change the project package file');
  const projectPackageReview = await reviewProjectPackageRemoval(null, { discoveryId: packageReport.discoveryId, findingId: projectPackage.id });
  assert.equal(projectPackageReview.ok, true, 'a checked project package should have a reviewed removal plan');
  assert.match(projectPackageReview.command, /^npm uninstall --ignore-scripts --no-audit --no-fund @convex-dev\/agent$/);
  const invalidProjectPackageApply = await applyProjectPackageRemoval(null, { reviewId: projectPackageReview.reviewId, confirmation: 'WRONG_CONFIRMATION' });
  assert.equal(invalidProjectPackageApply.ok, false, 'project package removal must require the explicit confirmation phrase');
  const projectPackageRemoval = await applyProjectPackageRemoval(null, { reviewId: projectPackageReview.reviewId, confirmation: 'REMOVE PROJECT PACKAGE' });
  assert.equal(projectPackageRemoval.ok, true, 'the confirmed reviewed project package should be removable with package scripts disabled');
  const changedProjectManifest = JSON.parse(await fsp.readFile(path.join(project, 'package.json'), 'utf8'));
  assert.equal(changedProjectManifest.dependencies?.['@convex-dev/agent'], undefined, 'project package removal must update only the selected project package file');
  // A malicious project can name a dependency so that cmd.exe on Windows would run a command
  // (`x&calc`). CCTI must refuse such a name before any npm call, on every platform.
  const hostileManifest = { name: 'checked-project', private: true, dependencies: { 'x&calc': '1.0.0' } };
  await fsp.writeFile(path.join(project, 'package.json'), JSON.stringify(hostileManifest, null, 2), 'utf8');
  const hostileReport = await discover(null, { projectPath: project });
  const hostilePackage = hostileReport.findings.find((item) => item.type === 'project-package' && item.name === 'x&calc');
  assert.ok(hostilePackage, 'the hostile dependency should still be listed so the user can see it');
  const spawnsBeforeHostile = spawnLog.length;
  const hostileReview = await reviewProjectPackageRemoval(null, { discoveryId: hostileReport.discoveryId, findingId: hostilePackage.id });
  assert.equal(hostileReview.ok, false, 'an invalid npm package name must be refused before removal');
  assert.match(hostileReview.error, /not a valid npm package name/i);
  assert.match(hostileReview.error, /package\.json/i, 'the refusal should state a plain next action');
  assert.equal(hostileReview.reviewId, undefined, 'a refused name must not receive a removal plan');
  const hostileApply = await applyProjectPackageRemoval(null, { reviewId: hostileReview.reviewId, confirmation: 'REMOVE PROJECT PACKAGE' });
  assert.equal(hostileApply.ok, false, 'a refused name must not be removable');
  assert.equal(spawnLog.slice(spawnsBeforeHostile).some((call) => /npm/i.test(call.command) || call.args.includes('uninstall')), false, 'no npm call may happen for an invalid package name');
  assert.deepEqual(JSON.parse(await fsp.readFile(path.join(project, 'package.json'), 'utf8')), hostileManifest, 'a refused removal must not change package.json');
  const managedManifestPath = path.join(home, '.setup-my-claude', 'manifest.tsv');
  await fsp.mkdir(path.dirname(managedManifestPath), { recursive: true });
  await fsp.writeFile(managedManifestPath, [
    `2026-09-18T00:00:00Z\tpath\t${path.join(home, '.claude', 'reference-repos', 'learn-claude-code')}\t\tlearn-claude-code`,
    '2026-09-18T00:00:00Z\tnpm-global\t@colbymchenry/codegraph\tcodegraph\tcodegraph',
    '2026-09-18T00:00:00Z\tmanual-review\tclaude-mem\tUse its documented removal steps.\tclaude-mem',
    `2026-09-18T00:00:00Z\tpath\t${path.join(tempRoot, 'outside-ccti-root')}\t\tlearn-claude-code`,
  ].join('\n') + '\n', 'utf8');
  const expiredManagedExtrasReview = await reviewManagedExtrasRemoval();
  Date.now = () => originalDateNow() + 10 * 60 * 1000 + 1;
  const expiredManagedExtrasApply = await applyManagedExtrasRemoval(null, { reviewId: expiredManagedExtrasReview.reviewId, confirmation: 'REMOVE CCTI EXTRAS' });
  Date.now = originalDateNow;
  assert.equal(expiredManagedExtrasApply.ok, false, 'managed extras removal must reject a review that has expired');
  assert.match(expiredManagedExtrasApply.error, /expired/i);
  assert.equal(await fsp.readFile(managedManifestPath, 'utf8'), [
    `2026-09-18T00:00:00Z\tpath\t${path.join(home, '.claude', 'reference-repos', 'learn-claude-code')}\t\tlearn-claude-code`,
    '2026-09-18T00:00:00Z\tnpm-global\t@colbymchenry/codegraph\tcodegraph\tcodegraph',
    '2026-09-18T00:00:00Z\tmanual-review\tclaude-mem\tUse its documented removal steps.\tclaude-mem',
    `2026-09-18T00:00:00Z\tpath\t${path.join(tempRoot, 'outside-ccti-root')}\t\tlearn-claude-code`,
  ].join('\n') + '\n', 'an expired managed-extras review must not change the manifest or its targets');
  const managedExtrasReview = await reviewManagedExtrasRemoval();
  assert.equal(managedExtrasReview.ok, true, 'only recognized CCTI manifest entries should be eligible for reviewed removal');
  assert.equal(managedExtrasReview.actions.length, 2);
  assert.equal(managedExtrasReview.manualItems.length, 1);
  assert.equal(managedExtrasReview.ignored, 1, 'manifest targets outside CCTI-managed roots must never enter a removal plan');
  const invalidManagedExtrasApply = await applyManagedExtrasRemoval(null, { reviewId: managedExtrasReview.reviewId, confirmation: 'WRONG_CONFIRMATION' });
  assert.equal(invalidManagedExtrasApply.ok, false, 'managed extras removal must require the explicit confirmation phrase');
  const managedReferenceFolder = path.join(home, '.claude', 'reference-repos', 'learn-claude-code');
  await fsp.mkdir(managedReferenceFolder, { recursive: true });
  await fsp.writeFile(path.join(managedReferenceFolder, 'README.md'), 'CCTI-managed reference\n', 'utf8');
  await fsp.writeFile(managedManifestPath, `2026-09-18T00:00:00Z\tpath\t${managedReferenceFolder}\t\tlearn-claude-code\n`, 'utf8');
  const singleManagedExtrasReview = await reviewManagedExtrasRemoval();
  assert.equal(singleManagedExtrasReview.ok, true);
  assert.equal(singleManagedExtrasReview.actions.length, 1);
  const managedExtrasRemoval = await applyManagedExtrasRemoval(null, { reviewId: singleManagedExtrasReview.reviewId, confirmation: 'REMOVE CCTI EXTRAS' });
  assert.equal(managedExtrasRemoval.ok, true, 'the confirmed managed extras review should remove only its reviewed path');
  await assert.rejects(fsp.access(managedReferenceFolder));
  assert.equal(await fsp.readFile(managedManifestPath, 'utf8'), '', 'completed managed extras records must not be repeated by a later cleanup review');

  const missingProjectReport = await discover(null, { projectPath: path.join(tempRoot, 'removed-project') });
  assert.equal(missingProjectReport.ok, false, 'a project that disappears before checkup must return a normalized failure');
  assert.match(missingProjectReport.error, /could not check the selected project/i);

  const duplicateReview = await reviewCustom(null, { source: duplicateSourceSkill, scope: 'user', projectPath: project });
  assert.equal(duplicateReview.ok, true, 'a duplicate review should complete without copying anything');
  assert.equal(duplicateReview.blocked, true, 'CCTI must block a duplicate skill before approval');
  assert.equal(duplicateReview.kind, 'duplicate-skill');
  assert.equal(duplicateReview.name, 'duplicate-skill');
  assert.equal(duplicateReview.existing.length, 2, 'duplicate review should identify both installed Claude Code copies');
  assert.match(duplicateReview.description, /already available in Claude Code/i);
  const blockedDuplicate = await applyCustom(null, { reviewId: duplicateReview.reviewId });
  assert.equal(blockedDuplicate.ok, false, 'CCTI must never copy a duplicate skill');
  assert.match(blockedDuplicate.error, /review has expired/i);
  await fsp.access(path.join(duplicateSourceSkill, 'SKILL.md'));
  await fsp.access(path.join(home, '.claude', 'skills', 'duplicate-skill', 'SKILL.md'));
  await fsp.access(path.join(project, '.claude', 'skills', 'duplicate-skill', 'SKILL.md'));

  await fsp.writeFile(fakeClaudeLog, '', 'utf8');
  const duplicatePluginResult = await runInstall(null, { selectedIds: ['frontend-design'], dryRun: false });
  assert.equal(duplicatePluginResult.ok, true, 'the catalog action should complete after safely skipping an installed plugin');
  const fakeClaudeCalls = await fsp.readFile(fakeClaudeLog, 'utf8');
  assert.match(fakeClaudeCalls, /plugin list/, 'CCTI should check the installed Claude Code plugins first');
  assert.doesNotMatch(fakeClaudeCalls, /plugin install|plugin marketplace add/, 'CCTI must not reinstall an already available curated plugin or repeat its marketplace add command');

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
  // Task 4 (Review Focus 5): a review left open past the old 10-minute window still applies,
  // because apply re-verifies current state (unchanged content) instead of rejecting on age
  // alone. Reason for updating this assertion: documented "refresh silently" rule.
  Date.now = () => originalDateNow() + 10 * 60 * 1000 + 1;
  const cleanupResult = await applyCleanup(null, { reviewId: cleanupPlan.reviewId });
  Date.now = originalDateNow;
  assert.equal(cleanupResult.ok, true, 'apply must succeed once re-verification passes, even past the old 10-minute window');
  await assert.rejects(fsp.access(userSkill.path));
  await fsp.access(path.join(cleanupPlan.destination, 'SKILL.md'));

  // Task 4 (Review Focus 5): the same re-verification-over-age rule applies to the bulk
  // duplicate cleanup path. A project-free discovery isolates this check from the shared
  // project-scope duplicate fixtures used below, since apply acts on real files regardless of
  // which discovery produced the plan.
  await writeSkill(path.join(home, '.claude', 'skills', 'age-check-a'), 'Age check', { contents: '# Age check\n' });
  await writeSkill(path.join(home, '.claude', 'skills', 'age-check-b'), 'Age check', { contents: '# Age check\n' });
  const ageCheckReport = await discover(null, {});
  const ageCheckBulkPlan = await reviewAllDuplicates(null, { discoveryId: ageCheckReport.discoveryId });
  assert.equal(ageCheckBulkPlan.ok, true, ageCheckBulkPlan.error);
  assert.equal(ageCheckBulkPlan.groups.length, 1, 'the project-free discovery should isolate the age-check duplicate pair from other fixtures');
  Date.now = () => originalDateNow() + 10 * 60 * 1000 + 1;
  const ageCheckResult = await applyAllDuplicates(null, { reviewId: ageCheckBulkPlan.reviewId });
  Date.now = originalDateNow;
  assert.equal(ageCheckResult.ok, true, 'bulk duplicate backup must apply once re-verification passes, even past the old 10-minute window');
  assert.equal(ageCheckResult.movedCount, 1);
  // Clean up this throwaway pair immediately: it lives under the same home skill and backup
  // roots that later discover() calls scan, so leaving it behind would inflate the shared
  // duplicate-skill and safe-backup counts asserted further down.
  await fsp.rm(path.join(home, '.claude', 'skills', 'age-check-a'), { recursive: true, force: true });
  await fsp.rm(ageCheckBulkPlan.moves[0].destination, { recursive: true, force: true });

  // Coordinator fix round 1, item 1: applyAllDuplicateSkills must re-verify the copy each
  // group would KEEP, not just the copies it moves. If the kept copy changed after review,
  // moving every other copy would leave no active copy of that skill at all. Again isolated
  // through a project-free discovery.
  await writeSkill(path.join(home, '.claude', 'skills', 'keeper-edited-a'), 'Keeper edited', { contents: '# Keeper edited\n' });
  await writeSkill(path.join(home, '.claude', 'skills', 'keeper-edited-b'), 'Keeper edited', { contents: '# Keeper edited\n' });
  const keeperEditedReport = await discover(null, {});
  const keeperEditedPlan = await reviewAllDuplicates(null, { discoveryId: keeperEditedReport.discoveryId });
  assert.equal(keeperEditedPlan.ok, true, keeperEditedPlan.error);
  assert.equal(keeperEditedPlan.groups.length, 1, 'the project-free discovery should isolate this duplicate pair from other fixtures');
  const keeperEditedGroup = keeperEditedPlan.groups[0];
  // Edit the copy the plan says it will KEEP (not either move target) after review.
  await fsp.writeFile(path.join(keeperEditedGroup.keep.path, 'SKILL.md'), '# Keeper edited (changed after review)\n', 'utf8');
  const keeperEditedResult = await applyAllDuplicates(null, { reviewId: keeperEditedPlan.reviewId });
  assert.equal(keeperEditedResult.ok, false, 'apply must refuse when the copy it would keep changed after review');
  assert.match(keeperEditedResult.error, /copy CCTI would keep changed/i);
  await fsp.access(path.join(home, '.claude', 'skills', 'keeper-edited-a', 'SKILL.md'));
  await fsp.access(path.join(home, '.claude', 'skills', 'keeper-edited-b', 'SKILL.md'));
  assert.equal(keeperEditedPlan.moves.length, 1);
  await assert.rejects(fsp.access(keeperEditedPlan.moves[0].destination), 'no backup should be created when the kept copy changed after review');
  await fsp.rm(path.join(home, '.claude', 'skills', 'keeper-edited-a'), { recursive: true, force: true });
  await fsp.rm(path.join(home, '.claude', 'skills', 'keeper-edited-b'), { recursive: true, force: true });

  // Same rule, but the kept copy is deleted entirely after review rather than edited.
  await writeSkill(path.join(home, '.claude', 'skills', 'keeper-deleted-a'), 'Keeper deleted', { contents: '# Keeper deleted\n' });
  await writeSkill(path.join(home, '.claude', 'skills', 'keeper-deleted-b'), 'Keeper deleted', { contents: '# Keeper deleted\n' });
  const keeperDeletedReport = await discover(null, {});
  const keeperDeletedPlan = await reviewAllDuplicates(null, { discoveryId: keeperDeletedReport.discoveryId });
  assert.equal(keeperDeletedPlan.ok, true, keeperDeletedPlan.error);
  assert.equal(keeperDeletedPlan.groups.length, 1, 'the project-free discovery should isolate this duplicate pair from other fixtures');
  const keeperDeletedGroup = keeperDeletedPlan.groups[0];
  await fsp.rm(keeperDeletedGroup.keep.path, { recursive: true, force: true });
  const keeperDeletedResult = await applyAllDuplicates(null, { reviewId: keeperDeletedPlan.reviewId });
  assert.equal(keeperDeletedResult.ok, false, 'apply must refuse when the copy it would keep was deleted after review');
  assert.match(keeperDeletedResult.error, /copy CCTI would keep changed/i);
  await fsp.access(path.join(keeperDeletedPlan.moves[0].source, 'SKILL.md'));
  await assert.rejects(fsp.access(keeperDeletedPlan.moves[0].destination), 'no backup should be created when the kept copy no longer exists');
  await fsp.rm(path.join(home, '.claude', 'skills', 'keeper-deleted-a'), { recursive: true, force: true }).catch(() => {});
  await fsp.rm(path.join(home, '.claude', 'skills', 'keeper-deleted-b'), { recursive: true, force: true }).catch(() => {});

  await fsp.access(path.join(home, '.claude', 'skills', 'global-revenue-playbook', 'SKILL.md'));

  // The personal copy ('global-revenue-playbook') is now the keeper and is never a move
  // target, so the staleness check below must change the copy that will actually move
  // ('local-gtm-playbook', the project copy).
  const staleBulkPlan = await reviewAllDuplicates(null, { discoveryId: report.discoveryId });
  await fsp.writeFile(path.join(project, '.claude', 'skills', 'local-gtm-playbook', 'SKILL.md'), '# Changed after preview\n', 'utf8');
  const staleBulkResult = await applyAllDuplicates(null, { reviewId: staleBulkPlan.reviewId });
  assert.equal(staleBulkResult.ok, false, 'bulk cleanup must refuse a preview whose exact file content changed before apply');
  await fsp.access(path.join(project, '.claude', 'skills', 'local-gtm-playbook', 'SKILL.md'));
  await fsp.writeFile(path.join(project, '.claude', 'skills', 'local-gtm-playbook', 'SKILL.md'), hashCollision.contents, 'utf8');

  const bulkPlan = await reviewAllDuplicates(null, { discoveryId: report.discoveryId });
  assert.equal(bulkPlan.ok, true, 'a bulk duplicate review should be generated from only the discovered global and project skill roots');
  assert.equal(bulkPlan.groups.length, 3, 'the already moved duplicate skill should not be included in the bulk plan');
  assert.equal(bulkPlan.groups.some((group) => group.name === 'same-name-different-content'), false, 'a same-name overlap with different verified content must never enter a bulk backup plan');
  const namedBulkGroup = bulkPlan.groups.find((group) => group.name === 'bulk-duplicate-skill');
  const hashedBulkGroup = bulkPlan.groups.find((group) => group.match === 'content-hash' && group.names.includes('global-revenue-playbook'));
  const projectBackupGroup = bulkPlan.groups.find((group) => group.name === 'project-backup-skill');
  // Task 4: Claude Code's documented rule is personal over project, so the personal (home)
  // copy is the keeper in each group below even where the project copy is newer. Reason for
  // updating these three assertions: documented personal-over-project rule.
  assert.equal(namedBulkGroup.keep.scope, 'Just you', 'the personal same-name copy is the one Claude Code uses, so it remains available even though the project copy is newer');
  assert.equal(hashedBulkGroup.keep.name, 'global-revenue-playbook', 'the personal hash-collision copy is the one Claude Code uses, so it remains available even though the project copy is newer');
  assert.equal(projectBackupGroup.keep.scope, 'Just you', 'the personal copy remains available when a project copy is backed up');
  assert.equal(bulkPlan.moves.length, 3);
  const namedBulkMove = bulkPlan.moves.find((move) => move.name === 'bulk-duplicate-skill');
  // The moved copy of the hash-collision group is now the project copy ('local-gtm-playbook'),
  // since the personal copy ('global-revenue-playbook') is the keeper.
  const hashCollisionMove = bulkPlan.moves.find((move) => move.name === 'local-gtm-playbook');
  const projectBackupMove = bulkPlan.moves.find((move) => move.name === 'project-backup-skill');
  assert.equal(namedBulkMove.scope, 'This project');
  assert.equal(hashCollisionMove.scope, 'This project');
  assert.equal(projectBackupMove.scope, 'This project');
  assert.deepEqual(hashCollisionMove.files.map((file) => file.source).sort((left, right) => left.localeCompare(right)), [
    path.join(project, '.claude', 'skills', 'local-gtm-playbook', 'SKILL.md'),
    path.join(project, '.claude', 'skills', 'local-gtm-playbook', 'references', 'guide.md'),
  ].sort((left, right) => left.localeCompare(right)), 'the cleanup review must preview every exact file that will be backed up');
  assert.ok(hashCollisionMove.files.every((file) => file.destination.startsWith(hashCollisionMove.destination)), 'each previewed file must show its exact backup destination');
  const bulkResult = await applyAllDuplicates(null, { reviewId: bulkPlan.reviewId });
  assert.equal(bulkResult.ok, true, 'all reviewed duplicate copies should move to backup in one action');
  assert.equal(bulkResult.movedCount, 3);
  await fsp.access(path.join(home, '.claude', 'skills', 'bulk-duplicate-skill', 'SKILL.md'));
  await assert.rejects(fsp.access(path.join(project, '.claude', 'skills', 'bulk-duplicate-skill')));
  await fsp.access(path.join(namedBulkMove.destination, 'SKILL.md'));
  await fsp.access(path.join(home, '.claude', 'skills', 'global-revenue-playbook', 'SKILL.md'));
  await assert.rejects(fsp.access(path.join(project, '.claude', 'skills', 'local-gtm-playbook')));
  await fsp.access(path.join(hashCollisionMove.destination, 'SKILL.md'));
  await fsp.access(path.join(hashCollisionMove.destination, 'references', 'guide.md'));
  await assert.rejects(fsp.access(path.join(project, '.claude', 'skills', 'project-backup-skill')));
  await fsp.access(path.join(projectBackupMove.destination, 'SKILL.md'));

  if (process.env.CCTI_KEEP_FIXTURE === '1') {
    console.log(`Verified generated user backup root: ${path.join(home, '.setup-my-claude', 'disabled-skills')}`);
    console.log(`Verified generated project backup root: ${path.join(project, '.claude', '.setup-my-claude-disabled')}`);
    return;
  }

  const backupReport = await discover(null, { projectPath: project });
  const safeBackups = backupReport.findings.filter((item) => item.type === 'skill-backup' && item.restorable);
  assert.equal(safeBackups.length, 4, 'the checkup should find the prior single-skill backup plus global and project backups created by bulk cleanup');
  assert.ok(safeBackups.some((item) => item.scope === 'Just you'));
  assert.ok(safeBackups.some((item) => item.scope === 'This project'));
  const expiredBackupRestorePlan = await reviewAllSkillBackups(null, { discoveryId: backupReport.discoveryId });
  Date.now = () => originalDateNow() + 10 * 60 * 1000 + 1;
  const expiredBackupRestoreResult = await applyAllSkillBackups(null, { reviewId: expiredBackupRestorePlan.reviewId });
  Date.now = originalDateNow;
  assert.equal(expiredBackupRestoreResult.ok, false, 'safe backup restore must reject an expired review');
  assert.match(expiredBackupRestoreResult.error, /expired/i);
  await fsp.access(path.join(namedBulkMove.destination, 'SKILL.md'));
  const backupRestorePlan = await reviewAllSkillBackups(null, { discoveryId: backupReport.discoveryId });
  assert.equal(backupRestorePlan.ok, true, 'a safe restoration review should be available for backed up duplicate skills');
  assert.equal(backupRestorePlan.moves.length, 4);
  assert.ok(backupRestorePlan.moves.some((move) => move.scope === 'This project'), 'the restore review must include project-scope backups');
  assert.ok(backupRestorePlan.moves.flatMap((move) => move.files).some((file) => file.destination.endsWith(path.join('local-gtm-playbook', 'references', 'guide.md'))), 'the restore preview must list nested files and original destinations');
  const backupRestoreResult = await applyAllSkillBackups(null, { reviewId: backupRestorePlan.reviewId });
  assert.equal(backupRestoreResult.ok, true, 'safe skill backups should restore in one reviewed action');
  assert.equal(backupRestoreResult.restoredCount, 4);
  await fsp.access(path.join(home, '.claude', 'skills', 'duplicate-skill', 'SKILL.md'));
  await fsp.access(path.join(project, '.claude', 'skills', 'bulk-duplicate-skill', 'SKILL.md'));
  await fsp.access(path.join(project, '.claude', 'skills', 'local-gtm-playbook', 'references', 'guide.md'));
  await fsp.access(path.join(project, '.claude', 'skills', 'project-backup-skill', 'SKILL.md'));
  await assert.rejects(fsp.access(namedBulkMove.destination));
  await assert.rejects(fsp.access(hashCollisionMove.destination));
  await assert.rejects(fsp.access(projectBackupMove.destination));

  const olderHistoryBackup = path.join(home, '.setup-my-claude', 'disabled-skills', 'restore-history-1760000000000-abcdef12');
  const newerHistoryBackup = path.join(home, '.setup-my-claude', 'disabled-skills', 'restore-history-1760000001000-fedcba98');
  await writeSkill(olderHistoryBackup, 'Older history', { contents: '# Older backup\n' });
  await writeSkill(newerHistoryBackup, 'Newer history', { contents: '# Newer backup\n' });
  const historyBackupReport = await discover(null, { projectPath: project });
  const historyBackups = historyBackupReport.findings.filter((item) => item.type === 'skill-backup' && item.name === 'restore-history');
  assert.equal(historyBackups.length, 2, 'all recognized backups targeting one original skill location should remain visible');
  assert.equal(historyBackups.filter((item) => item.restorable).length, 1, 'only the newest backup targeting one original location may be restored automatically');
  assert.equal(historyBackups.find((item) => item.restorable).path, newerHistoryBackup);
  const historyRestorePlan = await reviewAllSkillBackups(null, { discoveryId: historyBackupReport.discoveryId });
  assert.equal(historyRestorePlan.moves.length, 1, 'the restore review should exclude superseded backups');
  const historyRestoreResult = await applyAllSkillBackups(null, { reviewId: historyRestorePlan.reviewId });
  assert.equal(historyRestoreResult.ok, true);
  assert.equal(await fsp.readFile(path.join(home, '.claude', 'skills', 'restore-history', 'SKILL.md'), 'utf8'), '# Newer backup\n');
  await fsp.access(path.join(olderHistoryBackup, 'SKILL.md'));

  const corruptedBackupPath = path.join(home, '.setup-my-claude', 'disabled-skills', 'corrupted-restore-1760000002000-a1b2c3d4');
  await writeSkill(corruptedBackupPath, 'Corrupted restore', { contents: '# Original backup content\n', files: { 'references/check.md': 'Original nested content\n' } });
  const corruptedBackupReport = await discover(null, { projectPath: project });
  const corruptedRestorePlan = await reviewAllSkillBackups(null, { discoveryId: corruptedBackupReport.discoveryId });
  const corruptedMove = corruptedRestorePlan.moves.find((move) => move.name === 'corrupted-restore');
  assert.ok(corruptedMove, 'the restore review should include a verified CCTI backup before it is changed');
  await fsp.writeFile(path.join(corruptedBackupPath, 'references', 'check.md'), 'Corrupted after preview\n', 'utf8');
  const corruptedRestoreResult = await applyAllSkillBackups(null, { reviewId: corruptedRestorePlan.reviewId });
  assert.equal(corruptedRestoreResult.ok, false, 'restore must reject a backup whose exact manifest changed after review');
  assert.match(corruptedRestoreResult.error, /backup changed after the preview/i);
  await fsp.access(path.join(corruptedBackupPath, 'SKILL.md'));
  await fsp.access(path.join(corruptedBackupPath, 'references', 'check.md'));
  await assert.rejects(fsp.access(path.join(home, '.claude', 'skills', 'corrupted-restore')));
  await fsp.rm(corruptedBackupPath, { recursive: true, force: true });

  const missingFileBackupPath = path.join(home, '.setup-my-claude', 'disabled-skills', 'missing-file-restore-1760000003000-e5f6a7b8');
  await writeSkill(missingFileBackupPath, 'Missing file restore', { contents: '# Required manifest file\n', files: { 'references/recovery.md': 'Preserved recovery note\n' } });
  const missingFileBackupReport = await discover(null, { projectPath: project });
  const missingFileRestorePlan = await reviewAllSkillBackups(null, { discoveryId: missingFileBackupReport.discoveryId });
  const missingFileMove = missingFileRestorePlan.moves.find((move) => move.name === 'missing-file-restore');
  assert.ok(missingFileMove, 'the restore review should include a complete backup before its required file is removed');
  await fsp.rm(path.join(missingFileBackupPath, 'SKILL.md'));
  const missingFileRestoreResult = await applyAllSkillBackups(null, { reviewId: missingFileRestorePlan.reviewId });
  assert.equal(missingFileRestoreResult.ok, false, 'restore must fail safely when a reviewed backup file is entirely missing');
  assert.match(missingFileRestoreResult.error, /could not recheck one of the skill backups/i);
  await fsp.access(path.join(missingFileBackupPath, 'references', 'recovery.md'));
  await assert.rejects(fsp.access(path.join(home, '.claude', 'skills', 'missing-file-restore')));
  await fsp.rm(missingFileBackupPath, { recursive: true, force: true });

  const occupiedBackupName = 'bulk-duplicate-skill-1760000000000-abcdef12';
  const occupiedBackupPath = path.join(home, '.setup-my-claude', 'disabled-skills', occupiedBackupName);
  await writeSkill(occupiedBackupPath, 'Preserved duplicate');
  const occupiedBackupReport = await discover(null, { projectPath: project });
  const protectedBackup = occupiedBackupReport.findings.find((item) => item.type === 'skill-backup' && item.path === occupiedBackupPath);
  assert.ok(protectedBackup, 'recognized CCTI backup folders should be listed after a checkup');
  assert.equal(protectedBackup.restorable, false, 'a backup must not be restorable when the original direct skill folder is occupied');

  const archiveActiveFailureReview = await reviewSkillBackupReplacement(null, { discoveryId: occupiedBackupReport.discoveryId, backupId: protectedBackup.id });
  assert.equal(archiveActiveFailureReview.ok, true, 'a checked occupied backup should produce a replacement review before failure injection');
  const originalRename = fsp.rename;
  let archiveActiveFailureInjected = false;
  fsp.rename = async (source, destination) => {
    if (source === archiveActiveFailureReview.moves[0].source && destination === archiveActiveFailureReview.moves[0].destination) {
      archiveActiveFailureInjected = true;
      const error = new Error('Injected archive-active rename failure.');
      error.code = 'EIO';
      throw error;
    }
    return originalRename(source, destination);
  };
  let archiveActiveFailureResult;
  try {
    archiveActiveFailureResult = await applySkillBackupReplacement(null, { reviewId: archiveActiveFailureReview.reviewId });
  } finally {
    fsp.rename = originalRename;
  }
  assert.equal(archiveActiveFailureInjected, true, 'the fixture must fail exactly the archive-active rename');
  assert.equal(archiveActiveFailureResult.ok, false, 'an archive-active failure must stop the replacement');
  assert.match(archiveActiveFailureResult.error, /could not complete the reviewed replacement/i);
  await assert.rejects(fsp.access(archiveActiveFailureReview.moves[0].destination), 'a failed archive-active move must not leave a new active-skill backup folder');
  assert.match(await fsp.readFile(path.join(home, '.claude', 'skills', 'bulk-duplicate-skill', 'SKILL.md'), 'utf8'), /Bulk duplicate/);
  assert.match(await fsp.readFile(path.join(occupiedBackupPath, 'SKILL.md'), 'utf8'), /Preserved duplicate/);

  const restorePreservedFailureReview = await reviewSkillBackupReplacement(null, { discoveryId: occupiedBackupReport.discoveryId, backupId: protectedBackup.id });
  assert.equal(restorePreservedFailureReview.ok, true, 'a checked occupied backup should produce a replacement review before restore-preserved failure injection');
  const restorePreservedMove = restorePreservedFailureReview.moves[1];
  const originalRestoreRename = fsp.rename;
  let restorePreservedFailureInjected = false;
  fsp.rename = async (source, destination) => {
    if (source === restorePreservedMove.source && destination === restorePreservedMove.destination) {
      restorePreservedFailureInjected = true;
      const error = new Error('Injected restore-preserved rename failure.');
      error.code = 'EIO';
      throw error;
    }
    return originalRestoreRename(source, destination);
  };
  let restorePreservedFailureResult;
  try {
    restorePreservedFailureResult = await applySkillBackupReplacement(null, { reviewId: restorePreservedFailureReview.reviewId });
  } finally {
    fsp.rename = originalRestoreRename;
  }
  assert.equal(restorePreservedFailureInjected, true, 'the fixture must fail exactly the restore-preserved rename');
  assert.equal(restorePreservedFailureResult.ok, false, 'a restore-preserved failure must stop the replacement');
  assert.match(restorePreservedFailureResult.error, /active skill was returned to its original location when possible/i);
  await assert.rejects(fsp.access(restorePreservedFailureReview.moves[0].destination), 'the rollback must consume the temporary active-skill backup after restoring the active skill');
  assert.match(await fsp.readFile(path.join(home, '.claude', 'skills', 'bulk-duplicate-skill', 'SKILL.md'), 'utf8'), /Bulk duplicate/);
  assert.match(await fsp.readFile(path.join(occupiedBackupPath, 'SKILL.md'), 'utf8'), /Preserved duplicate/);

  const protectedRestore = await reviewAllSkillBackups(null, { discoveryId: occupiedBackupReport.discoveryId });
  assert.equal(protectedRestore.ok, false, 'the restore action must refuse to overwrite an active skill folder');
  await fsp.access(path.join(home, '.claude', 'skills', 'bulk-duplicate-skill', 'SKILL.md'));
  await fsp.access(path.join(occupiedBackupPath, 'SKILL.md'));
  const forgedReplacement = await reviewSkillBackupReplacement(null, { discoveryId: occupiedBackupReport.discoveryId, backupId: 'forged-backup-id' });
  assert.equal(forgedReplacement.ok, false, 'replacement must accept only a backup that the current bounded checkup discovered');
  const replacementReview = await reviewSkillBackupReplacement(null, { discoveryId: occupiedBackupReport.discoveryId, backupId: protectedBackup.id });
  assert.equal(replacementReview.ok, true, 'an occupied original location can be replaced only through a reviewed backup swap');
  assert.equal(replacementReview.moves.length, 2, 'replacement must show both the active-copy backup and preserved-copy restore moves');
  assert.equal(replacementReview.moves[0].kind, 'archive-active');
  assert.equal(replacementReview.moves[1].kind, 'restore-preserved');
  const replacementResult = await applySkillBackupReplacement(null, { reviewId: replacementReview.reviewId });
  assert.equal(replacementResult.ok, true, 'a reviewed replacement must retain the active copy before restoring the selected backup');
  assert.match(await fsp.readFile(path.join(home, '.claude', 'skills', 'bulk-duplicate-skill', 'SKILL.md'), 'utf8'), /Preserved duplicate/);
  assert.match(await fsp.readFile(path.join(replacementReview.moves[0].destination, 'SKILL.md'), 'utf8'), /Bulk duplicate/);
  await assert.rejects(fsp.access(occupiedBackupPath), 'the selected backup folder must be consumed only after it is restored');

  const copyReview = await reviewCustom(null, { source: sourceSkill, scope: 'project', projectPath: project });
  assert.equal(copyReview.ok, true);
  assert.equal(copyReview.kind, 'skill-copy');
  assert.equal(copyReview.destination, path.join(project, '.claude', 'skills', 'my-skill'));
  assert.ok(copyReview.reviewId, 'a reviewed local skill must have an opaque apply token');
  const copyResult = await applyCustom(null, { reviewId: copyReview.reviewId, source: duplicateSourceSkill });
  assert.equal(copyResult.ok, true);
  await fsp.access(path.join(copyReview.destination, 'SKILL.md'));
  await fsp.access(path.join(sourceSkill, 'SKILL.md'));

  const changedSourceSkill = path.join(tempRoot, 'changed-after-review');
  await writeSkill(changedSourceSkill, 'Changed after review', { contents: '# Original review\n' });
  const changedReview = await reviewCustom(null, { source: changedSourceSkill, scope: 'user', projectPath: project });
  assert.equal(changedReview.ok, true);
  await fsp.writeFile(path.join(changedSourceSkill, 'SKILL.md'), '# Changed after review\n', 'utf8');
  const changedApply = await applyCustom(null, { reviewId: changedReview.reviewId });
  assert.equal(changedApply.ok, false, 'a local skill changed after review must not be copied');
  assert.match(changedApply.error, /changed after review/i);
  await assert.rejects(fsp.access(path.join(home, '.claude', 'skills', 'changed-after-review')));

  
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
  if (originalAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = originalAppData;
  if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = originalLocalAppData;
  if (process.env.CCTI_KEEP_FIXTURE === '1') {
    console.log(`Retained isolated setup-manager fixture for inspection: ${tempRoot}`);
    return;
  }
  await fsp.rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}).catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
