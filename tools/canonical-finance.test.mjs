import {readDashboardSource} from './dashboard-source.cjs';
import assert from 'node:assert/strict';
import {readFinance,financialSummary,bonusEvidence,number,readDetail} from '../docs/portfolio-operations-dashboard/features/canonical-finance.mjs';
import {createCache,coverage} from '../docs/portfolio-operations-dashboard/features/financial-close.mjs';
const cid='community',periods=['2025-04','2025-05','2025-06'];
const envelopes=periods.map((period,i)=>({communityId:cid,period,registryVersion:'atlas-finance-v1',accountingBasis:'accrual',currency:'USD',actualCloseVersion:'c'+i,budgetVersion:'b',targetApprovalStatus:'approved',revenue:{actual:i===0?-10:20,budget:10},expenses:{actual:0,budget:10}}));
assert.equal(number(' '),null);assert.equal(number(0),0);assert.equal(number(-10),-10);
assert.equal(financialSummary({...envelopes[0],noi:{actual:10,budget:null}}).noiVariance,null);
const evidence=bonusEvidence(envelopes,'revenue',periods);assert.equal(evidence.attainment,100);assert.deepEqual(evidence.actualCloseVersions,['c0','c1','c2']);
assert.equal(bonusEvidence(envelopes,'expenses',periods).attainment,200);
assert.equal(bonusEvidence(envelopes.slice(1),'revenue',periods),null);
assert.equal(bonusEvidence(envelopes.map(s=>({...s,budgetVersion:null})),'revenue',periods),null);
assert.equal(bonusEvidence(envelopes.map(s=>({...s,revenue:{actual:1,budget:0}})),'revenue',periods),null);
assert.equal(bonusEvidence(envelopes,'revenue',['2025-05','2025-06','2025-07']),null);
const rows=envelopes.map(s=>({community_id:cid,period_key:s.period,summary:s}));
assert.deepEqual((await readFinance({rpc:async()=>{throw Error('Single-row helper must not serve a table read');},fetchJson:async(path,opts)=>{assert.equal(path,'/rpc/atlas_read_finance');assert.equal(opts.method,'POST');assert.deepEqual(JSON.parse(opts.body),{p_community_ids:[cid],p_periods:periods});return rows;}},[cid],periods,{baselineMode:'original_budget'})).map(row=>({...row,summary:Object.fromEntries(Object.entries(row.summary).filter(([key])=>!['financialSnapshot','snapshotFingerprint','publicationId'].includes(key)))})),rows);
await assert.rejects(()=>readFinance({fetchJson:async()=>rows[0]},[cid],periods),/row array/);
await assert.rejects(()=>readFinance({fetchJson:async()=>[{...rows[0],community_id:'other'}]},[cid],periods),/scope/);
let actor='a';await assert.rejects(()=>readFinance({getSession:()=>({user:{id:actor}}),fetchJson:async()=>{actor='b';return rows;}},[cid],periods),/Session changed/);
await assert.rejects(()=>readDetail({fetchJson:async()=>[]},{actualCloseVersion:'c',close:{row_count:1}}),/incomplete/);
assert.deepEqual(coverage([],2026),{first:0,last:0,missing:[],firstExpectedMonth:1,completeYtd:false});
assert.deepEqual(coverage([1,3,8].map(m=>({period_key:'2026-'+String(m).padStart(2,'0'),status:'closed',coverage:'full_month'})),2026),{first:1,last:8,missing:[2,4,5,6,7],firstExpectedMonth:1,completeYtd:false});
let fail=false;
const cache=createCache({readCommunitiesForAccess:async()=>[{community_id:cid,display_name:'Doro',canonical_name:'doro'}],fetchJson:async(path)=>{if(fail)throw Error('offline');return path==='/rpc/atlas_reforecast_effective_baseline'?periods.map(period=>({communityId:cid,period,status:'available',sourceType:'original_budget',versionId:'b',contentHash:'budget-hash',approved:true,locked:true,verified:true,lines:[{accountCode:'income',nature:'income',placement:'above_noi',amount:10},{accountCode:'expense',nature:'expense',placement:'above_noi',amount:10}]})):rows;}});
await cache.refresh(2025);assert.equal(cache.bonus('Doro','revenue',periods).attainment,100);fail=true;await assert.rejects(()=>cache.refresh(2025,true),/offline/);assert.equal(cache.envelope('Doro',periods[0]),null,'failed refresh must discard stale evidence');
console.log('PASS canonical adapter, exact quarter/year, source versions, missing/zero/signed values, invalid scope, stale cache and complete YTD');
const {readApprovedBudget}=await import('../docs/portfolio-operations-dashboard/features/canonical-finance.mjs');
const segments=[{version_id:'a',community_id:cid,calendar_year:2026,status:'locked',covered_months:[0,1],payload:{rows:[{glCode:'5120',monthly:[0,-5,...Array(10).fill(null)]}]}},{version_id:'b',community_id:cid,calendar_year:2026,status:'locked',covered_months:[2],payload:{rows:[{glCode:'5120',monthly:[null,null,10,...Array(9).fill(null)]}]}}];
const merged=await readApprovedBudget({fetchJson:async()=>segments},cid,2026);assert.deepEqual(merged.payload.rows[0].monthly.slice(0,4),[0,-5,10,null]);assert.equal(merged.periodVersions[2],'b');
await assert.rejects(()=>readApprovedBudget({fetchJson:async()=>[segments[0],segments[0]]},cid,2026),/Overlapping/);
const fs=await import('node:fs'),vm=await import('node:vm');
const html=readDashboardSource(new URL('../docs/portfolio-operations-dashboard/index.html',import.meta.url));
const body=html.slice(html.indexOf('function atlasBonusFinancialEvidence('),html.indexOf('\nfunction atlasBonusMetricActual('));
let requested,queued;
const context={Date,queueAtlasFinancialScope:(name,periods)=>{queued={name,periods};},refreshAtlasClosedFinancials:async()=>{},buildPeriodKey:(m,y)=>y+'-'+String(m+1).padStart(2,'0'),window:{AtlasClosedFinancialCache:{bonus:(name,key,periods)=>(requested={name,key,periods},{attainment:110})}}};vm.createContext(context);vm.runInContext(body,context);
assert.equal(context.atlasBonusFinancialEvidence({communityName:'Doro'},{metricKey:'noi'},{start:'2025-04-01',end:'2025-06-30'}).attainment,110);assert.equal(requested.periods.join(','),'2025-04,2025-05,2025-06');assert.equal(queued.periods.join(','),'2025-04,2025-05,2025-06');
assert.equal(context.atlasBonusFinancialEvidence({communityName:'Doro'},{metricKey:'noi'},{start:'2025-04-01',end:'2025-05-31'}),null);
for(const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){if(!/type\s*=\s*["']module/.test(match[1])&&match[2].trim())new vm.Script(match[2]);}
console.log('PASS non-overlapping fiscal budget segments, retained missing amounts, Bonus requested historical quarter and dashboard syntax');

const active=period=>({status:'available',communityId:cid,period,sourceType:'approved_reforecast',versionId:'forecast-revision',publicationId:'forecast-publication',contentHash:'forecast-hash',verified:true,approved:true,locked:true,lines:[{accountCode:'5120',amount:20,nature:'income',placement:'above_noi'},{accountCode:'6100',amount:15,nature:'expense',placement:'above_noi'}]});
const activeRows=rows.map(row=>({...row,summary:{...row.summary,effectiveBaseline:active(row.period_key)}}));let activeReads=0;
const effective=await readFinance({fetchJson:async path=>{activeReads++;assert.equal(path,'/rpc/atlas_read_finance');return structuredClone(activeRows);}},[cid],periods);assert.equal(activeReads,1,'Server monthly evidence does not cause a duplicate baseline request');
assert.equal(effective[0].summary.revenue.originalBudget,10);assert.equal(effective[0].summary.revenue.budget,20);assert.equal(effective[0].summary.revenue.variance,-30);assert.equal(effective[0].summary.expenses.variance,-15);assert.equal(effective[0].summary.expenses.favorability,'favorable');assert.equal(financialSummary(effective[0].summary).revenueBudget,20);assert.equal(financialSummary(effective[0].summary).revenueOriginalBudget,10);
assert.equal(bonusEvidence(effective.map(row=>row.summary),'revenue',periods,{requireEffectiveBaseline:true}).budget,60);
const missingEffective=await readFinance({fetchJson:async path=>path==='/rpc/atlas_read_finance'?structuredClone(rows):Promise.reject(Error('baseline service unavailable'))},[cid],periods);assert.equal(missingEffective[0].summary.revenue.actual,-10);assert.equal(missingEffective[0].summary.revenue.budget,null);assert.equal(missingEffective[0].summary.revenue.originalBudget,10);assert.equal(bonusEvidence(missingEffective.map(row=>row.summary),'revenue',periods,{requireEffectiveBaseline:true}),null);
console.log('PASS shared server effective baseline for Home and Bonus, distinct original comparator, mathematical variances, snapshot ancestry, and unavailable target on read failure');
const {withEffectiveBaseline}=await import('../docs/portfolio-operations-dashboard/features/canonical-finance.mjs');
const mapped={...envelopes[0],gpr:{actual:42,budget:30,activeBaseline:40,baselineSourceType:'approved_reforecast',baselineVersion:'forecast-revision',baselinePublicationId:'forecast-publication'}};
assert.equal(withEffectiveBaseline(mapped,active(periods[0])).gpr.budget,40);
assert.equal(withEffectiveBaseline({...mapped,gpr:{...mapped.gpr,baselinePublicationId:'stale'}},active(periods[0])).gpr.budget,null);
assert.equal(withEffectiveBaseline({...mapped,gpr:{...mapped.gpr,activeBaseline:null}},active(periods[0])).gpr.budget,null);
console.log('PASS server-governed metric mappings retain exact version-bound targets and reject stale mapping results');
const ytdSummary={...mapped,fiscalPeriods:periods,ytdBaselinePeriods:periods.map(period=>({period,status:'available',versionId:'forecast-revision',contentHash:'forecast-hash'})),ytd:{gpr:{actual:100,budget:70,originalBudget:70,activeBaseline:90},expenses:{actual:60,budget:90,originalBudget:90,activeBaseline:75}}};
const ytd=withEffectiveBaseline(ytdSummary,active(periods[0]));assert.equal(ytd.ytdGpr.budget,90);assert.equal(ytd.ytdGpr.originalBudget,70);assert.equal(ytd.ytdExpenses.variance,-15);assert.equal(ytd.ytdExpenses.favorability,'favorable');
assert.equal(withEffectiveBaseline({...ytdSummary,ytdBaselinePeriods:ytdSummary.ytdBaselinePeriods.slice(1)},active(periods[0])).ytdGpr.budget,null);
console.log('PASS YTD effective target requires every exact monthly lineage and retains mathematical expense variance');

// Explicit original comparison restores its own variance even if the server also attaches active evidence.
const originalRead=await readFinance({fetchJson:async()=>effective.map(row=>({...row,summary:{...row.summary,expenses:{...row.summary.expenses,originalBudget:null},ytd:{gpr:{actual:100,budget:90,originalBudget:70,activeBaseline:90,variance:10}}}}))},[cid],periods,{baselineMode:'original_budget'});
assert.equal(originalRead[0].summary.revenue.budget,10);assert.equal(originalRead[0].summary.revenue.variance,-20);assert.equal(originalRead[0].summary.expenses.budget,null);assert.equal(originalRead[0].summary.expenses.variance,null);assert.equal(originalRead[0].summary.ytdGpr.variance,30);assert.equal(originalRead[0].summary.financialSnapshot.identity.comparisonBasis,'original_budget');assert.equal(originalRead[0].summary.effectiveBaseline.publicationId,'forecast-publication');
console.log('PASS explicit original-budget comparison keeps its own mathematical variance and nulls while retaining active lineage separately');
// Delivery audit failure is nonblocking, but it must not allow a financial read
// started by a prior signed-in account to resolve after an account switch.
const observed={...active(periods[0]),versionId:'10000000-0000-0000-0000-000000000001',publicationId:'10000000-0000-0000-0000-000000000002',contentHash:'a'.repeat(64)};
actor='prior-user';let receiptCalls=0;
await assert.rejects(()=>readFinance({getSession:()=>({user:{id:actor}}),fetchJson:async path=>{
 if(path==='/rpc/atlas_read_finance')return [{...rows[0],summary:{...rows[0].summary,effectiveBaseline:observed}}];
 assert.equal(path,'/rpc/atlas_verify_budget_consumer');receiptCalls++;actor='next-user';
 return {publication_id:observed.publicationId,consumer_key:'finance_summary',content_fingerprint:observed.contentHash,delivery_status:'verified'};
}},[cid],[periods[0]]),/Session changed/);
assert.equal(receiptCalls,1);
console.log('PASS signed-in account is checked after consumer receipt verification');
