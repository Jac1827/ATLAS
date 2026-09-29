const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
if(typeof vm.SourceTextModule!=='function'){const result=require('node:child_process').spawnSync(process.execPath,['--experimental-vm-modules',__filename],{stdio:'inherit'});process.exit(result.status??1);}
const {webcrypto}=require('node:crypto');
const feature=path.resolve(__dirname,'../docs/portfolio-operations-dashboard/features');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class Element extends EventTarget {
 constructor(){super();this.open=false;this.isConnected=false;this.children=new Map();this.textContent='';}
 querySelector(key){if(!this.children.has(key))this.children.set(key,new Element());return this.children.get(key);}
 querySelectorAll(){return [];}
 setAttribute(){}
 showModal(){this.open=true;}
 close(){if(!this.open)return;this.open=false;this.dispatchEvent(new Event('close'));}
 remove(){this.isConnected=false;}
}
async function harness(){
 const host=new EventTarget(),dialogs=[],held=deferred(),recover=deferred();let auth={role:'admin',scope:['doro']},config={enabled:true,supabaseUrl:'https://example.invalid'},session={user:{id:'actor'},access_token:'old',expires_at:Math.floor(Date.now()/1000)+3600},writes=0,parses=0;
 const central={getSession:()=>session,getAccessContextKey:()=>JSON.stringify(auth),getStoredProfile:()=>auth,getConfig:()=>config,fetchJson:async()=>{throw Error('unexpected server operation');}};host.ATLAS_CENTRAL=central;host.parent=host;
 const context=vm.createContext({window:host,document:{createElement:()=>{const el=new Element();dialogs.push(el);return el;},body:{appendChild:el=>{el.isConnected=true;}}},crypto:webcrypto,console,setTimeout,clearTimeout,Date,Event});
 const scope=new vm.SourceTextModule(fs.readFileSync(path.join(feature,'reforecast-session-scope.mjs'),'utf8'),{context});await scope.link(()=>{});await scope.evaluate();
 const source=fs.readFileSync(path.join(feature,'reforecast-import-ui.mjs'),'utf8');
 const evidence={source:{fileName:'review.xlsx',sha256:'hash'},parserVersion:'current',integrity:{auditId:'audit'},lines:[],metadata:{},summary:{},issues:[]};
 const stubs={currentReforecastParserVersion:'current',needsReforecastParserRecovery:()=>false,upgradeReforecastParserEvidence:async e=>({evidence:e,changed:false}),readWorkbookAudit:()=>held.promise,parseReforecastWorkbook:async()=>{parses++;return evidence;},listForecastRecovery:()=>recover.promise,readForecastRecovery:()=>held.promise,saveForecastRecoveryEntries:async()=>{writes++;}};
 const exportsBySpecifier=new Map([...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)].map(m=>[m[2],m[1].split(',').map(x=>x.trim())]));
 const module=new vm.SourceTextModule(source,{context});await module.link(specifier=>{if(specifier.includes('reforecast-session-scope'))return scope;const names=exportsBySpecifier.get(specifier);return new vm.SyntheticModule(names,function(){for(const name of names)this.setExport(name,stubs[name]||(()=>{throw Error('Unexpected dependency '+name);}));},{context});});await module.evaluate();
 const options={central,actor:'actor',communities:[{community_id:'doro'}],defaultPeriods:['2026-09']};
 const upload={upload_id:'upload',community_id:'doro',payload:{...evidence,propertyAssignment:{communityId:'doro'}}};
 return {host,central,dialogs,held,recover,evidence,options,upload,api:module.namespace,scope:scope.namespace,get writes(){return writes;},get parses(){return parses;},change(kind,emit=true){if(kind==='role')auth={...auth,role:'viewer'};if(kind==='scope')auth={...auth,scope:[]};if(kind==='config')config={...config,supabaseUrl:'https://other.invalid'};if(kind==='actor')session={...session,user:{id:'other'}};if(kind==='signout')session=null;if(kind==='expiry')session={...session,expires_at:1};if(kind==='refresh')session={...session,access_token:'new',expires_at:Math.floor(Date.now()/1000)+7200};if(emit)host.dispatchEvent(new Event('atlas-central-auth-change'));}};
}
for(const change of ['role','scope','config','actor','signout','expiry'])test(`saved import rejects ${change} change while workbook evidence is loading`,async()=>{
 const h=await harness(),operation=h.api.resumeReforecastImport({...h.options,upload:h.upload});const failure=assert.rejects(operation,/workspace changed/);
 h.change(change);h.held.resolve(h.evidence.integrity);await failure;assert.equal(h.dialogs.filter(el=>el.open).length,0);assert.equal(h.writes,0);
});
test('same-access refresh preserves a pending saved import and its mapping dialog',async()=>{
 const h=await harness(),operation=h.api.resumeReforecastImport({...h.options,upload:h.upload});const cleanup=assert.rejects(operation,/test cleanup/);
 h.change('refresh');h.held.resolve(h.evidence.integrity);await tick();assert.equal(h.dialogs.filter(el=>el.open).length,1);h.change('refresh');assert.equal(h.dialogs.filter(el=>el.open).length,1);h.recover.reject(Error('test cleanup'));await cleanup;
});
test('same-actor access change closes an already opened review before its local recovery read completes',async()=>{
 const h=await harness(),operation=h.api.resumeReforecastImport({...h.options,upload:h.upload});const failure=assert.rejects(operation,/workspace changed/);h.held.resolve(h.evidence.integrity);await tick();assert.equal(h.dialogs.filter(el=>el.open).length,1);h.change('scope');assert.equal(h.dialogs.filter(el=>el.open).length,0);h.recover.resolve([]);await failure;assert.equal(h.writes,0);
});
test('expiry without an auth event rejects the saved import after the pending read',async()=>{
 const h=await harness(),operation=h.api.resumeReforecastImport({...h.options,upload:h.upload});const failure=assert.rejects(operation,/workspace changed/);h.change('expiry',false);h.held.resolve(h.evidence.integrity);await failure;assert.equal(h.dialogs.length,0);
});
test('new workbook captures access before reading bytes and closes its loading dialog',async()=>{
 const h=await harness(),operation=h.api.importReforecastWorkbook({...h.options,file:{name:'review.xlsx',arrayBuffer:()=>h.held.promise}});const failure=assert.rejects(operation,/workspace changed/);assert.equal(h.dialogs.filter(el=>el.open).length,1);h.change('role');assert.equal(h.dialogs.filter(el=>el.open).length,0);h.held.resolve(new ArrayBuffer(0));await failure;assert.equal(h.parses,0);assert.equal(h.writes,0);
});
test('local recovery captures access before reading retained private evidence',async()=>{
 const h=await harness(),operation=h.api.resumeLocalReforecastImport({...h.options,recoveryId:'review'});const failure=assert.rejects(operation,/workspace changed/);h.change('scope');h.held.resolve({kind:'import-review',evidenceId:'evidence'});await failure;assert.equal(h.dialogs.length,0);assert.equal(h.writes,0);
});
test('explicit workspace clear synchronously closes only owned dialogs and prevents a stale loader',async()=>{
 const h=await harness(),unrelated=new Element();unrelated.showModal();const operation=h.api.resumeReforecastImport({...h.options,upload:h.upload});const failure=assert.rejects(operation,/workspace changed/);h.scope.invalidateReforecastSessions();h.held.resolve(h.evidence.integrity);await failure;assert.equal(unrelated.open,true);assert.equal(h.dialogs.length,0);
});
test('retained parent operation guard blocks a same-actor stale callback before opening review',async()=>{
 const h=await harness();let parentValid=true;const operation=h.api.resumeReforecastImport({...h.options,upload:h.upload,beforeSessionCheck:()=>{if(!parentValid)throw Error('parent invalidated');}});const failure=assert.rejects(operation,/parent invalidated/);parentValid=false;h.held.resolve(h.evidence.integrity);await failure;assert.equal(h.dialogs.length,0);
});
test('closing the initiating chooser prevents a late saved-import dialog',async()=>{
 const h=await harness(),chooser=new Element();chooser.isConnected=true;chooser.showModal();
 const operation=h.scope.loadReforecastDialog(h.central,chooser,sessionScope=>h.api.resumeReforecastImport({...h.options,upload:h.upload,sessionScope}));
 const failure=assert.rejects(operation,/closed|workspace changed/);chooser.close();h.held.resolve(h.evidence.integrity);await failure;assert.equal(h.dialogs.length,0);assert.equal(h.writes,0);
});
test('successful review ownership handoff survives automatic chooser close and ordinary refresh',async()=>{
 const h=await harness(),chooser=new Element(),review=new Element();chooser.isConnected=true;chooser.showModal();review.isConnected=true;review.showModal();let scope;
 const returned=await h.scope.loadReforecastDialog(h.central,chooser,current=>{scope=current;return current.own(review);});assert.equal(returned,review);chooser.close();h.change('refresh');scope.check();assert.equal(review.open,true);h.change('scope');assert.equal(review.open,false);
});
