const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),test=require('node:test');
const P=require('../docs/portfolio-operations-dashboard/property-intelligence.js');
const script=fs.readFileSync('docs/portfolio-operations-dashboard/property-organization.js','utf8');
const regionalId='11111111-1111-4111-8111-111111111111',otherId='22222222-2222-4222-8222-222222222222';
function fixture(){
  let writes=0,pushes=0;const allowed=new Set(['Subject','Other']);
  const c={window:{AtlasPropertyIntelligence:P,ATLAS_CENTRAL:{getStatus:()=>({signedIn:true})}},atlasWorkspaceAccess:{validated:true},Map,Set,Date,URL,setInterval:()=>{},document:{hidden:true},getProp:()=>({name:'Subject'}),getSharedEmployeeStableId:e=>'empnum:'+e.employeeNumber,communityRegionalGrouping:'North',communityMarket:'',communitySharedSyncMeta:{regionalManagerUserId:regionalId},communityGeneralManagerName:'',communityGeneralManagerEmail:'',communityRegionalManagerName:'Old person',communityRegionalManagerEmail:'old@example.com',atlasDashboardUserCanSeeCommunityName:n=>allowed.has(n),savedData:{Subject:{communityRegionalGrouping:'North',regionalManagerUserId:regionalId,regionalManagerEmployeeId:'',regionalManagerName:'Old person',regionalManagerEmail:'old@example.com',monthlyData:[{occupied:203,leased:217}],renewalHistory:[{agreements:84}]},Other:{communityRegionalGrouping:'North'}},atlasSharedData:{lastPeopleSource:'atlas_central_people',employees:{[regionalId]:{employeeId:regionalId,peopleEmployeeId:regionalId,employeeNumber:'17',name:'Current regional',email:'current@example.com',title:'Regional Manager',active:true,status:'active'},g:{employeeId:'g',peopleEmployeeId:'g',name:'Current GM',email:'gm@example.com',title:'General Manager',active:true}},assignments:[{assignmentId:'gm',employeeId:'g',title:'General Manager',communityName:'Subject',effectiveStart:'2020-01-01',status:'active'}],reportingAssignments:[{assignmentId:'regional',employeeId:regionalId,title:'Regional Manager',communityName:'Subject',effectiveStart:'2020-01-01',status:'active',source:'atlas_central_people'}]},persistSaved:()=>{writes++;},queueAtlasCentralDocumentPush:()=>{pushes++;},loadPeoplePlatformStateForSharedData:()=>{throw Error('Do not use an unverified local roster');},atlasStateWritePromise:Promise.resolve(),renderTab:()=>{}};
  c.getCurrentCommunityRecord=()=>({...c.savedData.Subject,regionalManagerName:c.communityRegionalManagerName,regionalManagerEmail:c.communityRegionalManagerEmail,regionalManagerUserId:c.communitySharedSyncMeta.regionalManagerUserId});
  vm.createContext(c);vm.runInContext(script,c);return {c,w:c.window,allowed,counts:()=>({writes,pushes})};
}
test('current canonical UserId refreshes one coherent contact without reassigning or changing facts',()=>{
  const {c,w,counts}=fixture(),before=structuredClone(c.savedData),roster=JSON.stringify(c.atlasSharedData);
  assert(w.atlasSynchronizeLinkedContacts());
  assert.deepEqual(c.savedData.Subject,{...before.Subject,regionalManagerName:'Current regional',regionalManagerEmail:'current@example.com'});
  assert.deepEqual(c.savedData.Other,before.Other);assert.equal(JSON.stringify(c.atlasSharedData),roster);
  assert.equal(c.communityRegionalManagerName,'Current regional');assert.equal(c.communityRegionalManagerEmail,'current@example.com');
  assert.equal(w.atlasLinkedEmployeeIssues().length,0);assert.match(w.atlasEmployeeSelect('regional'),/value="empnum:17" selected>Current regional/);
  assert.equal(w.atlasSynchronizeLinkedContacts(),false);assert.deepEqual(counts(),{writes:1,pushes:1});
  c.atlasSharedData.employees[regionalId].email='updated@example.com';w.atlasRefreshLinkedEmployees();assert.equal(c.savedData.Subject.regionalManagerEmail,'updated@example.com');
});
test('legacy EmployeeId and matching dual identities remain supported; no link means no inferred assignment',()=>{
  for(const ids of [{regionalManagerUserId:'',regionalManagerEmployeeId:'empnum:17'},{regionalManagerUserId:regionalId,regionalManagerEmployeeId:'empnum:17'},{regionalManagerUserId:regionalId,regionalManagerEmployeeId:'people:'+regionalId}]){
    const {c,w}=fixture();Object.assign(c.savedData.Subject,ids);assert(w.atlasSynchronizeLinkedContacts());assert.equal(c.savedData.Subject.regionalManagerEmail,'current@example.com');
    for(const [key,value]of Object.entries(ids))assert.equal(c.savedData.Subject[key],value);
  }
  const {c,w,counts}=fixture();c.savedData.Subject.regionalManagerUserId='';assert.equal(w.atlasSynchronizeLinkedContacts(),false);assert.deepEqual(counts(),{writes:0,pushes:0});
});
test('stale, invalid, conflicting, cross-property, wrong-role and absent assignments are held',()=>{
  const cases=[c=>{c.savedData.Subject.regionalManagerUserId=otherId;},c=>{c.savedData.Subject.regionalManagerUserId='not-a-current-id';},c=>{c.savedData.Subject.regionalManagerEmployeeId='empnum:88';},c=>{c.atlasSharedData.reportingAssignments[0].communityName='Other';},c=>{c.atlasSharedData.reportingAssignments[0].title='Assistant General Manager';},c=>{c.atlasSharedData.reportingAssignments=[];},c=>{c.atlasSharedData.reportingAssignments[0].source='legacy_browser';}];
  for(const mutate of cases){const {c,w,counts}=fixture();mutate(c);const before=JSON.stringify(c.savedData);assert.equal(w.atlasSynchronizeLinkedContacts(),false);w.atlasRefreshLinkedEmployees();assert.equal(JSON.stringify(c.savedData),before);assert.equal(w.atlasLinkedEmployeeIssues().length,1);assert.deepEqual(counts(),{writes:0,pushes:0});}
});
test('inactive, future, ended, missing and deleted roster contacts never refresh or enter selector',()=>{
  const cases=[c=>{c.atlasSharedData.reportingAssignments[0].status='inactive';},c=>{c.atlasSharedData.reportingAssignments[0].recordStatus='superseded';},c=>{c.atlasSharedData.reportingAssignments[0].effectiveStart='2999-01-01';},c=>{c.atlasSharedData.reportingAssignments[0].effectiveEnd='2020-01-01';},c=>{delete c.atlasSharedData.employees[regionalId];},c=>{c.atlasSharedData.employees[regionalId].status='terminated';},c=>{c.atlasSharedData.employees[regionalId].active=false;},c=>{c.atlasSharedData.employees[regionalId].deletedAt='2026-01-01';}];
  for(const mutate of cases){const {c,w,counts}=fixture();mutate(c);assert.equal(w.atlasSynchronizeLinkedContacts(),false);assert(!w.atlasEmployeeSelect('regional').includes('>Current regional<'));assert.deepEqual(counts(),{writes:0,pushes:0});}
});
test('scope and authentication changes hold contacts, even with a previously loaded roster',()=>{
  for(const mutate of [(c,allowed)=>allowed.delete('Subject'),c=>{c.atlasWorkspaceAccess.validated=false;},c=>{c.window.ATLAS_CENTRAL.getStatus=()=>({signedIn:false});}]){
    const {c,w,allowed,counts}=fixture();mutate(c,allowed);assert.equal(w.atlasSynchronizeLinkedContacts(),false);assert(!w.atlasEmployeeSelect('regional').includes('>Current regional<'));assert.deepEqual(counts(),{writes:0,pushes:0});
  }
  const {c,w}=fixture();c.atlasSharedData.reportingAssignments[0].communityName='Other';assert(!w.atlasEmployeeSelect('regional').includes('>Current regional<'),'same region is insufficient for a reporting-only community assignment');
});
test('central contacts with missing or unknown active status and malformed dates are held',()=>{
  const cases=[c=>{delete c.atlasSharedData.reportingAssignments[0].status;},c=>{c.atlasSharedData.reportingAssignments[0].status='pending';},c=>{delete c.atlasSharedData.employees[regionalId].status;},c=>{c.atlasSharedData.employees[regionalId].status='on_leave';},c=>{c.atlasSharedData.reportingAssignments[0].effectiveEnd='invalid';},c=>{c.atlasSharedData.reportingAssignments[0].effectiveStart='2026-02-30';}];
  for(const mutate of cases){const {c,w}=fixture();mutate(c);assert.equal(w.atlasSynchronizeLinkedContacts(),false);assert(!w.atlasEmployeeSelect('regional').includes('>Current regional<'));}
});
test('regional words and matching display names do not bypass role or canonical community identity',()=>{
  for(const title of ['Regional Accountant','Regional Maintenance Technician','Assistant Regional Manager']){
    const {c,w}=fixture();c.atlasSharedData.reportingAssignments[0].title=title;assert.equal(w.atlasSynchronizeLinkedContacts(),false);assert(!w.atlasEmployeeSelect('regional').includes('>Current regional<'));
  }
  const {c,w}=fixture();c.savedData.Subject.atlasCommunityId=regionalId;c.atlasSharedData.reportingAssignments[0].communityId=otherId;
  assert.equal(w.atlasSynchronizeLinkedContacts(),false);assert(!w.atlasEmployeeSelect('regional').includes('>Current regional<'));
});
test('explicit existing selector keeps canonical and stable IDs coherent without modifying roster assignments',async()=>{
  const {c,w}=fixture(),before=JSON.stringify(c.atlasSharedData);
  await w.atlasSelectEmployee('regional','empnum:17');assert.equal(c.savedData.Subject.regionalManagerUserId,regionalId);assert.equal(c.savedData.Subject.regionalManagerEmployeeId,'empnum:17');assert.equal(c.savedData.Subject.regionalManagerName,'Current regional');assert.equal(c.savedData.Subject.regionalManagerEmail,'current@example.com');assert.equal(JSON.stringify(c.atlasSharedData),before);
  const saved=JSON.stringify(c.savedData);await w.atlasSelectEmployee('regional','empnum:missing');assert.equal(JSON.stringify(c.savedData),saved);
});
test('revoked access prevents selecting or clearing, and suppresses late queue work after persistence',async()=>{
  for(const revoke of [(c,allowed)=>allowed.delete('Subject'),c=>{c.atlasWorkspaceAccess.validated=false;},c=>{c.window.ATLAS_CENTRAL.getStatus=()=>({signedIn:false});}]){
    const {c,w,allowed,counts}=fixture(),before=JSON.stringify(c.savedData);revoke(c,allowed);await w.atlasSelectEmployee('regional','empnum:17');await w.atlasSelectEmployee('regional','');assert.equal(JSON.stringify(c.savedData),before);assert.deepEqual(counts(),{writes:0,pushes:0});
  }
  const {c,w,counts}=fixture();let finish;c.atlasStateWritePromise=new Promise(resolve=>{finish=resolve;});const task=w.atlasSelectEmployee('regional','empnum:17');c.atlasWorkspaceAccess.validated=false;finish();await task;assert.deepEqual(counts(),{writes:1,pushes:0});
});
