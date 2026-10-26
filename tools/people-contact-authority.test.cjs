const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {createHash} = require('node:crypto');
const api = require('../docs/portfolio-operations-dashboard/people-contact-authority.js');
const P = require('../docs/portfolio-operations-dashboard/property-intelligence.js');
const core = fs.readFileSync('docs/portfolio-operations-dashboard/workspace-core.js', 'utf8');
const clone = value => structuredClone(value);
const digest = async value => createHash('sha256').update(value).digest('hex');
const extract = name => {const start = core.search(new RegExp(`(?:async )?function ${name}\\(`)); assert(start >= 0); return core.slice(start, core.indexOf('\n}', start) + 2);};
const employee = {id:'employee-a',name:'Approved Person',email:'approved@example.invalid',role:'General Manager',community:'Source alias',status:'Active',managerId:'emp:supervisor',managerName:'Recorded Supervisor'};
const assignment = {...employee,id:'assignment-a',employeeId:employee.id,effectiveStart:'2026-01-01',effectiveEnd:'',recordStatus:'current'};
const supervisor = {id:'supervisor',name:'Recorded Supervisor',email:'supervisor@example.invalid',role:'Regional Director',status:'Active'};
const original = {generalManagerName:'Old Placeholder',generalManagerEmail:'old@example.invalid',generalManagerUserId:'legacy-person',generalManagerEmployeeId:'people:legacy-person',regionalManagerName:'Retained Regional',regionalManagerUserId:'retained-regional',marketSurveyData:{version:'new Oct26 import'},monthlyData:[{occupied:82}],communityRegionalGrouping:'North'};
async function source(people = {employees:[employee,supervisor],employeeAssignments:[assignment]}) {
  const value = JSON.stringify(people);
  return {snapshotType:'atlas_central_migration_read_only_snapshot_v1',readOnly:true,generatedAt:'2026-10-26T12:47:48Z',storageEntries:{rise_performance_platform_github_v1:{value,parsed:clone(people),sha256:await digest(value)}}};
}
const options = records => ({communities:['Subject'],records:records || {Subject:clone(original)},aliases:{'source alias':'Subject'},asOf:'2026-10-26',digest});
async function row() {return (await api.review(await source(),options())).rows[0];}

test('verified current People identities produce contact-only values and actual supervisory title', async () => {
  const snapshot=await source(), before=JSON.stringify(snapshot), review=await api.review(snapshot,options());
  assert.equal(review.rows.length,1);assert.equal(review.rows[0].disposition,'correct contact');
  const result=api.apply(original,review.rows[0].candidate);
  assert.equal(result.generalManagerName,employee.name);assert.equal(result.peopleContactAuthority.supervisor.title,'Regional Director');
  assert.equal(result.generalManagerUserId,original.generalManagerUserId);assert.equal(result.generalManagerEmployeeId,original.generalManagerEmployeeId);
  assert.equal(result.regionalManagerUserId,original.regionalManagerUserId);assert.deepEqual(result.marketSurveyData,original.marketSurveyData);
  assert.equal(JSON.stringify(snapshot),before);
  const current={...original,generalManagerName:employee.name,generalManagerEmail:employee.email};
  assert.equal((await api.review(snapshot,options({Subject:current}))).rows[0].disposition,'confirm identity');
});

test('name-only supervisor remains a verbatim label, never a guessed identity, title or email', async () => {
  const e={...employee,managerId:''}, a={...assignment,managerId:''};
  const review=await api.review(await source({employees:[e,supervisor],employeeAssignments:[a]}),options());
  assert.deepEqual(review.rows[0].candidate.supervisor,{kind:'recorded-name',name:'Recorded Supervisor'});
});

