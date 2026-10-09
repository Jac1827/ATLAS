import assert from 'node:assert/strict';
import test from 'node:test';
import {IDBFactory,IDBObjectStore} from 'fake-indexeddb';
import {createComparisonStore,createComparisonRecord,normalizeComparisonActuals,normalizeComparisonConcession,comparisonSourceFingerprint,COMPARISON_DB} from '../docs/portfolio-operations-dashboard/features/str-ltr-comparison-store.mjs';
const clone=structuredClone,id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),cid=id(1),actor=id(2),shared=id(3),revision=id(4);
function fixture(){
 let user=actor,access='access-1',version=1;
 const property={id:'DORO',name:'RISE Doro',atlasCommunityId:cid,units:[{id:'A1',code:'A1',planName:'One bedroom',marketRent:1875,avgSqft:700,units:40}]};
 const config={propertyId:'DORO',programmeId:'PROGRAM',name:'Doro 10',unitPicks:[{groupId:'A1',units:10}],unitRamp:{2026:[0,0,2,4,6,8,10,10,10,10,10,10]}};
 const programme={id:'PROGRAM',propertyId:'DORO',name:'Doro 10',config,applied:true};
 const lines=[{id:'rent',propertyId:'DORO',gl:'5120',name:'Rent',nature:'income',yearData:{2026:Array(12).fill(75000)}},{id:'str',propertyId:'DORO',strProgramId:'PROGRAM',gl:'5144',name:'STR income',nature:'income',yearData:{2026:Array(12).fill(20000)}}];
 const payload={sourcePropertyId:'DORO',sourceProgrammeId:'PROGRAM',name:'Doro 10',property:clone(property),programme:clone(programme),config:clone(config),lines:clone(lines.filter(row=>row.strProgramId)),years:[2026],sourceContext:{property:clone(property),lines:clone(lines),programmes:[clone(programme)]}};
 const state={properties:[property],lines,strPrograms:[programme],activeProperty:'DORO',actuals:{},actualsDetail:[],periods:{},scenarios:[]};
 const R={app:{state,year:()=>2026},YEARS:[2026]};
 const bundle={communityId:cid,periods:Array.from({length:12},(_,i)=>'2026-'+String(i+1).padStart(2,'0')),sourceVersion:'source-1',registry:{version:'registry-1',accounts:[{accountCode:'5144',name:'STR revenue',nature:'income'},{accountCode:'6100',name:'Payroll',nature:'expense'}]},baseline:{lines:[{period:'2026-01',accountCode:'6100',amount:2000}]},actuals:{cutoffPeriod:'2026-02',closeVersions:[{period:'2026-01',versionId:'close-1',approvedAt:'2026-02-15'}],lines:[{period:'2026-01',accountCode:'5144',amount:0},{period:'2026-01',accountCode:'6100',amount:null},{period:'2026-02',accountCode:'5144',amount:19000}]}};
 const calls=[];
 const record=()=>({verified:true,head:{community_id:cid,programme_id:shared,revision:version,revision_id:revision},revision:{community_id:cid,programme_id:shared,revision:version,revision_id:revision,content_hash:String(version).repeat(64),created_at:'2026-10-01',payload:clone(payload)}});
 const central={getSession:()=>({user:{id:user}}),getConfig:()=>({supabaseUrl:'https://test.invalid'}),getAccessContextKey:()=>access,readCommunitiesForAccess:async()=>[{community_id:cid,display_name:'RISE Doro'}],fetchJson:async(route,args)=>{calls.push({route,body:args?.body?JSON.parse(args.body):null});if(route.startsWith('/atlas_community_aliases'))return [];if(route==='/rpc/atlas_read_str_programme_drafts')return [record()];if(route==='/rpc/atlas_read_reforecast_source')return clone(bundle);throw Error('Unexpected RPC '+route);},propertySpecials:async(action,args)=>{assert.equal(action,'read');assert.equal(args.communityId,cid);return {communityId:cid,current:{status:'none'},offers:[]};}};
 const factory=new IDBFactory(),states=[];
 const store=createComparisonStore({R,central,indexedDB:factory,onState:(s)=>states.push(s)});
 return {R,central,store,states,factory,calls,payload,bundle,property,setActor:x=>user=x,setAccess:x=>access=x,nextVersion:()=>version++};
}

