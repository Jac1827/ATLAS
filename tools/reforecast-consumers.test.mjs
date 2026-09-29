import assert from 'node:assert/strict';
import {computeReforecast} from '../docs/portfolio-operations-dashboard/features/reforecast-engine.mjs';
import {createActiveReforecastCache,activeBenchmark,mountActiveBenchmark,scoutForecastEvidence} from '../docs/portfolio-operations-dashboard/features/reforecast-consumers.mjs';
import {activeReforecastReport,activeReforecastRows} from '../docs/portfolio-operations-dashboard/features/community-plan-report.mjs';
const A='10000000-0000-0000-0000-000000000001',B='10000000-0000-0000-0000-000000000002',periods=['2026-01','2026-02'];
const source={communityId:A,periods,sourceVersion:'source-1',baseline:{versionIds:['budget-1'],lines:periods.flatMap(period=>[{period,accountCode:'5120',amount:1000},{period,accountCode:'6100',amount:200}])},registry:{version:'registry-1',accounts:[{accountCode:'5120',nature:'income',category:'Rent',placement:'above_noi'},{accountCode:'6100',nature:'expense',category:'Payroll',placement:'above_noi'}]},actuals:{cutoffPeriod:null,closeVersions:[],lines:[]},scenario:{versionId:'revision-1',driverVersion:'driver-1',drivers:[{id:'payroll',type:'payroll',accountCodes:['6100'],operation:'percent_change',value:.1}]}};
const snapshot=computeReforecast(source),published={verified:true,approved:true,locked:true,contentHash:'immutable-content-hash',publicationId:'pub-1',communityId:A,revisionId:'revision-1',version:1,periods,activePeriods:periods,publishedAt:'2026-01-01',snapshot,source};
const vintage=JSON.stringify(snapshot),current={...published,source:{...source,sourceVersion:'source-2',actuals:{cutoffPeriod:'2026-01',closeVersions:[{period:'2026-01',versionId:'close-jan'}],lines:[{period:'2026-01',accountCode:'5120',amount:1200},{period:'2026-01',accountCode:'6100',amount:250}]}}};
const jan=activeBenchmark(current,'2026-01'),feb=activeBenchmark(current,'2026-02');assert.equal(jan.metrics.noi,780);assert.equal(feb.metrics.noi,780);assert.equal(jan.sourceVersions.reforecastVersion,'revision-1');assert.equal(jan.sourceVersions.actualCloseVersions.length,0);assert.equal(scoutForecastEvidence(current,'2026-01').fingerprint,jan.fingerprint);assert.equal(activeBenchmark({...current,activePeriods:['2026-02']},'2026-01'),null);assert.equal(JSON.stringify(snapshot),vintage);
let actor='admin',calls=0,response=[current];const central={getSession:()=>({user:{id:actor}}),fetchJson:async()=>{calls++;return response;}};
const cache=createActiveReforecastCache(central);await cache.refresh([A],periods);await cache.refresh([A],periods);assert.equal(calls,1);assert.equal(cache.get(A,'2026-01').publicationId,'pub-1');assert.equal(cache.get(B,'2026-01'),null);
actor='limited';response=[];await cache.refresh([A],periods);assert.equal(cache.get(A,'2026-01'),null,'old account publication cannot survive a session change');
actor='admin';response=[current];cache.clear();const button={},container={isConnected:true,innerHTML:'',querySelector:()=>button};await mountActiveBenchmark(container,{central,communityId:A,communityName:'Test property',period:'2026-01',cache});assert(container.innerHTML.includes('780.00'));assert(container.innerHTML.includes('1,000.00'));assert(container.innerHTML.includes(jan.fingerprint));assert(!container.innerHTML.includes('1,200.00'),'Later actuals cannot replace the immutable active baseline');
const record={report_id:'report-1',snapshot:{community:'Test property',period:'2026-01',activeReforecast:current}};assert.equal(activeReforecastRows(record).find(row=>row.Metric==='noi').Active_reforecast,780);assert.equal(activeReforecastRows(record).find(row=>row.Metric==='noi').Original_budget,800);assert(activeReforecastReport(record).includes('$780.00'));assert.equal(JSON.stringify(snapshot),vintage);
console.log('PASS active benchmark, Community Command/report tables, Scout evidence and frozen Community Plan export retain immutable approved baseline values with separate actual evidence; per-period publication and session cache isolation');

