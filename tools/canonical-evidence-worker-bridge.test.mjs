import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeCanonicalEvidence} from '../docs/portfolio-operations-dashboard/features/canonical-evidence.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const posted=[],worker={postMessage:value=>posted.push(value),terminate(){this.terminated=true;}},controller=new AbortController();let current=true;
 const args={archive:{dataDocuments:[{documentKey:'one',length:4}],recordCount:1},options:{dbName:'scoped',source:{archiveHash:'hash'}},signal:controller.signal,workerFactory:()=>worker,assertCurrent:()=>{if(!current)throw new DOMException('Workspace changed','AbortError');},readPart:async()=> 'YQ==',beforeCommit:async()=>{},onProgress:()=>{}};
 return {args,posted,worker,controller,change:()=>current=false,send:async data=>{await worker.onmessage({data});await tick();}};
}
test('worker bridge keeps credentials out, transfers only requested bounded parts and requires a fresh commit check',async()=>{
 const f=fixture();let checked=0;f.args.beforeCommit=async()=>checked++;
 const task=initializeCanonicalEvidence(f.args);assert.equal(f.posted[0].kind,'initialize');assert(!JSON.stringify(f.posted).includes('access_token'));
 await f.send({kind:'part',id:1,index:0});assert.deepEqual(f.posted.at(-1),{kind:'response',id:1,value:'YQ=='});
 await f.send({kind:'commit',id:2});assert.equal(checked,1);assert.equal(f.posted.at(-1).value,true);
 await f.send({kind:'result',ok:true,value:{verified:true}});assert.deepEqual(await task,{verified:true});assert(f.worker.terminated);
});
test('changed account cancels the worker and suppresses late completion and progress',async()=>{
 const f=fixture();let progress=0;f.args.onProgress=()=>progress++;const task=initializeCanonicalEvidence(f.args);const rejected=assert.rejects(task,{name:'AbortError'});
 f.change();await f.send({kind:'progress',event:{phase:'retaining',completed:1,total:2}});assert.equal(f.posted.at(-1).kind,'cancel');assert.equal(progress,0);
 await f.send({kind:'result',ok:true,value:{verified:true}});await rejected;assert(f.worker.terminated);
});
test('local rollback base64 goes to the worker as an immutable Blob rather than cloning a whole large string',async()=>{
 const f=fixture();f.args.archive={data:'YQ==',recordCount:1};const task=initializeCanonicalEvidence(f.args);
 const message=f.posted[0];assert.equal(message.archive.data,undefined);assert(message.archive.dataBlob instanceof Blob);assert.equal(await message.archive.dataBlob.text(),'YQ==');
 await f.send({kind:'result',ok:true,value:{verified:true}});await task;
});
test('aborted operations do not initialize a worker, and failed final source recheck is not approved',async()=>{
 const stopped=fixture();stopped.controller.abort();await assert.rejects(initializeCanonicalEvidence(stopped.args),{name:'AbortError'});assert.equal(stopped.posted.length,0);
 const f=fixture();f.args.beforeCommit=async()=>{throw Error('Source changed');};const task=initializeCanonicalEvidence(f.args);const rejected=assert.rejects(task,/Source changed/);
 await f.send({kind:'commit',id:2});assert.equal(f.posted.at(-1).error,'Source changed');await f.send({kind:'result',ok:false,error:'Source changed'});await rejected;
});
test('operational restore preparation crosses the worker boundary only when explicitly requested',async()=>{
 const f=fixture();f.args.options.operationalKeys={community:'community_data'};let received;f.args.prepareRestore=async bundle=>{received=bundle;return{records:[{record:{key:'community_data',value:{verified:true}},expectedHash:'captured'}]};};const task=initializeCanonicalEvidence(f.args);await f.send({kind:'prepareRestore',id:4,bundle:{indexedDb:{communityData:{}}}});assert.deepEqual(received,{indexedDb:{communityData:{}}});assert.equal(f.posted.at(-1).value.records[0].record.key,'community_data');await f.send({kind:'result',ok:true,value:{verified:true}});await task;
});