test('unverified, conflicting, out-of-scope and inactive People evidence is rejected or held', async () => {
  const bad=await source();bad.storageEntries.rise_performance_platform_github_v1.sha256='0'.repeat(64);
  await assert.rejects(api.review(bad,options()),/fingerprint/);
  const disagree=await source();disagree.storageEntries.rise_performance_platform_github_v1.parsed.employees[0].name='Other';
  await assert.rejects(api.review(disagree,options()),/disagree/);
  const duplicate=await source({employees:[employee,employee],employeeAssignments:[assignment]});
  await assert.rejects(api.review(duplicate,options()),/duplicate/);
  for (const change of [{effectiveStart:'2026-02-30'},{effectiveEnd:'2026-01-02'},{community:'Not authorized'},{managerId:'emp:someone-else'},{status:'Terminated'},{recordStatus:'draft'},{recordStatus:'rejected'},{recordStatus:''}]) {
    const result=await api.review(await source({employees:[employee,supervisor],employeeAssignments:[{...assignment,...change}]}),options());
    assert.equal(result.rows.length,0,JSON.stringify(change));
  }
  const duplicateAssignment=await api.review(await source({employees:[employee,supervisor],employeeAssignments:[assignment,{...assignment,id:'equivalent-current'}]}),options());
  assert.equal(duplicateAssignment.rows.length,1,'Equivalent duplicated source evidence does not create another contact');
  const unauthorized=await api.review(await source(),{...options(),communities:['Different']});assert.equal(unauthorized.rows.length,0);
});

function persistenceFixture() {
  const records=new Map([['communities',{key:'communities',value:{Subject:clone(original),Other:{marketSurveyData:{version:100}}},updatedAt:'before'}],['atlas_workspace_source_v2',{key:'atlas_workspace_source_v2',value:{dirty:false},updatedAt:'before'}]]);
  const state={writes:0,fail:false,readFail:false,access:true,afterCommit:null};
  const c={window:{AtlasPeopleContacts:api,ATLAS_CENTRAL:{getSession:()=>({user:{id:'actor'}})}},Date,Map,Set,JSON,
    ATLAS_STATE_COMMUNITY_KEY:'communities',OPS_GLOBAL_STORAGE_KEY:'ops',savedData:clone(records.get('communities').value),
    atlasWorkspaceAccess:{validated:true},getAtlasCentralStatus:()=>({signedIn:true}),isCommunitySettingsAdmin:()=>true,
    captureAtlasAuxiliaryContext:()=>({current:()=>state.access}),atlasDashboardUserCanSeeCommunityName:name=>name==='Subject',getProp:()=>({name:'Subject'}),
    communityGeneralManagerName:original.generalManagerName,communityGeneralManagerEmail:original.generalManagerEmail,
    queueAtlasStateWrite:async task=>{try{await task();}catch{}},
    atlasStateGetValue:async key=>{if(state.readFail)throw Error('Synthetic readback failure');return clone(records.get(key)?.value);}};
  c.buildSerializedSavedDataPayload=()=>clone(c.savedData);
  c.withAtlasStateStore=async(mode,action)=>{
    const pending=[],writes=[];let aborted=false;
    const store={transaction:{abort(){aborted=true;}},get(key){const r={};pending.push(()=>{r.result=clone(records.get(key));r.onsuccess?.();});return r;},put(value){writes.push(clone(value));}};
    action(store);for(const run of pending)run();
    if(aborted||state.fail)throw Error('Synthetic commit failure');
    for(const value of writes){records.set(value.key,value);state.writes++;}
    if(state.afterCommit){const f=state.afterCommit;state.afterCommit=null;await f();}
  };
  vm.createContext(c);vm.runInContext(['atlasStateSetValue','persistReviewedPeopleContacts'].map(extract).join('\n'),c);
  return {c,state,records};
}

