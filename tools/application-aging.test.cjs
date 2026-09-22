const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const A=require('../docs/portfolio-operations-dashboard/application-aging.js');
const W=require('../docs/portfolio-operations-dashboard/weekly-leasing-report.js');
const rec=(id,asOf,status='Application: Started')=>({applicationId:id,property:'Baymeadows',leasingAgent:'Peacock, Michelle',newLeadCreatedOn:'2026-08-01',sourceAsOf:asOf,applicationStatus:status});
const snap=(asOf,records)=>({community:'Baymeadows',asOf,records});
assert(!A.aged({...rec('1','2026-09-07'),newLeadCreatedOn:'2026-09-01'}));
assert(A.aged({...rec('1','2026-09-08'),newLeadCreatedOn:'2026-09-01'}));
for(const s of ['Application: Completed','Application: Cancelled','Renewal: Started','Lease: Approved'])assert(!A.aged(rec('1','2026-09-17',s)));
const snapshots=[snap('2026-08-31',[rec('1','2026-08-31')]),snap('2026-09-11',[rec('1','2026-09-11')]),snap('2026-09-17',[rec('1','2026-09-17'),rec('1','2026-09-17'),rec('2','2026-09-17','Application: Partially Completed')])];
let row=A.model(snapshots,{start:'2026-09-01',end:'2026-09-30'})[0];
assert.equal(row.current,2);assert.equal(row.derogatoryCount,2);assert.equal(row.previousWeek,1);assert.equal(row.previousMonth,1);assert(row.repeatWeek&&row.repeatMonth);
row=A.model(snapshots.slice(2),{start:'2026-09-01'})[0];assert.equal(row.previousWeek,null);assert.equal(row.repeatMonth,null);
row=A.model([...snapshots,snap('2026-09-18',[rec('1','2026-09-18','Application: Completed')])],{start:'2026-09-01'})[0];assert.equal(row.current,0);assert.equal(row.repeatWeek,false);assert.equal(row.derogatoryCount,2);
assert.equal(A.latestRecords([rec('old','2026-05-08'),rec('new','2026-09-17')]).length,1);
const model=W.model({records:[rec('1','2026-09-17')],communities:['Baymeadows'],end:'2026-09-17',period:'2026-09',offers:[{name:'Baymeadows',current:{asking:1778,ner:1437,offer:'Ten weeks free'}}]});
const report=W.document(model);assert(report.includes('$1,778')&&report.includes('$1,437'));assert(!report.includes('<th>Source</th>'));assert(/Concessions across communities<\/h2>\s*<table>/.test(report));assert(report.includes('background:#e8f3f8'));assert(report.includes('color:#b42318;font-weight:700">Peacock, Michelle'));assert(report.includes('color:#b42318;font-weight:700">1</td>'));
// Source display names cannot identify compensation employees; advisory never changes pay.
const html=fs.readFileSync(__dirname+'/../docs/portfolio-operations-dashboard/index.html','utf8');
const fn=html.match(/^function atlasBonusBuildCalculationRows\(options = \{\}\) \{[\s\S]*?^\}/m)[0];
const employee={name:'Michelle Peacock',communityName:'Baymeadows'};
const c={window:{AtlasApplicationAging:A},bonusQuarter:'Q3',atlasBonusState:()=>({filters:{}}),atlasBonusPeriodFromQuarter:()=>({start:'2026-07-01',end:'2026-09-30',periodKey:'2026-Q3'}),atlasBonusAuthorizedEmployees:()=>[employee],atlasBonusBuildRow:e=>({employee:e,exceptions:[],finalPayout:500}),atlasBonusEmployeeDisplayName:e=>e.name,getAtlasApplicationAgingRows:()=>[{community:'Baymeadows',professional:'Peacock, Michelle',derogatoryCount:2}]};
vm.createContext(c);vm.runInContext(fn,c);let rows=c.atlasBonusBuildCalculationRows();assert.equal(rows[0].exceptions.length,0);assert.equal(rows[0].applicationAgingDerogatoryCount,undefined);assert.equal(rows[0].finalPayout,500);
c.atlasBonusAuthorizedEmployees=()=>[employee,{...employee}];rows=c.atlasBonusBuildCalculationRows();assert(rows.every(r=>!r.exceptions.length),'Ambiguous employee attribution must not be guessed');
console.log('PASS aging threshold/status, newest snapshot, deduplication, WoW/MoM missing history, resolved records, report styling/currency, bonus review attribution and unchanged pay.');

assert(A.render([row],true).startsWith('<details'));assert(!/<details[^>]*\bopen\b/.test(A.render([row],true)));
const bonusRender=html.match(/^function renderBonusTab\(\) \{[\s\S]*?^\}/m)[0];assert(bonusRender.indexOf('renderBonusEngineSection(activeSection, rows)')<bonusRender.indexOf('window.AtlasApplicationAging.render'));assert(bonusRender.includes('activeSection === \"exceptions\"'));
