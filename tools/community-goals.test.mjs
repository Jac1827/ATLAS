import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readGoals,saveGoals,normalizeRecord,GOAL_FIELDS} from '../docs/portfolio-operations-dashboard/features/community-goals.mjs';
const require=createRequire(import.meta.url),{fixture}=require('./community-goals-fixture.cjs');
const {db,A,B}=await fixture();
let loseResponse=false,failRead=false,tamperRead=false,fetchCount=0;
const central={
 async rpc(name,p){
  assert.equal(name,'atlas_save_community_goals');
  const result=(await db.query('select atlas_save_community_goals($1,$2,$3,$4,$5,$6::jsonb) as result',[p.p_community_id,p.p_period,p.p_kind,p.p_expected_revision,p.p_request_id,JSON.stringify(p.p_payload)])).rows[0].result;
  if(loseResponse){loseResponse=false;throw Error('Network response lost after commit');}return result;
 },
 async fetchJson(path){
  fetchCount++;if(failRead){failRead=false;throw Error('Read unavailable');}
  const url=new URL(path,'http://test.local'),table=url.pathname.slice(1);assert(['atlas_community_goal_heads','atlas_community_goal_records'].includes(table));
  const params=[],where=[];
  for(const field of ['community_id','period_key','record_id']){
   const v=url.searchParams.get(field);if(!v)continue;
   if(v.startsWith('eq.')){params.push(v.slice(3));where.push(`${field}=$${params.length}`);}
   else if(v.startsWith('in.(')&&v.endsWith(')')){params.push(v.slice(4,-1).split(','));where.push(`${field}=any($${params.length})`);}else throw Error('Unknown test scope');
  }
  const limit=Number(url.searchParams.get('limit')||500),offset=Number(url.searchParams.get('offset')||0);
  assert(Number.isSafeInteger(limit)&&Number.isSafeInteger(offset));
  const order=table.endsWith('heads')?'community_id,period_key':'community_id,period_key,revision,record_id';
  const rows=(await db.query(`select to_jsonb(t) as row from public.${table} t ${where.length?'where '+where.join(' and '):''} order by ${order} limit ${limit} offset ${offset}`,params)).rows.map(r=>r.row);
  for(const row of rows)if(row.created_at)row.created_at=new Date(row.created_at).toISOString();
  if(tamperRead&&table.endsWith('records')){tamperRead=false;rows[0].payload.applicationGoal=999;}return rows;
 }
};
const payload={...Object.fromEntries(GOAL_FIELDS.map(k=>[k,0])),reason:'Keep the intentional zero',effectiveDate:'2026-09-01',weeklyGoals:[{week:1,startDay:1,applicationGoal:0,grossLeaseGoal:0,netLeaseGoal:0}]};
const request=(kind,expectedRevision,extra={})=>({communityId:A,period:'2026-09',kind,expectedRevision,requestId:randomUUID(),payload,...extra});
assert.deepEqual(await readGoals(central),[]);
let scope=await saveGoals(central,request('recommended',0,{payload:{...payload,applicationGoal:40}}));assert.equal(scope.revision,0);assert.equal(scope.recommendationRevision,1);assert.equal(scope.draft,null);
const draft=request('draft',0);loseResponse=true;await assert.rejects(()=>saveGoals(central,draft),/response lost/);
scope=await saveGoals(central,draft);assert.equal(scope.revision,1);assert.equal(scope.draft.applicationGoal,0);assert.equal(scope.draft.approvedAt,'');assert.equal(scope.recommended.applicationGoal,40);
assert.equal((await db.query('select count(*)::int as n from atlas_community_goal_records where kind=\'draft\'')).rows[0].n,1);
const approval=request('approved',1);failRead=true;await assert.rejects(()=>saveGoals(central,approval),/Read unavailable/);
scope=await saveGoals(central,approval);assert.equal(scope.revision,2);assert.equal(scope.draft,null);assert.equal(scope.approved.applicationGoal,0);assert.equal(scope.approvedHistory.length,1);assert.equal(scope.approved.id,scope.savedRecord.id);
await assert.rejects(()=>saveGoals(central,draft),error=>error.code==='GOALS_SAVED_THEN_SUPERSEDED');
scope=await saveGoals(central,request('draft',2,{payload:{...payload,applicationGoal:8}}));assert.equal(scope.approved.applicationGoal,0);assert.equal(scope.draft.applicationGoal,8);
scope=await saveGoals(central,request('recommended',1,{payload:{...payload,applicationGoal:60}}));assert.equal(scope.revision,3);assert.equal(scope.draft.applicationGoal,8);assert.equal(scope.approved.applicationGoal,0);
const altered=request('draft',3,{payload:{...payload,applicationGoal:11}});tamperRead=true;await assert.rejects(()=>saveGoals(central,altered),/committed record could not be verified/);scope=await saveGoals(central,altered);assert.equal(scope.draft.applicationGoal,11);
await saveGoals(central,request('draft',0,{communityId:B,payload:{...payload,applicationGoal:12}}));
await saveGoals(central,request('draft',0,{period:'2026-10',payload:{...payload,applicationGoal:13}}));
await saveGoals(central,request('draft',0,{period:'2027-09',payload:{...payload,applicationGoal:14}}));
const all=await readGoals(central);assert.equal(all.length,4);
assert.equal((await readGoals(central,{communityIds:[B],periods:['2026-09']}))[0].draft.applicationGoal,12);
assert.equal((await readGoals(central,{communityIds:[A],periods:['2026-10']}))[0].draft.applicationGoal,13);
assert.equal((await readGoals(central,{communityIds:[A],periods:['2027-09']}))[0].draft.applicationGoal,14);
assert.equal((await readGoals(central,{communityIds:[A],periods:['2026-09']}))[0].draft.applicationGoal,11);
failRead=true;await assert.rejects(()=>readGoals(central),/Read unavailable/);
const before=fetchCount;assert.deepEqual(await readGoals(central,{communityIds:[]}),[]);assert.equal(fetchCount,before);
await assert.rejects(()=>readGoals(central,{periods:['2026-13']}),/Invalid/);
await assert.rejects(()=>saveGoals(central,request('approved',0,{communityId:'Other'})),/verified community/);
assert.equal(normalizeRecord(null),null);
await db.close();
console.log('PASS actual adapter + PostgreSQL: exact readback, lost-response retry, failed-read retention, independent zero/draft/approval/recommendations, reload and community/month/year isolation');