const {resolveEffectiveBaseline,readEffectiveBaselines,composeBonusQuarter}=await import('../docs/portfolio-operations-dashboard/features/reforecast-consumers.mjs');
const quarter=['2026-01','2026-02','2026-03'],baselineRows=quarter.map((period,i)=>({communityId:A,period,status:'available',sourceType:i?'approved_reforecast':'original_budget',publicationId:i?'feb-mar-vintage':null,versionId:i?'revision-feb-mar':'original-v1',contentHash:'baseline-'+i,verified:true,approved:true,locked:true,lines:[{accountCode:'6100',amount:100*(i+1),nature:'expense',placement:'above_noi'}]}));
assert.equal(resolveEffectiveBaseline(baselineRows,{communityId:A,period:'2026-02'}).publicationId,'feb-mar-vintage');
assert.equal(resolveEffectiveBaseline(baselineRows,{communityId:A,period:'2026-04'}).status,'unavailable');
assert.equal(resolveEffectiveBaseline([{...baselineRows[1],stale:true}],{communityId:A,period:'2026-02'}).status,'unavailable');
assert.equal(resolveEffectiveBaseline([{...baselineRows[1],lines:[{accountCode:'6100',amount:null}]}],{communityId:A,period:'2026-02'}).reason,'missing_baseline_amount');
const canonicalBaselineReader={getSession:()=>({user:{id:'test'}}),fetchJson:async(path)=>{assert.equal(path,'/rpc/atlas_reforecast_effective_baseline');return baselineRows;}};
assert.deepEqual(await readEffectiveBaselines(canonicalBaselineReader,{communityIds:[A],periods:quarter}),baselineRows);
const paidJan={communityId:A,period:'2026-01',employeeId:'employee',planId:'plan',verified:true,paid:true,locked:true,calculationVersion:'paid-calculation',budget:100,actual:90,baselineEvidence:{sourceType:'original_budget',versionId:'original-v1',period:'2026-01'},actualCloseVersionId:'close-jan'};
const bonusInput={communityId:A,periods:quarter,baselines:baselineRows,actuals:quarter.map((period,i)=>({communityId:A,period,status:'closed',fullMonth:true,verified:true,versionId:'actual-'+period,contentHash:'actual-hash-'+i,lines:[{accountCode:'6100',amount:[90,190,280][i]}]})),plan:{id:'plan',versionId:'plan-v1',metricDefinitionId:'expense-management',eligible:true,accountCodes:['6100'],favorableDirection:'lower'},assignment:{id:'assignment',employeeId:'employee',communityId:A,eligible:true,startPeriod:'2026-01',endPeriod:'2026-12'},calculationVersion:'calculation-v2',retainedResults:[paidJan]};
const composed=composeBonusQuarter(bonusInput);assert.equal(composed.status,'available');assert.equal(composed.budget,600);assert.equal(composed.actual,560);assert.equal(composed.variance,-40);assert.deepEqual(composed.months[0],paidJan);assert.equal(composed.months[1].baselineEvidence.publicationId,'feb-mar-vintage');assert.equal(composed.payable,false,'preview composition cannot create a payable receipt');
assert.equal(composeBonusQuarter({...bonusInput,baselines:baselineRows.slice(0,2)}).status,'unavailable');
assert.equal(composeBonusQuarter({...bonusInput,actuals:bonusInput.actuals.map(row=>row.period==='2026-02'?{...row,reopened:true}:row)}).status,'unavailable');
assert.equal(composeBonusQuarter({...bonusInput,assignment:{...bonusInput.assignment,communityId:B}}).status,'unavailable');
console.log('PASS monthly effective-baseline adapter, full-quarter mixed vintages, paid/locked month retention and fail-closed stale/partial/missing/assignment gates');
const verifiedPublication={...current,verified:true,approved:true,locked:true,contentHash:'immutable-content-hash'};const immutableBenchmark=activeBenchmark(verifiedPublication,'2026-01');assert.equal(immutableBenchmark.metrics.noi,780,'A new governed close cannot replace the active locked target');assert.equal(immutableBenchmark.projectionKind,'published_vintage');
console.log('PASS upgraded active publication remains an immutable baseline when later governed actuals differ');
const {readFileSync}=await import('node:fs'),{runInNewContext}=await import('node:vm');const listeners=new Map();let financialClears=0,renders=0,removals=0;
const bridgeWindow={AtlasClosedFinancialCache:{clear(){financialClears++;}},addEventListener(name,fn){listeners.set(name,fn);},dispatchEvent(event){listeners.get(event.type)?.(event);},renderTab(){renders++;}};
runInNewContext(readFileSync(new URL('../docs/portfolio-operations-dashboard/reforecast-consumers.js',import.meta.url),'utf8'),{window:bridgeWindow,document:{querySelectorAll:()=>[{remove(){removals++;}}]},Event});
bridgeWindow.dispatchEvent(new Event('atlas-reforecast-updated'));assert.equal(financialClears,1);assert.equal(renders,1);assert.equal(removals,1);
console.log('PASS publication/reopen invalidates cached Home/Bonus targets and notifies legacy Budget financial views before rendering');

