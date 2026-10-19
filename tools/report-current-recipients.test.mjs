import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {resolveCurrentDlrRecipients} from '../src/dlr-current-recipients.mjs';
const id='00000000-0000-0000-0000-000000000001', other='00000000-0000-0000-0000-000000000002', employeeId='00000000-0000-0000-0000-000000000003';
const subscription={community_id:id,community_name:'Test A',recipient_config:{resolverVersion:1,employeeRecipientIds:[employeeId],toInvestorContacts:false,cc:['NEW@risere.com'],bcc:[]}};
let rows=[{employee_id:employeeId,community_id:id,employment_status:'Active',effective_start:'2026-01-01',effective_end:null,atlas_employees:{employee_id:employeeId,email:'new@risere.com',full_name:'Person',status:'Active'},atlas_roles:{}}];
const parent={document_key:'atlas_dashboard_state_v1',version:5,updated_at:'2026-10-19T00:00:00Z',archiveHash:'a'.repeat(64)};
let currentParent=parent;
let queryCount=0;
const query=async path=>{
  queryCount++;
  if(path.includes('atlas_communities?'))return [{community_id:id,display_name:'Test A',canonical_name:'Test A'}];
  if(path.includes('atlas_employee_assignments?')){assert(path.includes(`community_id=eq.${id}`));return structuredClone(rows);}
  if(path.includes('document_key=eq.atlas_dashboard_state_v1'))return [currentParent];
  if(path.includes('document_key=eq.atlas_workspace_projection_v1'))return [{source:{documentKey:parent.document_key,version:parent.version,archiveHash:parent.archiveHash,effectiveAt:parent.updated_at},communityData:{'Test A':{atlasCommunityId:id,investorEmailContacts:[{email:'NEW@risere.com'},{email:'owner@example.com'}]},'Test B':{atlasCommunityId:other,investorEmailContacts:[{email:'wrong@example.com'}]}}}];
  throw Error(path);
};
let actual=await resolveCurrentDlrRecipients(subscription,query,'2026-10-19');
assert.deepEqual(actual,{to:['new@risere.com'],cc:[],bcc:[]});
rows[0].atlas_employees.email='changed@risere.com';
assert.deepEqual((await resolveCurrentDlrRecipients(subscription,query,'2026-10-19')).to,['changed@risere.com']);
for(const mutate of [r=>r.atlas_employees.status='Inactive',r=>r.atlas_employees.deleted_at='2026-10-18',r=>r.community_id=other,r=>r.effective_end='2026-10-18',r=>r.effective_start='2026-10-20',r=>r.atlas_employees.email='',r=>r.atlas_employees.email='gm@rise.com',r=>r.atlas_employees.email='bad']){
  const old=structuredClone(rows);mutate(rows[0]);assert.deepEqual((await resolveCurrentDlrRecipients(subscription,query,'2026-10-19')).to,[]);rows=old;
}
const saved=structuredClone(subscription);
rows=[];assert.deepEqual((await resolveCurrentDlrRecipients(subscription,query,'2026-10-19')).to,[]);assert.deepEqual(subscription,saved);
subscription.recipient_config.toInvestorContacts=true;
assert.deepEqual((await resolveCurrentDlrRecipients(subscription,query,'2026-10-19')).to,['new@risere.com','owner@example.com']);
currentParent={...parent,version:6};await assert.rejects(()=>resolveCurrentDlrRecipients(subscription,query,'2026-10-19'),/published workspace/);currentParent=parent;
queryCount=0;await assert.rejects(()=>resolveCurrentDlrRecipients({...subscription,community_id:''},query),/recognized community/);assert.equal(queryCount,0);

