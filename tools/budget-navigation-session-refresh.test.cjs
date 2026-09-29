// Real central-client events and navigation with synthetic storage, clock,
// module boundaries and fetch responses; no browser or network.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
if(typeof vm.SourceTextModule!=='function'){const result=require('node:child_process').spawnSync(process.execPath,['--experimental-vm-modules',__filename],{stdio:'inherit'});process.exit(result.status??1);}
const candidate=fs.readFileSync(process.env.ATLAS_NAVIGATION_SOURCE||path.join(__dirname,'../docs/portfolio-operations-dashboard/reforecast-navigation.js'),'utf8');
const original=fs.readFileSync(path.join(__dirname,'fixtures/reforecast-navigation-before-auth-refresh.js'),'utf8');
const client=fs.readFileSync(path.join(__dirname,'../docs/portfolio-operations-dashboard/centralization/atlas-central-client.js'),'utf8');
const SESSION='atlas_central_auth_session_v1',PROFILE='atlas_central_profile_v1',CONFIG='atlas_central_runtime_config_v1';
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
async function harness({source=candidate,profileMissing=false,fallback=false}={}){
 let now=Date.parse('2026-09-28T21:43:00Z'),timerId=0,workspace=null,hold=null;
 const listeners=new Map(),documentListeners=new Map(),storage=new Map(),timers=new Map();
 const metrics={mounts:0,reviews:[],clears:0,legacyClears:0,fetches:[],toasts:[]};
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)};
 const profile=(actor='actor-a')=>({user_id:actor,role:'admin',status:'active',allowed_community_ids:['doro'],allowed_market_values:[],allowed_region_values:[]});
 const session=(actor='actor-a',seconds=60,suffix='initial')=>({access_token:'synthetic-access-'+suffix,refresh_token:'synthetic-refresh-'+suffix,expires_at:Math.floor(now/1000)+seconds,user:{id:actor,email:'synthetic@example.invalid'}});
 const storeSession=value=>value?storage.set(SESSION,JSON.stringify(value)):storage.delete(SESSION);
 const storeProfile=value=>value?storage.set(PROFILE,JSON.stringify(value)):storage.delete(PROFILE);
 storeSession(session());if(!profileMissing)storeProfile(profile());
 const add=(map,type,fn)=>{const entries=map.get(type)||[];entries.push(fn);map.set(type,entries);};
 const emit=(map,event)=>{for(const fn of map.get(event.type)||[])fn(event);};
 const setTimeout=(fn,delay=0)=>{const id=++timerId;timers.set(id,{fn,at:now+delay});return id;};
 class Element{
  constructor(){this.isConnected=true;this.textContent='';this.pendingEdit=null;}
  cloneNode(){return new Element();}
  replaceWith(next){this.isConnected=false;workspace=next;}
 }
 const location={origin:'https://app.synthetic.invalid',pathname:'/budget.html',search:'',hash:''};
 const window={location,history:{replaceState(){}},setTimeout,clearTimeout:id=>timers.delete(id),
  addEventListener:(type,fn)=>add(listeners,type,fn),dispatchEvent:event=>emit(listeners,event),
  ATLAS_CENTRAL_CONFIG:{enabled:true,supabaseUrl:'https://auth.synthetic.invalid',supabaseAnonKey:'synthetic-public-key',apiBaseUrl:'https://api.synthetic.invalid'}};
 window.parent=window;
 const document={title:'Synthetic navigation',getElementById:id=>id==='atlas-reforecast-workspace'?workspace:null,querySelectorAll:()=>[],addEventListener:(type,fn)=>add(documentListeners,type,fn)};
 const context=vm.createContext({window,document,location,Date:Clock,setTimeout,clearTimeout:window.clearTimeout,
  URL,URLSearchParams,AbortController,DOMException,TextEncoder,performance:{now:()=>now},localStorage,
  sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},
  CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},
  console:{log(){},warn(){},error(){}},fetch:async(url)=>{
   // A synthetic stub, never the host's fetch. Unexpected calls fail the test.
   assert.match(String(url),/^https:\/\/auth\.synthetic\.invalid\/auth\/v1\/token\?grant_type=refresh_token$/);
   metrics.fetches.push(String(url));const payload=session('actor-a',3600,'rotated');
   return {ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify(payload)};
  }});
 vm.runInContext(client,context,{filename:'atlas-central-client.reference.js'});
 if(fallback)delete window.ATLAS_CENTRAL.getAccessContextKey;
 const R=window.RBB={views:{},reforecastSources:{retained:true},reforecastPropertyAssignments:{retained:true},budgetNavigation:{groups:[['forecast','Forecast',[]],['reports','Reports',[]]]}};
 const A=R.app={VIEWS:[],state:{activeProperty:'doro',budgetYear:2026},view:'dashboard',go(view){this.view=view;this.render();},
  setProperty(id){this.state.activeProperty=id;this.render();},setYear(year){this.state.budgetYear=year;this.render();},
  render(){if(R.views[this.view]){if(workspace)workspace.isConnected=false;workspace=new Element();workspace.textContent=R.views[this.view]();}},
  toast:message=>metrics.toasts.push(message),scenario:()=>({type:'draft'}),publishToAtlas(){}};
 const modules=new Map();
 async function moduleFor(specifier){
  const kind=specifier.includes('reforecast-ui')?'workspace':specifier.includes('legacy-bridge')?'legacy':'saved-str';
  if(!modules.has(kind)){
   const exports=kind==='workspace'?{
    async mountReforecast(el,{mode}){metrics.mounts++;if(hold){const pending=hold;hold=null;await pending.promise;}if(el.isConnected)el.textContent='Mounted '+mode;},
    async openBudgetReview(detail){metrics.reviews.push(detail);if(workspace?.isConnected)workspace.textContent='Opened '+(detail.scenarioId||detail.reviewId);},
    async createRecommendedReforecast(){},clearReforecastSession(){metrics.clears++;}
   }:kind==='legacy'?{installLegacyReforecastBridge(){},clearLegacyReforecastCache(){metrics.legacyClears++;}}:{installSavedStrProgrammes(){}};
   const module=new vm.SyntheticModule(Object.keys(exports),function(){for(const[key,value]of Object.entries(exports))this.setExport(key,value);},{context});
   modules.set(kind,(async()=>{await module.link(()=>{});await module.evaluate();return module;})());
  }
  return modules.get(kind);
 }
 new vm.Script(source,{filename:'reforecast-navigation.js',importModuleDynamically:moduleFor}).runInContext(context);
 async function flush(){for(let i=0;i<5;i++){for(const[id,timer]of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}await new Promise(setImmediate);}}
 const event=key=>window.dispatchEvent({type:'storage',key});
 const review=async()=>{window.dispatchEvent({type:'message',origin:location.origin,source:window,data:{type:'atlas-reforecast-navigate',view:'reforecast',scenarioId:'exact-doro-draft'}});await flush();};
 await flush();
 return {window,R,A,metrics,storage,session,profile,storeSession,storeProfile,event,flush,review,get el(){return workspace;},
  get central(){return window.ATLAS_CENTRAL;},holdMount(){hold=deferred();return hold.resolve;},advance(ms){now+=ms;},
  async refresh(){await window.ATLAS_CENTRAL.refreshSession();await flush();}};
}

