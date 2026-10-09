import assert from 'node:assert/strict';
import test from 'node:test';
import {IDBFactory} from 'fake-indexeddb';
import {captureStrProgramme,installSavedStrProgrammes} from '../docs/portfolio-operations-dashboard/features/saved-str-programmes.mjs';
import {saveForecastRecovery,listForecastRecovery} from '../docs/portfolio-operations-dashboard/features/reforecast-recovery.mjs';

const clone=structuredClone,id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),communityId=id(1),actor=id(2);
const options={communityId,communityName:'Synthetic community',name:'2027 STR programme',reason:'Save independent unapplied proposal',expectedRevision:0};
function builder(){
 const state={properties:[{id:'DORO',name:'Synthetic community',units:[]}],lines:[],strPrograms:[],activeProperty:'DORO',activeScenario:'WORK'};
 return {YEARS:[2027],views:{strbuild:()=>''},app:{state,strCfg:{propertyId:'DORO',programmeId:'DORO-STR-SHORTTERMR',name:'2027 STR programme',adr:175},VIEWS:[],view:'strbuild',year:()=>2027,scenario:()=>({id:'WORK'}),render(){},touch(){},toast(){}}};
}
function receipt(request){
 const head={community_id:request.communityId,programme_id:request.programmeId,revision:request.expectedRevision+1,revision_id:crypto.randomUUID()};
 return {verified:true,head,revision:{...head,request_id:request.requestId,actor_id:actor,content_hash:'a'.repeat(64),created_at:'2026-10-09T00:00:00Z',payload:clone(request.payload)}};
}
async function setup(run){
 const previous={location:globalThis.location,indexedDB:globalThis.indexedDB};globalThis.location={hash:''};globalThis.indexedDB=new IDBFactory();
 const calls=[],receipts=new Map();let loseResponse=false,denyReceipts=false;
 const central={getSession:()=>({user:{id:actor}}),fetchJson:async(route,args)=>{
  const body=JSON.parse(args.body);calls.push({route,body});
  if(route.endsWith('atlas_read_str_programme_draft_receipt')){if(denyReceipts)throw Error('Synthetic receipt unavailable');return clone(receipts.get(body.p_request_id)||null);}
  if(!route.endsWith('atlas_save_str_programme_draft'))throw Error('Unexpected write '+route);
  const request={communityId:body.p_community_id,programmeId:body.p_programme_id,expectedRevision:body.p_expected_revision,requestId:body.p_request_id,payload:body.p_payload},saved=receipt(request);receipts.set(request.requestId,saved);
  if(loseResponse){denyReceipts=true;throw Error('Synthetic lost response after commit');}return clone(saved);
 }};
 const seed=async(request)=>saveForecastRecovery(central,'str-programme-write:'+request.requestId,{kind:'str-programme-write',request,name:request.payload.name});
 try{await run({central,calls,seed,receipts,install:R=>installSavedStrProgrammes(R,{central}),lose:()=>{loseResponse=true;},restore:()=>{loseResponse=false;denyReceipts=false;},pending:()=>listForecastRecovery(central)});}
 finally{globalThis.location=previous.location;globalThis.indexedDB=previous.indexedDB;}
}

test('new unapplied programme ignores unrelated creations and updates sharing its builder ID',()=>setup(async f=>{
 const R=builder(),payload=captureStrProgramme(R,options),before=clone(R.app.state);
 const unrelatedCreation={communityId,programmeId:id(10),expectedRevision:0,requestId:id(11),payload:{...clone(payload),name:'Prior 2026 programme'}};
 const unrelatedUpdate={communityId,programmeId:id(12),expectedRevision:3,requestId:id(13),payload:clone(payload)};
 await f.seed(unrelatedCreation);await f.seed(unrelatedUpdate);const retained=await f.pending();
 const saved=await f.install(R).persistCurrent(options);
 assert(![id(10),id(12)].includes(saved.head.programme_id));assert.equal(saved.head.revision,1);assert.equal(saved.revision.payload.sourceProgrammeId,payload.sourceProgrammeId);assert.equal(saved.revision.payload.programme.applied,false);assert.deepEqual(saved.revision.payload.lines,[]);assert.deepEqual(R.app.state,before);assert.deepEqual(await f.pending(),retained);assert.equal(f.calls.filter(row=>row.route.endsWith('atlas_save_str_programme_draft')).length,1);
}));