test('direct shared loader retains exact floor plans, LT Rent and ramp without touching budget or programme',async()=>{
 const f=fixture(),before=clone(f.R.app.state),programs=await f.store.listPrograms(f.property);assert.equal(programs.length,1);assert.equal(programs[0].kind,'shared');
 const input=await f.store.loadProgram(programs[0].id,f.property,{year:2026});
 assert.deepEqual(input.program.config.unitPicks,f.payload.config.unitPicks);assert.deepEqual(input.program.config.unitRamp,f.payload.config.unitRamp);assert.equal(input.property.units[0].marketRent,1875);assert.deepEqual(f.R.app.state,before);
 assert(f.calls.every(call=>!/(save|apply|publish)/.test(call.route)));assert.equal(input.source.actuals[0].amount,0);assert.equal(input.source.actuals[1].amount,null);assert.equal(input.source.actuals[0].status,'closed');assert.equal(input.source.actuals[2].status,'preliminary');assert(input.source.actuals.every(row=>row.programId===null&&row.scope==='property'));assert.equal(input.source.actualsMeta.latestMonth,'2026-02');assert.equal(input.source.actualsMeta.latestClosedMonth,'2026-01');assert.equal(input.source.budgetLines[0].monthly[1],null);
 await f.store.close();
});

test('distinct saved programmes sharing a builder ID load and reopen their exact saved record',async()=>{
 const f=fixture(),before=clone(f.R.app.state),reads=[],fetch=f.central.fetchJson;
 const records=['RISE STR 2026','RISE STR Re-Forecast 2026','Short-term rental programme'].map((name,index)=>{
  const payload=clone(f.payload),programmeId=id(30+index),revisionId=id(40+index),version=index===2?11:1;
  payload.name=name;payload.config.name=name;payload.config.adr=150+index*25;payload.config.unitPicks[0].units=6+index*2;
  payload.property.units[0].marketRent=1875+index*100;payload.lines[0].yearData[2026].fill(20000+index*1000);
  payload.programme.name=name;payload.programme.config=clone(payload.config);
  return {verified:true,head:{community_id:cid,programme_id:programmeId,revision:version,revision_id:revisionId},revision:{community_id:cid,programme_id:programmeId,revision:version,revision_id:revisionId,content_hash:String(index+1).repeat(64),created_at:'2026-10-01',payload}};
 });
 f.central.fetchJson=async(route,args)=>{if(route!=='/rpc/atlas_read_str_programme_drafts')return fetch(route,args);const body=JSON.parse(args.body);reads.push(body);return clone(records.filter(row=>!body.p_programme_id||row.head.programme_id===body.p_programme_id));};
 const listed=await f.store.listPrograms(f.property);assert.equal(listed.length,3);assert(listed.every(row=>row.id==='PROGRAM'));assert.equal(new Set(listed.map(row=>row.selectionKey)).size,3);
 assert.deepEqual((await f.store.listPrograms(f.property)).map(row=>row.selectionKey),listed.map(row=>row.selectionKey));
 await assert.rejects(()=>f.store.loadProgram('PROGRAM',f.property),/Select the exact saved programme/);
 for(const original of records){
  const descriptor=listed.find(row=>row.sharedId===original.head.programme_id),input=await f.store.loadProgram(descriptor.selectionKey,f.property);
  assert.equal(input.program.id,'PROGRAM');assert.equal(input.program.selectionKey,'shared:'+original.head.programme_id);assert.equal(input.program.name,original.revision.payload.name);assert.equal(input.program.version,original.revision.revision);assert.deepEqual(input.program.config,original.revision.payload.config);assert.equal(input.property.units[0].marketRent,original.revision.payload.property.units[0].marketRent);
  assert.equal(reads.at(-1).p_programme_id,original.head.programme_id);assert.equal(input.state.lines.filter(row=>row.strProgramId==='PROGRAM').length,1);assert.deepEqual(input.state.lines.find(row=>row.strProgramId==='PROGRAM'),original.revision.payload.lines[0]);
  assert.equal((await f.store.loadProgram(original.head.programme_id,f.property)).program.selectionKey,descriptor.selectionKey);
  const saved=await f.store.save(createComparisonRecord(input)),reopened=await f.store.read(saved.id);assert.equal(reopened.programmeId,'PROGRAM');assert.equal(reopened.inputs.program.sharedId,original.head.programme_id);assert.equal(reopened.inputs.program.selectionKey,descriptor.selectionKey);assert.equal((await f.store.checkSources(reopened)).changed,false);
 }
 assert.deepEqual(f.R.app.state,before);assert(f.calls.every(call=>!/(save|apply|publish)/.test(call.route)));await f.store.close();
});

