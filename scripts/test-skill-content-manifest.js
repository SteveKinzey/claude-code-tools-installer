#!/usr/bin/env node
// Skill content manifests: the two-pass scan must refuse oversized or linked skills before any
// file contents are read, must keep manifests byte-identical to the original single-pass
// algorithm for normal skills, and must keep skill and backup listings in folder order while
// several skills are hashed at once.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const fixtureRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccti-skill-manifest-')));
const home = path.join(fixtureRoot, 'home');
const skillRoot = path.join(home, '.claude', 'skills');
const backupRoot = path.join(home, '.setup-my-claude', 'disabled-skills');
const handlers = new Map();
let readyCallback;

// Keep the scan hermetic: no real Claude Code command is reachable from this PATH.
process.env.PATH = '/usr/bin:/bin';

const electronStub = {
  app: {
    getPath: (name) => name === 'home' ? home : fixtureRoot,
    getVersion: () => '0.0.0-test',
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
  Notification: class { static isSupported() { return false; } on() { return this; } show() {} },
  ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') return electronStub;
  return originalLoad.call(this, request, parent, isMain);
};

// Count every content read the main process makes, by path.
const contentReads = [];
const originalReadFile = fsp.readFile;
fsp.readFile = function countedReadFile(target, ...rest) {
  if (typeof target === 'string') contentReads.push(path.resolve(target));
  return originalReadFile.call(this, target, ...rest);
};
const readsUnder = (folder) => contentReads.filter((file) => file === folder || file.startsWith(`${folder}${path.sep}`));

// The original single-pass algorithm, kept verbatim as the reference for byte-identical output.
async function referenceManifest(skillPath) {
  const rootPath = path.resolve(skillPath);
  const files = [];
  let totalBytes = 0;
  const walk = async (directory) => {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isSymbolicLink()) throw new Error('A skill contains a symbolic link.');
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(filePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (files.length >= 2000) throw new Error('A skill contains too many files to verify safely.');
      const metadata = await fsp.stat(filePath);
      totalBytes += metadata.size;
      if (totalBytes > 25 * 1024 * 1024) throw new Error('A skill is too large to verify safely.');
      const relativePath = path.relative(rootPath, filePath).split(path.sep).join('/');
      const contents = await originalReadFile(filePath);
      files.push({ path: relativePath, size: metadata.size, sha256: createHash('sha256').update(contents).digest('hex') });
    }
  };
  await walk(rootPath);
  if (!files.some((file) => file.path === 'SKILL.md')) throw new Error('The skill no longer contains SKILL.md.');
  const identity = createHash('sha256').update(files.map((file) => `${file.path}\0${file.sha256}\0${file.size}\n`).join(''), 'utf8').digest('hex');
  return { identity, files, totalBytes };
}

async function writeSkill(folder, files) {
  await fsp.mkdir(folder, { recursive: true });
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(folder, relativePath);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, contents);
  }
}

