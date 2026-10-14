import {validateTemplate,missingFields} from '../docs/portfolio-operations-dashboard/features/moveout-documents.mjs';
// Credentials and durable idempotency stay on the server. No live messages are sent by tests.
const roles=new Set(['admin','centra','executive','regional','community_manager']);
const UUID=/^[0-9a-f]{8}-[0-9a-f-]{27}$/i,email=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const mailbox='central@risere.com';
const failure=(message,status=400)=>Object.assign(Error(message),{status});
export function configured(env){return ['ATLAS_MS_TENANT_ID','ATLAS_MS_CLIENT_ID','ATLAS_MS_CLIENT_SECRET'].every(k=>Boolean(env[k]));}
async function boundedBody(request){let size=0,chunks=[];const reader=request.body?.getReader();if(!reader)throw failure('Request body required.');try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>2_000_000){await reader.cancel();throw failure('Document exceeds the 2 MB delivery limit.',413);}chunks.push(value);}}finally{reader.releaseLock();}const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}return JSON.parse(new TextDecoder().decode(bytes));}
const digest=async body=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(body))))).map(b=>b.toString(16).padStart(2,'0')).join('');
const safeText=(value,max=1000)=>{if(typeof value!=='string'||value.length>max)throw failure('Invalid or oversized field.');return value;};
export function validateEmail(body){
 for(const key of ['to','cc'])if(!Array.isArray(body[key])||body[key].length>20||body[key].some(v=>typeof v!=='string'||!email.test(v)))throw failure('Valid recipients are required.');
 if(!body.to.length)throw failure('At least one recipient is required.');safeText(body.subject,250);safeText(body.message,15000);if(!body.subject.trim())throw failure('Email subject is required.');
 if(!body.document||!['mog','ntv','possession'].includes(body.document.kind)||typeof body.document.pdfBase64!=='string'||body.document.pdfBase64.length>1_500_000||!body.document.pdfBase64.startsWith('JVBERi0'))throw failure('A completed PDF document is required.');safeText(body.document.title,150);
}
export function eventBody(body,communityName){
 const a=body.appointment;if(!a||!UUID.test(a.id)||!['field','moveout'].includes(a.kind)||!/^\d{4}-\d{2}-\d{2}$/.test(a.date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(a.time)||!Number.isInteger(Number(a.duration))||Number(a.duration)<15||Number(a.duration)>480)throw failure('Complete the inspection date, time and duration.');
 const zones={'America/New_York':'Eastern Standard Time','America/Chicago':'Central Standard Time','America/Denver':'Mountain Standard Time','America/Los_Angeles':'Pacific Standard Time'};if(!zones[a.timeZone])throw failure('Unsupported calendar time zone.');
 const start=`${a.date}T${a.time}:00`,date=new Date(start+'Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==a.date)throw failure('Invalid date.');const end=new Date(date.getTime()+Number(a.duration)*60000).toISOString().slice(0,19);
 safeText(a.instructions||'',10000);safeText(a.purpose||'',500);safeText(a.unit||'',100);safeText(a.residentName||'',300);
 return {subject:`${a.kind==='field'?'Field Inspection':'Move-Out Inspection'} · ${communityName} · Unit ${a.unit||''}`,body:{contentType:'Text',content:`${a.purpose||''}\nResident: ${a.residentName||''}\n${a.instructions||''}\nATLAS: https://jac1827.github.io/ATLAS/portfolio-operations-dashboard/?tab=15&moveOutCase=${encodeURIComponent(body.caseId)}`},location:{displayName:`${communityName} · Unit ${a.unit||''}`},start:{dateTime:start,timeZone:zones[a.timeZone]},end:{dateTime:end,timeZone:zones[a.timeZone]},transactionId:a.id};
}
async function graphToken(env,fetcher){
 const response=await fetcher(`https://login.microsoftonline.com/${encodeURIComponent(env.ATLAS_MS_TENANT_ID)}/oauth2/v2.0/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.ATLAS_MS_CLIENT_ID,client_secret:env.ATLAS_MS_CLIENT_SECRET,grant_type:'client_credentials',scope:'https://graph.microsoft.com/.default'})});
 if(!response.ok)throw failure('Microsoft application authentication failed. Ask IT to verify the configured credentials and consent.',503);const data=await response.json();if(!data.access_token)throw failure('Microsoft did not return an access token.',503);return data.access_token;
}
const statusLabel=s=>({pending:'Sending',accepted:'Accepted by Microsoft',synchronized:'Synchronized',cancelled:'Cancelled',failed:'Failed',unknown:'Outcome unknown'}[s]||s);
export async function handleMoveOutIntegration(request,env,api,fetcher=fetch){
 let access,claim,body,community,dispatched=false,providerConfirmed=false;
 const reply=(data,status=200)=>api.apiResponse(data,{status});
 try{
  access=await api.requireAtlasAccessUser(request,env,roles);const path=new URL(request.url).pathname.split('/').pop();
  if(path==='status'&&request.method==='GET')return reply({ok:true,configured:configured(env),mailbox,error:configured(env)?'':'Microsoft application credentials and consent are required. No email or calendar event will be marked sent until Microsoft accepts it.'});
  if(request.method!=='POST'||!['email','calendar','result','templates'].includes(path))throw failure('Method or integration action not supported.',405);
  body=await boundedBody(request);
  if(path==='templates'){
   const db=(route,options={})=>api.supabaseRequest(access.config,route,{service:true,...options});
   if(body.action==='read'){
    const rows=await db('/rest/v1/atlas_moveout_document_templates?select=kind,version,template&order=version.desc');const templates={};for(const row of rows||[])if(!templates[row.kind])templates[row.kind]=row.template;
    return reply({ok:true,templates});
   }
   if(body.action!=='save'||access.role!=='admin')throw failure('Only an active administrator can publish document templates.',403);
   const template=validateTemplate(body.template),rows=await db(`/rest/v1/atlas_moveout_document_templates?kind=eq.${template.kind}&select=version&order=version.desc&limit=1`),version=rows?.[0]?.version||0;
   if(version!==body.expectedVersion)throw failure('Template changed elsewhere. Reload Settings before publishing.',409);
   template.version=version+1;template.updatedBy=access.user.id;template.updatedAt=new Date().toISOString();
   await db('/rest/v1/atlas_moveout_document_templates',{method:'POST',body:{kind:template.kind,version:template.version,template,updated_by:access.user.id}});
   return reply({ok:true,template});
  }
  safeText(body.caseId,200);if(!UUID.test(body.requestId))throw failure('A stable request ID is required.');
  community=await api.community(access,{communityName:body.communityName,communityId:body.communityId});
  const db=(route,options={})=>api.supabaseRequest(access.config,route,{service:true,...options});
  const operationPath=`/rest/v1/atlas_moveout_external_operations?request_id=eq.${encodeURIComponent(body.requestId)}&community_id=eq.${community.community_id}&case_id=eq.${encodeURIComponent(body.caseId)}`;
  if(path==='result'){
   const rows=await db(operationPath+'&select=status,result,actor_id,created_at');const row=rows?.[0];if(!row)throw failure('No retained operation was found.',404);return reply({ok:true,status:statusLabel(row.status),...row.result});
  }
  if(!configured(env))throw failure('Microsoft is not configured. The saved document or ATLAS appointment is retained for retry.',503);
  let entityId,mailboxAddress,calendarBody,binding;
  if(path==='email'){
   validateEmail(body);entityId=body.document.kind;
   const approved=await db(`/rest/v1/atlas_moveout_document_templates?kind=eq.${entityId}&version=eq.${Number(body.document.templateVersion)||0}&select=template&limit=1`);
   if(!approved?.[0])throw failure('Publish this document template in Central Services Settings before sending.',409);
   const missing=missingFields(approved[0].template,body.document.values||{});if(missing.length)throw failure('Required document fields are incomplete: '+missing.join('; '));
  }
  else{
   if(!['create','update','cancel','refresh'].includes(body.action))throw failure('Invalid calendar action.');calendarBody=eventBody(body,community.display_name||community.canonical_name);entityId=body.appointment.id;
   const rows=await db(`/rest/v1/atlas_moveout_external_operations?community_id=eq.${community.community_id}&case_id=eq.${encodeURIComponent(body.caseId)}&kind=eq.calendar&entity_id=eq.${entityId}&status=in.(synchronized,cancelled)&order=created_at.desc&limit=1&select=result,request_payload`);binding=rows?.[0];
   // The mailbox and provider event ID are taken from the retained receipt, never a browser-supplied URL.
   if(binding?.result?.status==='Cancelled'&&body.action==='cancel')return reply({ok:true,...binding.result});
   if(binding?.result?.eventId){mailboxAddress=binding.result.mailbox;if(body.appointment.technicianEmail!==mailboxAddress)throw failure('Cancel the existing appointment before changing its technician.',409);}
   else{
    if(body.action!=='create')throw failure('No synchronized event exists for this appointment.',409);
    if(!email.test(body.appointment.technicianEmail||''))throw failure('The technician needs a registered Microsoft email address.');
    const employees=await db(`/rest/v1/atlas_employees?email=eq.${encodeURIComponent(body.appointment.technicianEmail.toLowerCase())}&deleted_at=is.null&status=ilike.active&select=employee_id,email&limit=2`);if(employees?.length!==1)throw failure('Technician is not uniquely registered and active.',403);
    const assignments=await db(`/rest/v1/atlas_employee_assignments?employee_id=eq.${employees[0].employee_id}&deleted_at=is.null&employment_status=ilike.active&select=title,effective_start,effective_end`);const today=new Date().toISOString().slice(0,10);if(!assignments?.some(a=>a.effective_start<=today&&(!a.effective_end||a.effective_end>=today)&&/maintenance|technician|service supervisor|service manager/i.test(a.title)))throw failure('The employee does not have an active inspection-eligible assignment.',403);mailboxAddress=employees[0].email;
   }
  }
  const token=await graphToken(env,fetcher);
  const graph=async(route,method,payload)=>{dispatched=true;const response=await fetcher('https://graph.microsoft.com/v1.0'+route,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Prefer:'IdType="ImmutableId"'+(calendarBody?', outlook.timezone="'+calendarBody.start.timeZone+'"':'')},...(payload?{body:JSON.stringify(payload)}:{})});if(response.status===404&&path==='calendar'&&body.action==='refresh')return {isCancelled:true};if(!response.ok){const err=failure(`Microsoft rejected the ${path} request (HTTP ${response.status}).`,response.status>=500?502:400);err.uncertain=response.status>=500;throw err;}providerConfirmed=true;return response.status===202||response.status===204?{}:response.json();};
  if(path==='calendar'&&body.action==='refresh'){
   const event=await graph(`/users/${encodeURIComponent(mailboxAddress)}/events/${encodeURIComponent(binding.result.eventId)}`,'GET');return reply({ok:true,status:event.isCancelled?'Cancelled':'Synchronized',eventId:binding.result.eventId,eventOperationId:binding.result.eventOperationId,appointment:{date:event.start?.dateTime?.slice(0,10),time:event.start?.dateTime?.slice(11,16),duration:Math.round((Date.parse(event.end?.dateTime)-Date.parse(event.start?.dateTime))/60000),cancelled:Boolean(event.isCancelled)},providerEvent:event.id});
  }
  const claimed=await db('/rest/v1/rpc/atlas_claim_moveout_external_operation',{method:'POST',body:{p_request_id:body.requestId,p_community_id:community.community_id,p_case_id:body.caseId,p_entity_id:entityId,p_kind:path,p_actor_id:access.user.id,p_payload_hash:await digest(body),p_request_payload:body}});
  if(!claimed.claimed)return reply({ok:true,status:statusLabel(claimed.operation.status),...claimed.operation.result});claim=true;
  let result,status;
  if(path==='email'){
   await graph(`/users/${mailbox}/sendMail`,'POST',{message:{subject:body.subject,body:{contentType:'Text',content:body.message},toRecipients:body.to.map(address=>({emailAddress:{address}})),ccRecipients:body.cc.map(address=>({emailAddress:{address}})),attachments:[{'@odata.type':'#microsoft.graph.fileAttachment',name:body.document.title+'.pdf',contentType:'application/pdf',contentBytes:body.document.pdfBase64}]},saveToSentItems:true});
   status='accepted';result={status:'Accepted by Microsoft',at:new Date().toISOString(),sendingEmployee:access.profile.display_name||access.profile.email,recipients:body.to};
  }else{
   const eventId=binding?.result?.eventId;
   if(body.action==='cancel'){await graph(`/users/${encodeURIComponent(mailboxAddress)}/events/${encodeURIComponent(eventId)}`,'DELETE');status='cancelled';result={status:'Cancelled',eventId,mailbox:mailboxAddress,eventOperationId:body.requestId};}
   else{const payload={...calendarBody};if(eventId)delete payload.transactionId;const event=await graph(`/users/${encodeURIComponent(mailboxAddress)}/events${eventId?'/'+encodeURIComponent(eventId):''}`,eventId?'PATCH':'POST',payload);status='synchronized';result={status:'Synchronized',eventId:event.id||eventId,mailbox:mailboxAddress,eventOperationId:body.requestId};}
  }
  await db(operationPath,{method:'PATCH',body:{status,result,updated_at:new Date().toISOString()}});return reply({ok:true,...result});
 }catch(error){
  let status=claim&&(providerConfirmed||(dispatched&&error.uncertain!==false&&error.status!==400))?'unknown':'failed';
  if(claim&&access){try{await api.supabaseRequest(access.config,`/rest/v1/atlas_moveout_external_operations?request_id=eq.${body.requestId}`,{service:true,method:'PATCH',body:{status,result:{status:statusLabel(status),error:status==='unknown'?'Provider outcome needs verification. Automatic resend is blocked.':error.message},updated_at:new Date().toISOString()}});}catch{/* Retained pending receipt blocks a duplicate external action. */}}
  return reply({ok:false,status:statusLabel(status),error:status==='unknown'?'Microsoft may have accepted this action. Check the retained result before retrying.':error.message},error.status||502);
 }
}