test('legacy retained comparisons keep their fingerprint and refresh the exact shared identity',async()=>{
 const f=fixture(),input=await f.store.loadProgram('PROGRAM',f.property),legacy=clone(input);delete legacy.program.selectionKey;
 assert.equal(comparisonSourceFingerprint(legacy),input.sourceFingerprint);
 const saved=await f.store.save(createComparisonRecord(legacy));assert.equal((await f.store.read(saved.id)).inputs.program.selectionKey,undefined);
 const checked=await f.store.checkSources(saved);assert.equal(checked.changed,false);assert.equal(checked.inputs.program.selectionKey,'shared:'+shared);
 f.nextVersion();const changed=await f.store.checkSources(saved);assert.equal(changed.changed,true);assert.equal(changed.inputs.program.selectionKey,checked.inputs.program.selectionKey);assert.equal(changed.inputs.program.version,2);await f.store.close();
});

test('browser programme selection has a stable property-scoped identity',async()=>{
 const f=fixture(),store=createComparisonStore({R:f.R,central:null,indexedDB:f.factory}),listed=await store.listPrograms(f.property);
 assert.equal(listed[0].id,'PROGRAM');assert.equal(listed[0].selectionKey,'browser:DORO:PROGRAM');assert.equal(listed[0].sharedId,null);
 const input=await store.loadProgram(listed[0].selectionKey,f.property);assert.equal(input.program.selectionKey,listed[0].selectionKey);assert.equal(input.program.id,'PROGRAM');assert.deepEqual(input.program.config,f.payload.config);await store.close();await f.store.close();
});

test('named scenarios save, verify, reopen and duplicate without changing originals',async()=>{
 const f=fixture(),input=await f.store.loadProgram('PROGRAM',f.property),record=createComparisonRecord(input,{name:'Investor case'});record.scenario.rentOverrides.A1=1950;
 const saved=await f.store.save(record);assert.equal(saved.revision,1);assert.equal(saved.persistence,'browser');assert.deepEqual(f.states,['saving','saved']);
 const reopened=await f.store.read(saved.id);assert.equal(reopened.scenario.rentOverrides.A1,1950);assert.equal(reopened.inputs.property.units[0].marketRent,1875);
 reopened.scenario.rentOverrides.A1=1900;const updated=await f.store.save(reopened);assert.equal(updated.revision,2);
 const copy=await f.store.duplicate(updated,'Lower occupancy');assert.notEqual(copy.id,updated.id);assert.equal(copy.revision,1);assert.equal((await f.store.read(updated.id)).name,'Investor case');assert.equal((await f.store.listScenarios(f.property)).length,2);assert.deepEqual(await f.store.listRecovery(f.property),[]);
 const store2=createComparisonStore({R:f.R,central:f.central,indexedDB:f.factory});assert.equal((await store2.read(saved.id)).revision,2);await store2.close();await f.store.close();
});

test('stale tabs preserve their edit for recovery and never overwrite a newer revision',async()=>{
 const f=fixture(),input=await f.store.loadProgram('PROGRAM',f.property),saved=await f.store.save(createComparisonRecord(input));const stale=clone(saved);saved.name='Newer saved';const next=await f.store.save(saved);
 stale.name='Recovered tab change';await assert.rejects(()=>f.store.save(stale),/another tab/);assert.equal((await f.store.read(next.id)).name,'Newer saved');const recovered=await f.store.listRecovery(f.property);assert.equal(recovered[0].record.name,'Recovered tab change');assert.equal(f.states.at(-1),'failed');
 const duplicate=await f.store.duplicate(recovered[0].record);assert.equal(duplicate.name,'Recovered tab change — copy');await f.store.close();
});

