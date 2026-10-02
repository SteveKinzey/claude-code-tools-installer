#!/usr/bin/env node
// Supply-chain guard for the setup adapters: every third-party package or repository that setup
// downloads and then runs must be pinned to an exact, reviewed version or commit.
//  1. The three adapters carry one identical block of CCTI_* pins.
//  2. No adapter, the Electron main process, or the catalogs runs an `@latest` or unversioned
//     third-party `npx` / `npm install -g` package (anything intentionally unpinned is allowlisted
//     below with its reason).
//  3. gstack is fetched by its pinned commit SHA and verified before its setup can run; the bash
//     fetch helper is exercised against a local repository, including the failure paths.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
// Windows checks files out with CRLF line endings; normalize so every pattern below matches on all platforms.
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n/g, '\n');
const bashAdapters = ['setup-my-claude.sh', 'setup-my-claude-linux.sh'];
const windowsAdapter = 'setup-my-claude.ps1';
const adapters = [...bashAdapters, windowsAdapter];

// ---- 1. One identical pin block in all three adapters ------------------------------------------
const expectedPins = [
  'CCTI_SKILLS_CLI_VERSION', 'CCTI_CLAUDE_MEM_VERSION', 'CCTI_PLAYWRIGHT_MCP_VERSION', 'CCTI_REPOMIX_VERSION',
  'CCTI_BUN_VERSION', 'CCTI_CODEGRAPH_VERSION', 'CCTI_FIRECRAWL_CLI_VERSION', 'CCTI_CLAUDE_CODE_ROUTER_VERSION',
  'CCTI_GSTACK_REPO', 'CCTI_GSTACK_COMMIT',
];

