import {resolveCurrentDlrRecipients} from './dlr-current-recipients.mjs';
import {buildScheduledReport} from './scheduled-report-content.mjs';

export const REPORT_TYPES = ['rise_weekly_leasing', 'investor_community_packet'];
const WRITE_ROLES = new Set(['admin','centra','executive','finance','regional','community_manager']);
const BROAD_ROLES = new Set(['admin','centra','executive','finance']);
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
const fail = (message,status=400) => Object.assign(new Error(message),{status});
const first = rows => Array.isArray(rows) ? rows[0] : null;
const parentPath = '/rest/v1/atlas_app_documents?document_key=eq.atlas_dashboard_state_v1&module_key=eq.dashboard&deleted_at=is.null&select=document_key,version,updated_at,archiveHash:payload->bundle->>sha256&limit=1';

export function normalizeReportSchedule(input = {}) {
  if (!REPORT_TYPES.includes(input.reportType)) throw fail('Automated delivery supports RISE Weekly Leasing and Investor Community Packet as HTML reports.');
  const mode = input.mode || 'manual', frequency = input.frequency || 'weekly';
  if (!['manual','automated'].includes(mode) || !['daily','weekly','monthly'].includes(frequency)) throw fail('Choose a valid delivery mode and frequency.');
  const timezone = input.timezone || 'America/New_York';
  try { new Intl.DateTimeFormat('en-US',{timeZone:timezone}).format(); } catch { throw fail('Choose a valid time zone.'); }
  const sendTime = input.sendTime || '08:00';
  if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(sendTime)) throw fail('Choose a valid delivery time.');
  const integer = (value,fallback,min,max) => { const n=value===undefined?fallback:Number(value);if(!Number.isInteger(n)||n<min||n>max)throw fail('A schedule setting is outside its allowed range.');return n; };
  const periodPolicy = input.periodPolicy || 'current_month';
  if (!['current_month','previous_month'].includes(periodPolicy)) throw fail('Choose the current or previous reporting month.');
  const selected = input.employeeRecipientIds || [];
  if (!Array.isArray(selected) || selected.length > 100 || selected.some(id=>!uuid(id))) throw fail('Choose employees from the current roster.');
  const recipients = {resolverVersion:1,toInvestorContacts:input.toInvestorContacts===true,employeeRecipientIds:[...new Set(selected)],roleRecipients:[],cc:[],bcc:[]};
  if (mode==='automated'&&!recipients.toInvestorContacts&&!recipients.employeeRecipientIds.length) throw fail('Select recipients before saving automated delivery.');
  return {report_type:input.reportType,mode,frequency,weekday:integer(input.weekday,1,0,6),month_day:integer(input.monthDay,1,1,31),send_time:sendTime,timezone,
    period_policy:periodPolicy,max_source_age_days:integer(input.maxSourceAgeDays,7,1,31),recipient_config:recipients};
}

export function reportScheduleSlot(schedule, now = new Date()) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:schedule.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
  const date=`${parts.year}-${parts.month}-${parts.day}`, period=`${parts.year}-${parts.month}`;
  const day=Number(parts.day), utc=new Date(`${date}T12:00:00Z`), daysInMonth=new Date(Date.UTC(Number(parts.year),Number(parts.month),0)).getUTCDate();
  const time=Number(parts.hour)*60+Number(parts.minute), target=schedule.send_time.split(':').map(Number);
  let due=schedule.mode==='automated'&&time>=target[0]*60+target[1];
  if(schedule.frequency==='weekly')due=due&&utc.getUTCDay()===schedule.weekday;
  if(schedule.frequency==='monthly')due=due&&day===Math.min(schedule.month_day,daysInMonth);
  let reportingPeriod=period;
  if(schedule.period_policy==='previous_month') { const d=new Date(Date.UTC(Number(parts.year),Number(parts.month)-2,1));reportingPeriod=d.toISOString().slice(0,7); }
  return {due,date,period:reportingPeriod};
}

