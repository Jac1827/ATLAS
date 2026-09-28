const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/../docs/portfolio-operations-dashboard/workspace-core.js','utf8');
const extract=name=>source.match(new RegExp('^function '+name+'\\([^]*?^\\}','m'))[0];
const builders=['buildCommunityProgressSingleReportData','buildCommunityProgressReportData'].map(extract).join('\n');
function fixture(previous){
 const c={};vm.createContext(c);vm.runInContext(`
 let recommendationBuilds=0,selected=['Synthetic A','Synthetic B'];
 const COMMUNITY_PROGRESS_TREND_DETAIL_OPTIONS=Object.freeze({includeRecommendations:false});
 const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],DEFAULT_SEASONAL=Array(12).fill(1);
 const entries=MONTHS.map((_,i)=>({guestCards:i===0?0:4,tours:0,applications:0,applicationsApproved:0,moveIns:0,moveOuts:0,nerActual:null,proformaRent:1200}));
 const record={monthlyData:entries,communityFloorPlans:[],marketSurveyData:{},savedBudgetTargets:Array(12).fill(95)};
 const summary={totalUnits:100,occupied:0,leased:0,occupancyBaseUnits:100,occupiedRaw:0,leasedRaw:0,guestCards:0,tours:0,applications:0,applicationsApproved:0,applicationsDenied:0,applicationsCancelled:0,applicationsPendingDecision:0,leasesSigned:0,moveIns:0,moveOuts:0,renewalsSigned:0,renewalExpirations:0,renewalUndecided:0,renewalProjectedAttrition:0,renewalRetentionRate:0,budgetOccPct:95};
 function buildCommunityDetailForMonth(name,record,month,year,options={}){if(options.includeRecommendations!==false)recommendationBuilds++;return {name,record,summary:{...summary},get recommendations(){throw Error('Community Progress detail consumers must not read unused recommendations');}};}
 const getReportHubMonthIndex=()=>8,getReportHubYear=()=>2026,getCommunityProgressReportCommunityName=()=>selected[0],getCommunityProgressReportCommunityNames=()=>selected,getCommunityProgressReportScopeLabel=()=>selected.join(', '),getPersistedCommunityRecordForScope=()=>record;
 const getPropertyByName=()=>({units:100}),getResolvedTotalUnitsForRecord=()=>100,getCorporateLeaseUnitsForRecord=()=>0,getRecordMonthlyDataForYear=record=>record.monthlyData;
 const computeScheduleFromContext=()=>MONTHS.map(()=>({occPct:0,guestCardsNeeded:0,toursNeeded:0,apps:0,grossLeases:0}));
 const getRenewalSummaryForMonth=()=>({expirations:0,signed:0,undecided:0,projectedAttrition:0,retentionRate:0}),getEffectiveMoveOutsForMonth=()=>({effective:0}),getRecordSavedBudgetOccPct=()=>95,getMoveInTargetFromScheduleRow=()=>0;
 const formatDlrMonthYear=(m,y)=>MONTHS[m]+' '+y,getDashboardMonthLabel=m=>MONTHS[m],getComparableOccupancyUnits=v=>v,getOccupancyBaseUnits=(n,c)=>n-c,getOccupancyPctFromComparableUnitsOrFallback=(n,d)=>d?n/d*100:0;
 const getCompCalculatorSurveySnapshot=()=>({}),buildCommunityProgressMarketPerformance=()=>({compAverageLeasedPct:0,compAverageExposurePct:0,updatedOn:null});
 const buildFunnelConversionMetrics=()=>({guestToTourPct:0,tourToAppPct:0,appToLeasePct:0}),getTopLeadSourceFacts=()=>[];
 const buildCommunityFloorPlanVarianceRows=()=>({rows:[],unmatchedRates:[]}),getReportableCommunityFloorPlans=x=>x,buildCommunityProgressBedroomRentComparisonRows=()=>[],collectMonthlyPresentationPhotos=()=>[],collectInterleavedMonthlyPresentationPhotos=()=>[];
 const buildCommunityProgressNarrative=()=>({note:'Synthetic'}),getMonthlyPresentationRegionalStaffForDetails=()=>[],buildCommunityProgressTrendRows=()=>[{monthIdx:0,occupancyPct:0,renewalRetention:null}],normalizeMarketSurveyData=x=>x;
 const buildCommunityProgressStabilization=()=>({months:null}),buildCommunityProgressHistoricalApplicationsWeeklyTrend=()=>({avgAppsPerWeek:0}),buildCommunityProgressYoyApplicationsSummary=()=>({prior:null}),buildCommunityProgressReportAlerts=()=>[];
 const aggregateCommunitySummaries=()=>({...summary}),getSummaryOccPct=()=>0,getSummaryLeasedPct=()=>0,aggregateCommunityProgressBedroomRentComparisonRows=()=>[];
 const window={AtlasLeadSources:{combine:()=>({walkIn:null}),sum:values=>values.some(v=>v===null)?null:values.reduce((a,b)=>a+b,0)}};
 `,c);vm.runInContext(previous?builders.replaceAll('COMMUNITY_PROGRESS_TREND_DETAIL_OPTIONS','undefined'):builders,c);return c;
}
const plain=value=>JSON.parse(JSON.stringify(value,(key,value)=>key==='generatedAt'?undefined:value));
for(const selected of [['Synthetic A'],['Synthetic A','Synthetic B']]){
 const old=fixture(true),next=fixture(false);vm.runInContext('selected='+JSON.stringify(selected),old);vm.runInContext('selected='+JSON.stringify(selected),next);
 const before=plain(old.buildCommunityProgressReportData({silent:true})),after=plain(next.buildCommunityProgressReportData({silent:true}));
 assert.deepEqual(after,before,'Actual single/portfolio report builders retain every field');
 assert.ok(vm.runInContext('recommendationBuilds',old)>0);assert.equal(vm.runInContext('recommendationBuilds',next),0);
 assert.equal(after.occupancyPct,0);assert.equal(after.pricing.avgNetEffectiveRent,null);assert.equal(after.trendRows[0].renewalRetention,null);
}
console.log('PASS actual single/portfolio Community Progress builders preserve complete payload/null/zero values and never consume or build unused recommendations at current/market/forward detail call sites.');