async function run() {
  // Normal skills, with nested folders, mixed-case and accented names, binary content, and an
  // empty file, so ordering and hashing are exercised.
  const normalNames = ['alpha-skill', 'Bravo', 'charlie', 'delta-ünïcode', 'echo', 'foxtrot', 'golf'];
  for (const [index, name] of normalNames.entries()) {
    await writeSkill(path.join(skillRoot, name), {
      'SKILL.md': `# ${name}\n`,
      'b.md': `second ${index}\n`,
      'A.md': `first ${index}\n`,
      'é-accent.txt': 'accent\n',
      'nested/deeper/z.bin': Buffer.from([0, 1, 2, 3, index]),
      'nested/a.md': '',
    });
  }
  // Too many files: 2001 tiny files, all within the byte limit.
  const manyFiles = path.join(skillRoot, 'many-files');
  const many = { 'SKILL.md': '# many\n' };
  for (let index = 0; index < 2001; index += 1) many[`files/${String(index).padStart(4, '0')}.md`] = 'x';
  await writeSkill(manyFiles, many);
  // Too large: one sparse file just over the 25 MB limit (no real disk use).
  const tooLarge = path.join(skillRoot, 'too-large');
  await writeSkill(tooLarge, { 'SKILL.md': '# large\n' });
  const handle = await fsp.open(path.join(tooLarge, 'payload.bin'), 'w');
  await handle.truncate(25 * 1024 * 1024 + 1);
  await handle.close();
  // Linked: a symbolic link inside the skill.
  const linked = path.join(skillRoot, 'linked');
  await writeSkill(linked, { 'SKILL.md': '# linked\n', 'real.md': 'real\n' });
  await fsp.symlink(path.join(linked, 'real.md'), path.join(linked, 'link.md'));
  // Backups: two restorable backups of different skills and an oversized one.
  await writeSkill(path.join(backupRoot, 'hotel-1700000000000-aaaaaaaa'), { 'SKILL.md': '# hotel\n', 'notes.md': 'h\n' });
  await writeSkill(path.join(backupRoot, 'india-1700000000001-bbbbbbbb'), { 'SKILL.md': '# india\n' });
  const largeBackup = path.join(backupRoot, 'juliet-1700000000002-cccccccc');
  await writeSkill(largeBackup, { 'SKILL.md': '# juliet\n' });
  const backupHandle = await fsp.open(path.join(largeBackup, 'payload.bin'), 'w');
  await backupHandle.truncate(25 * 1024 * 1024 + 1);
  await backupHandle.close();

  require(path.join(root, 'desktop', 'src', 'main.js'));
  await readyCallback();
  const discover = handlers.get('setup-manager:discover');
  assert.ok(discover, 'the discover handler is registered');

  const report = await discover(null, {});
  const skillFindings = report.findings.filter((item) => ['skill', 'skill-link-excluded', 'attention'].includes(item.type) && path.dirname(item.path) === skillRoot);

  // Order: identical to the folder listing order, as the sequential loop produced.
  const listed = (await fsp.readdir(skillRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name);
  assert.deepEqual(skillFindings.map((item) => item.name), listed, 'skills stay in folder listing order');

  // Byte-identical manifests for normal skills.
  for (const name of normalNames) {
    const finding = skillFindings.find((item) => item.name === name);
    const reference = await referenceManifest(path.join(skillRoot, name));
    assert.equal(finding.type, 'skill');
    assert.equal(finding.contentHash, reference.identity, `${name}: identity matches the original algorithm`);
    assert.deepEqual(finding.files, reference.files, `${name}: file list matches the original algorithm`);
    assert.equal(finding.totalBytes, reference.totalBytes, `${name}: byte total matches the original algorithm`);
  }

  // Pass-1 rejections: same errors as before, and not one byte of content read.
  const expectRejected = async (folder, message) => {
    const finding = skillFindings.find((item) => item.path === folder);
    assert.equal(finding.type, 'attention');
    assert.equal(finding.description, `This skill could not be verified for duplicate cleanup: ${message} It was not changed.`);
    await assert.rejects(referenceManifest(folder), { message }, 'the original algorithm rejects with the same message');
    assert.deepEqual(readsUnder(folder), [], `${path.basename(folder)}: no file contents were read`);
  };
  contentReads.length = 0;
  await discover(null, {});
  await expectRejected(manyFiles, 'A skill contains too many files to verify safely.');
  await expectRejected(tooLarge, 'A skill is too large to verify safely.');
  const linkedFinding = skillFindings.find((item) => item.path === linked);
  assert.equal(linkedFinding.type, 'skill-link-excluded', 'linked skills stay excluded');
  assert.deepEqual(readsUnder(linked), [], 'linked skill: no file contents were read');
  assert.deepEqual(readsUnder(largeBackup), [], 'oversized backup: no file contents were read');

  // Backups: folder order kept, manifests identical, oversized backup reported as before.
  const backupFindings = report.findings.filter((item) => item.path && path.dirname(item.path) === backupRoot);
  const backupListing = (await fsp.readdir(backupRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => path.join(backupRoot, entry.name));
  assert.deepEqual(backupFindings.map((item) => item.path), backupListing, 'backups stay in folder listing order');
  for (const backup of backupFindings.filter((item) => item.type === 'skill-backup')) {
    const reference = await referenceManifest(backup.path);
    assert.equal(backup.contentHash, reference.identity);
    assert.deepEqual(backup.files, reference.files);
  }
  const largeBackupFinding = backupFindings.find((item) => item.path === largeBackup);
  assert.equal(largeBackupFinding.type, 'attention');
  assert.equal(largeBackupFinding.description, 'This skill backup could not be verified: A skill is too large to verify safely. It was not changed.');

  console.log(JSON.stringify({ ok: true, normalSkills: normalNames.length, rejectedWithoutReads: ['many-files', 'too-large', 'linked', 'juliet backup'] }));
}

run().finally(async () => {
  Module._load = originalLoad;
  fsp.readFile = originalReadFile;
  await fsp.rm(fixtureRoot, { recursive: true, force: true });
}).then(() => {
  // The main process keeps its own timers (update checks); the test is complete here.
  process.exit(0);
}).catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
