#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/build-macos-signed-notarized-test.yml'), 'utf8').replace(/\r\n/g, '\n');
const section = workflow.split('      - name: Prepare immutable runtime source\n')[1]?.split('      - name: Set up Node 22')[0];
assert(section, 'Source trust step must exist');
const commands = section.split('        run: |\n')[1].split('\n').filter(x => x.startsWith('          ')).map(x => x.slice(10)).join('\n');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccti-source-trust-'));
function git(cwd, ...args) {
  const p = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME:'Fixture', GIT_AUTHOR_EMAIL:'fixture@example.invalid', GIT_COMMITTER_NAME:'Fixture', GIT_COMMITTER_EMAIL:'fixture@example.invalid' } });
  assert.equal(p.status, 0, p.stderr); return p.stdout.trim();
}
try {
  const source = path.join(root, 'source'); fs.mkdirSync(source); git(source,'init','-b','main');
  fs.writeFileSync(path.join(source,'fixture.txt'),'trusted\n'); git(source,'add','.'); git(source,'commit','-m','trusted'); const trusted=git(source,'rev-parse','HEAD');
  git(source,'switch','-c','unreviewed'); fs.writeFileSync(path.join(source,'fixture.txt'),'unreviewed\n'); git(source,'commit','-am','unreviewed'); const untrusted=git(source,'rev-parse','HEAD'); git(source,'switch','main');
  const cases=[
    ['default trusted main','',trusted,'refs/heads/main',true],
    ['explicit trusted full SHA',trusted,trusted,'refs/heads/main',true],
    ['branch name refused','unreviewed',trusted,'refs/heads/main',false],
    ['tag name refused','v2026.10.12.00',trusted,'refs/heads/main',false],
    ['abbreviated SHA refused',trusted.slice(0,12),trusted,'refs/heads/main',false],
    ['unreviewed full SHA refused',untrusted,trusted,'refs/heads/main',false],
    ['branch controller refused',trusted,untrusted,'refs/heads/unreviewed',false],
    ['option-like ref refused','--help',trusted,'refs/heads/main',false],
    ['unknown full SHA refused','1'.repeat(40),trusted,'refs/heads/main',false],
  ];
  for(let i=0;i<cases.length;i++){
    const [name,ref,sha,controller,pass]=cases[i]; const cwd=path.join(root,`case-${i}`);git(root,'clone','--no-hardlinks',source,cwd);const output=path.join(root,`out-${i}`);fs.writeFileSync(output,'');
    const result=spawnSync('bash',['-eu','-o','pipefail','-c',commands],{cwd,encoding:'utf8',env:{...process.env,GITHUB_WORKSPACE:cwd,GITHUB_OUTPUT:output,SOURCE_REF:ref,GITHUB_SHA:sha,GITHUB_REF:controller}});
    assert.equal(result.status===0,pass,`${name}: ${result.status}\n${result.stderr}`);
    if(pass){assert.equal(git(cwd,'rev-parse','HEAD'),trusted);assert(fs.readFileSync(output,'utf8').includes(`commit=${trusted}`));}
    console.log(`PASS ${name}`);
  }
  console.log(`${cases.length} macOS source-trust fixtures passed; no signing secrets used.`);
} finally { fs.rmSync(root,{recursive:true,force:true}); }