test('actual atomic contact writer refuses stale workspace, then preserves refreshed market data through the next save', async()=>{
  const f=persistenceFixture(), selected=await row();
  f.records.get('communities').value.Subject.marketSurveyData={version:'later concurrent market import'};
  await assert.rejects(f.c.persistReviewedPeopleContacts([selected]),/Workspace data changed/);
  assert.equal(f.state.writes,0);
  f.c.savedData=clone(f.records.get('communities').value);
  assert.equal(await f.c.persistReviewedPeopleContacts([selected]),1);
  await f.c.atlasStateSetValue('communities',f.c.buildSerializedSavedDataPayload());
  const stored=f.records.get('communities').value;
  assert.equal(stored.Subject.marketSurveyData.version,'later concurrent market import');assert.equal(stored.Other.marketSurveyData.version,100);
  assert.equal(stored.Subject.generalManagerUserId,'legacy-person');assert.equal(stored.Subject.regionalManagerUserId,'retained-regional');
  assert.equal(f.records.get('atlas_workspace_source_v2').value.dirty,true);
  assert.equal(f.c.savedData.Subject.generalManagerName,employee.name);
});

test('contact conflicts, access changes, failed writes and later same-tab choices never replace live edits',async()=>{
  const selected=await row();
  const stale=persistenceFixture();stale.records.get('communities').value.Subject.generalManagerName='Newer manual choice';
  await assert.rejects(stale.c.persistReviewedPeopleContacts([selected]),/Workspace data changed/);assert.equal(stale.state.writes,0);
  const denied=persistenceFixture();denied.state.access=false;await assert.rejects(denied.c.persistReviewedPeopleContacts([selected]),/Access changed/);assert.equal(denied.state.writes,0);
  const failed=persistenceFixture();failed.state.fail=true;await assert.rejects(failed.c.persistReviewedPeopleContacts([selected]),/commit failure/);assert.deepEqual(failed.c.savedData.Subject,original);assert.equal(failed.state.writes,0);
  const newer=persistenceFixture();newer.state.afterCommit=()=>{newer.c.savedData.Subject.generalManagerName='Newer manual choice';};
  await assert.rejects(newer.c.persistReviewedPeopleContacts([selected]),/newer contact edit/);assert.equal(newer.c.savedData.Subject.generalManagerName,'Newer manual choice');
  assert.match(newer.c.window.AtlasPeopleContactRecovery,/Reload/);
  const persisted=JSON.stringify([...newer.records]);
  vm.runInContext(extract('persistSaved'),newer.c);assert.equal(newer.c.persistSaved().ok,false);
  await assert.rejects(newer.c.atlasStateSetValue('communities',newer.c.savedData),/Reload/);
  assert.equal(JSON.stringify([...newer.records]),persisted);
});

test('actual contact readers prefer reviewed GM over SQL placeholder; manual SQL choice clears only binding',async()=>{
  const selected=await row();const record=api.apply(clone(original),selected.candidate);let writes=0;
  const c={window:{AtlasPeopleContacts:api,AtlasPropertyIntelligence:P,ATLAS_CENTRAL:{getStatus:()=>({signedIn:true})}},Map,Set,Date,URL,
    atlasWorkspaceAccess:{validated:true},document:{hidden:true},setInterval(){},getProp:()=>({name:'Subject'}),getSharedEmployeeStableId:e=>'people:'+e.employeeId,
    communityRegionalGrouping:'North',communityMarket:'',savedData:{Subject:record},atlasDashboardUserCanSeeCommunityName:()=>true,
    atlasSharedData:{lastPeopleSource:'atlas_central_people',employees:{sql:{employeeId:'sql',name:'SQL Placeholder',email:'sql@example.invalid',status:'Active'}},assignments:[{employeeId:'sql',communityName:'Subject',title:'General Manager',status:'Active',effectiveStart:'2026-01-01'}]},
    persistSaved:()=>{writes++;},queueAtlasCentralDocumentPush(){},atlasStateWritePromise:Promise.resolve(),renderTab(){},
    loadPeoplePlatformStateForSharedData:()=>{throw Error('Unscoped People fallback prohibited');},communitySharedSyncMeta:{generalManagerUserId:'legacy-person'},
    communityGeneralManagerName:employee.name,communityGeneralManagerEmail:employee.email,communityRegionalManagerName:'Retained',communityRegionalManagerEmail:''};
  c.getCurrentCommunityRecord=()=>({...c.savedData.Subject,generalManagerName:c.communityGeneralManagerName,generalManagerEmail:c.communityGeneralManagerEmail,generalManagerUserId:c.communitySharedSyncMeta.generalManagerUserId});
  vm.createContext(c);vm.runInContext(fs.readFileSync('docs/portfolio-operations-dashboard/property-organization.js','utf8'),c);
  c.window.atlasSynchronizeLinkedContacts({persist:false});assert.equal(record.generalManagerName,employee.name);assert.equal(writes,0);
  assert(c.window.atlasEmployeeSelect('gm').includes('Approved Person'));assert(!c.window.atlasLinkedEmployeeIssues().some(v=>v.startsWith('GM')));
  await c.window.atlasSelectEmployee('gm','sql');assert.equal(c.savedData.Subject.peopleContactAuthority,undefined);assert.equal(c.savedData.Subject.generalManagerName,'SQL Placeholder');assert.equal(writes,1);
});

