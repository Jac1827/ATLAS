const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const base = 'docs/portfolio-operations-dashboard/';
const core = fs.readFileSync(base+'workspace-core.js','utf8');
const extract = name => {
  const match = core.match(new RegExp('^(?:async )?function '+name+'\\([^\\n]*\\) \\{[\\s\\S]*?^\\}','m'));
  assert(match,name); return match[0];
};
const storage = new Map(), reads = [];
const localStorage = {getItem:key=>{reads.push(key);return storage.get(key)||null;},setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)};
const c = {configured:true,ATLAS_STATE_DB_NAME:'actor-a-scope-1',atlasWorkspaceAccess:{validated:true,epoch:1},getAtlasRenderContextKey:()=>c.ATLAS_STATE_DB_NAME,
  getAtlasCentralStatus:()=>({configured:c.configured}),localStorage,PROPERTIES:[],
  OPS_PROPERTY_CATALOG_KEY:'catalog',ATLAS_SHARED_MANUAL_FIELD_LOCKS_KEY:'locks',PERFORMANCE_PLATFORM_STORAGE_KEY:'people',MARKETING_PEOPLE_LINKS_STORAGE_KEY:'links',
  ATLAS_PORTFOLIO_SHARED_FIELD_MAP:{generalManagerName:'generalManagerName'},ATLAS_SHARED_MANUAL_FIELD_LOCK_WINDOW_MS:259200000,
  isRetiredAtlasPropertyName:()=>false,atlasNormalizeSharedText:x=>x.toLowerCase(),readAtlasSharedPropertyCatalogEntries:()=>[],
  atlasCleanManualFieldLockValue:(_,x)=>x,atlasLatestTimestamp:(a,b)=>b||a,dataImportNormalizeText:x=>x.toLowerCase(),dataImportCanonicalCommunityName:x=>x,normalizeCommunityStatus:x=>x,
  DASHBOARD_DAILY_BACKUP_INDEX_KEY:'backups',WEEKLY_SNAPSHOT_STORAGE_KEY:'weekly',ATLAS_STATE_DAILY_BACKUP_INDEX_KEY:'scoped_backups',ATLAS_STATE_WEEKLY_SNAPSHOT_KEY:'scoped_weekly',
  dailyBackupIndexCache:['old-actor'],weeklySnapshotCache:{secret:'old-actor'},atlasStateGetValue:async()=>null,
  markAtlasPersistenceError:()=>{},removeLegacyDailyBackupStorageKeys:()=>{throw Error('Must retain legacy keys');},removeLegacyWeeklySnapshotStorageKey:()=>{throw Error('Must retain legacy keys');},queueAtlasStateWrite:()=>{throw Error('Must not import legacy data');},
  LVR_TEMPLATE_STORAGE_KEY:'lvr',LVR_TEMPLATE_HREF:'leasing-velocity-report-template.html',window:{ATLAS_CENTRAL:{getAccessContextKey:()=>c.ATLAS_STATE_DB_NAME}},console,URLSearchParams,alert:()=>{}
};
vm.createContext(c);
for(const name of ['atlasOperationalLocalKey','persistOpsPropertyCatalog','readAtlasSharedManualFieldLocks','writeAtlasSharedManualFieldLocks','atlasSharedManualFieldLockKey','getAtlasSharedManualFieldLock','clearAtlasSharedManualFieldLock','applyAtlasSharedManualFieldLocks','loadPeoplePlatformStateForSharedData','loadMarketingPeopleLinksForBonus','dataImportCatalogCommunityNames','dataImportCatalogCommunityStatus','hydrateDailyBackupState','hydrateWeeklySnapshotState','persistAtlasLvrPayload','buildLvrTemplateHref'])vm.runInContext(extract(name),c);
c.atlasScopedLocalKey = key=>c.configured?`${c.ATLAS_STATE_DB_NAME}:${key}`:key;
const raw={catalog:{properties:[{name:'Other Actor Community',units:999,status:'inactive'}]},locks:{'fixture:generalManagerName':{value:'Other Actor Manager',updatedAt:new Date().toISOString()}},people:{employees:[{name:'Other Actor Employee'}]},links:{private:'Other Actor Link'},backups:['old-day'],weekly:{secret:'Other Actor Snapshot'},lvr:{secret:'Other Actor Report'}};
for(const [key,value] of Object.entries(raw))storage.set(key,JSON.stringify(value));
const before = new Map(storage);
(async()=>{
  assert.equal(c.loadPeoplePlatformStateForSharedData().employees.length,0);
  assert.match(c.loadPeoplePlatformStateForSharedData().unavailableReason,/authorized/);
  assert.equal(Object.keys(c.loadMarketingPeopleLinksForBonus()).length,0);
  assert.equal(c.dataImportCatalogCommunityNames().length,0);
  assert.equal(c.dataImportCatalogCommunityStatus('Other Actor Community'),'');
  assert.equal(c.applyAtlasSharedManualFieldLocks('Fixture',{generalManagerName:'Authorized Manager'},{}).generalManagerName,'Authorized Manager');
  await c.hydrateDailyBackupState();await c.hydrateWeeklySnapshotState();
  assert.equal(c.dailyBackupIndexCache.length,0);assert.equal(c.weeklySnapshotCache,null);
  c.PROPERTIES=[{name:'Authorized Community',units:0}];c.persistOpsPropertyCatalog();
  assert.equal(JSON.parse(storage.get('actor-a-scope-1:catalog')).properties[0].units,0);
  c.writeAtlasSharedManualFieldLocks({'fixture:generalManagerName':{value:'Own Draft',updatedAt:new Date().toISOString()}});
  assert.equal(c.applyAtlasSharedManualFieldLocks('Fixture',{generalManagerName:'Authorized Manager'},{}).generalManagerName,'Own Draft');
  assert(c.persistAtlasLvrPayload({data:{actual:0,budget:null}}));
  const handoff=JSON.parse(storage.get('actor-a-scope-1:lvr'));
  assert.equal(handoff.accessContext,'actor-a-scope-1');assert.equal(handoff.data.actual,0);assert.equal(handoff.data.budget,null);
  assert.match(c.buildLvrTemplateHref(),/actor-a-scope-1%3Alvr/);
  c.ATLAS_STATE_DB_NAME='actor-b-scope-2';
  assert.equal(c.dataImportCatalogCommunityNames().length,0);assert.equal(Object.keys(c.readAtlasSharedManualFieldLocks()).length,0);
  c.atlasWorkspaceAccess.validated=false;
  const count=storage.size;c.persistOpsPropertyCatalog();c.writeAtlasSharedManualFieldLocks({x:1});assert.equal(c.persistAtlasLvrPayload({data:{}}),false);assert.equal(storage.size,count);
  for(const [key,value] of before)assert.equal(storage.get(key),value,'Legacy bytes retained: '+key);
  assert(!reads.some(key=>before.has(key)),'Configured reads never touch unbound operational keys');
  c.configured=false;
  assert.equal(c.loadPeoplePlatformStateForSharedData().employees[0].name,'Other Actor Employee');
  assert.equal(c.loadMarketingPeopleLinksForBonus().private,'Other Actor Link');
  assert.equal(c.dataImportCatalogCommunityNames()[0],'Other Actor Community','Explicit offline mode retains legacy compatibility');

  const lvrHtml=fs.readFileSync(base+'leasing-velocity-report-template.html','utf8');
  const script=lvrHtml.match(/<script>([\s\S]*?)<\/script>/)[1];
  async function lvrFixture({key='scoped:lvr',actor='actor-b',payloadActor='actor-a',reject=false,changeDuringRead=false}={}){
    const elements=new Map(),listeners=new Map(),h={reads:0,printed:0,actor};
    const element=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',disabled:false,addEventListener(){}});return elements.get(id);};
    const w={addEventListener:(name,fn)=>listeners.set(name,fn),print:()=>h.printed++,ATLAS_CENTRAL:{getStatus:()=>({configured:true}),getAccessContextKey:()=>h.actor,getSession:()=>({user:{id:h.actor}}),refreshSession:async()=>{},fetchProfile:async()=>{if(reject)throw Error('Authorization unavailable');if(changeDuringRead){h.actor='actor-c';listeners.get('atlas-central-auth-change')?.();}return {status:'active',account_status:'active'};}}};
    const cx={window:w,location:new URL('https://fixture.invalid/report'+(key?'?atlasStorageKey='+encodeURIComponent(key):'')),URL,URLSearchParams,console,history:{replaceState(){}},setTimeout:()=>{},document:{getElementById:element,documentElement:{style:{setProperty(){}}}},localStorage:{getItem:()=>{h.reads++;return JSON.stringify({accessContext:payloadActor,data:h.data});}}};
    vm.createContext(cx);vm.runInContext(script,cx);h.data=JSON.parse(vm.runInContext('JSON.stringify(LVR_DATA_DEFAULT)',cx));
    for(let i=0;i<15;i++)await Promise.resolve();
    h.root=element('lvr-root');h.print=element('print-btn');h.events=listeners;return h;
  }
  for(const settings of [{},{reject:true},{changeDuringRead:true}]){const h=await lvrFixture(settings);assert.match(h.root.innerHTML,/unavailable/);assert.equal(h.print.disabled,true);}
  const own=await lvrFixture({actor:'actor-a'});assert(!own.root.innerHTML.includes('unavailable'));assert.equal(own.print.disabled,false);
  own.actor='actor-b';own.events.get('atlas-central-auth-change')();assert.match(own.root.innerHTML,/unavailable/);assert.equal(own.print.disabled,true);
  const blank=await lvrFixture({key:null});assert.equal(blank.reads,0,'Blank Template does not read the last report');

  const finance=fs.readFileSync(base+'financial-accountability.html','utf8');
  assert.match(finance,/<script type="application\/x-atlas-legacy" id="atlas-legacy-financial-source">/);
  const gate=fs.readFileSync(base+'features/legacy-finance-gate.js','utf8');
  const root={replaceChildren(){this.children=[];},append(...children){this.children.push(...children);},children:[]};let scripts=0,auth=0;
  const gateContext={window:{ATLAS_CENTRAL:{getStatus:()=>({configured:true}),refreshSession:async()=>{},getSession:()=>({user:{id:'actor-b'}}),fetchProfile:async()=>{auth++;}},addEventListener(){}},document:{getElementById:()=>root,createElement:tag=>({tag}),body:{append(){scripts++;}}}};
  vm.runInNewContext(gate,gateContext);for(let i=0;i<8;i++)await Promise.resolve();
  assert.equal(scripts,0);assert.equal(auth,1);assert.match(root.children[0].textContent,/no verified data/);
  assert.match(core,/dailyBackupIndexCache = \[\]; weeklySnapshotCache = null;/,'Workspace changes clear in-memory backup evidence');
  console.log('PASS operational cache scope: other-actor raw keys blocked and retained, scoped null/zero and locks, unavailable People, scoped LVR authorization/race/clear, inert legacy financial route.');
})().catch(error=>{console.error(error);process.exitCode=1;});