test('explicit source check does not mutate saved data; refresh returns separately editable source snapshot',async()=>{
 const f=fixture(),input=await f.store.loadProgram('PROGRAM',f.property),saved=await f.store.save(createComparisonRecord(input));const before=clone(saved);assert.equal((await f.store.checkSources(saved)).changed,false);
 f.nextVersion();f.payload.property.units[0].marketRent=2100;f.bundle.sourceVersion='source-2';const checked=await f.store.checkSources(saved);assert.equal(checked.changed,true);assert.deepEqual(saved,before);assert.equal((await f.store.read(saved.id)).inputs.property.units[0].marketRent,1875);
 const refreshed=await f.store.refreshSources(saved);assert.equal(refreshed.inputs.property.units[0].marketRent,2100);assert.equal(refreshed.id,saved.id);assert.equal(refreshed.revision,saved.revision);assert.equal((await f.store.read(saved.id)).inputs.property.units[0].marketRent,1875);await f.store.save(refreshed);assert.equal((await f.store.read(saved.id)).inputs.program.version,2);await f.store.close();
});

test('cross-account scope and changed access cannot expose a saved comparison',async()=>{
 const f=fixture(),saved=await f.store.save(createComparisonRecord(await f.store.loadProgram('PROGRAM',f.property)));f.setActor(id(90));await assert.rejects(()=>f.store.read(saved.id),/account/);
 const different=createComparisonStore({R:f.R,central:f.central,indexedDB:f.factory});assert.equal(await different.read(saved.id),null);assert.deepEqual(await different.listScenarios(f.property),[]);await different.close();f.setActor(actor);f.setAccess('access-2');await assert.rejects(()=>f.store.listScenarios(f.property),/access changed/);await f.store.close();
});

test('quota failure remains failure and retains a recoverable exact edit',async()=>{
 const f=fixture(),record=createComparisonRecord(await f.store.loadProgram('PROGRAM',f.property));const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='comparisons')throw new DOMException('Synthetic quota failure','QuotaExceededError');return original.apply(this,args);};
 try{await assert.rejects(()=>f.store.save(record),/quota/);assert.equal(f.states.at(-1),'failed');assert.equal((await f.store.listRecovery(f.property))[0].record.id,record.id);assert.equal(await f.store.read(record.id),null);}finally{IDBObjectStore.prototype.put=original;await f.store.close();}
});

test('missing browser future actuals are not zero and ungoverned markers are preliminary',()=>{
 const state={actuals:{x:{propertyId:'P',year:2026,gl:'5144',monthly:[100,0,...Array(10).fill(0)]}},periods:{'P|2026':{closedThrough:2}},lines:[{propertyId:'P',gl:'5144',nature:'income'}]};const rows=normalizeComparisonActuals(null,{state,property:{id:'P'},year:2026});assert.equal(rows.length,2);assert.equal(rows[1].amount,0);assert(rows.every(row=>row.status==='preliminary'));state.periods={};assert.deepEqual(normalizeComparisonActuals(null,{state,property:{id:'P'},year:2026}),[]);
});

test('website concessions retain source/date, avoid ambiguous eligibility and require lease terms',()=>{
 const offer={id:'A',source:'website',text:'Two months free on a 12 month lease',observedStart:'2026-09-01',lastVerifiedAt:'2026-09-30'};const data={current:{offerId:'A',status:'found'},offers:[offer]};const value=normalizeComparisonConcession(data,{year:2026});assert.equal(value.type,'months');assert.equal(value.value,2);assert.equal(value.leaseTermMonths,12);assert.equal(value.reviewedAt,'2026-09-30');assert.equal(value.startMonth,9);assert.equal(value.timing,'upfront');
 assert.equal(normalizeComparisonConcession({...data,current:{...data.current,status:'conflict'}}).available,false);assert.equal(normalizeComparisonConcession({...data,offers:[{...offer,restrictions:'Select units only'}]}).available,false);assert.equal(normalizeComparisonConcession({...data,offers:[{...offer,text:'Two months free'}]}).available,false);assert.equal(normalizeComparisonConcession({current:{status:'none'}}).value,0);assert.equal(normalizeComparisonConcession({}).available,false);
});