await assert.rejects(()=>createActiveReforecastCache({getSession:()=>({user:{id:'reader'}}),fetchJson:async()=>[{...current,verified:undefined}]}).refresh([A],periods),/Active baseline unavailable/);
assert.throws(()=>activeBenchmark({...current,verified:undefined},periods[0]),/Active baseline unavailable/);
console.log('PASS an old active RPC cannot supply an unverified baseline or substitute current actuals');

const oldReport={...record,snapshot:{...record.snapshot,activeReforecast:{...current,verified:undefined,approved:undefined,locked:undefined,contentHash:undefined}}};
assert.equal(activeReforecastRows(oldReport).find(row=>row.Metric==='noi').Active_reforecast,780,'A previously saved immutable report remains its historical vintage, never a current active claim');
assert(activeReforecastReport(oldReport).includes('$780.00'));

const observedPublication={...current,publicationId:'10000000-0000-0000-0000-000000000006',revisionId:'10000000-0000-0000-0000-000000000007',contentHash:'a'.repeat(64)},lateContainer={isConnected:true,innerHTML:'',querySelector:()=>({})};
actor='prior-user';let deliveryCalls=0;
const switchingCentral={getSession:()=>({user:{id:actor}}),fetchJson:async()=>{deliveryCalls++;actor='next-user';return {publication_id:observedPublication.publicationId,consumer_key:'dashboard',content_fingerprint:observedPublication.contentHash,delivery_status:'verified'};}};
await mountActiveBenchmark(lateContainer,{central:switchingCentral,communityId:A,period:'2026-01',cache:{refresh:async()=>[observedPublication]}});
assert.equal(deliveryCalls,1);assert(!lateContainer.innerHTML.includes('780.00'),'late receipt cannot render old-session financial values');
console.log('PASS dashboard prevents stale-session rendering after delivery readback');

