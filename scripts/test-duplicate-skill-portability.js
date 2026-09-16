#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccti-dedup-portability-'));
const home = path.join(fixtureRoot, 'portable-home');
const externalProject = process.env.CCTI_PORTABILITY_PROJECT ? path.resolve(process.env.CCTI_PORTABILITY_PROJECT) : '';
const project = externalProject || path.join(fixtureRoot, 'client-revenue-automation-project');
const projectClaudeRoot = path.join(project, '.claude');
const projectSkillRoot = path.join(projectClaudeRoot, 'skills');
const handlers = new Map();
let readyCallback;
let temporaryProjectOverlayCreated = false;

class NotificationStub {
  static isSupported() { return true; }
  on() { return this; }
  show() {}
}

const electronStub = {
  app: {
    getPath: (name) => name === 'home' ? home : fixtureRoot,
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
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true, filePath: '' }) },
  shell: { showItemInFolder: () => true, openPath: async () => '' },
  Notification: NotificationStub,
  ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') return electronStub;
  return originalLoad.call(this, request, parent, isMain);
};

async function writeSkill(folder, files) {
  await fsp.mkdir(folder, { recursive: true });
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(folder, relativePath);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, contents, 'utf8');
  }
}

async function run() {
  await fsp.mkdir(home, { recursive: true });
  if (externalProject) {
    const stats = await fsp.stat(project);
    assert.ok(stats.isDirectory(), 'the external portability project must be a directory');
    await assert.rejects(fsp.access(projectClaudeRoot), 'the external portability project must not already contain .claude because this test creates a temporary overlay');
  } else {
    await fsp.mkdir(project, { recursive: true });
  }
  const portableContents = {
    'SKILL.md': '# Portable revenue workflow\n',
    'references/offer.md': 'Build an offer before an automation.\n',
  };
  const globalSkill = path.join(home, '.claude', 'skills', 'portable-revenue-workflow');
  const projectSkill = path.join(projectSkillRoot, 'client-automation-playbook');
  await writeSkill(globalSkill, portableContents);
  await writeSkill(projectSkill, portableContents);
  temporaryProjectOverlayCreated = true;
  await fsp.utimes(path.join(globalSkill, 'SKILL.md'), new Date('2026-03-01T00:00:00.000Z'), new Date('2026-03-01T00:00:00.000Z'));
  await fsp.utimes(path.join(projectSkill, 'SKILL.md'), new Date('2026-09-01T00:00:00.000Z'), new Date('2026-09-01T00:00:00.000Z'));

  require(path.join(root, 'desktop', 'src', 'main.js'));
  await readyCallback();
  const discover = handlers.get('setup-manager:discover');
  const reviewAllDuplicates = handlers.get('setup-manager:review-all-duplicates');
  const applyAllDuplicates = handlers.get('setup-manager:apply-all-duplicates');
  const reviewAllSkillBackups = handlers.get('setup-manager:review-all-skill-backups');
  const applyAllSkillBackups = handlers.get('setup-manager:apply-all-skill-backups');
  assert.ok(discover && reviewAllDuplicates && applyAllDuplicates && reviewAllSkillBackups && applyAllSkillBackups, 'the independent fixture requires discover, cleanup, and restore handlers');

  const initial = await discover(null, { projectPath: project });
  const collision = initial.duplicates.find((group) => group.type === 'skill' && group.match === 'content-hash');
  assert.ok(collision, 'identical content under different skill names must be detected in the independent project fixture');
  assert.deepEqual(collision.names, ['client-automation-playbook', 'portable-revenue-workflow']);

  const cleanupPlan = await reviewAllDuplicates(null, { discoveryId: initial.discoveryId });
  assert.equal(cleanupPlan.ok, true);
  assert.equal(cleanupPlan.moves.length, 1);
  assert.equal(cleanupPlan.moves[0].source, globalSkill);
  assert.equal(cleanupPlan.moves[0].scope, 'Just you');
  const cleanupResult = await applyAllDuplicates(null, { reviewId: cleanupPlan.reviewId });
  assert.equal(cleanupResult.ok, true);
  await assert.rejects(fsp.access(globalSkill));
  await fsp.access(path.join(projectSkill, 'references', 'offer.md'));
  const backupPath = cleanupPlan.moves[0].destination;
  await fsp.access(path.join(backupPath, 'SKILL.md'));
  await fsp.access(path.join(backupPath, 'references', 'offer.md'));
  assert.equal(path.dirname(backupPath), path.join(home, '.setup-my-claude', 'disabled-skills'), 'user-scope backup remains bounded to the fixture CCTI state root');

  const afterCleanup = await discover(null, { projectPath: project });
  const restorePlan = await reviewAllSkillBackups(null, { discoveryId: afterCleanup.discoveryId });
  assert.equal(restorePlan.ok, true);
  assert.equal(restorePlan.moves.length, 1);
  assert.equal(restorePlan.moves[0].destination, globalSkill);
  const restoreResult = await applyAllSkillBackups(null, { reviewId: restorePlan.reviewId });
  assert.equal(restoreResult.ok, true);
  await fsp.access(path.join(globalSkill, 'SKILL.md'));
  await fsp.access(path.join(globalSkill, 'references', 'offer.md'));
  await assert.rejects(fsp.access(backupPath));

  console.log(JSON.stringify({
    ok: true,
    fixture: externalProject ? `external:${path.basename(project)}` : 'client-revenue-automation-project',
    scopes: ['Just you', 'This project'],
    collision: 'content-hash',
    backupRoot: '<fixture-app-state>/disabled-skills',
    restoredTo: '<fixture-home>/.claude/skills/portable-revenue-workflow',
  }));
}

run().finally(async () => {
  Module._load = originalLoad;
  if (externalProject && temporaryProjectOverlayCreated) {
    await fsp.rm(path.join(projectSkillRoot, 'client-automation-playbook'), { recursive: true, force: true });
    await fsp.rmdir(projectSkillRoot).catch(() => {});
    await fsp.rmdir(projectClaudeRoot).catch(() => {});
  }
  await fsp.rm(fixtureRoot, { recursive: true, force: true });
}).catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
