/* Independent transport and source-retention checks; no production connection. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {IDBFactory} from 'fake-indexeddb';
import {buildStrProgrammeReport,captureStrProgramme,saveStrProgramme,readStrProgrammes,strProgrammeSourceFile,strProgrammeReport,applyRetainedStrProgramme,installSavedStrProgrammes} from '../docs/portfolio-operations-dashboard/features/saved-str-programmes.mjs';

const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),cid=id(1),pid=id(2),rid=id(3),actor=id(4),revisionId=id(5);
const config={propertyId:'source-property',programmeId:'source-programme',name:'Retained STR',adr:null,occupancy:0},property={id:'source-property',name:'Community',units:[]},line={id:'source-line',propertyId:'source-property',strProgramId:'source-programme',gl:'5144',name:'Revenue',nature:'income',yearData:{2026:[null,0,...Array(10).fill(1.123456)]}};
function payload(){const lines=[structuredClone(line)],reportSnapshot=buildStrProgrammeReport({name:'Retained STR',communityName:'Community',years:[2026],lines,config});return {schemaVersion:'atlas.str-programme-draft.v1',name:'Retained STR',sourcePropertyId:property.id,sourceProgrammeId:config.programmeId,config:structuredClone(config),reportBasisConfig:structuredClone(config),property:structuredClone(property),groups:[],programme:{id:config.programmeId,propertyId:property.id,config:structuredClone(config),applied:true},lines,years:[2026],reportSnapshot,sourceContext:{property:structuredClone(property),lines:[structuredClone(line)],libraries:{retained:true}},targetBudget:null,reason:'Retain exact source'};}
function record(p=payload()){const head={programme_id:pid,community_id:cid,revision_id:revisionId,revision:1,status:'working_draft'};return {head,revision:{...head,request_id:rid,request_hash:'b'.repeat(64),content_hash:'a'.repeat(64),payload:structuredClone(p),actor_id:actor,actor_role:'regional',created_at:'2026-09-25T00:00:00Z',target_budget:null},currentHead:{...head},verified:true};}
function api(handler){let current=actor;const calls=[];const central={getSession:()=>({user:{id:current}}),refreshSession:async()=>{},fetchJson:async(route,options)=>{const body=JSON.parse(options.body);calls.push({route,body});return handler(route,body,{central,setActor:value=>current=value});}};return {central,calls,setActor:value=>current=value};}
const options=p=>({communityId:cid,programmeId:pid,expectedRevision:0,requestId:rid,payload:p});

test('STR save is receipt-first and replay of a committed request never writes again',async()=>{
 const p=payload(),saved=record(p);let committed=false,writes=0;const {central,calls}=api(async route=>{if(route.endsWith('receipt'))return committed?saved:null;if(route.endsWith('atlas_save_str_programme_draft')){writes++;committed=true;return saved;}throw Error(route);});
 assert.deepEqual(await saveStrProgramme(central,options(p)),saved);assert(calls[0].route.endsWith('receipt'),'Read the exact request receipt before issuing a write');assert.deepEqual(await saveStrProgramme(central,options(p)),saved);assert.equal(writes,1);
});
test('STR lost response reads the exact committed receipt; stale versions never invent a new request',async()=>{
 const p=payload(),saved=record(p);let committed=false,writes=0;const {central}=api(async route=>{if(route.endsWith('receipt'))return committed?saved:null;writes++;committed=true;throw Error('Synthetic lost response after commit');});assert.deepEqual(await saveStrProgramme(central,options(p)),saved);assert.equal(writes,1);
 const stale=api(async route=>{if(route.endsWith('receipt'))return null;throw Error('STR programme changed in another session; reload before saving');});await assert.rejects(()=>saveStrProgramme(stale.central,options(p)),/another session/);assert.equal(stale.calls.filter(c=>c.route.endsWith('atlas_save_str_programme_draft')).length,1);assert(stale.calls.every(c=>c.body.p_request_id===rid));
});
test('STR save rejects same-payload receipts with wrong request, actor, community, version, hash or verification',async()=>{
 const p=payload();for(const mutate of [r=>r.revision.request_id=id(31),r=>r.revision.actor_id=id(32),r=>r.head.community_id=id(33),r=>r.revision.community_id=id(33),r=>r.revision.programme_id=id(34),r=>r.revision.revision=2,r=>r.head.revision_id=id(35),r=>r.revision.content_hash='',r=>r.verified=false,r=>r.currentHead.community_id=id(36)]){const bad=record(p);mutate(bad);const {central}=api(async()=>bad);await assert.rejects(()=>saveStrProgramme(central,options(p)),/receipt|readback|verified|identity|scope|saved|request|match/i);}
});
test('STR read rejects a wrong historical revision and inconsistent record identity',async()=>{
 for(const mutate of [r=>r.revision.revision_id=id(41),r=>r.head.community_id=id(42),r=>r.revision.community_id=id(42),r=>r.revision.programme_id=id(43),r=>r.verified=false]){const bad=record();mutate(bad);const {central}=api(async()=>[bad]);await assert.rejects(()=>readStrProgrammes(central,[cid],pid,revisionId),/scope|verified|identity|revision|match/i);}
});
test('STR transport rejects an account change before write and during readback',async()=>{
 const p=payload(),saved=record(p),pre=api(async route=>route.endsWith('receipt')?null:saved);pre.central.refreshSession=async()=>pre.setActor(id(50));await assert.rejects(()=>saveStrProgramme(pre.central,options(p)),/account changed/);assert.equal(pre.calls.filter(c=>c.route.endsWith('atlas_save_str_programme_draft')).length,0);
 const read=api(async(_route,_body,ctx)=>{ctx.setActor(id(51));return [saved];});await assert.rejects(()=>readStrProgrammes(read.central,[cid]),/account changed/);
 const late=api(async(route,_body,ctx)=>{if(route.endsWith('receipt'))return null;ctx.setActor(id(52));return saved;});await assert.rejects(()=>saveStrProgramme(late.central,options(p)),/account changed/);
});
test('STR report retains null, zero, exact source decimals and configuration in the source backup',()=>{
 const r=record(),report=strProgrammeReport(r);assert.equal(report.rows[0].amount,null);assert.equal(report.rows[1].amount,0);assert.equal(report.rows[2].amount,1.123456);assert.equal(report.totals.revenue,null);assert.equal(report.totals.netCashFlow,null);const backup=strProgrammeSourceFile(r);assert.deepEqual(backup.state.lines,r.revision.payload.lines);assert.deepEqual(backup.ui.strCfg,r.revision.payload.config);assert.equal(backup.state.properties.length,1);
});
test('Recovering retained STR lines never recalculates or mutates the browser model',()=>{
 const p=payload(),state={properties:[structuredClone(property)],strPrograms:[structuredClone(p.programme)],lines:structuredClone(p.lines)},before=structuredClone(state);let calculations=0;const R={YEARS:[2026],app:{state,strCfg:structuredClone(config),year:()=>2026},persist:{serialize:()=>({libraries:{saved:true}})},strBuilder:{apply:()=>{calculations++;throw Error('No implicit calculation');}}};
 const result=captureStrProgramme(R,{communityId:cid,communityName:'Community'});assert.equal(calculations,0);assert.deepEqual(result.lines,p.lines);assert.deepEqual(state,before);assert.equal(result.reportSnapshot.rows[0].amount,null);assert.equal(result.reportSnapshot.rows[1].amount,0);
 const partial={...R,app:{...R.app,state:structuredClone(state)}};delete partial.app.state.lines[0].yearData[2026];const unfinished=captureStrProgramme(partial,{communityId:cid,communityName:'Community'});assert.equal(unfinished.reportSnapshot,null,'Incomplete source months remain recoverable without a fabricated completed report');assert(unfinished.reportUnavailableReason);assert.equal(calculations,0);assert.deepEqual(unfinished.lines,partial.app.state.lines);
});

test('Applying a retained programme uses exact saved lines and refuses locks, stale sources or uncalculated driver changes',()=>{
 const p=payload(),make=()=>({app:{state:{properties:[structuredClone(property),{id:'other-property'}],lines:[structuredClone(line),{id:'unrelated',propertyId:'other-property'}],strPrograms:[structuredClone(p.programme)],activeProperty:property.id,activeScenario:'SC-WORK'},isLocked:()=>false,invalidate:()=>{}},persist:{snapshotUndo:()=>{}}});
 const R=make();applyRetainedStrProgramme(R,p);assert.deepEqual(R.app.state.lines.filter(row=>row.propertyId===property.id),p.lines);assert.deepEqual(R.app.state.properties[1],{id:'other-property'});assert.deepEqual(R.app.state.lines.find(row=>row.id==='unrelated'),{id:'unrelated',propertyId:'other-property'});
 for(const change of [(r,p)=>r.app.isLocked=()=>true,(r,p)=>r.app.state.lines[0].yearData[2026][1]=999,(r,p)=>p.configurationChangedSinceApplied=true,(r,p)=>p.reportSnapshot=null]){const r=make(),copy=structuredClone(p);change(r,copy);const before=structuredClone(r.app.state);assert.throws(()=>applyRetainedStrProgramme(r,copy),/editable|changed|recalculate/i);assert.deepEqual(r.app.state,before,'A rejected apply must not change any browser financial data');}
});

test('Save-and-apply waits for verified persistence and cancels apply after a scenario switch',async()=>{
 const oldDb=globalThis.indexedDB,oldLocation=globalThis.location;
 try{
  globalThis.location={hash:''};
  for(const mode of ['fail','switch','success']){
   globalThis.indexedDB=new IDBFactory();const p=payload();let committed=null,undos=0;
   const A={state:{properties:[structuredClone(property)],lines:[structuredClone(line)],strPrograms:[structuredClone(p.programme)],activeProperty:property.id,activeScenario:'SC-WORK'},strCfg:structuredClone(config),VIEWS:[],view:'strbuild',year:()=>2026,scenario:()=>({id:A.state.activeScenario}),isLocked:()=>false,touch:()=>{},render:()=>{},invalidate:()=>{},go:view=>A.view=view,toast:()=>{}};
   const R={YEARS:[2026],app:A,views:{strbuild:()=>''},persist:{serialize:()=>({libraries:{}}),snapshotUndo:()=>undos++},strBuilder:{apply:()=>{throw Error('Retained apply must not recalculate');}}};
   const before=structuredClone(A.state),{central}=api(async(route,body)=>{if(route.endsWith('receipt'))return committed;assert.deepEqual(A.state,before,'No financial mutation before the server commits');if(mode==='fail')throw Error('Synthetic server save rejected');committed=record(body.p_payload);committed.revision.request_id=body.p_request_id;if(mode==='switch')A.state.activeScenario='SC-OTHER';return committed;});
   const installed=installSavedStrProgrammes(R,{central}),operation=()=>installed.persistCurrent({communityId:cid,communityName:'Community',name:config.name,programmeId:pid,expectedRevision:0,reason:'Retain and apply exact saved programme',apply:true});
   if(mode==='success'){await operation();assert.equal(undos,1);assert.deepEqual(A.state.lines,committed.revision.payload.lines);}
   else{await assert.rejects(operation,/rejected|selection changed|scenario/i);assert.equal(undos,0);assert.deepEqual(A.state.lines,before.lines);assert.deepEqual(A.state.properties,before.properties);}
  }
 }finally{globalThis.indexedDB=oldDb;globalThis.location=oldLocation;}
});

test('Open applied browser budget resolves the recorded scenario and year rather than the current unrelated view',async()=>{
 const oldLocation=globalThis.location;try{globalThis.location={hash:''};for(const missing of [false,true]){
  const p=payload();p.browserTarget={propertyId:property.id,programmeId:config.programmeId,scenarioId:'SC-WORK',scenarioName:'Working Draft',year:2026};const saved=record(p),state={properties:[structuredClone(property)],lines:structuredClone(p.lines),strPrograms:[structuredClone(p.programme)],scenarios:missing?[{id:'SC-OTHER'}]:[{id:'SC-WORK'},{id:'SC-OTHER'}],activeProperty:property.id,activeScenario:'SC-OTHER',budgetYear:2027};
  const A={state,strCfg:structuredClone(config),VIEWS:[],view:'savedstr',year:()=>state.budgetYear,scenario:()=>state.scenarios.find(s=>s.id===state.activeScenario),render:()=>{},touch:()=>{},go:view=>A.view=view,toast:()=>{},setScenario:value=>state.activeScenario=value,setYear:value=>state.budgetYear=value};
  const R={YEARS:[2026,2027],app:A,views:{strbuild:()=>''},persist:{}},{central}=api(async()=>[saved]),installed=installSavedStrProgrammes(R,{central});
  if(missing){await assert.rejects(()=>installed.openTarget(saved),/scenario|target|unavailable|missing/i);assert.equal(state.activeScenario,'SC-OTHER');}
  else{await installed.openTarget(saved);assert.equal(state.activeScenario,'SC-WORK');assert.equal(state.budgetYear,2026);assert.equal(A.view,'workspace');assert.deepEqual(state.lines,p.lines);}
 }}finally{globalThis.location=oldLocation;}
});

test('A driver edit made during an in-flight save is preserved and autosaved in the next revision',async()=>{
 const oldDb=globalThis.indexedDB,oldLocation=globalThis.location;let timeout;
 try{globalThis.indexedDB=new IDBFactory();globalThis.location={hash:''};
  const p=payload(),receipts=new Map(),writes=[];let release,start,finish;
  const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>start=resolve),finished=new Promise(resolve=>finish=resolve);
  const A={state:{properties:[structuredClone(property)],lines:[structuredClone(line)],strPrograms:[structuredClone(p.programme)],activeProperty:property.id,activeScenario:'SC-WORK'},strCfg:structuredClone(config),VIEWS:[],view:'strbuild',year:()=>2026,scenario:()=>({id:A.state.activeScenario}),isLocked:()=>false,touch:()=>{},render:()=>{},invalidate:()=>{},go:view=>A.view=view,toast:()=>{}};
  const R={YEARS:[2026],app:A,views:{strbuild:()=>''},persist:{serialize:()=>({libraries:{}})},strBuilder:{apply:()=>{throw Error('Autosave must preserve retained lines');}}};
  const {central}=api(async(route,body)=>{if(route.endsWith('receipt'))return receipts.get(body.p_request_id)||null;const saved=record(body.p_payload),version=body.p_expected_revision+1;for(const obj of [saved.head,saved.revision,saved.currentHead])Object.assign(obj,{revision:version,revision_id:id(100+version)});saved.revision.request_id=body.p_request_id;receipts.set(body.p_request_id,saved);writes.push(structuredClone(saved));if(writes.length===1){start();await gate;}else finish();return saved;});
  central.readCommunitiesForAccess=async()=>[{community_id:cid,display_name:'Community'}];const originalFetch=central.fetchJson;central.fetchJson=(route,...args)=>route.startsWith('/atlas_community_aliases')?Promise.resolve([]):originalFetch(route,...args);
  const installed=installSavedStrProgrammes(R,{central}),operation=installed.persistCurrent({communityId:cid,communityName:'Community',name:config.name,programmeId:pid,expectedRevision:0,reason:'Save initial reviewed programme'});await started;A.strCfg.adr=200;A.touch();release();await operation;
  assert.equal(A.strCfg.adr,200,'Readback must not replace a newer driver edit');assert.equal(writes[0].revision.payload.config.adr,null,'The first immutable revision retains exactly the submitted value');
  await Promise.race([finished,new Promise((_resolve,reject)=>timeout=setTimeout(()=>reject(Error('Newer driver edit was not automatically saved after the first write finished')),5000))]);
  assert.equal(writes.length,2);assert.equal(writes[1].revision.revision,2);assert.equal(writes[1].revision.payload.config.adr,200);assert.deepEqual(writes[1].revision.payload.lines,p.lines,'Autosaving proposed drivers never silently recalculates saved financial values');
 }finally{clearTimeout(timeout);globalThis.indexedDB=oldDb;globalThis.location=oldLocation;}
});