test('actual shared graph projection cannot replace reviewed contact or create a new user identity',async()=>{
  const selected=await row(),record=api.apply(clone(original),selected.candidate);
  const c={window:{AtlasPeopleContacts:api},normalizeCommunityStatus:v=>v};vm.createContext(c);vm.runInContext(extract('atlasProjectSharedPropertyToCommunityRecord'),c);
  const projected=c.atlasProjectSharedPropertyToCommunityRecord({generalManagerName:'SQL Placeholder',generalManagerEmail:'sql@example.invalid',generalManagerUserId:'other-sql'},record,'Subject');
  assert.equal(projected.generalManagerName,employee.name);assert.equal(projected.generalManagerUserId,'legacy-person');assert.equal(projected.peopleContactAuthority.peopleId,employee.id);
});


test('supervisor changes are reviewed even with the same GM and assignment identity',async()=>{
  const previous=api.apply(clone(original),(await row()).candidate);
  const next=await api.review(await source({employees:[employee,{...supervisor,email:'new-supervisor@example.invalid'}],employeeAssignments:[assignment]}),options({Subject:previous}));
  assert.equal(next.rows[0].disposition,'update supervisor');
  assert.equal(next.rows[0].currentSupervisor.email,supervisor.email);
  assert.equal(next.rows[0].candidate.supervisor.email,'new-supervisor@example.invalid');
});

test('shared graph projection validates the caller community rather than the binding itself',async()=>{
  const record=api.apply(clone(original),(await row()).candidate);
  const c={window:{AtlasPeopleContacts:api},normalizeCommunityStatus:v=>v};vm.createContext(c);vm.runInContext(extract('atlasProjectSharedPropertyToCommunityRecord'),c);
  const projected=c.atlasProjectSharedPropertyToCommunityRecord({generalManagerName:'Other community manager',generalManagerEmail:'other@example.invalid',generalManagerUserId:'other-id'},record,'Other');
  assert.equal(projected.generalManagerName,'Other community manager');assert.equal(projected.generalManagerUserId,'other-id');
});


test('failed or raced readback holds later saves without applying unverified contacts or overwriting storage',async()=>{
  for(const kind of ['failure','competing edit']) {
    const f=persistenceFixture();
    if(kind==='failure')f.state.readFail=true;
    else f.state.afterCommit=()=>{f.records.get('communities').value.Subject.marketSurveyData={version:'newer other-tab import'};};
    await assert.rejects(f.c.persistReviewedPeopleContacts([await row()]),/readback failure|verification failed/);
    assert.deepEqual(f.c.savedData.Subject,original);
    assert.match(f.c.window.AtlasPeopleContactRecovery,/Reload/);
    assert.equal(f.records.get('atlas_workspace_source_v2').value.dirty,true,'Committed contacts retain durable pending state through reload');
    const stored=JSON.stringify([...f.records]);
    await assert.rejects(f.c.atlasStateSetValue('communities',f.c.savedData),/Reload/);
    vm.runInContext(extract('persistSaved')+'\n'+extract('saveAtlasCentralAppState'),f.c);
    assert.equal(f.c.persistSaved().ok,false);
    f.c.setAtlasCentralRuntimeMessage=()=>{};
    assert.equal(await f.c.saveAtlasCentralAppState({silent:true}),false);
    assert.equal(JSON.stringify([...f.records]),stored);
  }
});

