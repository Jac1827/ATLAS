import {reportHtml} from '../docs/portfolio-operations-dashboard/features/community-plan-report.mjs';
export async function handleCommunityPlanEmail(request,env,api){
 let claimed,access;
 try{
  access=await api.requireAtlasAccessUser(request,env,new Set(['admin','executive','regional','community_manager']));
  if(!env.EMAIL?.send||!env.ATLAS_DLR_FROM_EMAIL)return api.apiResponse({ok:false,error:'Report email service is not configured.'},{status:503});
  const reader=request.body?.getReader();if(!reader)throw Error('Report and recipients are required.');
  let size=0;const chunks=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384){await reader.cancel();throw Error('Delivery request exceeds the size limit.');}chunks.push(value);}}finally{reader.releaseLock();}
  const buffer=new Uint8Array(size);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length;}
  const body=JSON.parse(new TextDecoder().decode(buffer));
  if(!/^[0-9a-f-]{36}$/i.test(body.reportId)||!Array.isArray(body.recipients)||body.recipients.length>20)throw Error('Invalid report or recipients.');
  // Read as the caller, preserving report RLS. Never accept report HTML from a browser.
  const rows=await api.supabaseRequest(access.config,`/rest/v1/atlas_community_plan_reports?report_id=eq.${body.reportId}&select=*&limit=1`,{token:access.token});
  const report=rows?.[0];if(!report)return api.apiResponse({ok:false,error:'Report unavailable or access denied.'},{status:403});
  const result=await api.callAtlasRpcAsUser(access.config,access.token,'atlas_claim_command_report_delivery',{p_report_id:body.reportId,p_recipients:body.recipients});
  claimed=Array.isArray(result)?result[0]:result;
  const sent=await env.EMAIL.send({from:env.ATLAS_DLR_FROM_EMAIL,to:claimed.recipients,subject:`Community Performance Plan · ${report.snapshot.community} · ${report.snapshot.period}`,html:reportHtml(report)});
  await api.supabaseRequest(access.config,`/rest/v1/atlas_command_report_deliveries?delivery_id=eq.${claimed.delivery_id}`,{method:'PATCH',service:true,body:{status:'sent',provider_message_id:sent?.messageId||null,sent_at:new Date().toISOString()}});
  return api.apiResponse({ok:true,deliveryId:claimed.delivery_id,status:'sent'});
 }catch(error){
  if(claimed&&access){try{await api.supabaseRequest(access.config,`/rest/v1/atlas_command_report_deliveries?delivery_id=eq.${claimed.delivery_id}`,{method:'PATCH',service:true,body:{status:'unknown'}});}catch{/* A claimed record still blocks automatic resend. */}}
  return api.apiResponse({ok:false,error:claimed?'Delivery outcome needs verification. Automatic resend is blocked to prevent duplicate email.':String(error.message||error)},{status:error.status||400});
 }
}
