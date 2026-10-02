#!/usr/bin/env node
// Optional reference repositories (ui-ux-pro-max, caveman, and the other "clone reference repo"
// items) are copies the user reads, not code setup runs. When one moves or disappears upstream,
// setup must skip that item, keep installing the rest, and report the skip with exit code 3,
// never abort the whole run (2026-10-02: a moved ui-ux-pro-max repo stopped every later item).
//  1. Every adapter skips and reports a failed clone or update instead of stopping, and exits 3
//     after finishing when anything was skipped; the Electron main process still runs the reviewed
//     plugin actions on exit code 3.
//  2. Repository addresses known to have moved are not used again, except to point copies cloned
//     from an old address at the new one (only when the origin exactly matches the old address).
//  3. The bash helper is exercised against a local repository (no network), including failures.
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

// ---- 1. Skip and report, never abort -----------------------------------------------------------
for (const adapter of bashAdapters) {
  const source = read(adapter);
  const helper = source.match(/^clone_or_update\(\) \{\n[\s\S]*?\n\}\n/m)[0];
  assert.match(helper, /if ! run_cmd git -C "\$dest" pull --ff-only; then\n\s+skip_item/, `${adapter}: a failed update must skip the item.`);
  assert.match(helper, /if run_cmd git clone --depth 1 "\$repo" "\$dest"; then\n\s+record_manifest[\s\S]*?else\n\s+rm -rf -- "\$dest"\n\s+skip_item/, `${adapter}: a failed clone must remove any partial copy, skip the item, and not record it.`);
  assert.match(source, /if \[\[ "\$\{#SKIPPED_ITEMS\[@\]\}" -gt 0 \]\]; then\n\s+exit 3\n\s+fi\n\}\n\nmain "\$@"/, `${adapter}: setup must exit 3 after finishing when an item was skipped.`);
}
{
  const source = read(windowsAdapter);
  const helper = source.slice(source.indexOf('function Clone-OrUpdate {'), source.indexOf('function Install-Skill {'));
  assert.equal((helper.match(/\$LASTEXITCODE -ne 0\) \{\n\s+(?:if \(Test-Path \$Destination\) \{[\s\S]*?\n\s+\}\n\s+)?Skip-Item/g) || []).length, 3, `${windowsAdapter}: a failed origin move, update, or clone must skip the item (git failures do not throw in PowerShell).`);
  assert.match(helper, /Remove-Item -LiteralPath \$Destination -Recurse -Force -ErrorAction Stop[\s\S]*?if \(Test-Path \$Destination\) \{[\s\S]*?throw "CCTI stopped:/, `${windowsAdapter}: a partial copy that cannot be removed must stop setup, not be reported as a skip.`);
  assert.match(helper, /\(\$origin -replace '\\\.git\$', ''\) -eq \$oldRepo/, `${windowsAdapter}: only an origin that exactly matches the old address may be moved.`);
  assert.match(helper, /Skip-Item[^\n]+\n\s+return\n\s+\}\n\s+Add-Manifest/, `${windowsAdapter}: a failed clone must not be recorded in the manifest.`);
  assert.match(source, /if \(\$script:SkippedItems\.Count -gt 0\) \{ exit 3 \}\n$/, `${windowsAdapter}: setup must exit 3 after finishing when an item was skipped.`);
}
{
  const main = read('desktop/src/main.js');
  assert.match(main, /const SKIPPED_ITEMS_EXIT_CODE = 3;/);
  assert.match(main, /if \(\(result\.code === 0 \|\| finishedWithSkips\) && !dryRun\) await installReviewedPlugins/, 'Reviewed plugin actions must still run when setup only skipped optional items.');
}

// ---- 2. Moved repositories stay fixed ----------------------------------------------------------
const moved = {
  'https://github.com/nextlevelbuilders/ui-ux-pro-max': 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill',
  'https://github.com/JuliusBrussel/caveman': 'https://github.com/juliusbrussee/caveman',
};
for (const adapter of adapters) {
  const source = read(adapter);
  // Old addresses may appear only in the moved-repository table, which points old copies at the new address.
  const table = adapter.endsWith('.ps1')
    ? source.match(/^\$script:MovedReferenceRepos = @\{\n[\s\S]*?\n\}\n/m)[0]
    : source.match(/^MOVED_REFERENCE_REPOS=\(\n[\s\S]*?\n\)\n/m)[0];
  const outsideTable = source.replace(table, '');
  for (const [oldUrl, newUrl] of Object.entries(moved)) {
    assert.equal(outsideTable.includes(oldUrl), false, `${adapter} still uses ${oldUrl}, which moved to ${newUrl}.`);
    assert.ok(outsideTable.includes(newUrl), `${adapter} must use ${newUrl}.`);
    const entry = adapter.endsWith('.ps1') ? `"${newUrl}" = "${oldUrl}"` : `"${oldUrl} ${newUrl}"`;
    assert.ok(table.includes(entry), `${adapter} must point copies cloned from ${oldUrl} at ${newUrl}.`);
  }
}

// ---- 3. Behavioral check of the bash helper (no network) ---------------------------------------
function behavioralCloneCheck(adapter) {
  const source = read(adapter);
  const helpers = ['skip_item', 'moved_from', 'clone_or_update'].map((name) => source.match(new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?\\n\\}\\n`, 'm'))[0]).join('\n');
  const work = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ccti-reference-repo-'));
  const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'CCTI', GIT_AUTHOR_EMAIL: 'ccti@example.invalid', GIT_COMMITTER_NAME: 'CCTI', GIT_COMMITTER_EMAIL: 'ccti@example.invalid' };
  const git = (args, cwd = work) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: gitEnv });
    assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  };
  try {
    const upstream = path.join(work, 'upstream');
    git(['init', '-q', upstream]);
    fs.writeFileSync(path.join(upstream, 'README.md'), 'reference\n');
    git(['add', 'README.md'], upstream);
    git(['commit', '-q', '-m', 'reference'], upstream);
    const manifest = path.join(work, 'manifest');
    const moved = path.join(work, 'moved');
    git(['clone', '-q', upstream, moved]);
    // Clone a missing repository, then a good one; update a copy cloned from a moved address and a
    // copy with a customized origin; then update a copy whose upstream disappeared.
    const run = spawnSync('bash', ['-c', `set -Eeuo pipefail
DRY_RUN=0
log() { printf '%s\\n' "$*"; }
run_cmd() { "$@"; }
already_path() { [[ -e "$1" ]]; }
record_manifest() { printf '%s\\n' "$4" >> "$MANIFEST"; }
SKIPPED_ITEMS=()
MOVED_REFERENCE_REPOS=("file://$1/old-address file://$1/moved")
${helpers}
clone_or_update "file://$1/gone" "$1/repos/gone" gone-item
clone_or_update "file://$1/upstream" "$1/repos/good" good-item
git clone -q "file://$1/upstream" "$1/repos/old-copy"
git -C "$1/repos/old-copy" remote set-url origin "file://$1/old-address.git"
clone_or_update "file://$1/moved" "$1/repos/old-copy" moved-item
git clone -q "file://$1/upstream" "$1/repos/custom-copy"
clone_or_update "file://$1/moved" "$1/repos/custom-copy" custom-item
printf 'old-copy=%s\\n' "$(git -C "$1/repos/old-copy" remote get-url origin)"
printf 'custom-copy=%s\\n' "$(git -C "$1/repos/custom-copy" remote get-url origin)"
rm -rf "$1/upstream"
clone_or_update "file://$1/upstream" "$1/repos/good" good-item
printf 'skipped=%s\\n' "\${#SKIPPED_ITEMS[@]}"
printf '%s\\n' "\${SKIPPED_ITEMS[@]}"`, 'ccti', work], { encoding: 'utf8', env: { ...gitEnv, MANIFEST: manifest } });
    assert.equal(run.status, 0, `${adapter}: failed clones and updates must not stop setup.\n${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, /skipped=2\n/, `${adapter}: both failures must be reported.\n${run.stdout}`);
    assert.match(run.stdout, /gone-item: file:\/\/.+\/gone could not be downloaded/);
    assert.match(run.stdout, /good-item: the existing copy at .+ could not be updated .+ left as it was/);
    assert.match(run.stdout, /old-copy=file:\/\/.+\/moved\n/, `${adapter}: a copy cloned from a moved address must be pointed at the new address.`);
    assert.match(run.stdout, /custom-copy=file:\/\/.+\/upstream\n/, `${adapter}: a copy with any other origin must be left as it is.`);
    assert.equal(fs.existsSync(path.join(work, 'repos', 'gone')), false, `${adapter}: a failed clone must leave nothing behind.`);
    assert.ok(fs.existsSync(path.join(work, 'repos', 'good', 'README.md')), `${adapter}: a failed update must keep the existing copy.`);
    assert.deepEqual(fs.readFileSync(manifest, 'utf8').trim().split('\n'), ['good-item'], `${adapter}: only the successful clone is recorded.`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

let behavioral = 'skipped on Windows';
if (process.platform !== 'win32') {
  bashAdapters.forEach(behavioralCloneCheck);
  behavioral = 'checked';
}
console.log(`Reference repository resilience passed: ${adapters.length} adapters skip and report failed downloads, exit 3 when anything was skipped, and use the moved repository addresses (behavioral clone check: ${behavioral}).`);