const {effectiveBaselineMetric}=await import('../docs/portfolio-operations-dashboard/features/reforecast-consumers.mjs');
const nullEnvelope={...baselineRows[1],lines:[
 {accountCode:'5120',nature:'income',placement:'above_noi',amount:1000.005},
 {accountCode:'6100',nature:'expense',placement:'above_noi',amount:200},
 {accountCode:'6200',nature:'expense',placement:'above_noi',amount:null,disposition:'workbook_blank',legitimateBlank:true},
 {accountCode:'6300',nature:'expense',placement:'above_noi',amount:null,disposition:'outside_forecast_scope',sourceScopeExclusionConfirmed:true},
 {accountCode:'6400',nature:'expense',placement:'above_noi',amount:0}
]},nullBefore=JSON.stringify(nullEnvelope),nullBaseline=resolveEffectiveBaseline([nullEnvelope],{communityId:A,period:'2026-02'});
assert.equal(nullBaseline.status,'available');assert.equal(nullBaseline.lines[2].amount,null);assert.equal(nullBaseline.lines[3].amount,null);
assert.equal(effectiveBaselineMetric(nullBaseline,'revenue'),1000.01);assert.equal(effectiveBaselineMetric(nullBaseline,'expenses'),200);assert.equal(effectiveBaselineMetric(nullBaseline,'noi'),800.01);
assert.equal(effectiveBaselineMetric(nullBaseline,'expenses',{accountCodes:['6200']}),null,'A retained blank is not a zero GL budget');
assert.equal(effectiveBaselineMetric(nullBaseline,'expenses',{accountCodes:['6300']}),null,'Out-of-scope is not a zero GL budget');
assert.equal(effectiveBaselineMetric(nullBaseline,'expenses',{accountCodes:['6400']}),0,'An explicit numeric zero stays zero');
assert.equal(effectiveBaselineMetric(nullBaseline,'expenses',{accountCodes:['6100','6200']}),200);
for(const patch of [{disposition:'missing',legitimateBlank:true},{disposition:'workbook_blank',legitimateBlank:false},{disposition:'outside_forecast_scope',sourceScopeExclusionConfirmed:false}]){
 const bad={...nullEnvelope,lines:[{...nullEnvelope.lines[2],...patch}]};
 assert.equal(resolveEffectiveBaseline([bad],{communityId:A,period:'2026-02'}).reason,'missing_baseline_amount');
 assert.equal(effectiveBaselineMetric(bad,'expenses'),null);
}
assert.equal(resolveEffectiveBaseline([{...nullEnvelope,sourceType:'original_budget'}],{communityId:A,period:'2026-02'}).reason,'missing_baseline_amount');
assert.equal(resolveEffectiveBaseline([{...nullEnvelope,verified:false}],{communityId:A,period:'2026-02'}).reason,'unverified_baseline');
assert.equal(composeBonusQuarter({...bonusInput,baselines:baselineRows.map(row=>row.period==='2026-02'?{...row,lines:[{...row.lines[0],amount:null,disposition:'workbook_blank',legitimateBlank:true}]}:row)}).reason,'missing_bonus_baseline_amount','Blank forecast cannot silently create a zero bonus target');
assert.equal(JSON.stringify(nullEnvelope),nullBefore);assert(Object.isFrozen(nullBaseline.lines));
console.log('PASS verified workbook nulls preserve available aggregate baseline and raw null detail, strict unknown/original null rejection, decimal sums, and numeric-only bonus targets');

for(const patch of [{verified:false},{approved:false},{locked:false},{stale:true},{reopened:true},{reconciled:false},{versionId:null},{publicationId:null},{contentHash:null}])assert.equal(effectiveBaselineMetric({...nullBaseline,...patch},'expenses'),null,'Direct metric callers cannot bypass publication verification');
const decimalBaseline={...nullBaseline,lines:nullBaseline.lines.map(row=>row.accountCode==='6100'?{...row,amount:200.004}:row)};
assert.equal(effectiveBaselineMetric(decimalBaseline,'noi'),800.01,'Known-value consumer totals use rounded revenue less rounded expense, exactly like the immutable report');
console.log('PASS direct null metrics require verified publication identity and immutable staged-rounding parity');