export async function readCurrentReportSource(query, subscription) {
  const parent=first(await query(parentPath));
  if(!parent||!/^[a-f0-9]{64}$/.test(parent.archiveHash||''))throw Error('Current published workspace evidence is unavailable.');
  const key=`atlas_workspace_projection_v1:${parent.archiveHash}:${parent.version}`;
  const projection=first(await query(`/rest/v1/atlas_app_documents?document_key=eq.${encodeURIComponent(key)}&module_key=eq.dashboard&source_module=eq.workspace_projection&deleted_at=is.null&select=source:payload->source,communityData:payload->communityData,opsGlobalData:payload->opsGlobalData,importState:payload->importState&limit=1`));
  const source=projection?.source;
  if(!source||source.documentKey!==parent.document_key||source.version!==parent.version||source.archiveHash!==parent.archiveHash||Date.parse(source.effectiveAt)!==Date.parse(parent.updated_at))throw Error('The report projection does not match the current published workspace.');
  const communities=await query(`/rest/v1/atlas_communities?community_id=eq.${subscription.community_id}&deleted_at=is.null&select=community_id,display_name,canonical_name&limit=2`);
  const community=first(communities);
  if(communities?.length!==1||![community.display_name,community.canonical_name].includes(subscription.community_name))throw Error('The scheduled community identity changed.');
  const matches=Object.entries(projection.communityData||{}).filter(([name,record])=>{
    if(!record||typeof record!=='object')return false;
    const ids=[record.atlasCommunityId,record.sourceIds?.atlasCommunityId,uuid(record.communityId)?record.communityId:''].filter(Boolean);
    return ids.length?ids.every(id=>id===subscription.community_id):[community.display_name,community.canonical_name].includes(name);
  });
  if(matches.length!==1)throw Error('The current workspace does not have one exact report community match.');
  const [name,record]=matches[0];
  return {record,source,parent,imports:projection.importState,packetSettings:projection.opsGlobalData?.investorPacketState?.communities?.[name]||{}};
}

export async function reportActorAuthorized(query, subscription, {readOnly=false}={}) {
  if(!uuid(subscription.updated_by))return false;
  const profile=first(await query(`/rest/v1/atlas_user_profiles?user_id=eq.${subscription.updated_by}&select=user_id,role,status,account_status,allowed_community_ids,allowed_market_values,allowed_region_values,locked_tab_ids,locked_page_keys&limit=1`));
  if(profile?.status!=='active'||profile.account_status!=='active'||(!WRITE_ROLES.has(profile.role)&&!(readOnly&&profile.role==='viewer'))||(profile.locked_tab_ids||[]).map(String).includes('8')||(profile.locked_page_keys||[]).includes('reports'))return false;
  // Match the manual investor packet's Budget Builder access check before
  // using service credentials to read closed accounting detail.
  if(subscription.report_type==='investor_community_packet'&&(!['admin','centra','executive','regional','finance'].includes(profile.role)||(profile.locked_tab_ids||[]).map(String).includes('12')||(profile.locked_page_keys||[]).includes('budget')))return false;
  // Approved-close RLS uses atlas_can_access_community: these three roles or
  // an explicit property ID. A finance role/market grant alone is insufficient.
  if(subscription.report_type==='investor_community_packet'&&!['admin','centra','executive'].includes(profile.role)&&!(profile.allowed_community_ids||[]).includes(subscription.community_id))return false;
  const community=first(await query(`/rest/v1/atlas_communities?community_id=eq.${subscription.community_id}&deleted_at=is.null&select=community_id,status,market,regional_grouping&limit=1`));
  if(!community||community.community_id!==subscription.community_id)return false;
  if(profile.role==='admin')return true;
  const ids=profile.allowed_community_ids||[],markets=(profile.allowed_market_values||[]).map(v=>String(v).trim().toLowerCase()),regions=(profile.allowed_region_values||[]).map(v=>String(v).trim().toLowerCase());
  if(community.status!=='active'&&!ids.includes(subscription.community_id))return false;
  if(ids.length||markets.length||regions.length)return ids.includes(subscription.community_id)||markets.includes(String(community.market||'').trim().toLowerCase())||regions.includes(String(community.regional_grouping||community.market||'').trim().toLowerCase());
  return BROAD_ROLES.has(profile.role);
}

