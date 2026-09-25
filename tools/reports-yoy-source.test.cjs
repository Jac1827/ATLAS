const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const path=__dirname+'/../docs/portfolio-operations-dashboard/workspace-core.js';
const source=fs.readFileSync(path,'utf8').match(/^function buildCommunityProgressYoyApplicationsSummary\([^]*?^\}/m)[0];
const c={};vm.createContext(c);vm.runInContext(`
const getReportHubMonthIndex=()=>8,getReportHubYear=()=>2026,clampNumber=(n,min,max)=>Math.min(max,Math.max(min,n)),formatDlrMonthYear=(m,y)=>y+'-'+String(m+1).padStart(2,'0');
function buildCommunityDetailForMonth(){throw Error('YOY reads retained history and market snapshots directly; it must not construct unused community details/recommendations');}
const getRecordHistoryEntry=(record,m,y)=>record.history?.[y+'-'+m]??null;
const getMarketSurveySnapshotForPeriod=(record,m,y,options)=>record.surveys?.[y+'-'+m]??(options.allowCurrentFallback?record.fallback:null)??{};
const hasMarketSurveyData=survey=>survey.available===true;
`,c);vm.runInContext(source,c);
const plain=x=>JSON.parse(JSON.stringify(x));
assert.equal(c.buildCommunityProgressYoyApplicationsSummary(null),null);
const a={history:{'2025-8':{applications:10}},surveys:{'2026-8':{available:true,applicationsLast30:60,surveyComps:[{name:'A'},{name:'B'},{name:'Subject',isSubject:true}]},'2025-8':{available:true,applicationsLast30:30}}};
const b={history:{'2025-8':{applications:0}},fallback:{available:true,applicationsLast30:0,surveyComps:[{name:'C'},{name:' '}]}};
const report={communityReports:[{communityName:'Synthetic A',sourceRecord:a},{communityName:'Synthetic B',sourceRecord:b}],reportMonthIdx:8,reportYear:2026,trafficMetrics:{applications:20}};
const before=JSON.stringify(report);const combined=plain(c.buildCommunityProgressYoyApplicationsSummary(report));
assert.deepEqual(combined,{currentPeriodLabel:'2026-09',previousPeriodLabel:'2025-09',self:{currentValue:20,previousValue:10,delta:10,pctChange:100,coverageCount:2,expectedCount:2},market:{currentValue:60,previousValue:30,delta:30,pctChange:100,currentCoverageCount:2,previousCoverageCount:1,expectedCount:2,currentFallbackUsed:true,compCount:3,averageAppsPerComp:20}});
assert.equal(JSON.stringify(report),before,'Retained source records are never modified');
const sparse=plain(c.buildCommunityProgressYoyApplicationsSummary({communityName:'Sparse',sourceRecord:{},reportMonthIdx:0,reportYear:2025,trafficMetrics:{applications:0}}));
assert.equal(sparse.self.currentValue,0);assert.equal(sparse.self.previousValue,0);assert.equal(sparse.self.pctChange,null);assert.equal(sparse.self.coverageCount,0);assert.equal(sparse.market.previousCoverageCount,0);assert.equal(sparse.market.averageAppsPerComp,null);assert.equal(sparse.currentPeriodLabel,'2025-01');
const explicitNull=plain(c.buildCommunityProgressYoyApplicationsSummary({communityName:'Synthetic',sourceRecord:{history:{'2026-1':{applications:null}},surveys:{'2027-1':{available:true,applicationsLast30:0,surveyComps:[]}}},reportMonthIdx:1,reportYear:2027,trafficMetrics:{applications:0}}));
assert.equal(explicitNull.self.coverageCount,1,'Explicit null presence retains original coverage semantics');assert.equal(explicitNull.self.previousValue,0);assert.equal(explicitNull.self.pctChange,null);assert.equal(explicitNull.market.currentCoverageCount,1);assert.equal(explicitNull.market.currentValue,0);assert.equal(explicitNull.market.averageAppsPerComp,null);
console.log('PASS YOY source-only calculation: full aggregate expected values, prior/future sparse history, explicit zero/null presence, market fallback/comp coverage and source immutability; unused detail construction is forbidden.');
