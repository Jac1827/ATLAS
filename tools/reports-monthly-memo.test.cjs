const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=fs.readFileSync('docs/portfolio-operations-dashboard/workspace-core.js','utf8'),reports=fs.readFileSync('docs/portfolio-operations-dashboard/features/reports-workspace.js','utf8');
const c={Date,Number,Array};c.window=c;vm.createContext(c);
for(const name of ['defaultMonthly','normalizeBudgetOccupancyPct','deriveSavedBudgetTargetsFromMonthlyData','repairMonthlyBudgetTargets','buildPeriodKey','normalizeMonthlyHistoryByPeriod','normalizeCommunityMonthlySources','getRecordHistoryEntry','getRecordMonthEntryForPeriod','getRecordMonthlyDataForYear']){
 const match=core.match(new RegExp('^function '+name+'\\([^\\n]*\\) \\{[\\s\\S]*?^\\}','m'));assert(match,name);vm.runInContext(match[0],c);
}
const original=c.getRecordMonthlyDataForYear,normalize=c.normalizeCommunityMonthlySources;
let monthlyReads=0,normalizations=0;
c.getRecordMonthlyDataForYear=(...args)=>{monthlyReads++;return original(...args);};
c.normalizeCommunityMonthlySources=(...args)=>{normalizations++;return normalize(...args);};
vm.runInContext(reports.slice(0,reports.indexOf('let atlasCommunityProgressPreview')),c);
const year=new Date().getFullYear(),months=c.defaultMonthly();months[0]={applications:0,tours:null,budgetOcc:95,source:'retained'};
const record={monthlyData:months,monthlyHistoryByPeriod:{[`${year-1}-01`]:{applications:null,tours:0,source:'prior'}},savedBudgetTargets:[95,94]};
const plain=x=>JSON.parse(JSON.stringify(x));const before=JSON.stringify(record),expected=plain(original(record,year));
monthlyReads=0;normalizations=0;vm.runInContext('atlasReportRenderContext=new Map()',c);
const a=c.getRecordMonthlyDataForYear(record,year),b=c.getRecordMonthlyDataForYear({...record,currentMonth:2,unrelated:'fresh-copy'},year);
assert.equal(a,b);assert.deepEqual(plain(a),expected);assert.equal(monthlyReads,1);assert.equal(normalizations,1);
const prior=c.getRecordMonthlyDataForYear(record,year-1);assert.equal(prior[0].applications,null);assert.equal(prior[0].tours,0);assert.equal(prior[0].source,'prior');assert.equal(monthlyReads,2);assert.equal(normalizations,1,'Distinct year reuses only the common monthly normalization');
const different={...record,monthlyData:months.map((x,i)=>i===0?{...x,applications:9}:x)};
assert.equal(c.getRecordMonthlyDataForYear(different,year)[0].applications,9);assert.equal(normalizations,2,'A different source array cannot share the result');
assert.equal(JSON.stringify(record),before,'Source evidence is never changed by memoization');
vm.runInContext('atlasReportRenderContext=null',c);record.monthlyData[0].applications=7;
vm.runInContext('atlasReportRenderContext=new Map()',c);assert.equal(c.getRecordMonthlyDataForYear(record,year)[0].applications,7,'In-place edit is fresh on next synchronous render');
vm.runInContext('atlasReportRenderContext=null',c);const outside=c.getRecordMonthlyDataForYear(record,year);outside[0].applications=999;assert.equal(c.getRecordMonthlyDataForYear(record,year)[0].applications,7,'Outside rendering, original independent-result behavior remains');
assert.equal(c.getRecordMonthlyDataForYear(null,year).length,12);
console.log('PASS Reports month memo: exact source-array/year keys, shallow-copy reuse, full original values/history/null/zero parity, source immutability, fresh next render and independent external reads.');
// The trend payload never consumes recommendations: verify both report shapes
// against the original construction, with a getter that fails if read.
const trend=core.match(/^function buildCommunityProgressTrendRows\([^\n]*\) \{[\s\S]*?^\}/m)[0];
vm.runInContext('const COMMUNITY_PROGRESS_TREND_DETAIL_OPTIONS=Object.freeze({includeRecommendations:false});\n'+trend+'\n'+trend.replace('function buildCommunityProgressTrendRows','function originalTrend').replaceAll('COMMUNITY_PROGRESS_TREND_DETAIL_OPTIONS','undefined'),c);
Object.assign(c,{MONTHS:['Jan','Feb'],FULL_MONTHS:['January','February'],clampNumber:(v,min,max)=>Math.max(min,Math.min(max,v)),getPropertyByName:()=>({units:100}),getResolvedTotalUnitsForRecord:()=>100,normalizeCorporateLeaseUnits:()=>0,getCorporateLeaseUnitsForRecord:()=>0,getOccupancyBaseUnits:()=>100,getComparableOccupancyUnits:v=>v,estimateSnapshotUnitsForRecordMonth:()=>0,buildCommunityProgressMarketPerformance:()=>({compAverageLeasedPct:null,compAverageExposurePct:null}),getRecordSavedBudgetOccPct:()=>95,calculateFunnelConversionPct:(a,b)=>a/b*100,getAttributableLeaseConversionCount:({leases})=>leases,getEffectiveMoveOutsForMonth:()=>({effective:0}),getSummaryOccPct:x=>x.occPct,getSummaryLeasedPct:x=>x.leasedPct});
let recommendationBuilds=0;const summary={occPct:0,leasedPct:0,guestCards:0,tours:0,applications:0,applicationsApproved:0,moveIns:0,moveOuts:0,monthAbsorption:0,budgetOccPct:95,renewalExpirations:0,renewalsSigned:0,renewalUndecided:0,renewalProjectedAttrition:0};
c.buildCommunityDetailForMonth=(name,record,month,year,options={})=>{if(options.includeRecommendations!==false)recommendationBuilds++;return {name,record,summary:{...summary},get recommendations(){throw Error('Trend must not consume recommendations');}};};
c.aggregateCommunitySummaries=()=>({...summary});
for(const report of [{communityName:'Synthetic',sourceRecord:record,reportMonthIdx:1,reportYear:year},{communityReports:[{communityName:'Synthetic A',sourceRecord:record},{communityName:'Synthetic B',sourceRecord:record}],reportMonthIdx:1,reportYear:year}]){
 recommendationBuilds=0;const old=plain(c.originalTrend(report));assert(recommendationBuilds>0);recommendationBuilds=0;const next=plain(c.buildCommunityProgressTrendRows(report));assert.deepEqual(next,old);assert.equal(recommendationBuilds,0);assert.equal(next[0].occupancyPct,0);assert.equal(next[0].renewalRetention,null);
}
console.log('PASS single/portfolio trend rows exactly preserve the prior scalar payload, zero and missing values, while omitting unused recommendations.');