function recordNormalizerContext() {
  const c={window:{AtlasPeopleContacts:api},savedData:{},Date,Map,Set,JSON,
    defaultSavedCommunityRecord:()=>({}),normalizeCommunityMonthlySources:value=>({monthlyData:value.monthlyData,savedBudgetTargets:value.savedBudgetTargets,monthlyHistoryByPeriod:value.monthlyHistoryByPeriod}),
    getTotalUnitsFor:()=>100,getPropertyByName:name=>({name}),atlasNormalizeSharedEmail:value=>String(value||'').toLowerCase()};
  for(const name of ['normalizePropertyTeamConfig','normalizeCommunityTeamProfiles','normalizePropertyTurnoverConfig','normalizePropertyTurnoverByQuarter','getPropertyTurnoverTotalsFromQuarterMap','normalizeRenewalDetailRowsByMonth','normalizeRenewalDetailRowsByPeriod','normalizeCorporateLeaseUnits','normalizeCommunityStatus','normalizeInvestorEmailContacts','normalizeDlrDeliverySettings','normalizeCommunityFloorPlans','normalizeCommunityPhotoBank','rebuildBonusRolesByQuarter','normalizeCommissionData','normalizeMsoeByQuarter','normalizeReputationData','normalizeMarketSurveyData','normalizeDlrSummary','normalizeMarketSurveyHistory','normalizeImportTracking','serializeCommunityPhotoBank','serializeCommunityTeamProfiles'])c[name]=value=>value;
  vm.createContext(c);vm.runInContext(['normalizeSavedCommunityRecord','buildSerializedSavedDataPayload'].map(extract).join('\n'),c);return c;
}

test('community normalization and next-save serialization retain scoped contact authority and business values',async()=>{
  const c=recordNormalizerContext(), record=api.apply({...clone(original),financialLedger:{'2026-10':{revenue:123}},marketSurveyHistory:{10:{version:'Oct26'}}},(await row()).candidate);
  record.generalManagerName='Background placeholder';record.generalManagerEmail='background@example.invalid';
  c.savedData.Subject=c.normalizeSavedCommunityRecord('Subject',record);
  const serialized=c.buildSerializedSavedDataPayload().Subject;
  assert.equal(serialized.generalManagerName,employee.name);assert.equal(serialized.peopleContactAuthority.peopleId,employee.id);
  for(const key of ['financialLedger','marketSurveyData','marketSurveyHistory','monthlyData','generalManagerUserId','regionalManagerUserId'])assert.deepEqual(serialized[key],record[key]);
  const other=c.normalizeSavedCommunityRecord('Other',record);
  assert.equal(other.peopleContactAuthority,undefined);assert.equal(other.generalManagerName,'Background placeholder');
});

test('both actual graph writers omit reviewed contact identity from directory updates',async()=>{
  const record=api.apply(clone(original),(await row()).candidate), inputs=[];
  const c={window:{AtlasPeopleContacts:api},savedData:{Subject:record},PROPERTIES:[{name:'Subject',units:100}],ATLAS_SHARED_PROPERTY_SOURCE_ID:'synthetic',
    normalizeSavedCommunityRecord:(_name,value)=>value,atlasSharedNow:()=> '2026-10-26T00:00:00Z',readAtlasSharedPropertyGraph:()=>({}),atlasNormalizeSharedText:value=>value.toLowerCase(),
    atlasUpsertSharedProperty:(_graph,input)=>{inputs.push(input);return {changed:false};},writeAtlasSharedPropertyGraph:()=>{throw Error('Unexpected graph write');}};
  vm.createContext(c);vm.runInContext(['syncSharedPropertyFromPortfolioRecord','syncSharedPropertiesFromPortfolio'].map(extract).join('\n'),c);
  c.syncSharedPropertyFromPortfolioRecord('Subject',record,{persist:false});c.syncSharedPropertiesFromPortfolio({persist:false});
  assert.equal(inputs.length,2);
  for(const input of inputs){for(const key of ['generalManagerName','generalManagerEmail','generalManagerUserId','peopleContactAuthority'])assert.equal(Object.hasOwn(input,key),false);assert.equal(input.regionalManagerUserId,original.regionalManagerUserId);}
});

