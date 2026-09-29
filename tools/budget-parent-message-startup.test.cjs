// Real early helper, synthetic event surface; no storage or network operations.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{IDBFactory}=require('fake-indexeddb');
const source=fs.readFileSync(path.join(__dirname,'../docs/portfolio-operations-dashboard/budget-draft-storage.js'),'utf8');
function harness({investorReader=true}={}){
 const listeners=new Map(),hostListeners=new Map(),delivered=[],responses=[],toasts=[];
 let actor='actor-a',backend='https://data.invalid',access='same-access',expires=Date.now()/1000+3600;
 const add=(map,type,fn,capture)=>{const entries=map.get(type)||[];entries.push({fn,capture:!!capture});map.set(type,entries);};
 const emit=(map,event)=>{event.stopImmediatePropagation=()=>event.stopped=true;for(const {fn} of [...(map.get(event.type)||[])].sort((a,b)=>Number(b.capture)-Number(a.capture))){fn(event);if(event.stopped)break;}};
 const parent={ATLAS_CENTRAL:{getConfig:()=>({supabaseUrl:backend,apiBaseUrl:'https://api.invalid',enabled:true}),getSession:()=>({user:{id:actor},expires_at:expires}),getAccessContextKey:()=>access},postMessage:(data,origin)=>responses.push({data,origin}),addEventListener:(type,fn)=>add(hostListeners,type,fn)};
 const window={parent,location:{origin:'https://atlas.invalid',search:investorReader?'?investorReader=1':''},addEventListener:(type,fn,capture)=>add(listeners,type,fn,capture),dispatchEvent:event=>emit(listeners,event)};
 const P={markClean(){}},A={h:{esc:String},boot(){this.state={restoredActor:actor};},toast:message=>toasts.push(message)},R=window.RBB={persist:P,app:A,rebuildLibraries(){},views:{saveload:()=>''}};
 const context=vm.createContext({window,document:{querySelector:()=>null},indexedDB:new IDBFactory(),URLSearchParams,structuredClone,Date,JSON,Map,Error,Promise,MessageEvent:class{constructor(type,options){this.type=type;Object.assign(this,options);}},setTimeout,clearTimeout});
 // An early main-script listener must not see a partial-startup navigation.
 window.addEventListener('message',event=>delivered.push(event.data));
 vm.runInContext(source,context);
 const send=(data,{origin=window.location.origin,source=parent}={})=>emit(listeners,{type:'message',origin,source,data});
 const change=(key,value)=>{if(key==='actor')actor=value;if(key==='backend')backend=value;if(key==='access')access=value;if(key==='expires')expires=value;emit(hostListeners,{type:'atlas-central-auth-change'});};
 return {P,A,R,send,change,delivered,responses,toasts,parent};
}
test('startup buffers exact parent messages, context/catalog before latest navigation, and drains once without IDB',()=>{
 const h=harness();const old={type:'atlas-reforecast-navigate',scenarioId:'old',communityId:'doro'},last={type:'atlas-reforecast-navigate',scenarioId:'exact-last',communityId:'doro'};
 h.send(old);h.send({type:'atlas-budget-catalog',names:['RISE Doro'],communities:[{name:'RISE Doro',totalUnits:247}]});h.send(last);h.send({type:'atlas-shell-context',context:{community:'RISE Doro'}});last.scenarioId='mutated-after-delivery';assert.deepEqual(h.delivered,[]);
 h.P.completeIntegrationStartup();assert.deepEqual(h.delivered.map(row=>row.type),['atlas-shell-context','atlas-budget-catalog','atlas-reforecast-navigate']);assert.equal(h.delivered[2].scenarioId,'exact-last');h.P.completeIntegrationStartup();assert.equal(h.delivered.length,3);h.send({type:'atlas-budget-navigate',view:'savedstr'});assert.equal(h.delivered.length,4);
});
test('wrong-origin, non-parent and unsupported/write protocols are never captured or replayed',()=>{
 const h=harness();for(const [data,options] of [[{type:'atlas-budget-navigate',view:'reforecast'},{origin:'https://foreign.invalid'}],[{type:'atlas-budget-navigate',view:'reforecast'},{source:{}}],[{type:'atlas-budget-publish',payload:{write:true}},{}],[{type:'__proto__'},{}]])h.send(data,options);assert.equal(h.delivered.length,4);h.P.completeIntegrationStartup();assert.equal(h.delivered.length,4);
});
test('queued actions cannot cross observed actor A to B to A, backend, access or expiry transitions',()=>{
 for(const change of ['actor','backend','access','expires']){const h=harness();h.send({type:'atlas-reforecast-navigate',scenarioId:'exact'});h.send({type:'atlas-investor-read-budget',requestId:'old-scope',names:['Doro']});h.change(change,change==='expires'?1:'changed');if(change==='actor')h.change('actor','actor-a');h.P.completeIntegrationStartup();assert.deepEqual(h.delivered,[]);assert.equal(h.responses.length,1);assert.equal(h.responses[0].data.requestId,'old-scope');assert.match(h.responses[0].data.error,/account|workspace/i);assert(h.toasts.length);}
});
test('all bounded concurrent investor requests retain their identity; overflow receives an explicit response',()=>{
 const h=harness();for(let i=0;i<33;i++)h.send({type:'atlas-investor-read-budget',requestId:'request-'+i,year:2026,names:['Community '+i]});assert.equal(h.responses.length,1);assert.equal(h.responses[0].data.requestId,'request-32');assert.match(h.responses[0].data.error,/Too many/);h.P.completeIntegrationStartup();assert.equal(h.delivered.length,32);assert.deepEqual(h.delivered.map(row=>row.requestId),Array.from({length:32},(_,i)=>'request-'+i));assert.equal(h.delivered[31].names[0],'Community 31');h.P.completeIntegrationStartup();assert.equal(h.delivered.length,32);
});
test('equivalent auth refresh retains queued intent',()=>{const h=harness();h.send({type:'atlas-budget-navigate',view:'savedstr'});h.change('access','same-access');h.P.completeIntegrationStartup();assert.equal(h.delivered.length,1);assert.equal(h.delivered[0].view,'savedstr');});

test('a new-account request cannot replay into a draft already restored under the previous account',async()=>{const h=harness({investorReader:false});await h.A.boot();assert.equal(h.A.state.restoredActor,'actor-a');h.change('actor','actor-b');h.send({type:'atlas-reforecast-navigate',scenarioId:'b-record'});assert.throws(()=>h.P.completeIntegrationStartup(),/account or workspace changed/);assert.deepEqual(h.delivered,[]);assert.equal(h.P.renderReady,false);});
test('normal recovered-page startup guards then drains while rendering is still gated',async()=>{const h=harness({investorReader:false});h.send({type:'atlas-reforecast-navigate',scenarioId:'exact'});await h.A.boot();h.P.completeIntegrationStartup();assert.equal(h.delivered[0].scenarioId,'exact');assert.equal(h.P.renderReady,false);});