const core=fs.readFileSync(new URL('../docs/portfolio-operations-dashboard/workspace-core.js',import.meta.url),'utf8');
const extract=name=>core.match(new RegExp('^(?:async )?function '+name+'\\([^]*?^\\}','m'))[0];
const employee={employeeId,source:'atlas_central_people',active:true,status:'Active',name:'Current Person',email:'new@risere.com'};
const shared={employees:{[employeeId]:employee},assignments:[]};let scope=['Test A'];let writes=0;
const context={reportHubRecipientKeys:[],atlasSharedData:shared,normalizeAtlasSharedData:v=>v,getReportHubMonthIndex:()=>9,getAtlasTodayISODate:()=> '2026-10-19',getReportableCommunityNames:()=>scope,getSharedAssignmentsForCommunity:name=>name==='Test A'?[{employeeId,bonusRoleType:'gm'}]:[],isSharedPeopleEmployeeActive:e=>e.status==='Active',atlasNormalizeSharedEmail:v=>String(v||'').trim().toLowerCase(),atlasIsValidSharedEmail:v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),atlasEmployeeEmailIsInternal:v=>v.endsWith('@risere.com'),getReportBuilderScopedDetails:()=>[{name:'Test A',record:{investorEmailContacts:[{name:'Investor',email:'NEW@risere.com'}]}}],normalizeInvestorEmailContacts:v=>v,persistOpsGlobalData:()=>writes++,renderTab:()=>{}};
vm.createContext(context);vm.runInContext(['getCurrentReportRosterContacts','getWorkspaceScopedRecipientContacts','ensureReportHubRecipientSelection','getReportHubSelectedRecipientEmails','toggleReportHubRecipient','setAllReportHubRecipients'].map(extract).join('\n'),context);
assert.equal(context.ensureReportHubRecipientSelection().length,2);assert.equal(context.reportHubRecipientKeys.length,0);
const key=`Test A::employee::${employeeId}`;context.toggleReportHubRecipient(key);assert.equal(writes,1);assert.equal(context.reportHubRecipientKeys[0],key);
employee.email='changed@risere.com';assert.equal(context.getReportHubSelectedRecipientEmails()[0],'changed@risere.com');
employee.status='Inactive';assert.equal(context.getReportHubSelectedRecipientEmails().length,0);assert.equal(context.reportHubRecipientKeys[0],key);
employee.status='Active';scope=[];assert.equal(context.getReportHubSelectedRecipientEmails().length,0);scope=['Test A'];
context.setAllReportHubRecipients(false);context.ensureReportHubRecipientSelection();assert.equal(context.reportHubRecipientKeys.length,0);
employee.email='new@risere.com';context.setAllReportHubRecipients(true);assert.equal(context.getReportHubSelectedRecipientEmails().length,1);
employee.email='gm@rise.com';assert.equal(context.getCurrentReportRosterContacts('Test A')[0].eligible,false);
assert.match(extract('normalizeOpsGlobalData'),/reportHubRecipientKeys/);assert.match(extract('applyOpsGlobalData'),/reportHubRecipientKeys = normalized.reportHubRecipientKeys/);assert.match(extract('persistOpsGlobalData'),/reportHubRecipientKeys/);
assert.match(extract('defaultDlrDeliverySettings'),/frequencyMode: "manual"/);assert.match(extract('defaultDlrDeliverySettings'),/automationMode: "draft_only"/);assert.match(extract('normalizeDlrDeliverySettings'),/employeeRecipientIds/);
// Persist the actual selector payload, reload it, and resolve the new email.
const persistedContext={applicationResidentDataState:{uploads:[]},serializeJacsTeamBonus:value=>value};
for (const name of ['atlasInvestorPacketState','bonusQuarter','bonusQuarterManualOverride','bonusCalcView','bonusEngineState','jacsTeamBonus','regionalAssignments','salarySecurity','monthlyPresentationCommunities','reportHubCommunityProgressCommunities','reportHubLvrCommunity','weeklyExecutiveEmail','portfolioReportSections','portfolioReportFilters','portfolioReportMode','atlasWorkbookImportMode','portfolioMonthScopeByPeriod','reportHubType','reportHubPerspective','reportHubMonth','reportHubYear','reportRecommendationOverrides','communityCommandState','windowshadeState','atlasSharedData']) persistedContext[name]={};
persistedContext.reportHubRecipientKeys=[key];
persistedContext.applyOpsGlobalData=value=>{persistedContext.opsGlobalData=value;};
let savedSettings;
persistedContext.persistOpsGlobalSnapshot=value=>{savedSettings=JSON.stringify(value);return {ok:true};};
vm.createContext(persistedContext);vm.runInContext(extract('persistOpsGlobalData'),persistedContext);persistedContext.persistOpsGlobalData();
context.reportHubRecipientKeys=JSON.parse(savedSettings).reportHubRecipientKeys;employee.email='updated@risere.com';
assert.equal(context.reportHubRecipientKeys[0],key);assert.equal(context.getReportHubSelectedRecipientEmails()[0],'updated@risere.com');
persistedContext.reportHubRecipientKeys=[];persistedContext.persistOpsGlobalData();assert.deepEqual(JSON.parse(savedSettings).reportHubRecipientKeys,[]);
const deliveryContext={normalizeEmailListInput:value=>value};vm.createContext(deliveryContext);vm.runInContext(extract('defaultDlrDeliverySettings')+'\n'+extract('normalizeDlrDeliverySettings'),deliveryContext);
const savedDelivery=JSON.parse(JSON.stringify(deliveryContext.normalizeDlrDeliverySettings({employeeRecipientIds:[employeeId,employeeId]})));
assert.deepEqual(savedDelivery.employeeRecipientIds,[employeeId]);assert.equal(savedDelivery.frequencyMode,'manual');assert.equal(savedDelivery.automationMode,'draft_only');
assert.deepEqual(JSON.parse(JSON.stringify(deliveryContext.normalizeDlrDeliverySettings(savedDelivery))).employeeRecipientIds,[employeeId]);
// Regional Manager is a reporting role even when it has no bonus role type.
context.getSharedAssignmentsForCommunity=()=>[{employeeId,bonusRoleType:'',title:'Regional Manager'}];
context.normalizeDlrDeliverySettings=deliveryContext.normalizeDlrDeliverySettings;
vm.runInContext(extract('resolveDlrRoleRecipientEntries'),context);
assert.equal(context.resolveDlrRoleRecipientEntries('Test A',{roleRecipients:['regional_manager']})[0].email,'updated@risere.com');
rows=[{employee_id:employeeId,community_id:id,employment_status:'Active',effective_start:'2026-01-01',atlas_employees:{employee_id:employeeId,email:'updated@risere.com',status:'Active'},atlas_roles:{bonus_role_type:null,role_code:'regional_manager'}}];
assert.deepEqual((await resolveCurrentDlrRecipients({...subscription,recipient_config:{employeeRecipientIds:[],roleRecipients:['regional_manager'],toInvestorContacts:false}},query,'2026-10-19')).to,['updated@risere.com']);
// Exercise the real central-load -> persist -> apply -> normalize path. Regional
// reporting roles must survive repeated hydration without entering bonus input.
const regionalId='00000000-0000-0000-0000-000000000004';
const centralRow=(who,title,bonusRoleType)=>({assignment_id:who+'-assignment',effective_start:'2026-01-01',employment_status:'Active',title,
  atlas_employees:{employee_id:who,full_name:title,email:who===regionalId?'regional@risere.com':'gm@risere.com',status:'Active'},
  atlas_communities:{community_id:id,display_name:'Test A'},atlas_roles:{title,bonus_role_type:bonusRoleType}});
