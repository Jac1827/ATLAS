// Runs the actual browser client against credential-free, in-memory REST responses.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('docs/portfolio-operations-dashboard/centralization/atlas-central-client.js','utf8');
const SESSION='atlas_central_auth_session_v1',PROFILE='atlas_central_profile_v1';
const copy=value=>JSON.parse(JSON.stringify(value)),deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const row=n=>({import_id:id(n),community_id:id(9000),version:1,updated_at:'2026-09-01T00:00:00Z',deleted_at:null,content_hash:'hash-'+n,created_at:'2026-09-01T00:00:00Z',source_metadata:{missing:null,zero:0},records:[{applicationId:'synthetic-'+n,value:0,missing:null}]});
function fixture(rows=[row(1)]){
 const storage=new Map(),events=new Map(),calls=[];
 const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)};
 const w={location:{origin:'https://local.example.invalid',pathname:'/',search:'',hash:''},history:{replaceState(){}},setTimeout:(...args)=>{const timer=setTimeout(...args);timer.unref();return timer;},clearTimeout,addEventListener:(name,handler)=>{if(!events.has(name))events.set(name,[]);events.get(name).push(handler);},dispatchEvent:event=>{for(const handler of events.get(event.type)||[])handler(event);}};
 const h={rows:copy(rows),calls,storage,before:null};
 const response=value=>({ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify(value)});
 const context={window:w,localStorage,sessionStorage:localStorage,Date,URL,URLSearchParams,AbortController,DOMException,performance,TextEncoder,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},document:{title:'Local'},console,fetch:async(url,options)=>{
   const parsed=new URL(url),params=parsed.searchParams,table=parsed.pathname.split('/').at(-1),kind=params.get('select')==='*'?'payload':'metadata';
   const call={table,kind,params,options};calls.push(call);await h.before?.(call);
   if(options.signal?.aborted)throw options.signal.reason;
   if(table==='token')return response(h.tokenResponse);
   if(table.startsWith('atlas_publish_')||table==='atlas_revise_application_import')return response(h.rows[0]);
   let selected=h.rows.slice().sort((a,b)=>a.import_id.localeCompare(b.import_id));const filter=params.get('import_id');
   if(filter?.startsWith('gt.'))selected=selected.filter(r=>r.import_id>filter.slice(3));
   if(filter?.startsWith('in.(')){const ids=filter.slice(4,-1).split(',');selected=selected.filter(r=>ids.includes(r.import_id));}
   selected=selected.slice(0,Number(params.get('limit'))||100);
   if(kind==='metadata')selected=selected.map(r=>Object.fromEntries(params.get('select').split(',').map(k=>[k,r[k]])));
   return response(selected);
 }};
 vm.runInNewContext(source,context);h.central=w.ATLAS_CENTRAL;
 h.identity=(actor='actor-a',profile={})=>{storage.set(SESSION,JSON.stringify({access_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:actor}}));storage.set(PROFILE,JSON.stringify({user_id:actor,status:'active',role:'admin',allowed_community_ids:[id(9000)],...profile}));w.dispatchEvent({type:'atlas-central-auth-change'});};
 h.identity();h.payloads=()=>calls.filter(c=>c.kind==='payload');h.metadata=()=>calls.filter(c=>c.kind==='metadata');return h;
}
(async()=>{
 // Full paging, stable order, exact null/zero values and immutable payload reuse.
 {
  const h=fixture(Array.from({length:205},(_,i)=>row(205-i)));
  const initial=await h.central.readApplicationImports();assert.equal(initial.length,205);assert.deepEqual(copy(initial),h.rows.slice().reverse());assert.equal(h.payloads().length,5);assert.equal(h.metadata().length,6);
  assert(Object.isFrozen(initial[0])&&Object.isFrozen(initial[0].records[0]));initial.reverse();
  const repeat=await h.central.readApplicationImports();assert.equal(h.payloads().length,5,'unchanged metadata never transfers another payload');assert.equal(repeat[0].import_id,id(1));assert.equal(repeat[0].records[0].value,0);assert.equal(repeat[0].records[0].missing,null);assert.equal(repeat[0],initial.at(-1),'unchanged rows preserve immutable identity');
  h.rows[0]={...h.rows[0],version:2,updated_at:'2026-09-02T00:00:00Z',records:[{value:15}]};await h.central.readApplicationImports();assert.equal(h.payloads().length,6);assert.equal(h.payloads().at(-1).params.get('import_id'),`in.(${id(205)})`);
  h.rows[0]={...h.rows[0],version:3,deleted_at:'2026-09-03T00:00:00Z'};const deleted=await h.central.readApplicationImports();assert.equal(deleted.at(-1).deleted_at,h.rows[0].deleted_at,'tombstones retain the exact default row shape');
  h.rows=h.rows.filter(r=>r.import_id!==id(3));const removed=await h.central.readApplicationImports();assert(!removed.some(r=>r.import_id===id(3)));assert.equal(h.payloads().length,7,'access removal does not transfer another payload');
 }
 // Scope is actor, backend and every access dimension; returning to an old actor cannot resurrect its cache.
 {
  const h=fixture();await h.central.readApplicationImports();let count=h.payloads().length;
  for(const profile of [{role:'regional'},{allowed_community_ids:[id(9001)]},{locked_tab_ids:['16']},{account_status:'active'}]){h.identity('actor-a',profile);await h.central.readApplicationImports();assert.equal(h.payloads().length,++count);}
  h.identity('actor-b');await h.central.readApplicationImports();assert.equal(h.payloads().length,++count);h.identity('actor-a');await h.central.readApplicationImports();assert.equal(h.payloads().length,++count);
  h.central.saveLocalConfig({supabaseUrl:'https://second.example.invalid'});await h.central.readApplicationImports();assert.equal(h.payloads().length,++count);
  h.identity('actor-a',{status:'disabled'});await assert.rejects(h.central.readApplicationImports(),{name:'AbortError'});assert.equal(h.payloads().length,count);
 }
 // Simultaneous subscribers share one metadata/payload sequence; one cancellation cannot stop another reader.
 {
  const h=fixture(),gate=deferred(),entered=deferred();h.before=async call=>{if(call.kind==='metadata'&&h.calls.length===1){entered.resolve();await gate.promise;}};
  const controller=new AbortController(),first=h.central.readApplicationImports({signal:controller.signal}),cancelled=assert.rejects(first,{name:'AbortError'}),second=h.central.readApplicationImports();await entered.promise;controller.abort();await cancelled;assert.equal(h.calls[0].options.signal.aborted,false);gate.resolve();await second;assert.equal(h.payloads().length,1);assert.equal(h.metadata().length,2);
 }
 // Last subscriber cancellation aborts the transport, and the unfinished result cannot become current.
 {
  const h=fixture(),gate=deferred(),entered=deferred();h.before=async call=>{if(h.calls.length===1){entered.resolve();await gate.promise;}};
  const c=new AbortController(),read=h.central.readApplicationImports({signal:c.signal}),rejected=assert.rejects(read,{name:'AbortError'});await entered.promise;c.abort();await rejected;assert.equal(h.calls[0].options.signal.aborted,true);gate.resolve();await tick();h.before=null;await h.central.readApplicationImports();assert.equal(h.payloads().length,1);
 }
 // In-flight role and actor changes deny the old response even if a transport ignores abort.
 for(const change of ['actor','role']){
  const h=fixture(),gate=deferred(),entered=deferred();h.before=async call=>{if(call.kind==='payload'){entered.resolve();await gate.promise;}};
  const read=h.central.readApplicationImports(),rejected=assert.rejects(read,{name:'AbortError'});await entered.promise;h.identity(change==='actor'?'actor-b':'actor-a',{role:'regional'});gate.resolve();await rejected;h.before=null;await h.central.readApplicationImports();assert.equal(h.payloads().length,2);
 }
 // Cancelling a subscriber waiting for token rotation does not wait for or abort shared Auth.
 {
  const h=fixture(),gate=deferred(),entered=deferred(),session=JSON.parse(h.storage.get(SESSION));session.expires_at=Math.floor(Date.now()/1000)+60;session.refresh_token='synthetic-refresh';h.storage.set(SESSION,JSON.stringify(session));
  h.tokenResponse={...session,expires_at:Math.floor(Date.now()/1000)+3600};h.before=async call=>{if(call.table==='token'){entered.resolve();await gate.promise;}};
  const c=new AbortController(),read=h.central.readApplicationImports({signal:c.signal}),rejected=assert.rejects(read,{name:'AbortError'});await entered.promise;c.abort();await rejected;
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].options.signal.aborted,false,'Other Auth subscribers retain the shared refresh');gate.resolve();await tick();assert.equal(h.calls.length,1,'Cancelled read never resumes payload or metadata fetches');
 }
 // A revision race retries once using fresh metadata, with no stale result on continuous drift.
 {
  const h=fixture();let mutate=true;h.before=call=>{if(call.kind==='payload'&&mutate){h.rows[0].version++;h.rows[0].records[0].value=2;mutate=false;}};
  const result=await h.central.readApplicationImports();assert.equal(result[0].version,2);assert.equal(result[0].records[0].value,2);assert.equal(h.payloads().length,2);
  h.rows[0].version++;h.before=call=>{if(call.kind==='payload')h.rows[0].version++;};const before=h.payloads().length;await assert.rejects(h.central.readApplicationImports(),/changed while refreshing/);assert.equal(h.payloads().length-before,2,'at most one retry');h.before=null;await h.central.readApplicationImports();assert.equal(h.payloads().length-before,3,'failed refresh was never accepted as current');
 }
 // Revision/deletion occurring after the full fetch is caught by the final metadata sweep.
 {
  const h=fixture();let changed=false;h.before=call=>{if(call.kind==='metadata'&&h.payloads().length&&!changed){h.rows=[];changed=true;}};
  assert.deepEqual(copy(await h.central.readApplicationImports()),[]);assert.equal(h.payloads().length,1);
 }
 // Errors are not cached as successful empty/current reads; the next call performs real verification.
 {
  const h=fixture();await h.central.readApplicationImports();h.before=()=>{throw Error('synthetic read failure');};await assert.rejects(h.central.readApplicationImports(),/synthetic read failure/);h.before=null;await h.central.readApplicationImports();assert.equal(h.payloads().length,2);
  h.rows=[];assert.deepEqual(copy(await h.central.readApplicationImports()),[]);h.rows=[row(1)];await h.central.readApplicationImports();assert.equal(h.payloads().length,3,'removed rows are evicted, not retained across inaccessible scopes');
 }
 // Screening uses its actual immutable schema rather than nonexistent version/deletion fields.
 {
  const item=row(1);delete item.version;delete item.updated_at;delete item.deleted_at;const h=fixture([item]);
  assert.deepEqual(copy(await h.central.readScreeningImports()),[item]);await h.central.readScreeningImports();assert.equal(h.payloads().length,1);assert.equal(h.metadata()[0].params.get('select'),'import_id,content_hash,created_at');h.rows[0].content_hash='new-hash';await h.central.readScreeningImports();assert.equal(h.payloads().length,2);
 }
 console.log('PASS scoped immutable Applications/Screening cache: metadata-only repeats, exact paging/order/null/zero/tombstones, changed-row payloads, actor/access/backend invalidation, shared reads, cancellation, bounded revision races and no cached failures.');
})().catch(error=>{console.error(error);process.exitCode=1;});
