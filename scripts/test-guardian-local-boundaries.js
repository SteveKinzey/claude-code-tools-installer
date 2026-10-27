#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const { installReviewedSkill } = require('../desktop/src/custom-skill-copy');
const { processTree, superviseInstaller } = require('../desktop/src/installer-supervisor');

const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function manifest(root) {
  const files = [];
  const walk = async (directory) => {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('A skill contains a symbolic link.');
      if (entry.isDirectory()) await walk(file);
      else { const bytes = await fs.readFile(file); files.push({ path: path.relative(root, file).split(path.sep).join('/'), size: bytes.length, sha256: sha(bytes) }); }
    }
  };
  await walk(root);
  return { files, identity: sha(JSON.stringify(files)) };
}

async function copies(root) {
  const source = path.join(root, 'source-skill');
  const anchor = path.join(root, 'project');
  await fs.mkdir(path.join(source, 'references'), { recursive: true });
  await fs.mkdir(anchor);
  await fs.writeFile(path.join(source, 'SKILL.md'), '# Reviewed fixture\n');
  await fs.writeFile(path.join(source, 'references/notes.md'), 'reviewed bytes\n');
  await fs.writeFile(path.join(source, 'helper.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const destination = path.join(anchor, '.claude/skills/my-skill');
  const plan = { source, anchor, destination, manifest: await manifest(source), readManifest: manifest };
  await installReviewedSkill(plan);
  assert.deepEqual(await manifest(destination), plan.manifest, 'positive copy preserves complete reviewed content');
  if (process.platform !== 'win32') assert.ok((await fs.stat(path.join(destination, 'helper.sh'))).mode & 0o100, 'executable skill helpers retain their user execute bit');
  await assert.rejects(installReviewedSkill(plan), /already available/, 'existing destinations are never overwritten');
  assert.deepEqual(await manifest(destination), plan.manifest);

  const outside = path.join(root, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'sentinel'), 'unchanged');
  const linked = path.join(root, 'linked-project');
  await fs.mkdir(linked);
  await fs.symlink(outside, path.join(linked, '.claude'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(installReviewedSkill({ ...plan, anchor: linked, destination: path.join(linked, '.claude/skills/my-skill') }), /symbolic-link|plain scope/);
  assert.deepEqual((await fs.readdir(outside)).sort(), ['sentinel'], 'no child created through linked ancestor');
  assert.equal(await fs.readFile(path.join(outside, 'sentinel'), 'utf8'), 'unchanged');

  let releaseReader;
  const gate = new Promise((done) => { releaseReader = done; });
  const parallelPlan = { ...plan, destination: path.join(anchor, '.claude/skills/parallel'), readManifest: async (p) => { if (p === source) await gate; return manifest(p); } };
  const first = installReviewedSkill(parallelPlan);
  await assert.rejects(installReviewedSkill(parallelPlan), /already writing/, 'same destination is locked before any await');
  releaseReader();
  await first;
  assert.deepEqual(await manifest(parallelPlan.destination), plan.manifest);

  const mkdir = fs.mkdir;
  const raced = path.join(anchor, '.claude/skills/raced');
  fs.mkdir = async (p, options) => {
    if (p === raced) { await mkdir(p); await fs.writeFile(path.join(p, 'sentinel'), 'existing writer'); }
    return mkdir(p, options);
  };
  try { await assert.rejects(installReviewedSkill({ ...plan, destination: raced }), /already available/); }
  finally { fs.mkdir = mkdir; }
  assert.deepEqual(await fs.readdir(raced), ['sentinel']);
  assert.equal(await fs.readFile(path.join(raced, 'sentinel'), 'utf8'), 'existing writer');

  const changed = path.join(anchor, '.claude/skills/changed');
  await assert.rejects(installReviewedSkill({ ...plan, destination: changed, readManifest: async (p) => {
    const reviewed = await manifest(p);
    if (p === source) await fs.writeFile(path.join(source, 'references/notes.md'), 'unreviewed bytes');
    return reviewed;
  } }), /changed after review/);
  await assert.rejects(fs.lstat(changed), { code: 'ENOENT' }, 'partial new copy is cleaned after source change');
  await fs.writeFile(path.join(source, 'references/notes.md'), 'reviewed bytes\n');

  const failed = path.join(anchor, '.claude/skills/failed');
  const open = fs.open;
  fs.open = async (file, ...args) => {
    if (file === path.join(failed, 'SKILL.md')) throw Object.assign(new Error('injected write failure'), { code: 'EIO' });
    return open(file, ...args);
  };
  try { await assert.rejects(installReviewedSkill({ ...plan, destination: failed }), /injected write failure/); }
  finally { fs.open = open; }
  await assert.rejects(fs.lstat(failed), { code: 'ENOENT' });
  assert.deepEqual(await manifest(destination), plan.manifest, 'failure cleanup leaves pre-existing skills unchanged');
  console.log('PASS custom skills: normal nested copy, existing destination, linked scope, concurrent reviews, destination race, source change, partial-write rollback.');
}

async function supervision() {
  const options = { timeoutMs: 20, graceMs: 10, forceWaitMs: 10, pollMs: 2 };
  const normal = new EventEmitter();
  const normalSignals = [];
  const normalResult = superviseInstaller(normal, { ...options, tree: { alive: () => false, signal: async (s) => normalSignals.push(s) } });
  normal.emit('close', 0);
  assert.equal((await normalResult).code, 0);
  assert.deepEqual(normalSignals, []);

  const stubborn = new EventEmitter();
  let alive = true;
  const signals = [];
  const result = await superviseInstaller(stubborn, { ...options, tree: { alive: () => alive, signal: async (s) => {
    signals.push(s);
    stubborn.emit('error', new Error('injected failed kill'));
  } } });
  assert.equal(result.stillRunning, true);
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  let released = false;
  result.whenStopped.then(() => { released = true; });
  stubborn.emit('close', -1);
  await delay(6);
  assert.equal(released, false, 'root close does not prove descendant exit');
  alive = false;
  await Promise.race([result.whenStopped, delay(500).then(() => { throw new Error('retained supervisor did not observe exit'); })]);
  assert.equal(released, true, 'lock can be released after group exit and root close');

  const terminated = new EventEmitter();
  let terminatedAlive = true;
  const terminatedResult = await superviseInstaller(terminated, { ...options, fresh: true, tree: {
    alive: () => terminatedAlive,
    signal: async (s) => { if (s === 'SIGKILL') { terminatedAlive = false; terminated.emit('close', -1); } },
  } });
  assert.equal(terminatedResult.timedOut, true);
  assert.equal(terminatedResult.stillRunning, undefined);
  assert.match(terminatedResult.error, /may already have deleted.*no automatic backup/);
  assert.doesNotMatch(terminatedResult.error, /did not remove/);
  const exitedWindowsRoot = new EventEmitter();
  exitedWindowsRoot.pid = 123;
  const windowsTree = processTree(exitedWindowsRoot, 'win32');
  exitedWindowsRoot.emit('close', 0);
  await assert.rejects(windowsTree.signal('SIGKILL'), /root already exited/, 'Never taskkill a reusable exited-root PID');
  assert.equal(windowsTree.alive(), true, 'Unknown Windows descendants retain mutation authority');
  console.log('PASS setup supervisor: normal exit, ignored termination, kill errors, escalation, retained group lock, delayed descendant exit, truthful fresh timeout.');
}

async function nativeGroup(root) {
  const marker = path.join(root, 'writer');
  const writer = `process.on('SIGTERM',()=>{});setInterval(()=>require('node:fs').appendFileSync(${JSON.stringify(marker)},'.'),10)`;
  const parent = `process.on('SIGTERM',()=>{});require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(writer)}],{stdio:'inherit'});console.log('ready');setInterval(()=>{},1000)`;
  const child = spawn(process.execPath, ['-e', parent], { detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  const nativeTree = processTree(child);
  let emergency;
  try {
    await Promise.race([new Promise((done) => child.stdout.once('data', done)), delay(3000).then(() => { throw new Error('native process fixture did not start'); })]);
    for (let i = 0; i < 100; i += 1) {
      if (await fs.stat(marker).catch(() => null)) break;
      await delay(20);
    }
    assert.ok((await fs.stat(marker)).size > 0, 'writer descendant must be active before testing termination');
    const result = await superviseInstaller(child, { timeoutMs: 30, graceMs: 30, forceWaitMs: 50, pollMs: 10, tree: nativeTree });
    assert.equal(result.timedOut, true);
    if (result.stillRunning) {
      await Promise.race([result.whenStopped, new Promise((_, reject) => { emergency = setTimeout(() => reject(new Error('native group did not exit')), 3000); })]);
    }
    const size = (await fs.stat(marker)).size;
    await delay(80);
    assert.equal((await fs.stat(marker)).size, size, 'owned writer descendant is stopped before retry');
    console.log(`PASS native ${process.platform} timeout: real parent and termination-resistant writer descendant stopped; sentinel writes cease.`);
  } finally {
    clearTimeout(emergency);
    try { await nativeTree.signal('SIGKILL'); } catch {}
  }
}

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ccti-guardian-local-'));
  try { await copies(root); await supervision(); await nativeGroup(root); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
