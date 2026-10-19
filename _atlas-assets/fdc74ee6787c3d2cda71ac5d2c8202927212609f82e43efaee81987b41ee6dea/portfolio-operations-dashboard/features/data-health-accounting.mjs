// Read-only source evidence. Approved accounting never comes from browser draft totals.
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const period=value=>typeof value==='string'&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(value);
export async function readAccountingEvidence(central,communities,{throughPeriod,isCurrent=()=>true}={}) {
 if(!period(throughPeriod))throw Error('Invalid accounting health period.');
 const actor=central.getSession?.()?.user?.id,access=central.getAccessContextKey?.();
 if(!actor)throw Error('Sign in to verify approved accounting sources.');
 const guard=()=>{if(!isCurrent()||central.getSession?.()?.user?.id!==actor||central.getAccessContextKey?.()!==access)throw Error('Accounting source access changed.');};
 const names=new Map(communities.filter(row=>uuid(row.id)).map(row=>[row.id,row.name]));
 if(!names.size)return [];
 const read=async url=>{guard();const rows=await central.fetchJson(url);guard();if(!Array.isArray(rows)||rows.length>=1000)throw Error('Accounting source read is incomplete.');return rows;};
 const from=String(Number(throughPeriod.slice(0,4))-2)+throughPeriod.slice(4);
 const heads=await read(`/atlas_financial_close_heads?community_id=in.(${[...names.keys()].join(',')})&accounting_basis=eq.accrual&period_key=gte.${from}&period_key=lte.${throughPeriod}&select=community_id,period_key,version_id&order=period_key.desc&limit=1000`);
 const latest=new Map();
 for(const head of heads){
  if(!names.has(head.community_id)||!uuid(head.version_id)||!period(head.period_key)||head.period_key<from||head.period_key>throughPeriod)throw Error('Accounting source scope mismatch.');
  const prior=latest.get(head.community_id);
  if(prior?.period_key===head.period_key)throw Error('Accounting source head is ambiguous.');
  if(!prior||head.period_key>prior.period_key)latest.set(head.community_id,head);
 }
 if(!latest.size)return [];
 const ids=[...latest.values()].map(row=>row.version_id),filter=`version_id=in.(${ids.join(',')})`;
 const versions=await read(`/atlas_financial_close_versions?${filter}&select=version_id,community_id,period_key,status,coverage,source_hash,source_file,approved_at,approved_by,accounting_basis&limit=1000`);
 const events=await read(`/atlas_actual_period_events?${filter}&select=version_id,community_id,period_key,action,created_at&order=created_at.desc&limit=1000`);
 if(versions.some(row=>!ids.includes(row.version_id)))throw Error('Accounting version scope mismatch.');
 if(events.some(row=>!['reopened','relocked'].includes(row.action)||!Number.isFinite(Date.parse(row.created_at))||!ids.includes(row.version_id)||latest.get(row.community_id)?.version_id!==row.version_id||latest.get(row.community_id)?.period_key!==row.period_key))throw Error('Accounting event scope mismatch.');
 return [...latest.values()].map(head=>{
  const matches=versions.filter(row=>row.version_id===head.version_id),v=matches[0];
  if(matches.length!==1||v.community_id!==head.community_id||v.period_key!==head.period_key||v.status!=='closed'||v.coverage!=='full_month'||v.accounting_basis!=='accrual'||!v.source_hash||!v.source_file||!v.approved_by||!Number.isFinite(Date.parse(v.approved_at)))throw Error('Approved accounting evidence is incomplete.');
  const event=events.filter(row=>row.version_id===v.version_id).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at))[0];
  const [year,month]=v.period_key.split('-').map(Number),asOf=new Date(Date.UTC(year,month,0,12)).toISOString();
  return {id:v.version_id,closeVersionId:v.version_id,reportType:'approved_accounting',importStatus:'Approved',
   communityName:names.get(v.community_id),communities:[names.get(v.community_id)],fileName:v.source_file,fileHash:v.source_hash,
   reportingPeriodLabel:v.period_key,dataDateIso:asOf,uploadedAt:v.approved_at,batchId:'Approved Central close '+v.period_key,
   metadata:{dataAsOf:asOf,receivedAt:v.approved_at},accountingReopened:event?.action==='reopened',evidenceOrigin:'central_close'};
 });
}