let loadedRows=[centralRow(employeeId,'General Manager','gm'),centralRow(regionalId,'Regional Manager',null)],persistedRoster;
const pipeline={...persistedContext,Date,DOMException,Map,Set,ATLAS_SHARED_DATA_SCHEMA_VERSION:1,SHARED_BONUS_ROLE_LABELS:{gm:'General Manager'},
  SHARED_ASSIGNMENT_END_DATE_FIELDS:['effectiveEnd','assignmentEndDate','endDate'],PROPERTY_TEAM_ROLE_ORDER:['gm'],BONUS_QUARTERS:['Q1','Q2','Q3','Q4'],
  currentMonth:9,DEFAULT_CURRENT_MONTH:9,ATLAS_STATE_DB_NAME:'test-scope',atlasWorkspaceAccess:{validated:true,epoch:1},atlasCentralPeopleLoadPromise:null,
  window:{ATLAS_CENTRAL:{getAccessContextKey:()=> 'actor',getSession:()=>({user:{id:'actor'}}),fetchJson:async()=>structuredClone(loadedRows)}},
  getAtlasRenderContextKey:()=> 'scope',getAtlasCentralStatus:()=>({configured:true,signedIn:true}),getAtlasTodayISODate:()=> '2026-10-19',
  getBonusQuarterForMonth:()=> 'Q4',getReportHubMonthIndex:()=>9,getReportableCommunityNames:()=>['Test A'],findCanonicalCommunityName:x=>x,
  getBonusAssignmentAsOfDate:()=> '2026-10-19',validateAtlasSharedData:()=>[],syncAllCommunityStaffingFromPeopleRoster:()=>{},syncMonthlyTemplateImportTarget:()=>{},
  clampNumber:(v,min,max)=>Math.min(max,Math.max(min,v)),serializeJacsTeamBonus:x=>x,atlasNormalizeSharedEmail:context.atlasNormalizeSharedEmail,
  atlasIsValidSharedEmail:context.atlasIsValidSharedEmail,atlasEmployeeEmailIsInternal:context.atlasEmployeeEmailIsInternal,
  persistOpsGlobalSnapshot:value=>{persistedRoster=JSON.parse(JSON.stringify(value));return {ok:true};},renderTab:()=>{}};
