import assert from 'node:assert/strict';
import {readCommunityBudgetSettings,saveCommunityBudgetSettings} from '../docs/portfolio-operations-dashboard/features/community-budget-settings.mjs';
const cid='10000000-0000-0000-0000-000000000001',admin='20000000-0000-0000-0000-000000000001',other='20000000-0000-0000-0000-000000000002';
function fixture(){
 let actor=admin,role='admin',version=7,settingsVersion=2,classification='Multifamily',mismatch=false,readHook=()=>{},refreshHook=()=>{},saveHook=()=>{};
 const calls=[],calendar=()=>({verified:true,classification,startMonth:classification==='Student Housing'?8:1,source:'Community Settings review',settingsVersion});
 const central={getSession:()=>({user:{id:actor}}),getStoredProfile:()=>({user_id:actor,role,status:'active'}),async refreshSession(){refreshHook();},async fetchJson(url,options){
  calls.push({url,body:options?.body?JSON.parse(options.body):null});
  if(url.startsWith('/atlas_communities?')){readHook();return [{community_id:cid,display_name:'Authorized Community',version}];}
  if(url==='/rpc/atlas_read_budget_calendar'){const value=calendar();return mismatch?{...value,classification:'Multifamily',startMonth:1}:value;}
  if(url==='/rpc/atlas_set_budget_calendar'){
   const body=JSON.parse(options.body);assert.equal(body.p_community_id,cid);assert.equal(body.p_expected_version,version,'save uses canonical community version');
   classification=body.p_classification;version++;settingsVersion++;const value=calendar();saveHook();return value;
  }
  throw Error('Unexpected endpoint '+url);
 }};
 return {central,calls,setActor:value=>actor=value,setRole:value=>role=value,setVersion:value=>version=value,setMismatch:value=>mismatch=value,onRead:value=>readHook=value,onRefresh:value=>refreshHook=value,onSave:value=>saveHook=value};
}
const input={communityId:cid,expectedVersion:7,classification:'Student Housing',reason:'  Verified active school-year reporting  '};
let f=fixture();const loaded=await readCommunityBudgetSettings(f.central,cid);assert.equal(loaded.community.version,7);assert.equal(loaded.calendar.startMonth,1);
const saved=await saveCommunityBudgetSettings(f.central,input);assert.equal(saved.community.version,8);assert.equal(saved.calendar.startMonth,8);assert.equal(saved.calendar.settingsVersion,3);
assert.equal(f.calls.find(c=>c.url.endsWith('atlas_set_budget_calendar')).body.p_reason,'Verified active school-year reporting');
assert.equal(f.calls.filter(c=>c.url.startsWith('/atlas_communities?')).length,2,'save re-reads the canonical record');
assert.equal(f.calls.filter(c=>c.url.endsWith('atlas_read_budget_calendar')).length,2,'save verifies the shared calendar response');
await assert.rejects(()=>saveCommunityBudgetSettings(f.central,input),/canonical community version/,'stale versions cannot silently overwrite another editor');
f=fixture();f.setRole('executive');await assert.rejects(()=>saveCommunityBudgetSettings(f.central,input),/Admin/);assert.equal(f.calls.length,0,'VP authority does not grant Admin community settings rights');
f=fixture();f.onRefresh(()=>f.setActor(other));await assert.rejects(()=>saveCommunityBudgetSettings(f.central,input),/session changed/);assert.equal(f.calls.length,0,'session refresh cannot write as a different actor');
f=fixture();f.onRead(()=>f.setActor(other));await assert.rejects(()=>readCommunityBudgetSettings(f.central,cid),/session changed/,'cross-session results are never returned');
f=fixture();f.onSave(()=>f.setActor(other));await assert.rejects(()=>saveCommunityBudgetSettings(f.central,input),/session changed/);assert.equal(f.calls.length,1,'a switched session cannot confirm the prior user save');
f=fixture();f.setMismatch(true);await assert.rejects(()=>saveCommunityBudgetSettings(f.central,input),/could not be confirmed/,'calendar readback must match the actual saved classification');
f=fixture();await assert.rejects(()=>saveCommunityBudgetSettings(f.central,{...input,classification:'Conventional'}),/classification/);await assert.rejects(()=>saveCommunityBudgetSettings(f.central,{...input,reason:''}),/reason/);assert.equal(f.calls.length,0);
console.log('PASS Community Settings financial calendar: canonical versions, Admin-only save, shared readback, session changes and conflict rejection');
