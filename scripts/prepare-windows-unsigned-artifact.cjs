#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
function digest(bytes, algorithm = 'sha256', encoding = 'hex') { return crypto.createHash(algorithm).update(bytes).digest(encoding); }
function validateFeed(feed, name, bytes, version) {
  assert.equal(feed.version, version, 'Updater version must match tagged package');
  assert.equal(feed.path, name, 'Updater path must match installer');
  const sha512 = digest(bytes, 'sha512', 'base64');
  assert.equal(feed.sha512, sha512, 'Updater root SHA-512 must match bytes');
  assert.ok(Array.isArray(feed.files) && feed.files.length === 1, 'Require exactly one updater file');
  assert.equal(feed.files[0].url, name, 'Updater file URL must match installer');
  assert.equal(feed.files[0].size, bytes.length, 'Updater size must match installer');
  assert.equal(feed.files[0].sha512, sha512, 'Updater file SHA-512 must match bytes');
}
function prepare({source, controller, artifacts, tag, expectedCommit, controllerSha, runUrl}) {
  const git = (...args) => cp.execFileSync('git', ['-C', controller, ...args], {encoding:'utf8'}).trim();
  assert.match(tag, /^v\d{4}\.\d{2}\.\d{2}\.\d{2}$/);
  assert.match(expectedCommit, /^[0-9a-f]{40}$/); assert.match(controllerSha, /^[0-9a-f]{40}$/);
  assert.equal(git('rev-parse', `${tag}^{commit}`), expectedCommit, 'Remote tag commit must remain exact');
  assert.equal(git('rev-parse', 'HEAD'), controllerSha, 'Controller identity mismatch');
  const entries = git('ls-tree','-r', '--name-only',tag).split('\n');
  const hashes = {};
  for (const file of entries) {
    const tagged = cp.execFileSync('git',['-C',controller,'show',`${tag}:${file}`],{maxBuffer:64*1024*1024});
    const exported = fs.readFileSync(path.join(source,file));
    assert.ok(tagged.equals(exported), `Exported tagged source mismatch: ${file}`);
    if (file.startsWith('desktop/src/') || ['desktop/package.json','desktop/package-lock.json','setup-my-claude.ps1','setup-my-claude.sh','setup-my-claude-linux.sh'].includes(file)) hashes[file]=digest(tagged);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(source,'desktop/package.json')));
  const lock = JSON.parse(fs.readFileSync(path.join(source,'desktop/package-lock.json')));
  const parts=tag.slice(1).split('.');const version=`${Number(parts[0])}.${Number(parts[1])}.${Number(parts[2])*100+Number(parts[3])}`;
  assert.equal(pkg.version,version); assert.equal(lock.version,version);assert.equal(lock.packages[''].version,version);
  const names=fs.readdirSync(artifacts).filter(n=>n.toLowerCase().endsWith('-win-x64.exe')&&!n.toLowerCase().includes('uninstaller'));
  assert.equal(names.length,1,'Require one x64 NSIS installer'); const name=names[0];assert.equal(name,`Claude-Code-Tools-Installer-${version}-win-x64.exe`);
  const bytes=fs.readFileSync(path.join(artifacts,name));assert.ok(bytes.length>0);assert.equal(bytes.toString('ascii',0,2),'MZ','Require PE executable');
  const yaml=require(require.resolve('js-yaml',{paths:[path.join(source,'desktop')]}));
  const feed=yaml.load(fs.readFileSync(path.join(artifacts,'latest.yml'),'utf8'));validateFeed(feed,name,bytes,version);
  const sha256=digest(bytes);fs.writeFileSync(path.join(artifacts,`${name}.sha256`),`${sha256}  ${name}\n`);
  const receipt={source_tag:tag,source_commit:expectedCommit,source_tree:git('rev-parse',`${tag}^{tree}`),controller_commit:controllerSha,workflow_run:runUrl,version,architecture:'x64',distribution:'unsigned NSIS; build-only, not published',installer:{name,size:bytes.length,sha256,sha512:digest(bytes,'sha512','base64')},tagged_runtime_sha256:hashes,lock_sha256:hashes['desktop/package-lock.json']};
  fs.writeFileSync(path.join(artifacts,'windows-unsigned-source.json'),JSON.stringify(receipt,null,2)+'\n');
  fs.writeFileSync(path.join(artifacts,'windows-unsigned-source-predicate.json'),JSON.stringify(receipt,null,2)+'\n');return receipt;
}
if(require.main===module){const [source,controller,artifacts,tag,expectedCommit]=process.argv.slice(2);assert.ok(expectedCommit,'Usage: prepare source controller artifacts tag expectedCommit');console.log(JSON.stringify(prepare({source,controller,artifacts,tag,expectedCommit,controllerSha:process.env.GITHUB_SHA,runUrl:`${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`}),null,2));}
module.exports={validateFeed,prepare,digest};
