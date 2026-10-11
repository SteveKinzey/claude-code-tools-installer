#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const sources = [
  ['DietrichGebert/ponytail', 'ponytail', 'CCTI_PONYTAIL_COMMIT', 'skills/ponytail'],
  ['Leonxlnx/taste-skill', 'design-taste-frontend', 'CCTI_TASTE_SKILL_COMMIT', 'skills/taste-skill'],
  ['OthmanAdi/planning-with-files', 'planning-with-files', 'CCTI_PLANNING_WITH_FILES_COMMIT', 'skills/planning-with-files'],
  ['Graphify-Labs/graphify', 'graphify', 'CCTI_GRAPHIFY_COMMIT', 'graphify'],
];
for (const adapter of ['setup-my-claude.sh', 'setup-my-claude-linux.sh', 'setup-my-claude.ps1']) {
  const source = read(adapter);
  for (const [repo, skill, pin, subpath] of sources) {
    const call = adapter.endsWith('.ps1')
      ? `Install-Skill "https://github.com/${repo}" "${skill}" $Id $${pin} "${subpath}"`
      : `install_skill https://github.com/${repo} ${skill} "$id" "$${pin}" "${subpath}"`;
    assert.ok(source.includes(call), `${adapter}: ${skill} must use its reviewed full-commit source and explicit subpath`);
  }
  assert.ok(source.includes('--copy'), `${adapter}: disposable sources must use standalone copies`);
}
const work = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ccti-curated-pins-'));
const git = (args, cwd = work) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' } });
  assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
};
try {
  const upstream = path.join(work, 'upstream'); git(['init', '-q', upstream]);
  fs.mkdirSync(path.join(upstream, 'skills', 'fixture'), { recursive: true });
  fs.writeFileSync(path.join(upstream, 'skills', 'fixture', 'SKILL.md'), '---\nname: fixture\ndescription: test\n---\nPinned content\n');
  fs.mkdirSync(path.join(upstream, 'graphify')); fs.writeFileSync(path.join(upstream, 'graphify', 'skill.md'), '---\nname: graphify\ndescription: test\n---\nGraph content\n');
  git(['add', '.'], upstream); git(['commit', '-qm', 'reviewed'], upstream); const sha = git(['rev-parse', 'HEAD'], upstream);
  fs.appendFileSync(path.join(upstream, 'skills', 'fixture', 'SKILL.md'), 'New HEAD\n'); git(['commit', '-qam', 'unreviewed'], upstream);
  const repo = require('node:url').pathToFileURL(upstream).href;
  for (const adapter of ['setup-my-claude.sh', 'setup-my-claude-linux.sh']) {
    if (process.platform === 'win32') break;
    const source = read(adapter);
    const fetch = source.match(/^fetch_pinned_git_commit\(\) \{\n[\s\S]*?\n\}\n/m)[0];
    const install = source.slice(source.indexOf('install_skill() {'), source.indexOf('\ninstall_npm_global()'));
    const run = (name, scope, commit, subpath, { fail = false, dry = false, existing = false, skill = 'fixture' } = {}) => {
      const dir = path.join(work, `${adapter}-${name}`);fs.mkdirSync(dir);
      const home = path.join(dir, 'home'), project = path.join(dir, 'selected project');fs.mkdirSync(home);fs.mkdirSync(project);
      const dest = path.join(scope === 'project' ? project : home, '.claude', 'skills', skill);
      if (existing) { fs.mkdirSync(dest, { recursive: true });fs.writeFileSync(path.join(dest, 'SKILL.md'), 'Keep local version\n'); }
      const script = `set -Eeuo pipefail\nBASE_DIR="$HOME/.setup-my-claude"\nDRY_RUN=${dry ? 1 : 0}\nSKILL_SCOPE='${scope}'\nCCTI_SKILLS_CLI_VERSION='1.7.0'\n${dry ? '' : 'mkdir -p "$BASE_DIR"'}\nlog() { printf '%s\\n' "$*"; }\nrun_cmd() { "$@"; }\nalready_path() { [[ -e "$1" ]]; }\nrecord_manifest() { printf '%s\\t%s\\t%s\\t%s\\n' "$1" "$2" "$3" "$4" >> "$BASE_DIR/manifest.tsv"; }\nrun_npx_isolated() {\n [[ "$DRY_RUN" == 1 ]] && return 0\n printf '%s\\n' "$*" >> "$BASE_DIR/calls.log"\n ${fail ? 'return 7' : 'mkdir -p "$dest"; cp "$4/SKILL.md" "$dest/SKILL.md"'}\n}\n${fetch}\n${install}\ninstall_skill "$1" "$2" fixture "$3" "$4"\n`;
      const r = spawnSync('bash', ['-c', script, 'fixture', repo, skill, commit, subpath], { cwd: project, env: { ...process.env, HOME: home }, encoding: 'utf8' });
      const base = path.join(home, '.setup-my-claude');const manifest = path.join(base, 'manifest.tsv');
      const remaining = fs.existsSync(base) ? fs.readdirSync(base).filter((p) => p.startsWith('skill-source') || p.startsWith('git-fetch')) : [];
      assert.deepEqual(remaining, [], `${adapter}/${name}: staged source must always be cleaned`);
      return { r, dest, base, manifest, home };
    };
    for (const scope of ['global', 'project']) {
      const x = run(`good-${scope}`, scope, sha, 'skills/fixture');assert.equal(x.r.status, 0, x.r.stderr);
      assert.ok(fs.readFileSync(x.dest + '/SKILL.md', 'utf8').includes('Pinned content'));
      assert.ok(!fs.readFileSync(x.dest + '/SKILL.md', 'utf8').includes('New HEAD'));
      assert.ok(!fs.lstatSync(x.dest).isSymbolicLink());const ledger=fs.readFileSync(x.manifest,'utf8');assert.ok(ledger.includes(`source=${repo}@${sha};cli=skills@1.7.0;scope=${scope}`));
      const calls=fs.readFileSync(path.join(x.base,'calls.log'),'utf8');assert.ok(calls.includes('--copy'));assert.equal(calls.includes('--global'),scope==='global');
    }
    const keep=run('existing','global','f'.repeat(40),'skills/fixture',{existing:true});assert.equal(keep.r.status,0,keep.r.stderr);assert.equal(fs.readFileSync(keep.dest+'/SKILL.md','utf8'),'Keep local version\n');assert.equal(fs.existsSync(keep.manifest),false);
    for (const [name,commit,subpath,options] of [['missing', 'f'.repeat(40),'skills/fixture',{}],['short',sha.slice(0,10),'skills/fixture',{}],['layout',sha,'not-a-skill',{}],['cli-failed',sha,'skills/fixture',{fail:true}]]) {
      const x=run(name,'project',commit,subpath,options);assert.notEqual(x.r.status,0,`${adapter}/${name} must stop`);assert.equal(fs.existsSync(x.manifest),false);assert.equal(fs.existsSync(x.dest),false);
    }
    const graph=run('graphify','global',sha,'graphify',{skill:'graphify'});assert.equal(graph.r.status,0,graph.r.stderr);assert.ok(fs.readFileSync(graph.dest+'/SKILL.md','utf8').includes('Graph content'));
    const dry=run('dry','project',sha,'skills/fixture',{dry:true});assert.equal(dry.r.status,0,dry.r.stderr);assert.deepEqual(fs.readdirSync(dry.home),[],'dry run must not write user state');
  }
  if (process.platform === 'win32') {
    const source=read('setup-my-claude.ps1');const install=source.slice(source.indexOf('function Install-Skill {'),source.indexOf('function Install-NpmGlobal {'));const fetch=source.slice(source.indexOf('function Get-PinnedGitCommit {'),source.indexOf('function Install-Mcp {'));
    const script=path.join(work,'windows-fixture.ps1');fs.writeFileSync(script,`param([string]$Root,[string]$Repo,[string]$Commit)\n$ErrorActionPreference='Stop'\n$DryRun=$false\n$CCTI_SKILLS_CLI_VERSION='1.7.0'\nfunction Write-Log { param([string]$Message) }\nfunction Invoke-Logged { param([string]$Command,[string[]]$Arguments) & $Command @Arguments }\nfunction Add-Manifest { param($Kind,$Target,$Extra,$Item) Add-Content -LiteralPath (Join-Path $BaseDir 'manifest.tsv') -Value "$Kind\t$Target\t$Extra\t$Item" }\nfunction Invoke-NpxIsolated { param([string[]]$Arguments) if ($DryRun) { return }; if ($script:FailCli) { throw 'Fixture CLI failure' }; if ($Arguments -notcontains '--copy') { throw 'Missing copy' }; New-Item -ItemType Directory -Path $dest -Force | Out-Null; Copy-Item -LiteralPath (Join-Path $Arguments[3] 'SKILL.md') -Destination (Join-Path $dest 'SKILL.md') }\n${fetch}\n${install}\nfunction Assert-True { param([bool]$Condition,[string]$Message) if (-not $Condition) { throw $Message } }\nforeach ($mode in @('good-global','good-project','existing','missing','short','layout','cli-failed','graphify','dry')) {\n $dir=Join-Path $Root $mode; New-Item -ItemType Directory -Path $dir | Out-Null\n Set-Variable -Name HOME -Value (Join-Path $dir 'home') -Force\n New-Item -ItemType Directory -Path $HOME | Out-Null\n $BaseDir=Join-Path $HOME '.setup-my-claude'; $project=Join-Path $dir 'selected project'; New-Item -ItemType Directory -Path $project | Out-Null; Set-Location $project\n $SkillScope=if($mode -eq 'good-global' -or $mode -eq 'existing' -or $mode -eq 'graphify') {'global'} else {'project'}\n $skill=if($mode -eq 'graphify') {'graphify'} else {'fixture'}; $subpath=if($mode -eq 'graphify') {'graphify'} elseif($mode -eq 'layout') {'missing'} else {'skills/fixture'}\n $wanted=if($mode -eq 'missing' -or $mode -eq 'existing') {'f'*40} elseif($mode -eq 'short') {$Commit.Substring(0,10)} else {$Commit}\n $rootDest=if($SkillScope -eq 'global') {$HOME} else {$project};$dest=Join-Path $rootDest ".claude/skills/$skill"\n if($mode -eq 'existing') { New-Item -ItemType Directory -Path $dest -Force | Out-Null; Set-Content -LiteralPath (Join-Path $dest 'SKILL.md') -Value 'Keep local version' }\n $DryRun=$mode -eq 'dry';$script:FailCli=$mode -eq 'cli-failed';$failed=$false\n try { Install-Skill $Repo $skill fixture $wanted $subpath } catch { $failed=$true }\n $negative=$mode -in @('missing','short','layout','cli-failed');Assert-True ($failed -eq $negative) "Unexpected result: $mode"\n $manifest=Join-Path $BaseDir 'manifest.tsv'\n if($negative -or $mode -eq 'existing' -or $DryRun) { Assert-True (-not(Test-Path $manifest)) 'Failure/existing/dry recorded success' } else { Assert-True ((Get-Content $manifest -Raw).Contains("source=$Repo@$Commit;cli=skills@1.7.0;scope=$SkillScope")) 'Identity missing';Assert-True (-not(Get-Item $dest).LinkType) 'Broken source link';Assert-True (-not(Get-Content (Join-Path $dest 'SKILL.md') -Raw).Contains('New HEAD')) 'Installed moving HEAD' }\n if(Test-Path $BaseDir) { Assert-True (@(Get-ChildItem $BaseDir -Filter 'skill-source*').Count -eq 0) 'Source cleanup failed';Assert-True (@(Get-ChildItem $BaseDir -Filter 'git-fetch*').Count -eq 0) 'Fetch cleanup failed' }\n if($mode -eq 'existing') { Assert-True ((Get-Content (Join-Path $dest 'SKILL.md') -Raw).Trim() -eq 'Keep local version') 'Existing overwritten' }\n if($DryRun) { Assert-True (@(Get-ChildItem $HOME -Force).Count -eq 0) 'Dry run mutated HOME' }\n}\nWrite-Output 'Windows curated pinned-source fixtures passed'\n`);
    const r=spawnSync('pwsh',['-NoProfile','-File',script,work,repo,sha],{encoding:'utf8'});assert.equal(r.status,0,`${r.stdout}\n${r.stderr}`);console.log(r.stdout.trim());
  }
  console.log('Curated skill pins passed: parity, exact commits, standalone copy, identity ledger, missing/invalid sources, CLI failure, existing preservation, Graphify filename, and dry-run safety.');
} finally { fs.rmSync(work,{recursive:true,force:true}); }