// A compact notice next to the active metrics uses exact retained cells in the
// selected month, not a stale whole-workbook count or a converted zero amount.
assert(!container.innerHTML.includes('data-reviewed-forecast-blank-summary'),'Historical publications keep their existing summary');
const blankPublication=structuredClone(published),blankSnapshot=blankPublication.snapshot;
blankSnapshot.workbookCoverage={schemaVersion:1,reviewedForecastBlankCellCount:999,monthly:[]};
for(const line of blankSnapshot.lines.filter(row=>row.accountCode==='6100'))Object.assign(line,{forecast:null,disposition:'reviewed_forecast_blank',isBlank:true,legitimateBlank:true,reviewedForecastBlankConfirmed:true,sourceScopeExclusionConfirmed:false,source:{kind:'reviewed_forecast_blank',workbookSourceAbsent:true,uploadId:'retained-upload',auditId:'retained-audit',sourceHash:'retained-source',mappingVersion:'retained-map',sourceScenario:'Plan',review:{period:line.period,accountCode:line.accountCode,confirmed:true,reviewedBy:'reviewer',reviewedAt:'2026-01-01T00:00:00Z',reason:'Retain the future account as an editable forecast blank.'}}});
for(const month of blankSnapshot.monthly)Object.assign(month.reforecast,{expenses:0,noi:1000,cashFlow:1000});
const renderBlankPublication=async publication=>{const target={isConnected:true,innerHTML:'',querySelector:()=>({})};await mountActiveBenchmark(target,{central:{getSession:()=>({user:{id:'reader'}})},communityId:A,period:'2026-01',cache:{refresh:async()=>[publication]}});return target.innerHTML;};
const blankBefore=JSON.stringify(blankPublication),blankHtml=await renderBlankPublication(blankPublication),notice=blankHtml.match(/<p data-reviewed-forecast-blank-summary>[\s\S]*?<\/p>/)?.[0];
assert(notice);assert.match(notice,/1 reviewed intentional forecast blank in this month/);assert.match(notice,/Totals cover entered forecast values/);assert.match(notice,/Blank cells are not zeros/);assert.match(notice,/Governed actuals are loaded separately/);
assert(blankHtml.indexOf(notice)>blankHtml.indexOf('<th>Cash flow</th>')&&blankHtml.indexOf(notice)<blankHtml.indexOf('<details>'),'Coverage is visible next to the headline totals, outside collapsed detail');
assert.equal(activeBenchmark(blankPublication,'2026-01').metrics.noi,1000,'The explanatory notice does not change immutable metric amounts');assert.equal(JSON.stringify(blankPublication),blankBefore);
const filledPublication=structuredClone(blankPublication),filled=filledPublication.snapshot.lines.find(row=>row.period==='2026-01'&&row.accountCode==='6100');Object.assign(filled,{forecast:50,disposition:'reviewer_override',isBlank:false,legitimateBlank:false,reviewedForecastBlankConfirmed:false,workbookSource:structuredClone(filled.source),source:{kind:'reviewed_manual_override'}});
Object.assign(filledPublication.snapshot.monthly.find(row=>row.period==='2026-01').reforecast,{expenses:50,noi:950,cashFlow:950});
const filledHtml=await renderBlankPublication(filledPublication);assert.match(filledHtml,/<p data-reviewed-forecast-blank-summary><strong>0 reviewed intentional forecast blanks in this month/,'A later entered amount removes that cell from the blank count');assert.equal(filled.forecast,50);assert(filledHtml.includes('950.00'));
const inheritedPublication=structuredClone(filledPublication);delete inheritedPublication.snapshot.workbookCoverage;assert.match(await renderBlankPublication(inheritedPublication),/0 reviewed intentional forecast blanks in this month/,'Inherited source provenance keeps the explanation after all selected blanks are filled');
console.log('PASS active headline coverage for reviewed forecast blanks: selected-month exact null count, visible known-value basis, manual-fill decrease, inherited provenance, no metric or publication mutation, and unchanged legacy output');
