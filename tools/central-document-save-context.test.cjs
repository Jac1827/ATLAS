// Exercise the real client boundary, including both internal session refreshes.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('docs/portfolio-operations-dashboard/centralization/atlas-central-client.js','utf8');
const extract=name=>{const start=source.indexOf('  async function '+name+'('),end=source.indexOf('\n  }',start);assert(start>=0&&end>start);return source.slice(start,end+4);};
const archive=require('../docs/portfolio-operations-dashboard/migration-archive.js');
function fixture(){
 const state={actor:'actor-a',access:'access-a',target:{supabaseUrl:'https://source.example',documentKey:'state'},refreshes:0,writes:[],hash:null,callbackCurrent:true},rows=new Map();
 const context={DOMException,JSON,Number,String,getSignedInUser:()=>({id:state.actor}),getAccessContextKey:()=>state.access,getConfig:()=>state.target,DEFAULT_CONFIG:{documentKey:'state'},refreshSession:async()=>{state.refreshes++;await state.onRefresh?.(state.refreshes);},computeSha256:async()=>{await state.onHash?.();return 'hash';},fetchJson:async(path,options)=>{state.writes.push({actor:state.actor,path,args:JSON.parse(options.body)});await state.afterWrite?.();const row={version:1,payload_hash:JSON.parse(options.body).p_source_hash,payload:JSON.parse(options.body).p_payload};rows.set(JSON.parse(options.body).p_document_key,row);return row;}};
 vm.createContext(context);vm.runInContext(extract('rpc')+'\n'+extract('saveDocument'),context);
 return {state,client:{saveDocument:options=>context.saveDocument(options),readDocument:async key=>rows.get(key)||null},context};
}
const options={documentKey:'state',payload:{source:'retained original actor'},expectedVersion:1,sourceHash:'exact-source'};
(async()=>{
 for(const refresh of [1,2])for(const change of ['actor','access','endpoint','caller','abort']){
  const f=fixture(),controller=new AbortController();let release,reached;const gate=new Promise(r=>release=r),started=new Promise(r=>reached=r);f.state.onRefresh=async n=>{if(n===refresh){reached();await gate;}};
  const save=f.client.saveDocument({...options,isCurrent:()=>f.state.callbackCurrent,signal:controller.signal});await started;
  if(change==='actor')f.state.actor='actor-b';if(change==='access')f.state.access='revoked-role-or-community';if(change==='endpoint')f.state.target.apiBaseUrl='https://other.example';if(change==='caller')f.state.callbackCurrent=false;if(change==='abort')controller.abort();release();await assert.rejects(save,/context changed|Session changed/);assert.equal(f.state.writes.length,0,change+' during refresh '+refresh+' must prevent any mutation');
 }
 const hash=fixture();hash.state.onHash=()=>{hash.state.access='new-role';};await assert.rejects(hash.client.saveDocument({...options,sourceHash:null}),/context changed/);assert.equal(hash.state.writes.length,0);
 const callback=fixture();let checked=0;const result=await callback.client.saveDocument({...options,beforeWrite:()=>{checked++;assert.equal(callback.state.refreshes,2);}});assert.equal(checked,1);assert.equal(result.version,1);assert.equal(callback.state.writes.length,1);assert.equal(callback.state.writes[0].args.p_payload.source,options.payload.source);
 const unchanged=fixture();assert.equal((await unchanged.client.saveDocument(options)).version,1,'Legacy callers without new options keep successful saves');
 const after=fixture();after.state.afterWrite=()=>{after.state.access='revoked';};await assert.rejects(after.client.saveDocument(options),/context changed/);assert.equal(after.state.writes.length,1,'A committed request remains uncertain when access changes before verified completion');
 // Read RPCs retain their existing behavior; the optional callback is not a
 // new blanket access rule for unrelated RPC callers.
 const read=fixture();assert.equal((await read.context.rpc('atlas_read_fixture',{p_document_key:'fixture'})).version,1);
 // The archive helper must carry its outer context through saveDocument's
 // internal awaits, rather than checking only before calling the helper.
 for(const refresh of [1,2]){
  const f=fixture();f.state.onRefresh=n=>{if(n===refresh)f.state.callbackCurrent=false;};await assert.rejects(archive.publish({bundleType:archive.TYPE,data:'abcdefghijk'},f.client,4,{isCurrent:()=>f.state.callbackCurrent}),/context changed/);assert.equal(f.state.writes.length,0,'Archive part canceled inside refresh '+refresh);
 }
 const valid=fixture(),manifest=await archive.publish({bundleType:archive.TYPE,data:'abcdefghijk'},valid.client,4);assert.equal(manifest.dataDocuments.length,3);assert.equal(valid.state.writes.length,3);assert.equal(manifest.data,undefined);
 console.log('PASS actual Central document/part save guards: actor, access, endpoint, caller context and abort changes during either refresh cannot write; hash/readback scope changes fail closed; callbacks execute before transport; default callers and read RPCs remain compatible.');
})().catch(error=>{console.error(error);process.exitCode=1;});
