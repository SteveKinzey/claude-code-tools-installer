#!/usr/bin/env node
// Exact npmrc helper source; fake filesystem only. No user files or child processes modified.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function checkComponentNpmBigInt(repo = path.resolve(__dirname, '..')) {
  const text = fs.readFileSync(path.join(repo, 'desktop/src/main.js'), 'utf8');
  const start = text.indexOf('async function prepareComponentNpmConfig()');
  const end = text.indexOf('function componentNpmEnvironment()', start);
  assert.ok(start >= 0 && end > start, 'actual config helper is present');
  const high = 9007199254740992n;
  const changed = high + 1n;
  assert.equal(Number(high), Number(changed), 'fixture identities genuinely collide when coerced to Number');
  const home = path.resolve(repo, '.disposable-bigint-home');
  const setup = path.join(home, '.setup-my-claude');
  const root = path.join(setup, 'component-npm');
  const cache = path.join(root, 'cache');
  const config = path.join(root, 'npmrc');
  const cases = ['directory-inode-swap', 'directory-device-swap', 'temporary-inode-swap', 'published-inode-swap', 'stable', 'hardlink', 'nonempty-config'];
  for (const scenario of cases) {
    let published = false;
    let setupReads = 0;
    let renamed = false;
    const calls = [];
    const stat = (kind, options, ino = high, dev = high, nlink = 1n, size = 0n) => {
      calls.push(options);
      const value = number => options?.bigint === true ? number : Number(number);
      return { ino: value(ino), dev: value(dev), nlink: value(nlink), size: value(size),
        isFile: () => kind === 'file', isDirectory: () => kind === 'directory', isSymbolicLink: () => false };
    };
    const mock = {
      realpath: async folder => folder,
      mkdir: async () => {},
      lstat: async (file, options) => {
        if ([setup, root, cache].includes(file)) {
          if (file === setup) setupReads += 1;
          const swapped = file === setup && setupReads > 1;
          return stat('directory', options,
            swapped && scenario === 'directory-inode-swap' ? changed : high,
            swapped && scenario === 'directory-device-swap' ? changed : high);
        }
        if (file === config) {
          if (!published) { const error = new Error('absent'); error.code = 'ENOENT'; throw error; }
          return stat('file', options, scenario === 'published-inode-swap' ? changed : high, high,
            scenario === 'hardlink' ? 2n : 1n, scenario === 'nonempty-config' ? 1n : 0n);
        }
        assert.equal(path.dirname(file), root, 'temporary stays in fixture-owned root');
        return stat('file', options, scenario === 'temporary-inode-swap' ? changed : high);
      },
      open: async () => ({ stat: async options => stat('file', options), chmod: async () => {}, sync: async () => {}, close: async () => {} }),
      rename: async () => { renamed = true; published = true; },
      unlink: async () => {},
    };
    const context = { fs: mock, nodeFs: fs, path, randomUUID: () => 'fixture-id', app: { getPath: () => home },
      setupManagerDir: () => setup, componentNpmPaths: () => ({ root, cache, userconfig: config }) };
    vm.createContext(context);
    vm.runInContext(text.slice(start, end) + '\nglobalThis.prepare = prepareComponentNpmConfig;', context);
    let refused = false;
    try { await context.prepare(); } catch (error) {
      assert.match(error.message, /CCTI npm config\/cache/, 'refusal must come from actual safety check, not harness error');
      refused = true;
    }
    assert.equal(refused, scenario !== 'stable', `${scenario}: large identities and BigInt link/size rules retain correct behavior`);
    if (scenario.startsWith('directory-') || scenario === 'temporary-inode-swap') assert.equal(renamed, false, 'identity mismatch prevents config publication');
    assert.ok(calls.length > 0 && calls.every(options => options?.bigint === true), `${scenario}: every identity stat must explicitly request BigInt`);
  }
  console.log('Component npm BigInt identity regression passed: 7 scenarios preserve distinct dev/ino above Number.MAX_SAFE_INTEGER, stable preparation, link-count and size checks.');
}
module.exports = checkComponentNpmBigInt;
if (require.main === module) checkComponentNpmBigInt().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
