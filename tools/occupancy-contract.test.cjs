const {readDashboardSource}=require('./dashboard-source.cjs');
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const html = readDashboardSource(__dirname + '/../docs/portfolio-operations-dashboard/index.html');
const c = {console, Date, Map, Set, window:{AtlasLeadSources:require("../docs/portfolio-operations-dashboard/lead-source-contract.js")}, MONTHS:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'], DEFAULT_SEASONAL:Array(12).fill(1), DEFAULT_CURRENT_MONTH:8, bonusQuarter:'Q3', PROPERTY_TEAM_ROLE_ORDER:[], dataImport2State:{lineage:[]}, communityCommandState:{trendMode:'12'}, savedData:{}};
c.FULL_MONTHS=c.MONTHS; vm.createContext(c);
for (const f of html.matchAll(/^(?:async )?function [A-Za-z_$][\w$]*\([^\n]*\) \{[\s\S]*?^\}/gm)) vm.runInContext(f[0],c);
// Isolate unrelated personnel/configuration services. Production occupancy,
// summary, schedule, command model, chart and KPI rendering functions run below.
Object.assign(c, {
 normalizeSavedCommunityRecord:(name,r)=>JSON.parse(JSON.stringify(r)),
 getProp:()=>({name:'Citrus Ridge',units:222}), getPropertyByName:()=>({name:'Citrus Ridge',units:222}),
 matchPropertyName:n=>n, getSelectedDashboardMonthIndex:()=>8,
 normalizeReputationData:()=>({}), normalizePropertyTeamConfig:()=>({}),
 normalizePropertyTurnoverByQuarter:()=>({Q3:{}}), normalizeMsoeByQuarter:()=>({Q3:null}),
 getPropertyTurnoverTotalsFromQuarterMap:()=>({}), getPropertyTeamTurnoverRate:()=>({}),
 getPropertyTurnoverConfigForQuarter:()=>({}), normalizeDlrSummary:()=>({dailyBoxScore:{},pricing:{}}),
 normalizeDlrBoxScoreSnapshot:()=>({}), getCommunityCommandEconomicOccupancyData:()=>({mtdPct:null,sourceLabel:'Missing rent-charge mapping'}),
 getCommunityCommandActivePlan:()=>null, communityCommandCanOverrideDashboard:()=>false,
 getCommunityCommandDashboardOverride:()=>null, getCommunityCommandApprovedGoal:()=>null,
});
const record={currentMonth:8,reportYear:2026,currentOccupied:184,currentLeased:181,customUnits:'',corporateLeaseUnits:0,occupancyGoal:95,leasedGoal:97,conversionRate:65,monthlyData:c.defaultMonthly(),monthlyHistoryByPeriod:{},savedBudgetTargets:Array(12).fill(95),seasonal:Array(12).fill(1),sharedSyncUpdatedAt:'2026-09-11T15:56:53.094Z'};
Object.assign(record.monthlyData[8], {budgetOcc:95,occupiedSnapshot:184,leasedSnapshot:181,sourceLeasedUnits:191,sourceTotalUnits:222,rentableUnits:220,physicalOccupancyPct:184/220*100,leasedOccupancyPct:191/220*100,exposureUnits:41,guestCards:59,walkIn:6,phoneCalls:16,emailsOnline:19,textChatOther:18,tours:6,applications:2,applicationsApproved:1,denied:3,moveIns:2,moveOuts:5,leasesSignedActual:2});
const close=(a,b)=>assert(Math.abs(a-b)<1e-8,`${a} != ${b}`);
let model=c.buildCommunityCommandModel('Citrus Ridge',record);
assert.equal(model.occupancyBaseUnits,220);assert.equal(model.occupied,184);assert.equal(model.leased,191);
close(model.physicalPct,184/220*100);close(model.leasedPct,191/220*100);close(model.trendingPct,179/220*100);
assert.equal(model.summary.budgetOccUnits,209);assert.equal(model.plan.occupancyGapUnits,25);assert.equal(model.schedule[8].netOccLeases,25);
const points=c.getCommunityCommandTrendPoints(model);close(points[8].physical,model.physicalPct);close(points[8].leased,model.leasedPct);close(points[8].trending,model.trendingPct);assert.equal(points[9].trending,null);
let markup=c.renderCommunityCommandHealthSnapshot(model);assert(markup.includes('83.6%'));assert(markup.includes('86.8%'));assert(markup.includes('184 occupied of 220 comparable units'));assert(markup.includes('191 leased units'));assert(markup.includes('179 not-exposed leased units'));assert(!markup.includes('September 11'));
for(const field of ['occupied_units','leased_units','applications','move_ins','move_outs'])c.dataImport2State.lineage.push({currentState:true,communityName:'Citrus Ridge',periodKey:'2026-09',atlasField:field,sourceFile:'Box Score September.xlsx',dataAsOf:'2026-09-16T16:00:00Z'});
c.dataImport2State.lineage.push({currentState:true,communityName:'Other community',periodKey:'2026-09',atlasField:'occupied_units',sourceFile:'Wrong.xlsx',dataAsOf:'2026-09-17'});
model=c.buildCommunityCommandModel('Citrus Ridge',JSON.parse(JSON.stringify(record)));
markup=c.renderCommunityCommandHealthSnapshot(model);assert(markup.includes('Box Score September.xlsx'));assert(!markup.includes('Wrong.xlsx'));assert(!markup.includes('September 11'));
assert(!c.getCommunityCommandMetricSourceLabel(model,'budget_occupancy').includes('Box Score'));
assert(!c.getCommunityCommandMetricSourceLabel(model,'renewal_conversion').includes('Box Score'));
const manual=JSON.parse(JSON.stringify(record));manual.monthlyData[8].leasedSnapshot=195;
assert.equal(c.buildCommunityCommandModel('Citrus Ridge',manual).leased,195,'Later explicit snapshot is not replaced by an old report');
const invalid={...record.monthlyData[8],sourceTotalUnits:999};assert.equal(c.getReportedOccupancySnapshot(invalid,222),null);assert.equal(c.getReportedOccupancyBaseUnits(invalid,222),222);
const zero={...record.monthlyData[8],sourceLeasedUnits:0,leasedSnapshot:0,occupiedSnapshot:0,physicalOccupancyPct:0,exposureUnits:220};assert.equal(c.getReportedOccupancySnapshot(zero,222).leasedUnits,0);
const corp=c.getReportedOccupancySnapshot(record.monthlyData[8],222,2);assert.equal(corp.baseUnits,218);assert.equal(corp.leasedUnits,189);assert.equal(corp.trendUnits,177);
console.log('PASS saved legacy and JSON reload -> summary, Command model/cards, trend chart, 95% target, metric provenance, zero counts, corporate exclusions and manual snapshot protection.');

const corporateRecord={...record,corporateLeaseUnits:2};const corporateModel=c.buildCommunityCommandModel("Citrus Ridge",corporateRecord);assert.equal(corporateModel.schedule[8].netOccLeases,26,"Corporate units are excluded exactly once");