function installActualSaveQueue(f) {
  Object.assign(f.c,{atlasStateWritePromise:Promise.resolve(),ATLAS_STATE_DB_NAME:'synthetic',DOMException,atlasPersistenceMeta:{},
    markAtlasPersistenceError:()=>{},clearAtlasPersistenceError:()=>{},persistAtlasPersistenceMeta:()=>{},removeLegacyCommunityStorageKeys:()=>{},dashboardSharedSyncMeta:{},persistDashboardSharedSyncMeta:()=>{},setAtlasCentralRuntimeMessage:()=>{}});
  vm.runInContext(['queueAtlasStateWrite','persistSaved','saveAtlasCentralAppState'].map(extract).join('\n'),f.c);
}

test('ordinary or direct saves during contact readback cannot queue an older snapshot that erases the binding',async()=>{
  const f=persistenceFixture();installActualSaveQueue(f);let competing;
  f.state.afterCommit=async()=>{
    competing=f.c.persistSaved();assert.equal(competing.ok,false);
    assert.equal(await f.c.saveAtlasCentralAppState({silent:true}),false);
    await assert.rejects(f.c.atlasStateSetValue('communities',clone(f.c.savedData)),/People contacts changed/);
    f.c.savedData.Subject.marketSurveyData={version:'new same-tab market edit'};
  };
  await f.c.persistReviewedPeopleContacts([await row()]);await competing.completion;
  assert(f.records.get('communities').value.Subject.peopleContactAuthority);assert(f.c.savedData.Subject.peopleContactAuthority);
  assert.equal(f.c.savedData.Subject.marketSurveyData.version,'new same-tab market edit');
  assert.equal(f.c.window.AtlasPeopleContactWrite,undefined);
  const later=f.c.persistSaved();await later.completion;
  assert.equal(later.ok,true);assert(f.records.get('communities').value.Subject.peopleContactAuthority);
  assert.equal(f.records.get('communities').value.Subject.marketSurveyData.version,'new same-tab market edit');
});

test('ordinary saves already queued before contact review complete before its atomic baseline check',async()=>{
  const f=persistenceFixture();installActualSaveQueue(f);const selected=await row();
  f.c.savedData.Subject.marketSurveyData={version:'prior queued market edit'};
  const prior=f.c.persistSaved();
  await f.c.persistReviewedPeopleContacts([selected]);await prior.completion;
  assert.equal(prior.ok,true);assert.equal(f.records.get('communities').value.Subject.marketSurveyData.version,'prior queued market edit');
  assert(f.records.get('communities').value.Subject.peopleContactAuthority);
});


test('a direct community write held at database-open cannot revive after contact verification finishes',async()=>{
  for(const starts of ['before','during']) {
    const f=persistenceFixture(), io=f.c.withAtlasStateStore;let release, delayed, hold=false;
    f.c.withAtlasStateStore=async(...args)=>{if(hold){hold=false;await new Promise(resolve=>{release=resolve;});}return io(...args);};
    const start=()=>{hold=true;delayed=f.c.atlasStateSetValue('communities',clone(f.c.savedData));delayed.catch(()=>{});};
    if(starts==='before')start();else f.state.afterCommit=start;
    await f.c.persistReviewedPeopleContacts([await row()]);assert.equal(f.c.window.AtlasPeopleContactWrite,undefined);
    release();await assert.rejects(delayed,/People contacts changed/);
    assert(f.records.get('communities').value.Subject.peopleContactAuthority);
  }
});
