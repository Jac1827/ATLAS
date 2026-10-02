import assert from 'node:assert/strict';
import {capturePublicationCache,acknowledgePublicationCache} from '../docs/portfolio-operations-dashboard/features/workspace-publication-cache.mjs';
const keys=['communities','ops','history','atlas_workspace_source_v2'];
function fixture(){
 const records=new Map(keys.map(key=>[key,{key,value:{revision:1},updatedAt:'before'}]));
 let active=true, beforeRead=null;
 const withStore=async(mode,run)=>{const pending=[],writes=[];const store={get(key){const req={};pending.push(()=>{beforeRead?.(key);req.result=structuredClone(records.get(key));req.onsuccess?.();});return req;},put(row){writes.push(row);}};run(store);for(const cb of pending)cb();for(const row of writes)records.set(row.key,structuredClone(row));};
 return {records,withStore,isCurrent:()=>active,stop:()=>active=false,onRead:fn=>beforeRead=fn};
}
const source={version:4,archiveHash:'a'},workspace={source,binding:{fullProjection:true,scopeFingerprint:'scope'},projection:{contentHash:'hash',importState:{batches:[]}}};
const stable=JSON.stringify;
const apply=(f,c,w=workspace,s=source)=>acknowledgePublicationCache(f.withStore,c,w,s,f.isCurrent,stable);
const good=fixture(),capture=await capturePublicationCache(good.withStore,keys,good.isCurrent);assert(await apply(good,capture));assert.equal(good.records.get(keys[3]).value.dirty,false);assert.deepEqual(good.records.get('history').value,{revision:1});
for(const key of keys){const f=fixture(),c=await capturePublicationCache(f.withStore,keys,f.isCurrent);f.records.get(key).value.revision++;assert.equal(await apply(f,c),false,`${key} changed during publication must remain unacknowledged`);assert.equal(f.records.has('atlas_startup_import_projection_v2'),false);}
const obsolete=fixture(),c=await capturePublicationCache(obsolete.withStore,keys,obsolete.isCurrent);obsolete.onRead(()=>obsolete.stop());assert.equal(await apply(obsolete,c),false,'Account change during transaction cannot acknowledge');
const filtered=fixture(),fc=await capturePublicationCache(filtered.withStore,keys,filtered.isCurrent);assert.equal(await apply(filtered,fc,{...workspace,binding:{fullProjection:false}}),false);assert.equal(await apply(filtered,fc,workspace,{version:5}),false);assert.equal(await apply(filtered,null),false,'Projection-only retries have no proof of matching local records');
console.log('PASS publication cache: exact snapshot acknowledgement, all four concurrent mutation guards, account change, changed parent, scoped data and retry refusal; history remains intact.');
