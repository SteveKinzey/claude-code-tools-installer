#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const nodeFs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const source = nodeFs.readFileSync(path.join(__dirname,'../desktop/src/main.js'),'utf8');
const start=source.indexOf('const TESTER_FEEDBACK_MAXIMUM_BYTES'); const end=source.indexOf('async function exportDiagnosticReport',start); assert(start>=0 && end>start);
let destination, selection, calls=[], writeFail=false;
const filesystem = new Proxy(fs,{get(target,key){if(key==='open')return async(...args)=>{const handle=await target.open(...args);if(writeFail && String(args[0]).includes('.ccti-feedback-'))handle.writeFile=async()=>{throw new Error('injected write failure');};return handle;};return target[key];}});
const context={fs:filesystem,nodeFs,path,randomUUID,Buffer,process,setTimeout,clearTimeout,Date,mainWindow:null,currentAppVersion:()=> 'fixture',dialog:{showSaveDialog:async()=>({filePath:destination}),showOpenDialog:async()=> selection},shell:{openExternal:async url=>calls.push(url)}};
vm.createContext(context);vm.runInContext(source.slice(start,end)+'\nthis.api={buildTesterFeedbackReport,saveTesterFeedbackLocally,openTesterFeedbackEmail,chooseTesterFeedbackScreenshot,copyTesterFeedbackScreenshot,forgetTesterFeedbackScreenshot,testerFeedbackScreenshots};',context);const api=context.api;
const valid={area:'Setup',category:'Something did not work',expected:'Expected',actual:'Actual'};
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ccti-feedback-')); let count=0;
 const test=async(name,run)=>{await run();count++;console.log('PASS '+name);};
 try {
  await test('required fields refused',async()=>assert.equal(api.buildTesterFeedbackReport({}).ok,false));
  await test('invalid category refused',async()=>assert.equal(api.buildTesterFeedbackReport({...valid,category:'other'}).ok,false));
  await test('invalid email refused',async()=>assert.equal(api.buildTesterFeedbackReport({...valid,email:'invalid'}).ok,false));
  await test('oversized Unicode report refused',async()=>assert.equal(api.buildTesterFeedbackReport({...valid,expected:'😀'.repeat(2000),actual:'😀'.repeat(2000),steps:'😀'.repeat(2000)}).ok,false));
  await test('fresh private report saved',async()=>{destination=path.join(root,'new.txt');assert.equal((await api.saveTesterFeedbackLocally(valid)).ok,true);assert((await fs.readFile(destination,'utf8')).includes('Expected'));if(process.platform!=='win32')assert.equal((await fs.stat(destination)).mode&0o777,0o600);});
  await test('existing report never truncated or broadened',async()=>{destination=path.join(root,'existing.txt');await fs.writeFile(destination,'SENTINEL',{mode:0o644});assert.equal((await api.saveTesterFeedbackLocally(valid)).ok,false);assert.equal(await fs.readFile(destination,'utf8'),'SENTINEL');});
  await test('symlink target unchanged',async()=>{const target=path.join(root,'target.txt');await fs.writeFile(target,'TARGET');destination=path.join(root,'link.txt');await fs.symlink(target,destination);assert.equal((await api.saveTesterFeedbackLocally(valid)).ok,false);assert.equal(await fs.readFile(target,'utf8'),'TARGET');});
  await test('write failure publishes no partial report and cleans temp',async()=>{destination=path.join(root,'failure.txt');writeFail=true;try{assert.equal((await api.saveTesterFeedbackLocally(valid)).ok,false);}finally{writeFail=false;}assert.equal(await fs.access(destination).then(()=>true,()=>false),false);assert(!(await fs.readdir(root)).some(x=>x.includes('.ccti-feedback-')));});
  await test('empty screenshot token succeeds without attachment',async()=>assert.equal((await api.copyTesterFeedbackScreenshot('',path.join(root,'none.txt'))).attachment,null));
  await test('expired token returns explicit failure',async()=>{api.testerFeedbackScreenshots.set('expired',{expiresAt:0});const result=await api.copyTesterFeedbackScreenshot('expired',path.join(root,'expired.txt'));assert.equal(result.ok,false);assert.match(result.error,/choose|select/i);});
  await test('unknown nonempty token fails',async()=>assert.equal((await api.copyTesterFeedbackScreenshot('unknown',path.join(root,'unknown.txt'))).ok,false));
  await test('selected screenshot copied exclusively owner-only',async()=>{const image=path.join(root,'image.png');await fs.writeFile(image,'IMAGE');selection={canceled:false,filePaths:[image]};const chosen=await api.chooseTesterFeedbackScreenshot();const result=await api.copyTesterFeedbackScreenshot(chosen.screenshotToken,path.join(root,'shot.txt'));assert.equal(result.ok,true);const copied=path.join(root,result.attachment);assert.equal(await fs.readFile(copied,'utf8'),'IMAGE');if(process.platform!=='win32')assert.equal((await fs.stat(copied)).mode&0o777,0o600);});
  await test('selected screenshot replacement refused',async()=>{const image=path.join(root,'changed.png');await fs.writeFile(image,'BEFORE');selection={canceled:false,filePaths:[image]};const chosen=await api.chooseTesterFeedbackScreenshot();await fs.unlink(image);await fs.writeFile(image,'AFTER-CHANGED');assert.equal((await api.copyTesterFeedbackScreenshot(chosen.screenshotToken,path.join(root,'change.txt'))).ok,false);});
  await test('short email opens only bounded mailto draft',async()=>{calls=[];assert.equal((await api.openTesterFeedbackEmail(valid)).ok,true);assert.equal(calls.length,1);assert(calls[0].startsWith('mailto:'));assert(calls[0].length<=2081);});
  await test('long encoded feedback refuses before opening email',async()=>{calls=[];const result=await api.openTesterFeedbackEmail({...valid,actual:'é'.repeat(1500)});assert.equal(result.ok,false);assert.match(result.error,/save/i);assert.equal(calls.length,0);});
  await test('email cancellation failure safely reported',async()=>{context.shell.openExternal=async()=>{throw new Error('fixture');};assert.equal((await api.openTesterFeedbackEmail(valid)).ok,false);});
  await test('implementation privacy scan covers all helpers',async()=>{const block=source.slice(start,end);assert(!/(?:\bfetch\s*\(|https?:\/\/|\bnet\.request\s*\()/i.test(block));const validator=nodeFs.readFileSync(path.join(__dirname,'validate-desktop-ui.js'),'utf8');assert(validator.includes('testerFeedbackImplementation'));assert(validator.includes('TESTER_FEEDBACK_MAXIMUM_BYTES'));});
  await test('privacy guard rejects injected network code',async()=>{const validator=nodeFs.readFileSync(path.join(__dirname,'validate-desktop-ui.js'),'utf8');const a=validator.indexOf('const testerFeedbackStart =');const b=validator.indexOf('const testerFeedbackFixtures =',a);assert(a>=0&&b>a);const guard=validator.slice(a,b);for(const injected of ['fetch("blocked")','net.request("blocked")'])assert.throws(()=>vm.runInNewContext(guard,{main:source.slice(0,start)+source.slice(start,end)+injected+'\n'+source.slice(end)}),/never be sent/);vm.runInNewContext(guard,{main:source});});
  console.log(`${count} tester feedback regressions passed; network and email sending stubbed.`);
 } finally {for(const token of api.testerFeedbackScreenshots.keys())api.forgetTesterFeedbackScreenshot(token);await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
