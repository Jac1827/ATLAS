import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createReputationStore,score,reputationAverage} from '../docs/portfolio-operations-dashboard/features/reputation-store.mjs';
assert.equal(score('',5),null);assert.equal(score(null,100),null);assert.equal(score('0',100),0);assert.throws(()=>score('NaN',5));assert.throws(()=>score(101,100));
assert.equal(reputationAverage([null,undefined,0,80]),40);assert.equal(reputationAverage([null,0,4]),2);assert.equal(reputationAverage([null,undefined]),null);
let actor='first',rows=[],calls=[],loseResponse=false,pauseRead=null,pauseSave=null;
const receipts=new Map();
const central={getSession:()=>({user:{id:actor}}),rpc:async(name,args)=>{
 calls.push({name,args});
 if(name==='atlas_read_reputation_months'){
  if(pauseRead)await pauseRead;
  return {records:rows.filter(row=>args.p_community_ids.includes(row.community_id)&&args.p_periods.includes(row.period_key)),editableCommunityIds:args.p_community_ids};
 }
 if(pauseSave)await pauseSave;
 if(receipts.has(args.p_request_id))return receipts.get(args.p_request_id);
 const existing=rows.find(row=>row.community_id===args.p_community_id&&row.period_key===args.p_period);
 if((existing?.version||0)!==args.p_expected_version)throw Error('Changed in another session');
 const row={community_id:args.p_community_id,period_key:args.p_period,google_review_score:args.p_google_review_score,ora_score:args.p_ora_score,version:args.p_expected_version+1,input_method:'manual',google_availability:args.p_google_review_score===null?'unavailable':'available',ora_availability:args.p_ora_score===null?'unavailable':'available',entered_by:existing?.entered_by||actor,entered_at:existing?.entered_at||'2026-10-13T12:00:00Z',updated_by:actor,updated_at:'2026-10-13T12:00:00Z'};
 rows=rows.filter(other=>other!==existing);rows.push(row);receipts.set(args.p_request_id,row);
 if(loseResponse){loseResponse=false;throw Error('Lost response');}return row;
}};
const entries=[{name:'A',communityId:'community-a',year:2026},{name:'B',communityId:'community-b',year:2026}],store=createReputationStore(central);
await store.hydrate(entries);assert.equal(store.get('A','2026-10').oraScore,null);
store.edit('A','2026-10','oraScore','0');store.edit('A','2026-10','googleReviewScore','');
loseResponse=true;await assert.rejects(store.save('A','2026-10'),/Lost response/);assert.equal(rows.length,1);
assert.throws(()=>store.edit('A','2026-10','oraScore','4'),/Retry/);
await store.save('A','2026-10');assert.equal(rows.length,1);assert.equal(store.get('A','2026-10').oraScore,0);assert.equal(store.get('A','2026-10').googleReviewScore,null);
const saves=calls.filter(call=>call.name==='atlas_save_reputation_month');assert.equal(saves[0].args.p_request_id,saves[1].args.p_request_id);
assert.equal(store.get('A','2026-10').inputMethod,'manual');assert.equal(store.get('A','2026-10').oraAvailability,'available');assert.equal(store.get('A','2026-10').googleAvailability,'unavailable');
const second=createReputationStore(central);await second.hydrate(entries);assert.equal(second.get('A','2026-10').oraScore,0,'Reloaded store reads durable server data');
store.edit('A','2026-09','oraScore','80');await store.save('A','2026-09');assert.equal(store.average('A',['2026-09','2026-10','2026-11']),40);
assert.equal(store.get('B','2026-10').oraScore,null);assert.equal(store.get('A','2027-10').oraScore,null);
second.edit('A','2026-10','oraScore','40');store.edit('A','2026-10','oraScore','20');await store.save('A','2026-10');await assert.rejects(second.save('A','2026-10'),/another session/);assert.equal(second.draft('A','2026-10').oraScore,40);await second.reload('A','2026-10');assert.equal(second.get('A','2026-10').oraScore,20);
// Invalid text remains visible and cannot save the previous valid value.
store.edit('B','2026-10','oraScore','20');assert.throws(()=>store.edit('B','2026-10','oraScore','wrong'),/Enter a score/);
assert.equal(store.draft('B','2026-10').inputs.oraScore,'wrong');const beforeInvalid=calls.length;
await assert.rejects(store.save('B','2026-10'),/Correct the invalid/);assert.equal(calls.length,beforeInvalid);
store.edit('B','2026-10','oraScore','0');await store.save('B','2026-10');assert.equal(store.get('B','2026-10').oraScore,0);
// Native numeric inputs expose an empty value for incomplete numbers such as 1e.
// Their badInput flag must block save rather than treating that empty string as clearing.
assert.throws(()=>store.edit('B','2026-10','oraScore','',{badInput:true}),/complete valid number/);
const beforeIncomplete=calls.length;await assert.rejects(store.save('B','2026-10'),/Correct the invalid/);
assert.equal(calls.length,beforeIncomplete);assert.equal(store.get('B','2026-10').oraScore,0);
store.edit('B','2026-10','oraScore','',{badInput:false});await store.save('B','2026-10');assert.equal(store.get('B','2026-10').oraScore,null,'Intentional clear still persists null');
// A pending save cannot be reloaded or replaced by a new draft.
let resumeSave;pauseSave=new Promise(resolve=>resumeSave=resolve);store.edit('A','2026-10','oraScore','30');
const delayedSave=store.save('A','2026-10');assert.equal(store.draft('A','2026-10').saving,true);
await assert.rejects(store.reload('A','2026-10'),/Wait for this save/);assert.throws(()=>store.edit('A','2026-10','oraScore','40'),/Retry/);
resumeSave();await delayedSave;pauseSave=null;store.edit('A','2026-10','oraScore','40');assert.equal(store.draft('A','2026-10').oraScore,40);
// A reload that began before a fresh edit cannot erase the newer draft.
let resumeReload;pauseRead=new Promise(resolve=>resumeReload=resolve);const delayedReload=store.reload('A','2026-10');
store.edit('A','2026-10','oraScore','50');resumeReload();await delayedReload;pauseRead=null;assert.equal(store.draft('A','2026-10').oraScore,50);
let resume;pauseRead=new Promise(resolve=>resume=resolve);const pending=store.hydrate([{name:'A',communityId:'community-a',year:2027}]);actor='different';store.clear();resume();await assert.rejects(pending,/account changed/);pauseRead=null;assert.equal(store.get('A','2026-10').oraScore,null);