export async function readScheduledAccounting(query,subscription,period) {
  const headPath=`/rest/v1/atlas_financial_close_heads?community_id=eq.${subscription.community_id}&accounting_basis=eq.accrual&period_key=eq.${period}&select=community_id,period_key,version_id&limit=2`;
  const heads=await query(headPath),head=first(heads);
  if(!heads?.length)return {evidence:null,guards:[]};
  if(heads.length!==1||head.community_id!==subscription.community_id||head.period_key!==period||!uuid(head.version_id))throw Error('The accounting close identity is ambiguous.');
  const versions=await query(`/rest/v1/atlas_financial_close_versions?version_id=eq.${head.version_id}&select=version_id,community_id,period_key,status,coverage,source_hash,content_hash,source_file,approved_at,approved_by,accounting_basis,row_count&limit=2`),v=first(versions);
  if(versions?.length!==1||v.community_id!==subscription.community_id||v.period_key!==period||v.version_id!==head.version_id||v.status!=='closed'||v.coverage!=='full_month'||v.accounting_basis!=='accrual'||!uuid(v.approved_by)||!Number.isFinite(Date.parse(v.approved_at))||!v.source_file||!v.source_hash||!/^[a-f0-9]{64}$/i.test(v.content_hash||'')||!Number.isInteger(v.row_count)||v.row_count<1||v.row_count>10000)throw Error('Approved accounting evidence is incomplete.');
  const eventPath=`/rest/v1/atlas_actual_period_events?version_id=eq.${v.version_id}&community_id=eq.${subscription.community_id}&period_key=eq.${period}&select=action,created_at&order=created_at.desc&limit=2`;
  const events=await query(eventPath),event=first(events);
  if(events?.some(row=>!['reopened','relocked'].includes(row.action)||!Number.isFinite(Date.parse(row.created_at)))||(events?.length===2&&events[0].created_at===events[1].created_at))throw Error('Accounting lock evidence is ambiguous.');
  const guards=[{path:headPath,value:heads},{path:eventPath,value:events}];
  if(event?.action==='reopened')throw Error('The accounting period is reopened and must be relocked before automated investor delivery.');
  const rows=[];
  for(let offset=0;offset<v.row_count;offset+=500)rows.push(...await query(`/rest/v1/atlas_financial_close_rows?version_id=eq.${v.version_id}&select=version_id,community_id,gl_code,account_name,section,actual,source_location&order=gl_code&limit=500&offset=${offset}`));
  if(rows.length!==v.row_count||new Set(rows.map(row=>row.gl_code)).size!==rows.length||rows.some(row=>row.version_id!==v.version_id||row.community_id!==subscription.community_id||!row.gl_code||row.actual===null||row.actual===''||!Number.isFinite(Number(row.actual))))throw Error('Approved accounting detail readback is incomplete.');
  const [year,month]=period.split('-').map(Number),asOf=new Date(Date.UTC(year,month,0,12)).toISOString();
  return {guards,evidence:{id:v.version_id,closeVersionId:v.version_id,reportType:'approved_accounting',importStatus:'Approved',communityName:subscription.community_name,communities:[subscription.community_name],reportingPeriodLabel:period,fileName:v.source_file,fileHash:v.source_hash,contentHash:v.content_hash,dataDateIso:asOf,uploadedAt:v.approved_at,metadata:{dataAsOf:asOf,receivedAt:v.approved_at},accountingReopened:false,evidenceOrigin:'central_close',monthlyLedger:rows.map(row=>({glCode:row.gl_code,description:row.account_name,section:row.section,actual:Number(row.actual),monthlyActual:Number(row.actual),sourceLocation:row.source_location}))}};
}

