import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {historyOperation} from '../docs/portfolio-operations-dashboard/features/import-history.mjs';
for(const operation of ['exportPacked','recordExportPacked']) test(`${operation} progress preserves actual counts without transferring callbacks or completing the request early`,async()=>{
 const previous=globalThis.Worker,events=[];let worker;
 globalThis.Worker=class{
  constructor(){worker=this;}
  postMessage(payload){assert.equal(Object.hasOwn(payload,'onProgress'),false);assert.equal(Object.hasOwn(payload,'onArchiveProgress'),false);assert.doesNotThrow(()=>structuredClone(payload));queueMicrotask(()=>this.onmessage({data:{progress:true,detail:{phase:'packing',completed:2,total:44}}}));}
  terminate(){this.terminated=true;}
 };
 try{
  let settled=false;const task=historyOperation({operation,onProgress:event=>events.push(event)}).then(value=>{settled=true;return value;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);assert.deepEqual(events,[{phase:'packing',completed:2,total:44}]);
  worker.onmessage({data:{ok:true,value:{verified:true}}});assert.deepEqual(await task,{verified:true});assert(worker.terminated);
  worker.onmessage({data:{progress:true,detail:{completed:99,total:100}}});assert.equal(events.length,1,'Late worker progress is ignored after settlement');
 }finally{globalThis.Worker=previous;}
});
for(const operation of ['exportPacked','recordExportPacked']) test(`cancelled ${operation} removes progress listener and never retries an accepted job`,async()=>{
 const previous=globalThis.Worker,events=[];let worker,starts=0;
 globalThis.Worker=class{constructor(){worker=this;}postMessage(){starts++;}terminate(){this.terminated=true;}};
 try{
  const controller=new AbortController(),task=historyOperation({operation,signal:controller.signal,onProgress:event=>events.push(event)});
  controller.abort(new DOMException('Changed account','AbortError'));await assert.rejects(task,{name:'AbortError'});
  worker.onmessage({data:{progress:true,detail:{completed:9,total:10}}});assert.equal(events.length,0);assert.equal(starts,1);assert(worker.terminated);
 }finally{globalThis.Worker=previous;}
});

for(const operation of ['exportPacked','recordExportPacked']) test(`${operation} worker forwards progress and transfers packed buffers without copying`,async()=>{
 const posts=[],bytes=new Uint8Array([1,2,3]),value={files:[{bytes}]};
 const context={self:{postMessage:(message,transfer)=>posts.push({message,transfer})},executeHistory:async request=>{request.onArchiveProgress({phase:'packing',completed:1,total:2});return value;}};
 const source=readFileSync(new URL('../docs/portfolio-operations-dashboard/features/import-history-worker.mjs',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'');
 runInNewContext(source,context);await context.self.onmessage({data:{operation}});
 assert.equal(posts.length,2);assert.equal(posts[0].message.progress,true);assert.deepEqual(posts[0].message.detail,{phase:'packing',completed:1,total:2});
 assert.equal(posts[1].message.value,value);assert.equal(posts[1].transfer.length,1);assert.equal(posts[1].transfer[0],bytes.buffer);
});
