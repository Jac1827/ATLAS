const assert=require('node:assert/strict');
const P=require('../docs/portfolio-operations-dashboard/investor-packet-core.js');
const S=require('../docs/portfolio-operations-dashboard/investor-packet-sources.js');
const record={generalManagerName:'Test owner',monthlyHistoryByPeriod:{'2026-01':{guestCards:0,physicalOccupancyPct:92,economicOccupancyPct:99,actualCharges:88,grossPotentialRent:100,revenue:100,expenses:70},'2025-12':{revenue:90,expenses:65}},marketSurveyHistory:{'2026-01':{sourceFileName:'market.xlsx',compAverageRent:1500,compAverageNer:1400,surveyComps:[{name:'Comparable',rent:1500,ner:1400,leasedPct:93}]}},renewalDetailRowsByPeriod:{'2026-01':[{status:'Signed & Executed'},{status:'NTV Received'}]},importTracking:{renewals:{'2026-01':{sourceFileName:'renewals.xlsx'}}}};
const imports={lineage:[{currentState:true,communityName:'A',periodKey:'2026-01',atlasField:'new_leads',importedValue:0,sourceFile:'entrata.xlsx'},{currentState:true,communityName:'B',periodKey:'2026-01',atlasField:'new_leads',importedValue:100}]};
const maintenance={db:{weeks:{'2026-01-29':{perfByProp:{A:{notc:4,comp:10,src:'workorders.xlsx'},B:{notc:999}},manual:{A:{vacantNR:3}}}}}};
const central={evictions:[{id:'x',propertyName:'A',periodKey:'2026-01',delinquentBalance:100,sourceFileName:'cases.xlsx',fileDate:'2026-01-02',residentName:'DO NOT EXPORT'},{id:'z',propertyName:'B',periodKey:'2026-01',delinquentBalance:999,sourceFileName:'other.xlsx'}]};
const applications=[{applicationId:'one',communityName:'A',reportPeriodKey:'2026-01',leadSource:'Web',sourceFileName:'applications.xlsx',applicationPartiallyCompletedOn:'2026-01-02',applicationStatus:'Lease: Completed',residentName:'PRIVATE'}, {applicationId:'one',communityName:'A',reportPeriodKey:'2026-01',leadSource:'Web'}, {applicationId:'two',communityName:'B',reportPeriodKey:'2026-01'}];
const before=JSON.stringify({record,imports,maintenance,central,applications});
const rec=S.connect({community:'A',record,imports,maintenance,central,applications});
const p=P.build({community:'A',period:'2026-01',record:rec});const v=id=>p.rows.find(r=>r.id===id).cells.current.value;
assert.equal(v('guestCards'),0,'Verified import zero is a real zero');
assert.equal(v('physicalOccupancy'),92);assert.equal(v('economicOccupancy'),null,'Legacy ratios without closed-package evidence are unavailable');assert.equal(v('compRent'),1500);
assert.equal(v('renewalSigned'),1);assert.equal(v('retention'),50);assert.equal(v('openWorkOrders'),4);assert.equal(v('unitsNotReady'),3);
assert.equal(v('completedWorkOrders'),null,'Weekly completions cannot become monthly totals');
assert.equal(v('caseReceivables'),100);assert.equal(v('receivables'),null,'Case balances cannot become total property receivables');
assert.equal(v('applicationsStarted'),1,'Duplicate application IDs must be excluded');
assert.equal(p.segments.find(x=>x.segment==='Web').values.signedStatus,1);
assert(!JSON.stringify(p).includes('PRIVATE'));assert(!JSON.stringify(p).includes('DO NOT EXPORT'));
assert.equal(P.read(rec,'2025-01','compRent').value,null);
assert.equal(JSON.stringify({record,imports,maintenance,central,applications}),before);
const auto=S.narrate(p,rec,{});assert(auto.performance.includes('92%'));assert(auto.performanceSource.includes('physicalOccupancy.current'));
const edited=S.narrate(p,rec,{performance:'My reviewed explanation',performanceSource:'Owner note'});assert.equal(edited.performance,'My reviewed explanation');
assert(p.issues.some(x=>x.issue.includes('weekly completions')));
console.log('PASS automatic source connections, exact community/period, verified zeros, renewal cohorts, case-scope protection, PII exclusion, deduplication, generated narratives and user override preservation.');

for(const [fields,expected] of [[{actualCharges:0,grossPotentialRent:100},0],[{actualCharges:-5,grossPotentialRent:100},-5],[{actualCharges:90,grossPotentialRent:0},null],[{actualCharges:null,grossPotentialRent:100},null],[{actualCharges:90,grossPotentialRent:100},90],[{},null]]) {
 const connected=S.connect({community:'A',record:{monthlyHistoryByPeriod:{'2026-01':{economicOccupancyPct:99,...fields}}}});
 assert.equal(P.read(connected,'2026-01','economicOccupancy').value,null,'Unclosed charges never supply economic occupancy');
 assert.equal(P.read(connected,'2025-01','economicOccupancy').value,null);
}