test('negative control: deployed navigation clears the draft on a real same-access refresh event',async()=>{
 const h=await harness({source:original});await h.review();const before=h.el;await h.refresh();
 assert.notEqual(h.el,before);assert.equal(h.metrics.clears,1);assert.match(h.el.textContent,/signed-in workspace changed/);
});
test('candidate retains mounted draft, unsaved edits and caches on token rotation and equivalent profile storage event',async()=>{
 const h=await harness();await h.review();const before=h.el,sources=h.R.reforecastSources,assignments=h.R.reforecastPropertyAssignments;
 before.pendingEdit={name:'Unsaved Doro change'};const pendingEdit=before.pendingEdit;
 await h.refresh();h.storeProfile({...h.profile(),display_name:'Changed display-only profile field'});h.event(PROFILE);await h.flush();
 assert.equal(h.el,before);assert.equal(h.el.pendingEdit,pendingEdit);assert.equal(h.R.reforecastSources,sources);assert.equal(h.R.reforecastPropertyAssignments,assignments);
 assert.equal(h.metrics.mounts,1);assert.equal(h.metrics.reviews.length,1);assert.equal(h.metrics.clears,0);assert.equal(h.metrics.legacyClears,0);assert.equal(h.metrics.fetches.length,1);
});
test('same-access refresh retains queued exact-record intent during a pending mount',async()=>{
 const h=await harness(),release=h.holdMount();await h.review();const before=h.el;
 await h.refresh();h.event(PROFILE);await h.flush();assert.equal(h.el,before);assert.equal(h.metrics.clears,0);
 release();await h.flush();assert.equal(h.metrics.reviews.length,1);assert.equal(h.metrics.reviews[0].scenarioId,'exact-doro-draft');assert.match(h.el.textContent,/Opened exact-doro-draft/);
});
for(const [name,change]of [
 ['sign-out',h=>{h.storeSession(null);h.event(SESSION);}],
 ['actor change',h=>{h.storeSession(h.session('actor-b'));h.storeProfile(h.profile('actor-b'));h.event(SESSION);}],
 ['role change',h=>{h.storeProfile({...h.profile(),role:'community_manager'});h.event(PROFILE);}],
 ['community scope change',h=>{h.storeProfile({...h.profile(),allowed_community_ids:[]});h.event(PROFILE);}],
 ['profile removal',h=>{h.storeProfile(null);h.event(PROFILE);}],
 ['database configuration change',h=>{h.window.ATLAS_CENTRAL_CONFIG.supabaseUrl='https://other.synthetic.invalid';h.event(CONFIG);}],
 ['API configuration change outside central access key',h=>{const key=h.central.getAccessContextKey();h.window.ATLAS_CENTRAL_CONFIG.apiBaseUrl='https://other-api.synthetic.invalid';assert.equal(h.central.getAccessContextKey(),key);h.event(CONFIG);}],
 ['central client replacement',h=>{h.window.ATLAS_CENTRAL={...h.central};h.window.dispatchEvent({type:'atlas-central-auth-change'});}],
])test(name+' clears display/caches and cancels the pending exact-record intent',async()=>{
 const h=await harness(),release=h.holdMount();await h.review();const before=h.el;change(h);
 assert.notEqual(h.el,before);assert.equal(before.isConnected,false);assert.equal(h.R.reforecastSources,undefined);assert.equal(h.R.reforecastPropertyAssignments,undefined);
 release();await h.flush();assert.equal(h.metrics.reviews.length,0);assert.equal(h.metrics.clears,1);assert.equal(h.metrics.legacyClears,1);assert.match(h.el.textContent,/signed-in workspace changed/);
});
test('expiry clears even with retained actor/token and an unchanged expiry-blind key when profile was already absent',async()=>{
 const h=await harness({profileMissing:true});await h.review();const before=h.el,key=h.central.getAccessContextKey();
 h.event(SESSION);await h.flush();assert.equal(h.el,before); // Schedules the real central client's expiry timer.
 h.advance(61000);await h.flush();assert.equal(h.central.getSession().user.id,'actor-a');assert.equal(h.central.getAccessContextKey(),key);
 assert.notEqual(h.el,before);assert.equal(h.metrics.clears,1);assert.match(h.el.textContent,/signed-in workspace changed/);
});
for(const expires_at of [undefined,'invalid',0])test('missing or invalid session expiry clears without relying on a profile change: '+String(expires_at),async()=>{
 const h=await harness({profileMissing:true});await h.review();const before=h.el,key=h.central.getAccessContextKey();
 h.storeSession({...h.session(),expires_at});assert.equal(h.central.getAccessContextKey(),key);h.event(SESSION);await h.flush();assert.notEqual(h.el,before);assert.equal(h.metrics.clears,1);
});
test('expiry also invalidates a pending callback before any auth event is delivered',async()=>{
 const h=await harness({profileMissing:true}),release=h.holdMount();await h.review();h.advance(61000);release();await h.flush();assert.equal(h.metrics.reviews.length,0);
});
test('profile fallback retains a refresh but still clears changed authorization',async()=>{
 const h=await harness({fallback:true});await h.review();const before=h.el;await h.refresh();assert.equal(h.el,before);assert.equal(h.metrics.clears,0);
 h.storeProfile({...h.profile(),allowed_community_ids:[]});h.event(PROFILE);await h.flush();assert.notEqual(h.el,before);assert.equal(h.metrics.clears,1);
});
test('an explicit unavailable access key is not replaced by a cached profile fallback',async()=>{
 const h=await harness();await h.review();const before=h.el;
 h.central.getAccessContextKey=()=>null;h.event(PROFILE);await h.flush();assert.notEqual(h.el,before);assert.equal(h.metrics.clears,1);
});