test('source tampering and invalid adjustments cannot be labeled saved',async()=>{
 const f=fixture(),record=createComparisonRecord(await f.store.loadProgram('PROGRAM',f.property));record.inputs.property.units[0].marketRent=1;await assert.rejects(()=>f.store.save(record),/snapshot changed/);record.inputs.sourceFingerprint=comparisonSourceFingerprint(record.inputs);record.scenario.occupancy={mode:'custom',str:1.1,ltr:.9};await assert.rejects(()=>f.store.save(record),/occupancy/);assert.equal((await f.store.listScenarios(f.property)).length,0);await f.store.close();
});

test('autosave freezes each queued edit and advances revisions without replacing later input',async()=>{
 const oldDocument=globalThis.document;globalThis.document={querySelectorAll:()=>[],getElementById:()=>null,addEventListener:()=>{},createElement:()=>({}),head:{append:()=>{}}};
 try{
  const {installStrLtrComparison}=await import('../docs/portfolio-operations-dashboard/features/str-ltr-comparison-ui.mjs');
  let release,started;const began=new Promise(r=>started=r),pause=new Promise(r=>release=r),writes=[];const store={save:async record=>{writes.push(clone(record));if(writes.length===1){started();await pause;}return {...record,revision:record.revision+1,updatedAt:'2026-10-09T12:00:00Z'};},listScenarios:async()=>[]};
  const R={app:{state:{properties:[{id:'P'}],activeProperty:'P'},prop:()=>({id:'P'}),VIEWS:[],view:'other'},views:{}};const controller=installStrLtrComparison(R,{store,calculate:()=>({})});controller.ui.record={id:'C',name:'First edit',revision:0,scenario:{},inputs:{}};controller.ui.propertyId='P';controller.ui.editGeneration=1;
  const first=controller.saveCurrent();await began;controller.ui.record.name='Second edit';controller.ui.editGeneration=2;const second=controller.saveCurrent();release();await first;assert.equal(controller.ui.record.name,'Second edit');await second;
  assert.deepEqual(writes.map(row=>[row.name,row.revision]),[['First edit',0],['Second edit',1]]);assert.equal(controller.ui.record.revision,2);assert.equal(controller.ui.record.name,'Second edit');assert.equal(controller.ui.saveState,'saved');
 }finally{globalThis.document=oldDocument;}
});

test('source checks exclude read time and selected year already included in retained coverage',async()=>{
 const f=fixture();f.payload.years=[2026,2027];const inputs=await f.store.loadProgram('PROGRAM',f.property,{year:2026}),record=createComparisonRecord(inputs);assert.deepEqual(inputs.source.years,[2026,2027]);assert.equal(f.calls.find(c=>c.route==='/rpc/atlas_read_reforecast_source').body.p_periods.length,24);record.scenario.year=2027;
 const check=await f.store.checkSources(record);assert.equal(check.changed,false);assert.equal(check.inputs.source.year,2027);assert.equal(check.inputs.sourceFingerprint,inputs.sourceFingerprint);await f.store.close();
});

test('approved source in one year does not suppress retained property budgets in another year',async()=>{
 const f=fixture();f.payload.sourceContext.lines.push({id:'gas',propertyId:'DORO',gl:'6464',name:'Natural Gas',nature:'expense',method:'imported',behavior:'variable_occupancy',yearData:{2026:Array(12).fill(0),2027:Array(12).fill(0)}},{id:'payroll',propertyId:'DORO',gl:'6100',name:'Payroll',nature:'expense',method:'imported',yearData:{2026:Array(12).fill(1800),2027:Array(12).fill(2200)}});
 f.R.engine={computeProperty:(state,propertyId,scenarioId,year)=>({results:Object.fromEntries(state.lines.map(line=>[line.id,{line,monthly:line.yearData?.[year]||Array(12).fill(0),audit:{}}]))})};
 const input=await f.store.loadProgram('PROGRAM',f.property);assert.deepEqual(input.source.years,[2026,2027]);assert.equal(f.calls.find(c=>c.route==='/rpc/atlas_read_reforecast_source').body.p_periods.length,24);
 const approved=input.source.budgetLines.find(row=>row.year===2026&&row.gl==='6100'),retained=input.source.budgetLines.find(row=>row.year===2027&&row.gl==='6100'),gas=input.source.budgetLines.find(row=>row.year===2027&&row.gl==='6464');assert.equal(approved.monthly[0],2000);assert.equal(approved.monthly[1],null);assert.match(approved.source,/approved/);assert.deepEqual(retained.monthly,Array(12).fill(2200));assert.match(retained.source,/retained/i);assert.deepEqual(gas.monthly,Array(12).fill(0));assert.equal(gas.behavior,'variable_occupancy');
 const record=createComparisonRecord(input);record.scenario.year=2027;assert.equal((await f.store.checkSources(record)).changed,false);await f.store.close();
});

