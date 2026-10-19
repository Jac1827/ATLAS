import assert from 'node:assert/strict';
import {normalizeReportSchedule,reportScheduleSlot,dispatchScheduledReport,prepareScheduledReport,handleReportAutomation,readScheduledAccounting,reportActorAuthorized} from '../src/report-automation.mjs';
const cid='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',uid='20000000-0000-4000-8000-000000000001',eid='30000000-0000-4000-8000-000000000001',sid='40000000-0000-4000-8000-000000000001';
const defaults=normalizeReportSchedule({reportType:'rise_weekly_leasing'});
assert.equal(defaults.mode,'manual');assert.deepEqual(defaults.recipient_config.employeeRecipientIds,[]);assert.equal(defaults.recipient_config.toInvestorContacts,false);
assert.throws(()=>normalizeReportSchedule({reportType:'monthly_investor_deck'}),/supports/);
assert.throws(()=>normalizeReportSchedule({reportType:'rise_weekly_leasing',mode:'automated'}),/Select recipients/);
assert.throws(()=>normalizeReportSchedule({reportType:'rise_weekly_leasing',sendTime:'25:30'}),/valid delivery time/);
assert.throws(()=>normalizeReportSchedule({reportType:'rise_weekly_leasing',timezone:'invalid'}),/time zone/);
const schedule={...defaults,mode:'automated',report_subscription_id:sid,version:1,community_id:cid,community_name:'Synthetic A',updated_by:uid,frequency:'daily',recipient_config:{...defaults.recipient_config,employeeRecipientIds:[eid]}};
assert.equal(reportScheduleSlot(schedule,new Date('2026-03-08T11:59:00Z')).due,false);
assert.equal(reportScheduleSlot(schedule,new Date('2026-03-08T12:00:00Z')).due,true);
assert.equal(reportScheduleSlot(schedule,new Date('2026-11-01T13:00:00Z')).due,true);
const monthly={...schedule,frequency:'monthly',month_day:31,period_policy:'previous_month'};
assert.deepEqual(reportScheduleSlot(monthly,new Date('2026-02-28T13:00:00Z')),{due:true,date:'2026-02-28',period:'2026-01'});
assert.equal(reportScheduleSlot(monthly,new Date('2026-03-30T13:00:00Z')).due,false);
assert.equal(reportScheduleSlot({...monthly,month_day:1},new Date('2027-01-01T13:00:00Z')).period,'2026-12');
const parent={document_key:'atlas_dashboard_state_v1',version:9,updated_at:'2026-10-19T10:00:00Z',archiveHash:'a'.repeat(64)};
const source={documentKey:parent.document_key,version:9,effectiveAt:parent.updated_at,archiveHash:parent.archiveHash};
const report={subject:'Synthetic report',html:'<p>Source-backed 0</p>',text:'Source-backed 0',readiness:{ready:true,issues:[]}};
const now=new Date('2026-10-19T13:00:00Z');
function harness(){
 const history=new Map(),state={schedule:structuredClone(schedule),profile:{status:'active',account_status:'active',role:'regional',allowed_community_ids:[cid]},parent:structuredClone(parent),email:'before@risere.com',sends:0,imports:{}};
 const query=async(path,options={})=>{
  if(path==='/rest/v1/atlas_report_delivery_history'&&options.method==='POST'){
   const key=options.body.report_subscription_id+'|'+options.body.scheduled_date;
   if(history.has(key))throw Object.assign(Error('Unique claim'),{status:409});history.set(key,structuredClone(options.body));return [options.body];
  }
  if(path.startsWith('/rest/v1/atlas_report_delivery_history?')&&options.method==='PATCH'){
   const record=[...history.values()].find(r=>path.includes(r.report_delivery_id));assert(record);if(path.includes('&status=eq.held')&&record.status!=='held')return [];Object.assign(record,options.body);return [record];
  }
  if(path.includes('atlas_user_profiles?'))return [state.profile];
  if(path.includes('atlas_report_subscriptions?'))return [state.schedule];
  if(path.includes('document_key=eq.atlas_dashboard_state_v1'))return [state.parent];
  if(path.includes('document_key=eq.atlas_workspace_projection_v1'))return [{source,communityData:{'Synthetic A':{atlasCommunityId:cid,investorEmailContacts:[{email:'owner@example.com'}]},'Synthetic B':{atlasCommunityId:other,investorEmailContacts:[{email:'wrong@example.com'}]}},opsGlobalData:{},importState:state.imports}];
  if(path.includes('atlas_communities?'))return [{community_id:cid,display_name:'Synthetic A',canonical_name:'synthetic_a',status:'active',market:'Synthetic Market',regional_grouping:'Synthetic Region'}];
  if(path.includes('atlas_employee_assignments?'))return [{community_id:cid,employee_id:eid,effective_start:'2020-01-01',employment_status:'Active',atlas_employees:{employee_id:eid,email:state.email,status:'Active'},atlas_roles:{}}];
  throw Error('Unexpected query '+path);
 };
 const build=async()=>({report,source,parent:structuredClone(parent),recipients:{to:[state.email]},ready:true,issues:[]});
 const send=async message=>{state.sends++;assert.equal(message.to[0],state.email);return {messageId:'synthetic-provider'};};
 return {query,state,history,build,send,fromEmail:'central@risere.com',now};
}
{
 const h=harness();const out=await Promise.all([dispatchScheduledReport(schedule,h),dispatchScheduledReport(schedule,h)]);
 assert.deepEqual(out.map(x=>x.status).sort(),['already_recorded','sent']);assert.equal(h.state.sends,1);assert.equal([...h.history.values()][0].status,'sent');
}
{
 const h=harness();assert.equal((await dispatchScheduledReport({...schedule,mode:'manual'},h)).status,'not_due');assert.equal(h.history.size,0);assert.equal(h.state.sends,0);
}
for(const profile of [{status:'inactive',account_status:'active',role:'admin'},{status:'active',account_status:'activation_pending',role:'admin'},{status:'active',account_status:'active',role:'admin',locked_tab_ids:['8']},{status:'active',account_status:'active',role:'admin',locked_page_keys:['reports']},{status:'active',account_status:'active',role:'regional',allowed_community_ids:[other]},{status:'active',account_status:'active',role:'finance',allowed_region_values:['Another Region']},{status:'active',account_status:'active',role:'viewer',allowed_community_ids:[cid]}]){
 const h=harness();h.state.profile=profile;assert.equal((await dispatchScheduledReport(schedule,h)).status,'held');assert.equal(h.state.sends,0);
}
for(const change of [{role:'viewer'},{role:'community_manager'},{role:'admin',locked_tab_ids:['12']},{role:'admin',locked_page_keys:['budget']}]){
 const h=harness();Object.assign(h.state.profile,change);
 assert.equal(await reportActorAuthorized(h.query,{...schedule,report_type:'investor_community_packet'},{readOnly:true}),false,'manual investor Budget Builder restrictions also apply to automation');
 assert.equal(await reportActorAuthorized(h.query,schedule,{readOnly:true}),true,'financial lock does not block a permitted weekly operating report');
 assert.equal((await dispatchScheduledReport({...schedule,report_type:'investor_community_packet'},h)).status,'held');assert.equal(h.state.sends,0);
}
for(const grant of [{allowed_community_ids:[]},{allowed_community_ids:[],allowed_market_values:['Synthetic Market']}]){
 const h=harness();Object.assign(h.state.profile,{role:'finance'},grant);
 assert.equal(await reportActorAuthorized(h.query,schedule),true);
 assert.equal(await reportActorAuthorized(h.query,{...schedule,report_type:'investor_community_packet'}),false,'finance close RLS requires explicit property even when operating reports allow broad/market access');
}
{
 const h=harness();h.send=async()=>{h.state.sends++;throw Error('Provider response lost');};
 assert.equal((await dispatchScheduledReport(schedule,h)).status,'delivery_uncertain');
 assert.equal((await dispatchScheduledReport(schedule,h)).status,'already_recorded');assert.equal(h.state.sends,1);
}
for(const change of [h=>h.state.schedule.version++,h=>h.state.schedule.mode='manual',h=>h.state.parent.version++]){
 const h=harness(),base=h.build;h.build=async(...args)=>{const p=await base(...args);change(h);return p;};
 assert.equal((await dispatchScheduledReport(schedule,h)).status,'held');assert.equal(h.state.sends,0);
}
{
 const h=harness(),query=h.query;
 h.query=async(path,options)=>{const rows=await query(path,options);if(path.includes('atlas_employee_assignments?'))h.state.parent.version++;return rows;};
 assert.equal((await dispatchScheduledReport(schedule,h)).status,'held');assert.equal(h.state.sends,0,'source change during final current-recipient resolution prevents stale report send');
}
{
 const h=harness(),query=h.query;
 h.query=async(path,options)=>{const rows=await query(path,options);if(path.includes('atlas_employee_assignments?'))h.state.profile.status='disabled';return rows;};
 assert.equal((await dispatchScheduledReport(schedule,h)).status,'held');assert.equal(h.state.sends,0,'actor revoked during final recipient lookup cannot send');
}
{
 const h=harness();h.build=async()=>({ready:false,issues:['Box Score stale'],source});
 assert.equal((await dispatchScheduledReport(schedule,h)).status,'held');assert.equal(h.state.sends,0);
}
{
 const h=harness(),ready=h.build;h.build=async()=>({ready:false,issues:['Source unavailable'],source});
 await dispatchScheduledReport(schedule,h);const held=structuredClone([...h.history.values()][0]);h.build=ready;
 const retried=await Promise.all([dispatchScheduledReport(schedule,{...h,heldDelivery:held}),dispatchScheduledReport(schedule,{...h,heldDelivery:held})]);
 assert.deepEqual(retried.map(r=>r.status).sort(),['already_recorded','sent']);assert.equal(h.state.sends,1);
 await assert.rejects(()=>dispatchScheduledReport(schedule,{...h,heldDelivery:{...held,status:'sending'}}),/Only a held delivery/);
}
{
 const h=harness(),fields={total_units:100,rentable_units:90,occupied_units:81,new_leads:0,applications:0,leases_completed:0};
 const base={currentState:true,communityName:'Synthetic A',periodKey:'2026-10',reportType:'box_score',fileHash:parent.archiveHash,sourceFile:'Synthetic Box.xlsx',dataAsOf:'2026-10-19'};
 h.state.imports={lineage:Object.entries(fields).map(([atlasField,importedValue])=>({...base,atlasField,importedValue})),canonicalRecords:[{...base,values:{measurement_basis:'units'}}]};
 delete h.build;
 const prepared=await prepareScheduledReport(h.query,schedule,reportScheduleSlot(schedule,now));
 assert.equal(prepared.ready,true,prepared.issues.join('; '));assert.match(prepared.report.text,/Physical occupancy: 90%/);assert.match(prepared.report.text,/New leases signed: 0/);
 assert.equal((await dispatchScheduledReport(schedule,h)).status,'sent');assert.equal(h.state.sends,1,'complete default builder pipeline sends only with verified evidence');
}
{
 const h=harness(),slot=reportScheduleSlot(schedule,now);
 const a=await prepareScheduledReport(h.query,schedule,slot,()=>report);assert.equal(a.ready,true);assert.deepEqual(a.recipients.to,['before@risere.com']);
 h.state.email='current@risere.com';const b=await prepareScheduledReport(h.query,schedule,slot,()=>report);assert.deepEqual(b.recipients.to,['current@risere.com']);
 const c=await prepareScheduledReport(h.query,{...schedule,recipient_config:{toInvestorContacts:true}},slot,()=>report);assert.deepEqual(c.recipients.to,['owner@example.com']);
 h.state.parent.version++;await assert.rejects(()=>prepareScheduledReport(h.query,schedule,slot,()=>report),/current published workspace/);
}
// API scope is resolved before even reading another community's schedule.
{
 let reads=0,checked=0;
 const deps={requireAtlasAccessUser:async()=>({user:{id:uid},config:{}}),community:async()=>{checked++;throw Object.assign(Error('Out of scope'),{status:403});},supabaseRequest:async()=>{reads++;},apiResponse:(value,options={})=>({value,status:options.status||200})};
 const response=await handleReportAutomation(new Request('https://synthetic/api',{method:'POST',body:JSON.stringify({action:'status',communityId:other,reportType:'rise_weekly_leasing'})}),{},deps);
 assert.equal(response.status,403);assert.equal(checked,1);assert.equal(reads,0);
}
// No-head is missing evidence; immutable accounting rows must match the exact
// community, approved version and expected count, and reopened months hold.
{
 assert.equal((await readScheduledAccounting(async()=>[],schedule,'2026-09')).evidence,null);
 const version='50000000-0000-4000-8000-000000000001';let reopen=false,bad=false;
 const query=async path=>path.includes('close_heads?')?[{community_id:cid,period_key:'2026-09',version_id:version}]:path.includes('close_versions?')?[{version_id:version,community_id:cid,period_key:'2026-09',status:'closed',coverage:'full_month',accounting_basis:'accrual',approved_by:uid,approved_at:'2026-10-01T00:00:00Z',source_file:'synthetic.xlsx',source_hash:'b'.repeat(64),content_hash:'c'.repeat(64),row_count:1}]:path.includes('actual_period_events?')?(reopen?[{action:'reopened',created_at:'2026-10-02T00:00:00Z'}]:[]):[{version_id:version,community_id:bad?other:cid,gl_code:'4000',section:'Operating Income',actual:0}];
 assert.equal((await readScheduledAccounting(query,schedule,'2026-09')).evidence.monthlyLedger[0].actual,0);
 bad=true;await assert.rejects(()=>readScheduledAccounting(query,schedule,'2026-09'),/incomplete/);bad=false;reopen=true;await assert.rejects(()=>readScheduledAccounting(query,schedule,'2026-09'),/reopened/);
}
{
 const h=harness();let persisted=null,revokeDuringPreparation=false,revokeDuringRetryLookup=false;
 const deps={
  requireAtlasAccessUser:async(_request,_env,roles)=>{if(roles&&!roles.has(h.state.profile.role))throw Object.assign(Error('Role denied'),{status:403});return {user:{id:uid},config:{}};},
  community:async(_access,body)=>{if(body.communityId!==cid)throw Object.assign(Error('Out of scope'),{status:403});return {community_id:cid,display_name:'Synthetic A'};},
  apiResponse:(value,options={})=>({value,status:options.status||200}),
  supabaseRequest:async(_config,path,options={})=>{
   if(path.includes('atlas_report_subscriptions')){
    if(options.method==='POST'){persisted={...structuredClone(options.body),report_subscription_id:sid};return [persisted];}
    if(options.method==='PATCH'){if(!path.includes(`version=eq.${persisted.version}`))return [];persisted={...persisted,...structuredClone(options.body)};return [persisted];}
    return persisted?[persisted]:[];
   }
   if(path.includes('atlas_report_delivery_history')){
    if(revokeDuringRetryLookup&&path.includes('status=eq.held')){h.state.profile.status='disabled';return [{report_delivery_id:sid,report_subscription_id:sid,status:'held',community_id:cid,report_type:'rise_weekly_leasing',scheduled_date:'2026-10-19',reporting_period:'2026-10'}];}
    return [];
   }
   const result=await h.query(path,options);if(revokeDuringPreparation&&path.includes('document_key=eq.atlas_workspace_projection_v1'))h.state.profile.status='disabled';return result;
  }
 };
 const call=body=>handleReportAutomation(new Request('https://synthetic/api',{method:'POST',body:JSON.stringify({communityId:cid,communityName:'Synthetic A',reportType:'rise_weekly_leasing',...body})}),{},deps);
 let response=await call({action:'save',expectedVersion:0});assert.equal(response.status,200);assert.equal(persisted.mode,'manual');assert.deepEqual(persisted.recipient_config.employeeRecipientIds,[]);
 response=await call({action:'save',expectedVersion:1,mode:'automated',employeeRecipientIds:[eid],frequency:'monthly',monthDay:28});assert.equal(response.status,200);assert.equal(persisted.version,2);assert.equal(persisted.frequency,'monthly');assert.equal(persisted.mode,'automated');assert.equal(h.state.sends,0,'saving a schedule never immediately sends');
 response=await call({action:'status'});assert.equal(response.value.subscription.version,2);assert.deepEqual(response.value.subscription.recipient_config.employeeRecipientIds,[eid]);
 revokeDuringRetryLookup=true;assert.equal((await call({action:'retry_held',deliveryId:sid,expectedVersion:2})).status,403,'retry caller revoked during held lookup cannot invoke still-active owner schedule');revokeDuringRetryLookup=false;h.state.profile.status='active';
 assert.equal((await call({action:'save',expectedVersion:1})).status,409,'stale editor cannot overwrite current schedule');
 h.state.profile.account_status='password_reset_required';assert.equal((await call({action:'status'})).status,403,'account recovery state cannot read report history');
 h.state.profile.account_status='active';h.state.profile.allowed_community_ids=[other];assert.equal((await call({action:'preview'})).status,403,'revoked current grant blocks preview before source access');
 h.state.profile.allowed_community_ids=[cid];
 for(const role of ['viewer','community_manager']){h.state.profile.role=role;for(const action of ['status','preview','save','retry_held'])assert.equal((await call({action,reportType:'investor_community_packet',expectedVersion:2})).status,403,'financially unauthorized actor denied before accounting query');}
 h.state.profile.role='regional';revokeDuringPreparation=true;
 const revoked=await call({action:'preview'});assert.equal(revoked.status,403);assert.equal(revoked.value.report,undefined,'revoked access cannot receive a completed report preview');
}
console.log('PASS manual defaults, cadence/month-end/DST, current contacts, scoped authorization, concurrent claim, source/config recheck, stale holds, provider uncertainty, approved accounting identity');