test('an explicit shared destination is never replaced by an identical pending payload for another destination',()=>setup(async f=>{
 const R=builder(),payload=captureStrProgramme(R,options),other={communityId,programmeId:id(20),expectedRevision:2,requestId:id(21),payload};
 await f.seed(other);const retained=await f.pending(),saved=await f.install(R).persistCurrent({...options,programmeId:id(22),expectedRevision:2});
 assert.equal(saved.head.programme_id,id(22));assert.equal(saved.head.revision,3);assert.notEqual(saved.revision.request_id,other.requestId);assert.deepEqual(await f.pending(),retained);assert.equal(f.calls.find(row=>row.route.endsWith('atlas_save_str_programme_draft')).body.p_programme_id,id(22));
}));

test('exact creation retry after restarting the builder reads its committed receipt without another write',()=>setup(async f=>{
 const R=builder();f.lose();await assert.rejects(()=>f.install(R).persistCurrent(options),/receipt unavailable/);
 const pending=(await f.pending())[0],writes=f.calls.filter(row=>row.route.endsWith('atlas_save_str_programme_draft')).length;assert.equal(writes,1);assert.equal(pending.request.expectedRevision,0);
 f.restore();const reopened=builder(),saved=await f.install(reopened).persistCurrent(options);
 assert.equal(saved.head.programme_id,pending.request.programmeId);assert.equal(saved.revision.request_id,pending.request.requestId);assert.deepEqual(saved.revision.payload,pending.request.payload);assert.equal(f.calls.filter(row=>row.route.endsWith('atlas_save_str_programme_draft')).length,writes);assert.deepEqual(await f.pending(),[]);
}));

test('same-target changed content or revision remains blocked even when its builder ID changed',()=>setup(async f=>{
 const R=builder(),payload=captureStrProgramme(R,options),request={communityId,programmeId:id(30),expectedRevision:3,requestId:id(31),payload};await f.seed(request);const retained=await f.pending(),installed=f.install(R);
 R.app.strCfg.programmeId='DIFFERENT-BUILDER-ID';await assert.rejects(()=>installed.persistCurrent({...options,programmeId:id(30),expectedRevision:3}),/prior save.*receipt recovery/);
 R.app.strCfg.programmeId=payload.sourceProgrammeId;await assert.rejects(()=>installed.persistCurrent({...options,programmeId:id(30),expectedRevision:4}),/prior save.*receipt recovery/);
 assert.equal(f.calls.length,0);assert.deepEqual(await f.pending(),retained);
 f.receipts.set(request.requestId,receipt(request));const saved=await installed.persistCurrent({...options,programmeId:id(30),expectedRevision:3});assert.equal(saved.revision.request_id,request.requestId);assert.equal(saved.head.revision,4);assert(f.calls.every(row=>row.route.endsWith('receipt')));assert.deepEqual(await f.pending(),[]);
}));

test('multiple exact pending creations require recovery instead of selecting an arbitrary request',()=>setup(async f=>{
 const R=builder(),payload=captureStrProgramme(R,options);for(const n of [40,50])await f.seed({communityId,programmeId:id(n),expectedRevision:0,requestId:id(n+1),payload});const retained=await f.pending();
 await assert.rejects(()=>f.install(R).persistCurrent(options),/receipt recovery/);assert.equal(f.calls.length,0);assert.deepEqual(await f.pending(),retained);
}));