test('missing imported years and failed drivers cannot become budget engine zero defaults',async()=>{
 const f=fixture();f.payload.sourceContext.lines.push({id:'payroll',propertyId:'DORO',gl:'6100',name:'Payroll',nature:'expense',method:'imported',yearData:{2026:Array(12).fill(1800)}},{id:'contract',propertyId:'DORO',gl:'6200',name:'Contract',nature:'expense',method:'contract'});
 f.R.engine={computeProperty:(state)=>({results:Object.fromEntries(state.lines.map(line=>[line.id,{line,monthly:Array(12).fill(0),audit:line.method==='contract'?{error:'Contract source is missing'}:{}}]))})};
 const input=await f.store.loadProgram('PROGRAM',f.property,{year:2027}),rows=input.source.budgetLines.filter(row=>row.year===2027);
 assert.deepEqual(rows.find(row=>row.gl==='6100').monthly,Array(12).fill(null));assert.match(rows.find(row=>row.gl==='6100').source,/no imported values for 2027/);assert.deepEqual(rows.find(row=>row.gl==='6200').monthly,Array(12).fill(null));assert.equal(rows.find(row=>row.gl==='6200').sourceError,'Contract source is missing');assert.equal(input.source.budgetLines.find(row=>row.gl==='6100'&&row.year===2026).monthly[0],2000);await f.store.close();
});

test('approved budget normalization preserves existing typed account and blank-source evidence',async()=>{
 const f=fixture();f.payload.sourceContext.lines.push({id:'known',propertyId:'DORO',gl:'6279',name:'Retained payroll account',nature:'expense',yearData:{2026:Array(12).fill(0)}});
 f.bundle.baseline.lines.push({period:'2026-01',accountCode:'6279',amount:null,disposition:'workbook_blank',legitimateBlank:true,source:{kind:'approved_workbook',sourceLineId:'Budget!C20'}});
 const input=await f.store.loadProgram('PROGRAM',f.property),row=input.source.budgetLines.find(row=>row.gl==='6279');assert.equal(row.nature,'expense');assert.equal(row.name,'Retained payroll account');assert.equal(row.monthly[0],null);assert.equal(row.sourceReferences[0].disposition,'workbook_blank');assert.equal(row.sourceReferences[0].legitimateBlank,true);assert.equal(row.sourceReferences[0].source.sourceLineId,'Budget!C20');await f.store.close();
});

test('comparison retains saved libraries rather than newer global assumptions',async()=>{
 const f=fixture();f.R.ASSUMPTIONS={global:{bad_debt_pct:{value:.09}}};f.R.CURVES={flat:{v:Array(12).fill(1)}};f.R.UTILITY_PROVIDERS=[];f.R.COA=[{gl:'5144',name:'STR income',nature:'income'}];f.payload.sourceContext.libraries={assumptions:{global:{bad_debt_pct:{value:.02}}},curves:{flat:{v:Array(12).fill(1)}},utilityProviders:[],utilityBenchmarks:{}};
 const original=f.R.ASSUMPTIONS,inputs=await f.store.loadProgram('PROGRAM',f.property);assert.equal(inputs.source.libraries.assumptions.global.bad_debt_pct.value,.02);assert.equal(f.R.ASSUMPTIONS,original);f.R.ASSUMPTIONS.global.bad_debt_pct.value=.15;assert.equal(inputs.source.libraries.assumptions.global.bad_debt_pct.value,.02);assert.equal((await f.store.checkSources(createComparisonRecord(inputs))).changed,false);await f.store.close();
});

