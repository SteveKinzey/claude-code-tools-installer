#!/usr/bin/env node
// Exercises only --uninstall --dry-run with disposable homes and command stubs. It never runs a
// real installer or remover; the Windows adapter is checked structurally because this macOS runner
// has no PowerShell host.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const fixture = fs.readFileSync(path.join(root, 'scripts', 'fixtures', 'adapter-rollback-safety', 'manifest.tsv.in'), 'utf8');
const bashAdapters = ['setup-my-claude.sh', 'setup-my-claude-linux.sh'];
const windowsAdapter = 'setup-my-claude.ps1';
const tempRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ccti-adapter-rollback-safety-'));

function writeExecutable(file, body) {
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

function createCommandStubs(bin) {
  fs.mkdirSync(bin, { recursive: true });
  writeExecutable(path.join(bin, 'node'), 'echo v22.0.0');
  writeExecutable(path.join(bin, 'npx'), 'exit 0');
  writeExecutable(path.join(bin, 'git'), 'if [ "$1" = "--version" ]; then echo "git version 2.0"; fi\nexit 0');
  // npm list succeeds so the approved npm manifest action reaches the dry-run command boundary.
  writeExecutable(path.join(bin, 'npm'), 'case "$1" in --version) echo 10.0.0 ;; list) exit 0 ;; uninstall) exit 99 ;; esac\nexit 0');
}

function run(adapter, args, cwd, env) {
  return spawnSync('/bin/bash', [path.join(root, adapter), ...args], {
    cwd,
    env,
    encoding: 'utf8',
  });
}

function count(output, fragment) {
  return output.split(fragment).length - 1;
}

function assertSourceContracts() {
  for (const adapter of bashAdapters) {
    const source = fs.readFileSync(path.join(root, adapter), 'utf8');
    assert.match(source, /rollback_expected_path\(\)/, `${adapter} must derive an expected path from the record kind and item.`);
    assert.match(source, /path:gstack\).*\$\{HOME\}\/\.claude\/skills\/gstack/, `${adapter} must preserve intentional global gstack rollback.`);
    assert.match(source, /skill:taste-skill\) skill="design-taste-frontend"/, `${adapter} must preserve reviewed skill rollback.`);
    assert.match(source, /\[\[ ! -L "\$current" \]\] \|\| return 1/, `${adapter} must reject symlinked path components.`);
    assert.match(source, /run_cmd rm -rf -- "\$target"/, `${adapter} must use the guarded target with an end-of-options marker.`);
    assert.match(source, /rollback_npm_target_is_allowed/, `${adapter} must allowlist npm rollback targets.`);
    assert.match(source, /rollback_mcp_is_allowed/, `${adapter} must allowlist MCP rollback targets.`);
  }

  const windows = fs.readFileSync(path.join(root, windowsAdapter), 'utf8');
  assert.match(windows, /function Get-RollbackExpectedPath/, 'Windows must map every path rollback to a reviewed item target.');
  assert.match(windows, /function Test-RollbackPathIsSafe/, 'Windows must reject unsafe path rollback records.');
  assert.match(windows, /Test-RollbackPathHasReparsePoint/, 'Windows must reject reparse points/symlinks in a rollback path.');
  assert.match(windows, /"path\|gstack"[\s\S]{0,120}\$HOME[\s\S]{0,80}gstack/, 'Windows must preserve intentional global gstack rollback.');
  assert.match(windows, /Join-Path \(Get-Location\)\.Path[\s\S]{0,80}\$skill/, 'Windows must only accept a project skill from the current project directory.');
  assert.match(windows, /Remove-Item -LiteralPath \$target -Recurse -Force/, 'Windows must remove only the guarded literal target.');
  assert.match(windows, /Test-RollbackNpmTarget/, 'Windows must allowlist npm rollback targets.');
  assert.match(windows, /Test-RollbackMcpTarget/, 'Windows must allowlist MCP rollback targets.');
}