export async function prepareScheduledReport(query, subscription, slot, build=buildScheduledReport) {
  const current=await readCurrentReportSource(query,subscription);
  const accounting=subscription.report_type==='investor_community_packet'?await readScheduledAccounting(query,subscription,slot.period):{evidence:null,guards:[]};
  const report=build({type:subscription.report_type,communityName:subscription.community_name,record:current.record,period:slot.period,localDate:slot.localDate||slot.date,source:current.source,maxSourceAgeDays:subscription.max_source_age_days,packetSettings:current.packetSettings,imports:current.imports,accountingEvidence:accounting.evidence});
  const recipients=await resolveCurrentDlrRecipients(subscription,query,slot.localDate||slot.date);
  const issues=[...(report.readiness?.issues||[])];
  if(!report.readiness?.ready&&!issues.length)issues.push('The report is not ready for automated delivery.');
  if(!recipients.to.length)issues.push('No eligible current recipients remain selected.');
  if(recipients.to.length>50)issues.push('More than 50 recipients are selected; narrow this community delivery.');
  const latest=first(await query(parentPath));
  if(JSON.stringify(latest)!==JSON.stringify(current.parent))issues.push('The published workspace changed during report preparation.');
  for(const guard of accounting.guards)if(JSON.stringify(await query(guard.path))!==JSON.stringify(guard.value))issues.push('The approved accounting source changed during report preparation.');
  if(JSON.stringify(report).length>1500000)issues.push('The report exceeds the supported email content size.');
  return {report,recipients,source:{...current.source,...(accounting.evidence?{accountingVersion:accounting.evidence.closeVersionId,accountingContentHash:accounting.evidence.contentHash}:{})},parent:current.parent,evidenceGuards:accounting.guards,issues,ready:issues.length===0};
}

export async function dispatchScheduledReport(subscription, {query,send,fromEmail,now=new Date(),build=prepareScheduledReport,heldDelivery=null}) {
  let slot=reportScheduleSlot(subscription,now);
  if(heldDelivery&&subscription.mode==='automated')slot={...slot,due:true,localDate:slot.date,date:heldDelivery.scheduled_date,period:heldDelivery.reporting_period};
  if(!slot.due)return {status:'not_due'};
  const id=heldDelivery?.report_delivery_id||crypto.randomUUID(), historyPath=`/rest/v1/atlas_report_delivery_history?report_delivery_id=eq.${id}`;
  try {
    if(heldDelivery){
      if(heldDelivery.status!=='held'||heldDelivery.report_subscription_id!==subscription.report_subscription_id||heldDelivery.community_id!==subscription.community_id||heldDelivery.report_type!==subscription.report_type)throw Error('Only a held delivery for this saved schedule can be retried.');
      const claimed=await query(`${historyPath}&status=eq.held`,{method:'PATCH',body:{status:'preparing',reason:null,subscription_version:subscription.version,updated_at:now.toISOString()},prefer:'return=representation'});
      if(!claimed?.length)return {status:'already_recorded'};
    } else await query('/rest/v1/atlas_report_delivery_history',{method:'POST',body:{report_delivery_id:id,report_subscription_id:subscription.report_subscription_id,subscription_version:subscription.version,community_id:subscription.community_id,report_type:subscription.report_type,scheduled_date:slot.date,reporting_period:slot.period,status:'preparing'},prefer:'return=representation'});
  } catch(error) { if(error.status===409)return {status:'already_recorded'};throw error; }
  const record=async(status,details={})=>{await query(historyPath,{method:'PATCH',body:{status,updated_at:new Date().toISOString(),...details}});return {status,...(details.reason?{reason:details.reason}:{})};};
  let prepared;
  try {
    if(!await reportActorAuthorized(query,subscription))throw Error('The schedule owner no longer has active access to this community.');
    prepared=await build(query,subscription,slot);
    if(!prepared.ready)return record('held',{reason:prepared.issues.join(' '),source_receipt:prepared.source});
    if(!send||!fromEmail)return record('held',{reason:'Transactional email delivery is not configured.'});
    const current=first(await query(`/rest/v1/atlas_report_subscriptions?report_subscription_id=eq.${subscription.report_subscription_id}&select=*&limit=1`));
    if(!current||current.version!==subscription.version||current.mode!=='automated')throw Error('The schedule changed during preparation.');
    if(!await reportActorAuthorized(query,subscription))throw Error('The schedule owner access changed during preparation.');
    if(JSON.stringify(first(await query(parentPath)))!==JSON.stringify(prepared.parent))throw Error('The source changed before delivery.');
    for(const guard of prepared.evidenceGuards||[])if(JSON.stringify(await query(guard.path))!==JSON.stringify(guard.value))throw Error('The accounting source changed before delivery.');
    prepared.recipients=await resolveCurrentDlrRecipients(subscription,query,slot.localDate||slot.date);
    if(!prepared.recipients.to.length||prepared.recipients.to.length>50)throw Error('Current recipients changed; select between 1 and 50 eligible recipients.');
    if(JSON.stringify(first(await query(parentPath)))!==JSON.stringify(prepared.parent))throw Error('The source changed while resolving current recipients.');
    for(const guard of prepared.evidenceGuards||[])if(JSON.stringify(await query(guard.path))!==JSON.stringify(guard.value))throw Error('The accounting source changed while resolving current recipients.');
    const beforeSend=first(await query(`/rest/v1/atlas_report_subscriptions?report_subscription_id=eq.${subscription.report_subscription_id}&select=version,mode&limit=1`));
    if(beforeSend?.version!==subscription.version||beforeSend?.mode!=='automated')throw Error('The schedule changed while resolving recipients.');
    if(!await reportActorAuthorized(query,subscription))throw Error('Current report or financial access changed before delivery.');
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(prepared.report.html)))).map(x=>x.toString(16).padStart(2,'0')).join('');
    await record('sending',{subject:prepared.report.subject,recipients:prepared.recipients.to,source_receipt:prepared.source,report_hash:hash,report_payload:{html:prepared.report.html,text:prepared.report.text,metadata:prepared.report.metadata||{}}});
  } catch(error) {return record('held',{reason:error.message||'Report preparation failed.'});}
  // The unique history claim precedes the provider call. Uncertain deliveries
  // never retry automatically, including a crash after provider acceptance.
  try {
    const result=await send({from:{email:fromEmail,name:'ATLAS Reports'},to:prepared.recipients.to,subject:prepared.report.subject,html:prepared.report.html,text:prepared.report.text,
      attachments:[{filename:`ATLAS_${subscription.report_type}_${subscription.community_name.replace(/[^a-z0-9]/gi,'_')}_${slot.period}.html`,type:'text/html',disposition:'attachment',content:prepared.report.html}]});
    return await record('sent',{provider_message_id:result?.messageId||null,sent_at:new Date().toISOString()});
  } catch(error) {return record('delivery_uncertain',{reason:`Delivery was attempted. Check provider history before any manual resend. ${error.message||''}`});}
}