// Execute shipped consumers with the canonical store, not copied formulas.
const source=fs.readFileSync('docs/portfolio-operations-dashboard/workspace-core.js','utf8');
const fn=name=>source.match(new RegExp('^function '+name+'\\([^]*?^\\}', 'm'))[0];
const context={window:{AtlasReputation:second},getSelectedDashboardMonthIndex:()=>9,buildPeriodKey:(month,year)=>`${year}-${String(month+1).padStart(2,'0')}`,atlasBonusCommunitySummary:()=>({}),getOccupancyBudgetCoverage:()=>({complete:false}),getAttributableLeaseConversionCount:()=>0,calculateFunnelConversionPct:()=>0};
actor='first';await second.hydrate(entries);vm.createContext(context);
for(const name of ['getAtlasReputationPeriod','getAtlasMonthlyReputation','aggregateCommunitySummaries','getMetricOutcome','atlasReputationDisplay','getAtlasQuarterOra','atlasBonusMetricActual'])vm.runInContext(fn(name),context);
assert.equal(context.getAtlasMonthlyReputation('A',{reportYear:2026,currentMonth:8,reputationData:{oraScore:99}}).oraScore,80);
assert.equal(context.getAtlasMonthlyReputation('A',{reportYear:2026,currentMonth:10,reputationData:{oraScore:99}}).oraScore,null,'Legacy/import values cannot supply a missing month');
const summaries=[0,80,null].map(oraScore=>new Proxy({oraScore,googleReviewScore:oraScore===null?null:oraScore/20},{get:(row,key)=>Object.hasOwn(row,key)?row[key]:0}));
assert.equal(context.aggregateCommunitySummaries(summaries).oraScore,40);assert.equal(context.aggregateCommunitySummaries(summaries).googleReviewScore,2);
assert.equal(context.atlasBonusMetricActual({communityName:'A'},{metricKey:'reputation_score'},{start:'2026-09-01',end:'2026-09-30'}),80);
assert.equal(context.atlasBonusMetricActual({communityName:'A'},{metricKey:'reputation_score'},{start:'2026-07-01',end:'2026-09-30'}),null);
assert.equal(context.atlasBonusMetricActual({communityName:'A'},{metricKey:'reputation_score'},{start:'2027-09-01',end:'2027-09-30'}),null);
assert.equal(context.getAtlasQuarterOra('A',{},3,2026),null,'No quarterly aggregation policy is invented');
assert.equal(context.getMetricOutcome({syncKey:'oraScore',actual:0,goal:62,tiers:[{threshold:62,multiplier:1}]}).status,'miss');
assert.equal(context.getMetricOutcome({syncKey:'oraScore',actual:null,goal:62}).status,'pending');assert.equal(context.atlasReputationDisplay(0),'0.0');assert.equal(context.atlasReputationDisplay(null),'—');
// Render preparation must not write a failed old-account read into the new view.
let renderContext='old',readReject,scheduled=0;
const panel={innerHTML:''},pendingRead=new Promise((resolve,reject)=>readReject=reject);
const preparationContext={window:{AtlasReputation:{ready:()=>false,hydrate:()=>pendingRead}},activeTab:6,
 getAtlasCentralStatus:()=>({configured:true}),getAtlasDashboardAuthorizedCommunityOptions:()=>[{name:'A'}],
 getAtlasCommunityAccessRecord:()=>({atlasCommunityId:'community-a'}),savedData:{A:{reportYear:2026}},
 getReportHubYear:()=>2026,atlasBonusPeriodFromQuarter:()=>({start:'2026-10-01'}),
 document:{getElementById:()=>panel},getAtlasRenderContextKey:()=>renderContext,atlasWorkspaceAccess:{epoch:1},
 loadReputationModule:async()=>({}),scheduleAtlasSharedRender:()=>scheduled++,escapeHtml:value=>String(value)};
vm.createContext(preparationContext);vm.runInContext(fn('prepareAtlasReputationView').replace("import('./features/reputation-store.mjs')","loadReputationModule()"),preparationContext);
assert.equal(preparationContext.prepareAtlasReputationView(),false);await Promise.resolve();
renderContext='new';preparationContext.atlasWorkspaceAccess.epoch++;readReject(Error('Old account failed'));
await preparationContext.prepareAtlasReputationView.pending.task;
assert.equal(scheduled,1);assert.equal(panel.innerHTML.includes('Old account failed'),false);assert.equal(preparationContext.prepareAtlasReputationView.pending,null);
console.log('PASS monthly reputation exact save/readback, lost-response retry, independent scopes, drafts and CAS recovery, stale-session isolation, canonical import protection, zero-aware consumers and unchanged payout thresholds.');