test('percentage concessions use decimal fractions and expired offers cannot seed a later year',()=>{
 const offer={id:'O',source:'manual',text:'10% off a 12 month lease',start:'2026-01-01',end:'2026-12-31'},data={current:{status:'manual',offerId:'O'},offers:[offer]};assert.equal(normalizeComparisonConcession(data,{year:2026}).value,.1);assert.equal(normalizeComparisonConcession(data,{year:2027}).available,false);
});

test('recovery opens an exact pending edit as a verified new comparison and preserves the existing saved record',async()=>{
 const {createComparisonRecovery}=await import('../docs/portfolio-operations-dashboard/features/str-ltr-comparison-recovery.mjs');const f=fixture(),saved=await f.store.save(createComparisonRecord(await f.store.loadProgram('PROGRAM',f.property)));let current=clone(saved);const newer=clone(saved);newer.name='Committed newer edit';await f.store.save(newer);current.name='My pending edit';await assert.rejects(()=>f.store.save(current),/another tab/);
 const before=clone(f.R.app.state),recovery=createComparisonRecovery({store:f.store,getProperty:()=>f.property,getRecord:()=>current,openRecord:async row=>{current=row;},flush:async()=>{throw Error('Identical pending edit does not need to overwrite its stale identity');}}),pending=(await recovery.list())[0];
 const file=recovery.backup();assert.equal(JSON.parse(file.bytes).record.name,'My pending edit');const restored=await recovery.restore(pending.record.id,pending.recoveryVersion);assert.notEqual(restored.id,saved.id);assert.equal(current.name,'My pending edit — recovered');assert.equal(current.revision,1);assert.equal((await f.store.read(saved.id)).name,'Committed newer edit');assert.deepEqual(await recovery.list(),[]);assert.deepEqual(f.R.app.state,before);await f.store.close();
});

test('recovery completion cannot delete a newer pending version and rejects a changed property',async()=>{
 const {createComparisonRecovery}=await import('../docs/portfolio-operations-dashboard/features/str-ltr-comparison-recovery.mjs');const f=fixture(),record=createComparisonRecord(await f.store.loadProgram('PROGRAM',f.property)),saved=await f.store.save(record);record.name='Stale edit';await assert.rejects(()=>f.store.save(record),/another tab/);const old=(await f.store.listRecovery(f.property))[0],copy=await f.store.duplicate(old.record);record.name='New pending edit';await assert.rejects(()=>f.store.save(record),/another tab/);assert.equal(await f.store.completeRecovery({id:old.record.id,recoveryVersion:old.recoveryVersion,replacement:copy}),false);assert.equal((await f.store.listRecovery(f.property))[0].record.name,'New pending edit');
 let property=f.property;const recovery=createComparisonRecovery({store:f.store,getProperty:()=>property,getRecord:()=>record,openRecord:async()=>{}});property={id:'OTHER'};assert.throws(()=>recovery.backup(),/selected property/);assert.deepEqual(await recovery.list(),[]);await assert.rejects(()=>recovery.restore(old.record.id,old.recoveryVersion),/changed/);await f.store.close();
});

test('duplicated retained results carry the new comparison identity and leave source results intact',async()=>{
 const f=fixture(),record=createComparisonRecord(await f.store.loadProgram('PROGRAM',f.property));record.snapshot={engineVersion:'1.0.0',name:record.name,scenario:{...record.scenario,id:record.id,name:record.name,revision:1},metadata:{scenarioName:record.name,comparisonId:record.id,comparisonRevision:1},totals:{str:{noi:123}}};const saved=await f.store.save(record),copy=await f.store.duplicate(saved,'Duplicated investor scenario');
 assert.equal(copy.snapshot.name,copy.name);assert.equal(copy.snapshot.scenario.id,copy.id);assert.equal(copy.snapshot.scenario.name,copy.name);assert.equal(copy.snapshot.scenario.revision,1);assert.equal(copy.snapshot.metadata.comparisonId,copy.id);assert.equal(copy.snapshot.metadata.name,copy.name);assert.equal(copy.snapshot.metadata.comparisonRevision,1);assert.equal(copy.snapshot.metadata.scenarioName,copy.name);assert.equal(copy.snapshot.totals.str.noi,123);assert.deepEqual((await f.store.read(saved.id)).snapshot,saved.snapshot);await f.store.close();
});