function pinsOf(name) {
  const source = read(name);
  const pattern = name.endsWith('.ps1') ? /^\$(CCTI_[A-Z_]+) = "([^"]*)"$/gm : /^(CCTI_[A-Z_]+)="([^"]*)"$/gm;
  const pins = {};
  for (const [, key, value] of source.matchAll(pattern)) {
    assert.equal(Object.hasOwn(pins, key), false, `${name} must define ${key} exactly once.`);
    pins[key] = value;
  }
  return pins;
}

const pinsByAdapter = Object.fromEntries(adapters.map((name) => [name, pinsOf(name)]));
const pins = pinsByAdapter['setup-my-claude.sh'];
assert.deepEqual(Object.keys(pins).sort(), [...expectedPins].sort(), 'setup-my-claude.sh must define exactly the reviewed CCTI_* pins.');
for (const name of adapters) {
  assert.deepEqual(pinsByAdapter[name], pins, `${name} must carry the same pinned versions as setup-my-claude.sh (bump all three adapters together).`);
}
for (const key of expectedPins.filter((key) => key.endsWith('_VERSION'))) {
  assert.match(pins[key], /^\d+\.\d+\.\d+$/, `${key} must be an exact version, not a range or tag.`);
}
assert.match(pins.CCTI_GSTACK_COMMIT, /^[0-9a-f]{40}$/, 'CCTI_GSTACK_COMMIT must be a full 40-character commit SHA.');
assert.equal(pins.CCTI_GSTACK_REPO, 'https://github.com/garrytan/gstack.git');
// Pins an adapter may define without using, with the reason.
const unusedPins = { 'setup-my-claude.ps1': ['CCTI_BUN_VERSION'] }; // Windows never runs gstack's Unix-only setup, so it never installs Bun.
for (const name of adapters) {
  const source = read(name);
  for (const key of expectedPins.filter((candidate) => !(unusedPins[name] || []).includes(candidate))) {
    const uses = source.split(key).length - 2; // minus the definition itself
    assert.ok(uses >= 1, `${name} defines ${key} but never uses it.`);
  }
}

// ---- 2. No @latest or unversioned third-party npx / npm-global execution -----------------------
// Lines that only describe, log, or detect a command (they never run third-party code).
const nonExecuting = [
  /^\s*#/,
  /^\s*(log|echo|Write-Log|Write-Host)\b/,
  /^\s*if \(\$LASTEXITCODE -ne 0\) \{ throw "[^"]*" \}$/, // error message only
  /\bcommand -v\b|Get-Command\b/,
  /^\s*for cmd in node npm npx git; do$/,
  /^\s*foreach \(\$cmd in @\("node", "npm", "npx", "git"\)\) \{$/,
  /^\s*\[pscustomobject\]@\{ Id=/, // the Windows item table's human-readable Action text
  /^[a-z0-9-]+\|[^|]*\|[^|]*\|[^|]*\|(yes|no)\|[^|]*$/, // the bash item table's human-readable action text
];
// Generic helpers that forward already-reviewed arguments (each caller is checked separately).
const forwardingHelpers = [
  /^\s*run_npx_isolated\(\) \{$/,
  /^\s*\(trap 'rm -rf -- "\$prefix_dir"' EXIT; npx --prefix "\$prefix_dir" "\$@"\) \|\| status=\$\?$/,
  /^\s*Invoke-Logged npx \(@\("--prefix", \$prefixDir\) \+ \$Arguments\)$/,
  /^\s*install_npm_global\(\) \{$/,
  /^\s*function Install-NpmGlobal \{$/,
];
// Pin references that make an execution line acceptable.
const pinned = /\$\{?CCTI_[A-Z_]+_VERSION\}?|"\$\{package\}@\$\{package_version\}"|"\$Package@\$PackageVersion"/;
const executesThirdPartyPackage = /(?<![-\w])npx(?![-\w])|\bnpm (install|i) -g\b|"install", "-g"|\binstall_npm_global\b|\bInstall-NpmGlobal\b|\bInvoke-NpxIsolated\b|\brun_npx_isolated\b|"skills@/;
// Intentionally unpinned, with the reason. Each entry must still match something, so stale
// entries are caught.
const allowlist = [
  {
    file: /^setup-my-claude\.sh$/,
    line: /for cask in claude-code claude-code@latest; do/,
    reason: 'Names Anthropic\'s first-party Homebrew cask so a fresh setup can remove it; nothing is installed from it.',
  },
  {
    file: /^setup-my-claude\.ps1$/,
    line: /function Invoke-NpxIsolated \{|Invoke-NpxIsolated \$skillArguments/,
    reason: 'Isolated-npx helper and its skills call; $skillArguments is built from the pinned CCTI_SKILLS_CLI_VERSION (asserted below).',
  },
];

function allowlisted(file, line) {
  const entry = allowlist.find((candidate) => candidate.file.test(file) && candidate.line.test(line));
  if (entry) entry.used = true;
  return Boolean(entry);
}

for (const name of adapters) {
  const lines = read(name).split(/\r?\n/);
  lines.forEach((line, index) => {
    const where = `${name}:${index + 1}: ${line.trim()}`;
    if (nonExecuting.some((pattern) => pattern.test(line))) return;
    if (/@latest\b/.test(line)) {
      assert.ok(allowlisted(name, line), `${where}\nSetup must not run an @latest package; pin it in the CCTI_* block.`);
      return;
    }
    if (!executesThirdPartyPackage.test(line)) return;
    if (forwardingHelpers.some((pattern) => pattern.test(line))) return;
    // Judge each command on the line separately, so a pinned call cannot vouch for an unpinned one.
    for (const command of line.split(/;\s|&&|\|\|/)) {
      if (!executesThirdPartyPackage.test(command) || pinned.test(command)) continue;
      assert.ok(allowlisted(name, line), `${where}\nSetup must not run an unversioned third-party npx or global npm package; pin it in the CCTI_* block.`);
    }
  });
}
const windowsSource = read(windowsAdapter);
assert.match(windowsSource, /\$skillArguments = @\("-y", "skills@\$CCTI_SKILLS_CLI_VERSION", "add",/, 'The Windows adapter must run the pinned skills CLI.');
for (const name of bashAdapters) {
  assert.match(read(name), /run_npx_isolated -y "skills@\$\{CCTI_SKILLS_CLI_VERSION\}" add /, `${name} must run the pinned skills CLI.`);
  assert.match(read(name), /run_cmd npm install -g "\$\{package\}@\$\{package_version\}"/, `${name} must install global npm tools at their pinned version.`);
  assert.match(read(name), /record_manifest "npm-global" "\$package" "\$bin" "\$item"/, `${name} must keep recording the bare package name so rollback still matches it.`);
}
assert.match(windowsSource, /Invoke-Logged npm @\("install", "-g", "\$Package@\$PackageVersion"\)/, 'The Windows adapter must install global npm tools at their pinned version.');
assert.match(windowsSource, /Add-Manifest "npm-global" \$Package \$Bin \$ItemId/, 'The Windows adapter must keep recording the bare package name so rollback still matches it.');

// The desktop app and catalogs: no @latest package and no unversioned npx / npm-global install.
const appFiles = ['desktop/src/main.js', 'desktop/catalog.json', 'desktop/catalog-details.json', 'desktop/convex-components.json'];
const appAllowlist = [
  {
    file: 'desktop/src/main.js',
    line: /'claude-code@latest'/,
    reason: 'Detects/removes Anthropic\'s first-party Claude Code Homebrew cask; nothing is installed from it.',
  },
  {
    file: 'desktop/src/main.js',
    line: /spawnSafely\(npmCommand, \['install', \.\.\.packages\]/,
    reason: 'Project-local Convex component install the user reviews per project; recorded in that project\'s own package-lock. Not a global or setup-time package.',
  },
  {
    file: 'desktop/convex-components.json',
    line: /"installCommand": "npm install [^"]+"/,
    reason: 'Display text for the same reviewed project-local Convex component install (see main.js entry).',
  },
];
for (const file of appFiles) {
  read(file).split(/\r?\n/).forEach((line, index) => {
    const risky = /@latest\b/.test(line)
      || /['"`]npx(\.cmd)?['"`]\s*[,)]|\bnpx -y\b|\bnpx --yes\b/.test(line)
      || /npm (install|i) -g\b|'install', '-g'|"install", "-g"/.test(line)
      || /\['install',/.test(line)
      || /"installCommand"/.test(line);
    if (!risky) return;
    const entry = appAllowlist.find((candidate) => candidate.file === file && candidate.line.test(line));
    assert.ok(entry, `${file}:${index + 1}: ${line.trim()}\nThe desktop app must not run an @latest or unversioned third-party package.`);
    entry.used = true;
  });
}
for (const entry of [...allowlist, ...appAllowlist]) {
  assert.ok(entry.used, `Stale allowlist entry (nothing matches it any more; remove it): ${entry.line} — ${entry.reason}`);
}

// ---- 3. gstack is fetched by pinned SHA and verified before setup ------------------------------
for (const name of adapters) {
  const source = read(name);
  assert.equal(/git(\s+|", ")clone[^\n]*gstack/.test(source), false, `${name} must not clone gstack's moving default branch.`);
}
for (const name of bashAdapters) {
  const source = read(name);
  const gstackBlock = source.slice(source.indexOf('    gstack)\n'), source.indexOf('    ecc)\n'));
  const fetchAt = gstackBlock.indexOf('fetch_pinned_git_commit "$CCTI_GSTACK_REPO" "$CCTI_GSTACK_COMMIT" "$dest"');
  assert.ok(fetchAt > 0, `${name} must fetch gstack by its pinned commit.`);
  assert.ok(gstackBlock.indexOf("./setup") > fetchAt, `${name} must only run gstack's setup after the pinned fetch.`);
  const helper = source.match(/^fetch_pinned_git_commit\(\) \{\n[\s\S]*?\n\}\n/m)?.[0] || '';
  assert.match(helper, /fetch --depth 1 origin "\$commit"/, `${name} must fetch exactly the pinned commit.`);
  assert.match(helper, /checkout -q --detach FETCH_HEAD/, `${name} must check out the fetched commit.`);
  assert.match(helper, /actual="\$\(git -C "\$staging" rev-parse HEAD/, `${name} must read back the checked-out commit.`);
  assert.match(helper, /if \[\[ "\$actual" != "\$commit" \]\]; then/, `${name} must refuse a checkout that is not the pinned commit.`);
}
{
  const gstackBlock = windowsSource.slice(windowsSource.indexOf('    "gstack" {'), windowsSource.indexOf('    "ecc" {'));
  assert.match(gstackBlock, /Get-PinnedGitCommit \$CCTI_GSTACK_REPO \$CCTI_GSTACK_COMMIT \$dest/, 'The Windows adapter must fetch gstack by its pinned commit.');
  const helper = windowsSource.slice(windowsSource.indexOf('function Get-PinnedGitCommit {'), windowsSource.indexOf('function Install-Mcp {'));
  assert.match(helper, /"fetch", "--depth", "1", "origin", \$Commit/, 'The Windows adapter must fetch exactly the pinned commit.');
  assert.match(helper, /"checkout", "-q", "--detach", "FETCH_HEAD"/, 'The Windows adapter must check out the fetched commit.');
  assert.match(helper, /if \(\$actual -ne \$Commit\) \{ throw/, 'The Windows adapter must refuse a checkout that is not the pinned commit.');
}

// Behavioral check of the bash helper against a local repository (no network).
function behavioralFetchCheck(adapter) {
  const helper = read(adapter).match(/^fetch_pinned_git_commit\(\) \{\n[\s\S]*?\n\}\n/m)[0];
  const work = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ccti-pinned-fetch-'));
  const git = (args, cwd = work) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'CCTI', GIT_AUTHOR_EMAIL: 'ccti@example.invalid', GIT_COMMITTER_NAME: 'CCTI', GIT_COMMITTER_EMAIL: 'ccti@example.invalid' } });
    assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
    return result.stdout.trim();
  };
  try {
    const upstream = path.join(work, 'upstream');
    git(['init', '-q', upstream]);
    git(['config', 'uploadpack.allowAnySHA1InWant', 'true'], upstream);
    fs.writeFileSync(path.join(upstream, 'setup'), '#!/usr/bin/env bash\necho pinned\n', { mode: 0o755 });
    git(['add', 'setup'], upstream);
    git(['commit', '-q', '-m', 'pinned'], upstream);
    const pinnedCommit = git(['rev-parse', 'HEAD'], upstream);
    fs.writeFileSync(path.join(upstream, 'setup'), '#!/usr/bin/env bash\necho moved-on\n', { mode: 0o755 });
    git(['commit', '-q', '-am', 'newer upstream'], upstream);
    const repoUrl = `file://${upstream}`;
    const run = (commit, dest, { lie = false } = {}) => spawnSync('bash', ['-c', `set -Eeuo pipefail
DRY_RUN=0
BASE_DIR="$1/base"
log() { printf '%s\\n' "$*"; }
run_cmd() { "$@"; }
${lie ? 'git() { if [[ "$*" == *" rev-parse HEAD" ]]; then echo 0123456789abcdef0123456789abcdef01234567; else command git "$@"; fi; }' : ''}
${helper}
fetch_pinned_git_commit "$2" "$3" "$4"`, 'ccti', work, repoUrl, commit, dest], { encoding: 'utf8' });

    const good = path.join(work, 'skills', 'good');
    const ok = run(pinnedCommit, good);
    assert.equal(ok.status, 0, `${adapter}: pinned fetch must succeed.\n${ok.stdout}\n${ok.stderr}`);
    assert.equal(git(['rev-parse', 'HEAD'], good), pinnedCommit, `${adapter}: the checkout must be the pinned commit, not the newer upstream HEAD.`);
    assert.equal(fs.readFileSync(path.join(good, 'setup'), 'utf8').trim().split('\n').pop(), 'echo pinned');

    const missing = path.join(work, 'skills', 'missing');
    const absent = run('f'.repeat(40), missing);
    assert.notEqual(absent.status, 0, `${adapter}: an unknown pinned commit must stop setup.`);
    assert.match(absent.stderr, /could not fetch the pinned commit/);
    assert.equal(fs.existsSync(missing), false, `${adapter}: a failed fetch must leave nothing at the destination.`);

    const mismatched = path.join(work, 'skills', 'mismatched');
    const lied = run(pinnedCommit, mismatched, { lie: true });
    assert.notEqual(lied.status, 0, `${adapter}: a checkout that is not the pinned commit must stop setup.`);
    assert.match(lied.stderr, /not the pinned commit/);
    assert.equal(fs.existsSync(mismatched), false, `${adapter}: a mismatched checkout must leave nothing at the destination.`);

    const short = run(pinnedCommit.slice(0, 12), path.join(work, 'skills', 'short'));
    assert.notEqual(short.status, 0, `${adapter}: an abbreviated pin must be refused.`);
    assert.match(short.stderr, /full 40-character commit SHA/);

    assert.deepEqual(fs.readdirSync(path.join(work, 'base')), [], `${adapter}: staging folders must be cleaned up.`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

let behavioral = 'skipped on Windows';
if (process.platform !== 'win32') {
  bashAdapters.forEach(behavioralFetchCheck);
  behavioral = 'checked';
}

console.log(`Pinned setup code passed: ${expectedPins.length} identical pins across ${adapters.length} adapters, no @latest or unversioned third-party npx/npm-global execution, gstack fetched by verified SHA (behavioral fetch check: ${behavioral}).`);
