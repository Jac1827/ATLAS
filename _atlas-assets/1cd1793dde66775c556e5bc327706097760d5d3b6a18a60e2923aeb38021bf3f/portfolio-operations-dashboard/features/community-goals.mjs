/* Durable goal records are independent of imported data and dashboard settings. */
export const GOAL_FIELDS = Object.freeze(['requiredMoveIns','applicationGoal','grossLeaseGoal','netLeaseGoal','occupancyGoal','leasedGoal','economicGoal','renewalGoal']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const periodPattern = /^20\d{2}-(0[1-9]|1[0-2])$/;
const key = (community, period) => `${community}|${period}`;
function validateScope(communityId, period) {
 if (!uuid.test(communityId) || !periodPattern.test(period)) throw Error('A verified community and reporting month are required to save goals.');
}
export function normalizeRecord(record) {
 if (!record) return null;
 return {...record.payload,id:record.record_id,communityId:record.community_id,period:record.period_key,
  monthIdx:Number(record.period_key.slice(5))-1,year:Number(record.period_key.slice(0,4)),
  status:{recommended:'Recommended',draft:'Draft',approved:'Approved'}[record.kind],version:record.revision,
  reason:record.reason,effectiveDate:record.effective_date || '',revisedAt:record.created_at,
  updatedBy:record.actor_id,approver:record.kind==='approved'?record.actor_id:'',approvedBy:record.kind==='approved'?record.actor_id:'',
  approvedAt:record.kind==='approved'?record.created_at:'',requestId:record.request_id};
}
async function allRows(central, path, signal) {
 const result=[],limit=500;
 for(let offset=0; ;offset+=limit) {
  const rows=await central.fetchJson(`${path}&limit=${limit}&offset=${offset}`,{signal});
  if(!Array.isArray(rows))throw Error('Saved goals could not be read. Try again without discarding your edits.');
  result.push(...rows);if(rows.length<limit)return result;
 }
}
export async function readGoals(central,{communityIds,periods,signal}={}) {
 if(communityIds && (!Array.isArray(communityIds)||communityIds.some(id=>!uuid.test(id))))throw Error('Invalid community goal scope.');
 if(periods && (!Array.isArray(periods)||periods.some(period=>!periodPattern.test(period))))throw Error('Invalid goal reporting period.');
 if(communityIds?.length===0||periods?.length===0)return [];
 const scope=(communityIds?`&community_id=in.(${[...new Set(communityIds)].join(',')})`:'')+(periods?`&period_key=in.(${[...new Set(periods)].join(',')})`:'');
 // Read heads first: every referenced record already exists and is immutable.
 const heads=await allRows(central,`/atlas_community_goal_heads?select=*&order=community_id,period_key${scope}`,signal);
 if(!heads.length)return [];
 const records=await allRows(central,`/atlas_community_goal_records?select=*&order=community_id,period_key,revision,record_id${scope}`,signal);
 const byId=new Map(records.map(record=>[record.record_id,record]));
 const approvedByScope=new Map();
 for(const record of records)if(record.kind==='approved'){
  const k=key(record.community_id,record.period_key);if(!approvedByScope.has(k))approvedByScope.set(k,[]);approvedByScope.get(k).push(record);
 }
 return heads.map(head=>{
  for(const id of [head.recommendation_id,head.draft_id,head.approved_id])if(id&&!byId.has(id))throw Error('Saved goal history is incomplete. Reload the shared goals before editing.');
  return {communityId:head.community_id,period:head.period_key,revision:head.revision,recommendationRevision:head.recommendation_revision,updatedAt:head.updated_at,
   recommended:normalizeRecord(byId.get(head.recommendation_id)),draft:normalizeRecord(byId.get(head.draft_id)),approved:normalizeRecord(byId.get(head.approved_id)),
   approvedHistory:(approvedByScope.get(key(head.community_id,head.period_key))||[]).filter(record=>record.revision<=head.revision).sort((a,b)=>b.revision-a.revision).map(normalizeRecord)};
 });
}
const canonical = value => Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const same = (a,b) => JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
// The RPC JSON and table endpoint may format the same timestamptz with Z or +00:00.
// Goal payloads and all other immutable fields must still compare exactly.
const comparableRecord = record => ({...record,created_at:Number.isFinite(Date.parse(record?.created_at))?new Date(record.created_at).toISOString():record?.created_at});
export async function saveGoals(central,{communityId,period,kind,expectedRevision,requestId,payload,signal}) {
 validateScope(communityId,period);
 if(!['recommended','draft','approved'].includes(kind)||!Number.isInteger(expectedRevision)||expectedRevision<0||!uuid.test(requestId))throw Error('Invalid goal save request. Keep your edits and reopen the editor if necessary.');
 const result=await central.rpc('atlas_save_community_goals',{p_community_id:communityId,p_period:period,p_kind:kind,p_expected_revision:expectedRevision,p_request_id:requestId,p_payload:payload});
 const saved=result?.record;
 if(!saved?.record_id||!uuid.test(saved.record_id)||saved.community_id!==communityId||saved.period_key!==period||saved.kind!==kind||saved.request_id!==requestId)throw Error('Goal save could not be confirmed. Your edits are retained; retry this save.');
 const read=await central.fetchJson(`/atlas_community_goal_records?record_id=eq.${saved.record_id}&select=*&limit=1`,{signal});
 const committed=read?.[0];
 if(!committed || !same(comparableRecord(committed),comparableRecord(saved)))throw Error('Goal save returned, but the committed record could not be verified. Your edits are retained; retry this save.');
 for(const field of GOAL_FIELDS)if(!same(committed.payload[field],payload[field]))throw Error('Saved goal values did not match your edits. Your edits are retained.');
 if(!same(committed.payload.weeklyGoals||[],payload.weeklyGoals||[])||(kind!=='recommended'&&(committed.reason!==payload.reason.trim()||committed.effective_date!==payload.effectiveDate)))throw Error('Saved goal details did not match your edits. Your edits are retained.');
 const scopes=await readGoals(central,{communityIds:[communityId],periods:[period],signal});
 const scope=scopes[0];
 if(!scope||(kind==='recommended'?scope.recommendationRevision:scope.revision)<saved.revision)throw Error('Goal save is recorded, but its shared revision could not be verified. Your edits are retained; retry this save.');
 if(scope[kind]?.id!==saved.record_id) {
  const error=Error('Your goal changes were saved, but another session has already saved a newer revision. Your edits are retained; reload the saved goals before continuing.');
  error.code='GOALS_SAVED_THEN_SUPERSEDED';error.savedRecord=normalizeRecord(committed);throw error;
 }
 return {...scope,savedRecord:normalizeRecord(committed)};
}