for(const name of ['normalizeBonusEngineState','normalizeJacsTeamBonus','normalizeRegionalAssignments','normalizeSalarySecurity','normalizeMonthlyPresentationCommunities','normalizeCommunityProgressReportCommunities','normalizeWeeklyExecutiveEmailSettings','normalizePortfolioReportSections','normalizePortfolioMonthScopeByPeriod','normalizeReportHubType','normalizeReportHubPerspective','normalizeReportRecommendationOverrides','normalizeApplicationResidentDataState','normalizeCommunityCommandState','normalizeWindowshadeState'])pipeline[name]=v=>v||{};
pipeline.defaultPortfolioReportFilters=()=>({});
vm.createContext(pipeline);
vm.runInContext(['simpleHash','normalizeSharedDate','sharedDateTime','getSharedDateFromEmployee','inferSharedBonusRoleType','defaultAtlasSharedData','normalizeAtlasBonusBoolean','normalizeSharedEmployeeRecord','normalizeSharedAssignmentRecord','normalizeAtlasSharedData','makeSharedAssignmentId','isSharedPeopleEmployeeActive','isSharedAssignmentActiveOnDate','getSharedAssignmentsForCommunity','normalizeOpsGlobalData','applyOpsGlobalData','persistOpsGlobalData','loadAtlasCentralPeopleAssignments','getCurrentReportRosterContacts'].map(extract).join('\n'),pipeline);
pipeline.atlasSharedData=pipeline.defaultAtlasSharedData();
assert.equal((await pipeline.loadAtlasCentralPeopleAssignments({employeeIds:[employeeId,regionalId]})).employees,2);
assert.deepEqual(Array.from(pipeline.getCurrentReportRosterContacts('Test A'),x=>x.roleKey).sort(),['gm','regional_manager']);
assert.equal(pipeline.atlasSharedData.assignments.length,1);assert.equal(pipeline.atlasSharedData.assignments[0].bonusRoleType,'gm');
assert.equal(pipeline.atlasSharedData.reportingAssignments.length,1);assert.equal(pipeline.atlasSharedData.reportingAssignments[0].bonusRoleType,'');
const bonusBefore=JSON.stringify(pipeline.atlasSharedData.assignments);
pipeline.applyOpsGlobalData(persistedRoster);pipeline.persistOpsGlobalData();pipeline.applyOpsGlobalData(persistedRoster);
assert.equal(JSON.stringify(pipeline.atlasSharedData.assignments),bonusBefore,'persist and hydration do not expand bonus input');
assert.equal(pipeline.getSharedAssignmentsForCommunity('Test A').length,1,'bonus/staffing readers still exclude roleless reporting assignments');
assert.equal(pipeline.getCurrentReportRosterContacts('Test A').find(x=>x.employeeId===regionalId).email,'regional@risere.com');
for(const change of [a=>a.status='Inactive',a=>a.recordStatus='superseded',a=>a.effectiveEnd='2026-10-18',a=>a.effectiveStart='2026-10-20',a=>a.communityName='Test B']){
  const prior=structuredClone(pipeline.atlasSharedData.reportingAssignments);change(pipeline.atlasSharedData.reportingAssignments[0]);
  assert.equal(pipeline.getCurrentReportRosterContacts('Test A').some(x=>x.employeeId===regionalId),false);pipeline.atlasSharedData.reportingAssignments=prior;
}
loadedRows=[];await pipeline.loadAtlasCentralPeopleAssignments({employeeIds:[regionalId]});
assert.equal(pipeline.atlasSharedData.reportingAssignments.length,0,'scoped central removal clears the old reporting role');
assert.equal(JSON.stringify(pipeline.atlasSharedData.assignments),bonusBefore,'scoped reporting removal preserves other bonus assignments');
loadedRows=[centralRow(regionalId,'Regional Manager',null)];await pipeline.loadAtlasCentralPeopleAssignments({employeeIds:[regionalId]});
loadedRows=[];await pipeline.loadAtlasCentralPeopleAssignments();
assert.equal(pipeline.atlasSharedData.reportingAssignments.length,0,'full central refresh removes missing reporting roles');
const worker=fs.readFileSync(new URL('../src/worker.mjs',import.meta.url),'utf8');assert.match(worker,/resolverVersion === 1[\s\S]*?await resolveCurrentDlrRecipients/);
console.log('PASS current roster email changes, active/authorized community scope, missing/invalid contacts, exact current investor setup, case-insensitive dedupe, stable persisted selections, empty stays empty, manual defaults');