function testDryRunDoesNotCreateState(adapter, bin) {
  const home = path.join(tempRoot, `${adapter}-empty-home`);
  const project = path.join(tempRoot, `${adapter}-empty-project`);
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  const result = run(adapter, ['--uninstall', '--dry-run', '--yes'], project, {
    ...process.env,
    HOME: home,
    PATH: `${bin}:/usr/bin:/bin`,
  });
  assert.equal(result.status, 0, `${adapter} empty-home dry run failed:\n${result.stdout}\n${result.stderr}`);
  assert.deepEqual(fs.readdirSync(home), [], `${adapter} dry-run rollback must not create installer state when no manifest exists.`);
}

function testDryRunManifestSafety(adapter, bin) {
  const work = path.join(tempRoot, adapter.replace(/[^a-z0-9]+/gi, '-'));
  const home = path.join(work, 'home');
  const project = path.join(work, 'project');
  const base = path.join(home, '.setup-my-claude');
  const sentinel = path.join(home, 'DO-NOT-DELETE');
  const legitimatePaths = [
    path.join(home, '.claude', 'reference-repos', 'learn-claude-code'),
    path.join(home, '.claude', 'skills', 'gstack'),
    path.join(project, '.claude', 'skills', 'design-taste-frontend'),
    path.join(base, 'node-runtime'),
  ];
  fs.mkdirSync(project, { recursive: true });
  for (const target of legitimatePaths) fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(sentinel, 'CCTI rollback sentinel\n');
  const symlinkTarget = path.join(home, '.claude', 'reference-repos', 'multica');
  fs.symlinkSync(sentinel, symlinkTarget);

  const manifest = fixture
    .replaceAll('__HOME__', home)
    .replaceAll('__PROJECT__', project);
  fs.writeFileSync(path.join(base, 'manifest.tsv'), manifest);
  const beforeManifest = fs.readFileSync(path.join(base, 'manifest.tsv'), 'utf8');
  const result = run(adapter, ['--uninstall', '--dry-run', '--yes'], project, {
    ...process.env,
    HOME: home,
    PATH: `${bin}:/usr/bin:/bin`,
  });
  const output = `${result.stdout}${result.stderr}`;

  assert.equal(result.status, 0, `${adapter} hostile-manifest dry run failed:\n${output}`);
  for (const target of legitimatePaths) {
    assert.match(output, new RegExp(`\\+ rm -rf -- ${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), `${adapter} must retain its reviewed rollback action for ${target}.`);
    assert.ok(fs.statSync(target).isDirectory(), `${adapter} dry run must not remove the approved fixture target.`);
  }
  assert.match(output, /\+ npm uninstall -g repomix/, `${adapter} must retain the reviewed npm rollback action in dry-run mode.`);
  assert.match(output, /Dry run: would check whether MCP server 'repomix' already exists/, `${adapter} must keep approved MCP rollback behind the no-command dry-run check.`);
  assert.equal(count(output, '+ rm -rf -- '), legitimatePaths.length, `${adapter} must not add a deletion action for an unsafe manifest target.`);
  assert.ok(count(output, 'Skipping untrusted manifest entry') >= 9, `${adapter} must report rejected home/root/relative/traversal/symlink/mismatched records.`);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'CCTI rollback sentinel\n', `${adapter} must not touch the disposable HOME sentinel.`);
  assert.ok(fs.lstatSync(symlinkTarget).isSymbolicLink(), `${adapter} must not follow the symlink fixture.`);
  assert.equal(fs.readFileSync(path.join(base, 'manifest.tsv'), 'utf8'), beforeManifest, `${adapter} dry-run rollback must not rewrite the manifest.`);
  assert.deepEqual(fs.readdirSync(base).sort(), ['manifest.tsv', 'node-runtime'], `${adapter} dry-run rollback must not create logs or other state.`);
}

function main() {
  try {
    const bin = path.join(tempRoot, 'bin');
    createCommandStubs(bin);
    assertSourceContracts();
    for (const adapter of bashAdapters) {
      testDryRunDoesNotCreateState(adapter, bin);
      testDryRunManifestSafety(adapter, bin);
    }
    console.log('Adapter rollback safety passed: macOS/Linux dry runs reject home, root, relative, traversal, symlink, and item-target mismatch records without touching disposable-HOME sentinels or creating state; the Windows allowlist/reparse-point contract is source-checked.');
  }
  finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main();
