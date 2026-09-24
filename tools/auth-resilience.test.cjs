// Real browser client with a fake clock and synthetic responses. Never sends a network request.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('docs/portfolio-operations-dashboard/centralization/atlas-central-client.js','utf8');
const SESSION='atlas_central_auth_session_v1',PROFILE='atlas_central_profile_v1';
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const response=(status,payload,headers={})=>({ok:status>=200&&status<300,status,headers:{get:name=>headers[name.toLowerCase()]||null},text:async()=>typeof payload==='string'?payload:JSON.stringify(payload)});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function harness(){
 let now=Date.parse('2026-09-24T20:00:00Z'),nextTimer=0,handler;
 const storage=new Map(),sessionStorage=new Map(),timers=new Map(),calls=[],events=[],logs=[];
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const local={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)};
 const window={location:{origin:'https://synthetic.example.invalid',pathname:'/index.html',search:'',hash:''},history:{replaceState(){}},dispatchEvent:event=>events.push(event),addEventListener(){},setTimeout:(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,at:now+delay});return id;},clearTimeout:id=>timers.delete(id)};
 const context={window,Date:Clock,URL,URLSearchParams,AbortController,DOMException,TextEncoder,performance:{now:()=>now},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},document:{title:'Synthetic'},localStorage:local,sessionStorage:{getItem:key=>sessionStorage.get(key)||null,setItem:(key,value)=>sessionStorage.set(key,value),removeItem:key=>sessionStorage.delete(key)},console:{log:(...args)=>logs.push(args),error:(...args)=>logs.push(args),warn:(...args)=>logs.push(args)},fetch:async(url,options)=>{calls.push({url,options});return handler(url,options);}};
 vm.runInNewContext(source,context);
 const session=(actor='actor-a',seconds=60,suffix=actor)=>({access_token:'synthetic-access-'+suffix,refresh_token:'synthetic-refresh-'+suffix,expires_at:Math.floor(now/1000)+seconds,user:{id:actor,email:'synthetic@risere.com'}});
 return{central:window.ATLAS_CENTRAL,storage,timers,calls,events,logs,session,setHandler:fn=>handler=fn,store:value=>storage.set(SESSION,JSON.stringify(value)),profile:(actor='actor-a')=>storage.set(PROFILE,JSON.stringify({user_id:actor,role:'admin',status:'active'})),stored:()=>JSON.parse(storage.get(SESSION)||'null'),async advance(ms){now+=ms;for(const[id,timer]of[...timers])if(timer.at<=now){timers.delete(id);timer.fn();}await tick();}};
}
(async()=>{
 // One explicit password request, clear messages and no session on transport/service failures.
 for(const mode of ['network','500','504','429','body']){
  const h=harness();h.setHandler(async()=>{if(mode==='network')throw Error('private backend token=SECRET');if(mode==='body')return{...response(200,{}),text:async()=>{throw Error('private body SECRET');}};return response(Number(mode),{error:'private backend SECRET /auth/v1/token?grant_type=password'},{'retry-after':'90'});});
  await assert.rejects(h.central.signInWithPassword('synthetic@risere.com','synthetic-password'),error=>{assert(!/SECRET|https:|auth\/v1|grant_type|private backend|Failed to fetch/.test(error.message));assert(/ATLAS|sign-in/.test(error.message));if(mode==='429')assert.equal(error.retryAfterSeconds,90);return true;});
  assert.equal(h.calls.length,1);assert.equal(h.stored(),null);assert.equal(h.logs.length,0);assert.equal(h.timers.size,0);
 }
 for(const bodyHang of [false,true]){
  const h=harness(),pending=deferred();h.setHandler(async()=>bodyHang?{...response(200,{}),text:()=>pending.promise}:pending.promise);
  const result=h.central.signInWithPassword('synthetic@risere.com','synthetic-password');const rejection=assert.rejects(result,/taking too long/);await tick();assert.equal(h.calls.length,1);await h.advance(19999);assert.equal(h.calls[0].options.signal.aborted,false);await h.advance(1);await rejection;assert.equal(h.calls[0].options.signal.aborted,true);assert.equal(h.stored(),null);assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);
 }
 // A malformed HTTP200 cannot clear an existing session or report a successful sign-in.
 for(const missing of ['access_token','refresh_token','user','expires_at','expired','invalid_expiry']){
  const h=harness(),original=h.session('actor-a',3600),payload=h.session('actor-b',3600);h.store(original);h.profile();const initialEvents=h.events.length;
  if(missing==='expired')payload.expires_at=1;else if(missing==='invalid_expiry')payload.expires_at='invalid';else delete payload[missing];
  h.setHandler(async()=>response(200,payload));await assert.rejects(h.central.signInWithPassword('synthetic@risere.com','synthetic-password'),/temporarily unavailable/);assert.deepEqual(h.stored(),original);assert.equal(h.central.getStoredProfile().user_id,'actor-a');assert.equal(h.calls.length,1);assert.equal(h.events.length,initialEvents);
 }
 // Concurrent password submissions share one POST; a successful token proceeds to profile bootstrap.
 {
  const h=harness(),pending=deferred(),token=h.session('actor-a',3600);h.setHandler(async url=>url.includes('/auth/v1/token')?pending.promise:response(200,url.includes('atlas_user_profiles')?[{user_id:'actor-a',role:'admin',status:'active'}]:[]));
  const a=h.central.signInWithPassword('synthetic@risere.com','synthetic-password'),b=h.central.signInWithPassword('synthetic@risere.com','synthetic-password');await tick();assert.equal(h.calls.length,1);pending.resolve(response(200,token));await Promise.all([a,b]);assert.equal(h.calls.filter(c=>c.url.includes('/auth/v1/token')).length,1);assert.equal(h.central.getStoredProfile().role,'admin');assert.equal(h.stored().access_token,token.access_token);assert.equal(h.calls[0].options.headers.Authorization.startsWith('Bearer sb_publishable_'),true);
 }
 // Transient refresh failures retain the stored session, suppress repeats and honor Retry-After.
 for(const status of [0,403,409,503,429]){
  const h=harness(),original=h.session();h.store(original);h.profile();h.setHandler(async()=>{if(!status)throw Error('private connection failure');return response(status,{error:'private outage'},{'retry-after':status===429?'90':'0'});});
  await assert.rejects(h.central.refreshSession());assert.deepEqual(h.stored(),original);assert.equal(h.central.getStoredProfile().role,'admin');assert.equal(h.calls.length,1);for(let i=0;i<5;i++)await assert.rejects(h.central.refreshSession());assert.equal(h.calls.length,1);
  const cooldown=status===429?90000:30000;await h.advance(cooldown-1);await assert.rejects(h.central.refreshSession());assert.equal(h.calls.length,1);await h.advance(1);await assert.rejects(h.central.refreshSession());assert.equal(h.calls.length,2);assert.deepEqual(h.stored(),original);if(status===429)assert.equal(h.central.getStoredProfile(),null,'Expired cached roles cannot authorize access');
 }
 // Refresh is deduplicated and recovered tokens replace only the still-matching session.
 {
  const h=harness(),old=h.session(),pending=deferred();h.store(old);h.setHandler(()=>pending.promise);const a=h.central.refreshSession(),b=h.central.refreshSession();assert.equal(h.calls.length,1);pending.resolve(response(200,h.session('actor-a',3600,'rotated')));await Promise.all([a,b]);assert.equal(h.stored().refresh_token,'synthetic-refresh-rotated');
 }
 // A pending refresh for another configured project cannot coalesce or replace its new session.
 {
  const h=harness(),old=h.session(),pending=deferred();h.store(old);h.setHandler(()=>pending.promise);const first=h.central.refreshSession();
  h.central.saveLocalConfig({supabaseUrl:'https://new-project.example.invalid'});h.setHandler(async()=>response(200,h.session('actor-a',3600,'new-project')));await h.central.refreshSession();assert.equal(h.calls.length,2);assert(h.calls[1].url.startsWith('https://new-project.example.invalid/'));
  pending.resolve(response(200,h.session('actor-a',3600,'old-project')));await first;assert.equal(h.stored().refresh_token,'synthetic-refresh-new-project');
 }
 for(const outcome of ['success','invalid','network']){
  const h=harness(),old=h.session(),newSession=h.session('actor-b',3600),pending=deferred();h.store(old);h.profile();h.setHandler(()=>pending.promise);const attempt=h.central.refreshSession();const observed=attempt.catch(error=>error);h.store(newSession);h.profile('actor-b');
  if(outcome==='network')pending.reject(Error('private outage'));else pending.resolve(outcome==='invalid'?response(400,{error_code:'refresh_token_not_found',msg:'Invalid Refresh Token: Refresh Token Not Found'}):response(200,h.session('actor-a',3600,'rotated')));
  await observed;assert.deepEqual(h.stored(),newSession);assert.equal(h.central.getStoredProfile().user_id,'actor-b');
 }
 {
  const h=harness(),old=h.session();h.store(old);h.profile();h.setHandler(async()=>response(400,{error_code:'refresh_token_not_found',msg:'Invalid Refresh Token: Refresh Token Not Found'}));await assert.rejects(h.central.refreshSession());assert.equal(h.stored(),null);assert.equal(h.central.getStoredProfile(),null);
 }
 {
  const h=harness(),old=h.session();h.store(old);h.profile();h.setHandler(async()=>response(403,{error:'edge access denied'}));await assert.rejects(h.central.refreshSession());assert.deepEqual(h.stored(),old,'Unrelated HTTP403 must not destroy a session');h.store(h.session('actor-a',-1));assert.equal(h.central.getStoredProfile(),null);assert.equal(h.central.getStatus().role,'');h.store(h.session('actor-b',3600));assert.equal(h.central.getStoredProfile(),null,'A prior account profile cannot grant roles to a new actor');
 }
 // A new actor is not trapped by another actor's failed-refresh cooldown, even with fixture token reuse.
 {
  const h=harness(),old=h.session();h.store(old);h.setHandler(async()=>response(503,{error:'outage'}));await assert.rejects(h.central.refreshSession());h.store({...old,user:{id:'actor-b'}});await assert.rejects(h.central.refreshSession());assert.equal(h.calls.length,2);
 }
 // Non-Auth RPC writes keep their existing behavior and are never put under this deadline or retried.
 {
  const h=harness(),pending=deferred();h.setHandler(()=>pending.promise);const result=h.central.fetchJson('/rpc/atlas_bonus_workflow',{method:'POST',body:'{}'});await tick();assert.equal(h.timers.size,0);assert.equal(h.calls[0].options.signal,undefined);await h.advance(25000);assert.equal(h.calls.length,1);pending.resolve(response(200,{ok:true}));assert.equal((await result).ok,true);
 }
 console.log('PASS Auth-only 20s network/body deadline, safe transient messages, no password retries, concurrent deduplication, refresh cooldown/Retry-After, session-race protection, expired profile denial and unchanged RPC writes; synthetic VM only');
})().catch(error=>{console.error(error);process.exitCode=1;});
