// Exercise the actual browser client with synthetic, version-checked REST data.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('docs/portfolio-operations-dashboard/centralization/atlas-central-client.js','utf8');
const key='atlas_shared_property_graph_v1',sessionKey='atlas_central_auth_session_v1',profileKey='atlas_central_profile_v1';
const clone=x=>JSON.parse(JSON.stringify(x));
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
const tick=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const doc=(version=3,payload={value:0,missing:null})=>({document_id:'00000000-0000-4000-8000-000000000001',document_key:key,module_key:'shared-data',source_module:'atlas_shared_data',payload,payload_hash:'old-hash',version,updated_at:'2026-09-24T00:00:00Z'});
function fixture(initial=doc()){
 const storage=new Map(),events=new Map(),calls=[],h={row:clone(initial),before:null,after:null,calls};
 const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)};
 const w={location:{origin:'https://fixture.invalid',pathname:'/',search:'',hash:''},history:{replaceState(){}},setTimeout:(...a)=>{const t=setTimeout(...a);t.unref();return t;},clearTimeout,addEventListener:(k,fn)=>{if(!events.has(k))events.set(k,[]);events.get(k).push(fn);},dispatchEvent:e=>{for(const f of events.get(e.type)||[])f(e);}};
 const response=(body,status=200)=>({ok:status===200,status,headers:{get:()=>null},text:async()=>JSON.stringify(body)});
 const c={window:w,document:{title:'Fixture'},localStorage,sessionStorage:localStorage,URL,URLSearchParams,Date,AbortController,DOMException,console,CustomEvent:class {constructor(type){this.type=type;}},fetch:async(url,options)=>{
  const call={url,options,kind:String(url).includes('/rpc/')?'write':String(url).includes('/auth/')?'auth':'read',body:options.body?JSON.parse(options.body):null};calls.push(call);
  await h.before?.(call);
  if(options.signal?.aborted && !h.ignoreAbort)throw options.signal.reason;
  if(call.kind==='auth')return response(h.tokenResponse);
  if(call.kind==='read'){const value=h.row?[clone(h.row)]:[];await h.after?.(call);return response(value);}
  const args=call.body;
  if((h.row?.version??null)!==args.p_expected_version)return response({message:'Synthetic version conflict'},400);
  h.row={...doc((h.row?.version??0)+1,clone(args.p_payload)),payload_hash:args.p_source_hash};
  await h.after?.(call);
  return response([{document_id:h.row.document_id,document_key:key,module_key:'shared-data',version:h.row.version,payload_hash:h.row.payload_hash,updated_at:h.row.updated_at}]);
 }};
 vm.runInNewContext(source,c);h.central=w.ATLAS_CENTRAL;h.storage=storage;
 h.identity=(id='actor-a',profile={})=>{storage.set(sessionKey,JSON.stringify({access_token:'fixture-token',expires_at:Date.now()/1000+3600,user:{id}}));storage.set(profileKey,JSON.stringify({user_id:id,status:'active',account_status:'active',role:'admin',allowed_community_ids:[],...profile}));w.dispatchEvent({type:'atlas-central-auth-change'});};
 h.identity();h.writes=()=>calls.filter(x=>x.kind==='write');h.reads=()=>calls.filter(x=>x.kind==='read');return h;
}
(async()=>{
 {
  const h=fixture();await assert.rejects(h.central.saveSharedPropertyGraph({value:1}),/Pull and reconcile/);assert.equal(h.calls.length,0,'Unverified drafts do not generate conflict traffic');
  const base=await h.central.readSharedPropertyGraph();base.payload.value=999;
  const unchanged=await h.central.saveSharedPropertyGraph({missing:null,value:0});assert.equal(unchanged.status,'unchanged');assert.equal(h.writes().length,0,'Semantic equality preserves null and zero without another write');
  await assert.rejects(h.central.saveSharedPropertyGraph({value:1},{expectedVersion:1}),/Pull and reconcile/);assert.equal(h.writes().length,0,'Stale explicit version is rejected locally');
  const saved=await h.central.saveSharedPropertyGraph({value:1,missing:null});assert.equal(saved.status,'saved');assert.equal(saved.version,4);assert.equal(h.writes()[0].body.p_expected_version,3);assert.equal(h.reads().length,2,'Only readback establishes the next base');
  await h.central.saveSharedPropertyGraph({value:2,missing:null});assert.equal(h.row.version,5,'A caller immediately awaiting a save can queue the next save');
 }
 {
  const h=fixture(null);assert.equal(await h.central.readSharedPropertyGraph(),null);const saved=await h.central.saveSharedPropertyGraph({properties:{}});assert.equal(saved.version,1);assert.equal(h.writes()[0].body.p_expected_version,null,'Create requires a verified absence read');
 }
 {
  const h=fixture(),gate=deferred(),entered=deferred();await h.central.readSharedPropertyGraph();
  h.before=async call=>{if(call.kind==='write'&&h.writes().length===1){entered.resolve();await gate.promise;}};
  const input={value:1},first=h.central.saveSharedPropertyGraph(input);input.value=999;await entered.promise;
  const firstDuplicate=h.central.saveSharedPropertyGraph({value:1});
  const superseded=h.central.saveSharedPropertyGraph({value:2}),latest=h.central.saveSharedPropertyGraph({value:3}),duplicate=h.central.saveSharedPropertyGraph({value:3});
  assert.equal((await superseded).status,'superseded');gate.resolve();
  const results=await Promise.all([first,firstDuplicate,latest,duplicate]);assert.deepEqual(results.map(r=>r.version),[4,4,5,5]);
  assert.deepEqual(h.writes().map(c=>c.body.p_payload.value),[1,3]);assert.deepEqual(h.writes().map(c=>c.body.p_expected_version),[3,4]);assert.equal(h.row.payload.value,3,'Only latest complete queued draft is published');
 }
 {
  const h=fixture(),gate=deferred(),entered=deferred();await h.central.readSharedPropertyGraph();
  h.before=async call=>{if(call.kind==='write'){entered.resolve();await gate.promise;}};
  const first=h.central.saveSharedPropertyGraph({value:1}),failed=assert.rejects(first,/Pull and reconcile/);await entered.promise;
  const queued=h.central.saveSharedPropertyGraph({value:2}),queuedFailed=assert.rejects(queued,/Pull and reconcile/);h.row=doc(7,{external:1});gate.resolve();await Promise.all([failed,queuedFailed]);
  assert.equal(h.writes().length,1);assert.equal(h.reads().length,1,'Conflict performs no blind read-latest retry');
  await assert.rejects(h.central.saveSharedPropertyGraph({value:3}),/Pull and reconcile/);assert.equal(h.writes().length,1);
  h.before=null;await h.central.readSharedPropertyGraph();await h.central.saveSharedPropertyGraph({external:1,reconciled:true});assert.equal(h.writes().at(-1).body.p_expected_version,7);
 }
 // An ambiguous committed write/readback error blocks retries until a fresh pull.
 {
  const h=fixture();await h.central.readSharedPropertyGraph();h.before=call=>{if(call.kind==='read'&&h.writes().length)throw Error('Readback unavailable');};
  await assert.rejects(h.central.saveSharedPropertyGraph({value:1}),/Pull and reconcile/);assert.equal(h.row.version,4);
  await assert.rejects(h.central.saveSharedPropertyGraph({value:1}),/Pull and reconcile/);assert.equal(h.writes().length,1);
  h.before=null;await h.central.readSharedPropertyGraph();assert.equal((await h.central.saveSharedPropertyGraph({value:1})).status,'unchanged');
 }
 for(const change of ['actor','scope','backend']){
  const h=fixture(),gate=deferred(),entered=deferred();await h.central.readSharedPropertyGraph();
  h.before=async call=>{if(call.kind==='write'){entered.resolve();await gate.promise;}};
  const first=h.central.saveSharedPropertyGraph({value:1}),failed=assert.rejects(first,{name:'AbortError'});await entered.promise;
  const queued=h.central.saveSharedPropertyGraph({value:2}),queuedFailed=assert.rejects(queued,{name:'AbortError'});
  if(change==='backend')h.central.saveLocalConfig({supabaseUrl:'https://other.example.invalid'});else h.identity(change==='actor'?'actor-b':'actor-a',{allowed_community_ids:['new-scope']});
  gate.resolve();await Promise.all([failed,queuedFailed]);assert.equal(h.writes().length,1,'Queued old-context draft never reaches another identity/backend');
  await assert.rejects(h.central.saveSharedPropertyGraph({value:3}),/Pull and reconcile/);h.before=null;await h.central.readSharedPropertyGraph();await h.central.saveSharedPropertyGraph({value:4});assert.equal(h.writes().length,2);
 }
 // A role change during Auth refresh is checked before any write can be sent.
 {
  const h=fixture(),gate=deferred(),entered=deferred();await h.central.readSharedPropertyGraph();
  const session=JSON.parse(h.storage.get(sessionKey));session.expires_at=Date.now()/1000+60;session.refresh_token='fixture-refresh';h.storage.set(sessionKey,JSON.stringify(session));h.tokenResponse={...session,expires_at:Date.now()/1000+3600};
  h.before=async call=>{if(call.kind==='auth'){entered.resolve();await gate.promise;}};
  const saved=h.central.saveSharedPropertyGraph({value:1}),failed=assert.rejects(saved,{name:'AbortError'});await entered.promise;h.identity('actor-b');gate.resolve();await failed;assert.equal(h.writes().length,0);
 }
 // Reads cannot seed another actor's base or race an active write's readback.
 {
  const h=fixture(),gate=deferred(),entered=deferred();h.after=async call=>{if(call.kind==='read'){entered.resolve();await gate.promise;}};
  const read=h.central.readSharedPropertyGraph(),failed=assert.rejects(read,{name:'AbortError'});await entered.promise;h.identity('actor-b');gate.resolve();await failed;
  await assert.rejects(h.central.saveSharedPropertyGraph({value:1}),/Pull and reconcile/);h.after=null;
  await h.central.readSharedPropertyGraph();h.identity('actor-b',{role:'executive'});await h.central.readSharedPropertyGraph();await assert.rejects(h.central.saveSharedPropertyGraph({value:1}),/Pull and reconcile/);assert.equal(h.writes().length,0);
 }
 // Consumer drafts survive failed central publication; errors are visible once,
 // and a previous actor's late error never changes the new workspace's status.
 for(const kind of ['dashboard','marketing']){
  const file=kind==='dashboard'?'workspace-core.js':'RISE-Marketing-Command-Center.html',name=kind==='dashboard'?'writeAtlasSharedPropertyGraph':'writeMarketingSharedPropertyGraph';
  const text=fs.readFileSync('docs/portfolio-operations-dashboard/'+file,'utf8'),match=text.match(new RegExp('^function '+name+'\\(graph, options = \\{\\}\\) \\{[\\s\\S]*?^\\}','m'));
  assert(match);let access='actor-a',notices=0,fail;
  const stored=new Map(),c={window:{ATLAS_CENTRAL:{getStatus:()=>({configured:true,signedIn:true}),getAccessContextKey:()=>access,saveSharedPropertyGraph:()=>new Promise((_,reject)=>{fail=reject;})}},localStorage:{setItem:(k,v)=>stored.set(k,v)},normalizeAtlasSharedPropertyGraph:clone,marketingNormalizeSharedGraph:clone,marketingDefaultSharedGraph:()=>({}),marketingScopedLocalKey:x=>x,atlasScopedLocalKey:x=>x,atlasSharedNow:()=>'',marketingSharedNow:()=>'',ATLAS_SHARED_PROPERTY_GRAPH_KEY:key,ATLAS_SHARED_PROPERTY_SOURCE_ID:'fixture',markAtlasPersistenceError:()=>notices++,setAtlasCentralRuntimeMessage(){},syncAtlasTopbar(){},showToast:()=>notices++,console};
  vm.createContext(c);vm.runInContext(match[0],c);c[name]({draft:1});fail(Error('Conflict'));await tick();assert.equal(notices,1);assert.equal(JSON.parse(stored.get(key)).draft,1);
  c[name]({draft:2});fail(Error('Conflict'));await tick();assert.equal(notices,1,'Repeated blocked writes do not create notification loops');
  c[name]({draft:3});access='actor-b';fail(Error('Late failure'));await tick();assert.equal(notices,1);
 }
 console.log('PASS shared graph CAS: verified base/absence, exact unchanged skip, latest queued coalescing, version conflicts, ambiguous readback, actor/access/backend isolation, Auth race, local draft retention and visible deduplicated errors.');
})().catch(error=>{console.error(error);process.exitCode=1;});
