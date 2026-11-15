'use strict';
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const destinations = new Set();

function inside(anchor, target) {
  const relative = path.relative(anchor, target);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

async function plainTree(anchor, target, create = false) {
  anchor = path.resolve(anchor);
  target = path.resolve(target);
  if (!inside(anchor, target)) throw new Error('The skill destination is outside its reviewed scope.');
  const realAnchor = await fs.realpath(anchor);
  let current = anchor;
  for (const part of ['', ...path.relative(anchor, target).split(path.sep).filter(Boolean)]) {
    if (part) {
      current = path.join(current, part);
      if (create) {
        try { await fs.mkdir(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
    }
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('The skill destination contains a symbolic-link or non-directory ancestor.');
    if (await fs.realpath(current) !== path.join(realAnchor, path.relative(anchor, current))) throw new Error('The skill destination resolves outside its reviewed plain scope.');
  }
}

async function installReviewedSkill({ source, destination, anchor, manifest, readManifest }) {
  source = path.resolve(source);
  destination = path.resolve(destination);
  anchor = path.resolve(anchor);
  const root = path.join(anchor, '.claude', 'skills');
  if (path.dirname(destination) !== root) throw new Error('The skill destination is outside its reviewed scope.');
  if (destinations.has(destination)) throw new Error('Another addition is already writing this skill destination.');
  destinations.add(destination);
  let reserved = null;
  const verifyReservation = async () => {
    await plainTree(anchor, destination);
    const stat = await fs.lstat(destination, { bigint: true });
    if (!reserved || stat.dev !== reserved.dev || stat.ino !== reserved.ino) throw new Error('The reserved skill destination changed.');
  };
  try {
    const current = await readManifest(source);
    if (!manifest || current.identity !== manifest.identity || JSON.stringify(current.files) !== JSON.stringify(manifest.files)) {
      throw new Error('The reviewed skill changed after review. Review it again before adding it.');
    }
    await plainTree(anchor, root, true);
    // Exclusive mkdir is the no-overwrite reservation. A check-before-copy is insufficient.
    await fs.mkdir(destination, { mode: 0o700 });
    reserved = await fs.lstat(destination, { bigint: true });
    await verifyReservation();
    // Publish SKILL.md last, after all other reviewed files have been copied. No unreviewed
    // new source file is enumerated/copied, and every opened file is checked against review.
    const files = [...manifest.files].sort((a, b) => Number(a.path === 'SKILL.md') - Number(b.path === 'SKILL.md'));
    for (const file of files) {
      const parts = file.path.split('/');
      if (!parts.length || parts.some((p) => !p || p === '.' || p === '..' || p.includes('\\'))) throw new Error('Unsafe reviewed skill path.');
      const from = path.join(source, ...parts);
      const to = path.join(destination, ...parts);
      await verifyReservation();
      await plainTree(source, path.dirname(from));
      const input = await fs.open(from, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      let bytes;
      let outputMode = 0o600;
      try {
        const stat = await input.stat();
        if (!stat.isFile() || stat.size !== file.size || file.size > 25 * 1024 * 1024) throw new Error('The reviewed skill changed after review.');
        // Preserve executable skill helpers while keeping new copies private.
        if (stat.mode & 0o100) outputMode = 0o700;
        bytes = Buffer.alloc(file.size);
        let offset = 0;
        while (offset < bytes.length) {
          const read = await input.read(bytes, offset, bytes.length - offset, offset);
          if (!read.bytesRead) throw new Error('The reviewed skill changed after review.');
          offset += read.bytesRead;
        }
        if ((await input.stat()).size !== file.size || createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
          throw new Error('The reviewed skill changed after review.');
        }
      } finally { await input.close(); }
      await plainTree(destination, path.dirname(to), true);
      const output = await fs.open(to, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), outputMode);
      try { await output.chmod(outputMode); await output.writeFile(bytes); } finally { await output.close(); }
    }
    await verifyReservation();
    const installed = await readManifest(destination);
    if (installed.identity !== manifest.identity) throw new Error('The copied skill did not match its reviewed content.');
  } catch (error) {
    if (reserved) {
      // Remove only our own new directory, never an existing or replaced destination.
      try { await verifyReservation(); await fs.rm(destination, { recursive: true, force: false }); } catch {}
    }
    if (error.code === 'EEXIST') throw Object.assign(new Error('This skill is already available; CCTI did not overwrite it.'), { code: 'EEXIST' });
    throw error;
  } finally { destinations.delete(destination); }
}

module.exports = { installReviewedSkill };
