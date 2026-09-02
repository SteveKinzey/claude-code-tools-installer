#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { inspectProjectPackage, prepareProjectPackage } = require('../desktop/src/project-prerequisites');

async function run() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccti-project-prerequisites-'));
  try {
    const emptyProject = path.join(tempRoot, 'New Project');
    await fs.mkdir(emptyProject);
    const preview = await prepareProjectPackage(emptyProject, { dryRun: true });
    assert.equal(preview.wouldCreate, true);
    await assert.rejects(fs.access(path.join(emptyProject, 'package.json')));

    const created = await prepareProjectPackage(emptyProject);
    assert.equal(created.created, true);
    const createdManifest = JSON.parse(await fs.readFile(path.join(emptyProject, 'package.json'), 'utf8'));
    assert.deepEqual(createdManifest, { name: 'new-project', version: '0.1.0', private: true });

    const existingProject = path.join(tempRoot, 'existing-project');
    await fs.mkdir(existingProject);
    const original = '{\n  "name": "existing",\n  "private": true\n}\n';
    await fs.writeFile(path.join(existingProject, 'package.json'), original, 'utf8');
    const existing = await prepareProjectPackage(existingProject);
    assert.equal(existing.created, false);
    assert.equal(await fs.readFile(path.join(existingProject, 'package.json'), 'utf8'), original);

    const invalidProject = path.join(tempRoot, 'invalid-project');
    await fs.mkdir(invalidProject);
    await fs.writeFile(path.join(invalidProject, 'package.json'), '{ invalid json', 'utf8');
    await assert.rejects(inspectProjectPackage(invalidProject), /left it unchanged/i);
    assert.equal(await fs.readFile(path.join(invalidProject, 'package.json'), 'utf8'), '{ invalid json');

    await assert.rejects(prepareProjectPackage(''), /Choose a project folder/);
    console.log('Project prerequisite behavior passed: CCTI previews or creates a minimal package.json, never overwrites existing content, and leaves malformed files untouched.');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