export async function processReportSchedules(env, deps, now=new Date()) {
  const config=deps.getAtlasSupabaseConfig(env);
  if(!config.serviceKey)return {checked:0};
  const query=(path,options={})=>deps.supabaseRequest(config,path,{...options,service:true});
  const rows=await query('/rest/v1/atlas_report_subscriptions?mode=eq.automated&select=*&order=report_subscription_id.asc&limit=501');
  if(rows?.length>500)throw Error('Report delivery exceeded the supported schedule count.');
  const results=[];
  for(const subscription of rows||[]) {
    try {results.push(await dispatchScheduledReport(subscription,{query,now,send:env.EMAIL?.send?message=>env.EMAIL.send(message):null,fromEmail:String(env.ATLAS_DLR_FROM_EMAIL||'').trim()}));}
    catch {results.push({status:'error'});}
  }
  return {checked:rows?.length||0,results};
}

export async function handleReportAutomation(request,env,deps) {
  try {
    if(request.method!=='POST')throw fail('Method Not Allowed',405);
    const body=await request.json();
    const action=body?.action;
    if(!['status','save','preview','retry_held'].includes(action))throw fail('Choose a supported report delivery action.');
    const writes=['save','retry_held'].includes(action);
    const access=await deps.requireAtlasAccessUser(request,env,writes?WRITE_ROLES:undefined);
    const community=await deps.community(access,body);
    if(!community?.community_id)throw fail('Choose a recognized community.');
    if(!REPORT_TYPES.includes(body.reportType))throw fail('This report format is available through manual export only.');
    const query=(path,options={})=>deps.supabaseRequest(access.config,path,{...options,service:true});
    const actorScope={community_id:community.community_id,updated_by:access.user.id,report_type:body.reportType};
    if(!await reportActorAuthorized(query,actorScope,{readOnly:!writes}))throw fail('Current account, report access, financial access, or community scope does not permit this delivery request.',403);
    const filter=`community_id=eq.${community.community_id}&report_type=eq.${body.reportType}`;
    const existing=first(await query(`/rest/v1/atlas_report_subscriptions?${filter}&select=*&limit=1`));
    if(action==='status'){
      const history=await query(`/rest/v1/atlas_report_delivery_history?${filter}&select=report_delivery_id,scheduled_date,reporting_period,status,reason,subject,recipients,created_at,sent_at&order=created_at.desc&limit=10`);
      if(!await reportActorAuthorized(query,actorScope,{readOnly:true}))throw fail('Report access changed while reading delivery history.',403);
      return deps.apiResponse({ok:true,subscription:existing,history,capabilities:{email:!!env.EMAIL?.send&&!!env.ATLAS_DLR_FROM_EMAIL}});
    }
    if(action==='retry_held'){
      if(!existing||existing.mode!=='automated'||body.expectedVersion!==existing.version||!uuid(body.deliveryId))throw fail('Reload an automated schedule and choose a held delivery before retrying.',409);
      const held=first(await query(`/rest/v1/atlas_report_delivery_history?report_delivery_id=eq.${body.deliveryId}&report_subscription_id=eq.${existing.report_subscription_id}&status=eq.held&select=*&limit=1`));
      if(!held)throw fail('This delivery is not held. Sending, sent, and uncertain outcomes cannot be retried here.',409);
      if(!await reportActorAuthorized(query,actorScope))throw fail('Your current report access changed before the held delivery could be retried.',403);
      const result=await dispatchScheduledReport(existing,{query,heldDelivery:held,send:env.EMAIL?.send?message=>env.EMAIL.send(message):null,fromEmail:String(env.ATLAS_DLR_FROM_EMAIL||'').trim()});
      return deps.apiResponse({ok:true,result});
    }
    const settings=normalizeReportSchedule(body);
    const candidate={...settings,community_id:community.community_id,community_name:community.display_name,updated_by:access.user.id};
    if(action==='preview') {
      const prepared=await prepareScheduledReport(query,candidate,reportScheduleSlot(candidate,new Date()));
      if(!await reportActorAuthorized(query,actorScope,{readOnly:true}))throw fail('Report access changed during preparation. Reload your access before viewing this report.',403);
      return deps.apiResponse({ok:true,report:prepared.report,recipients:prepared.recipients,source:prepared.source,issues:prepared.issues,ready:prepared.ready});
    }
    const expected=Number(body.expectedVersion);
    if(!Number.isInteger(expected)||expected!==(existing?.version||0))throw fail('This schedule changed. Load its saved settings before saving again.',409);
    if(settings.mode==='automated') {
      const recipients=await resolveCurrentDlrRecipients(candidate,query);
      if(!recipients.to.length||recipients.to.length>50)throw fail('Select between 1 and 50 eligible current recipients before enabling delivery.');
    }
    const record={...candidate,version:expected+1,updated_at:new Date().toISOString()};
    if(!await reportActorAuthorized(query,actorScope))throw fail('Current report access changed before saving.',403);
    let saved;
    if(existing) {
      saved=first(await query(`/rest/v1/atlas_report_subscriptions?report_subscription_id=eq.${existing.report_subscription_id}&version=eq.${expected}`,{method:'PATCH',body:record,prefer:'return=representation'}));
      if(!saved)throw fail('Another editor changed the schedule. Reload its saved settings.',409);
    } else saved=first(await query('/rest/v1/atlas_report_subscriptions',{method:'POST',body:{...record,created_by:access.user.id},prefer:'return=representation'}));
    if(!saved?.report_subscription_id||saved.version!==expected+1)throw fail('The saved delivery settings could not be verified. Reload their server status.',503);
    return deps.apiResponse({ok:true,subscription:saved});
  } catch(error) {return deps.apiResponse({ok:false,error:error.message||'Report delivery request failed.'},{status:error.status||500});}
}
