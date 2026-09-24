const {readDashboardSource}=require('./dashboard-source.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const P=require('../docs/portfolio-operations-dashboard/property-intelligence.js');
const B=require('../docs/portfolio-operations-dashboard/application-source-bridge.js');
assert.deepEqual(P.sectionDates('Lead Activity (09/01/2026 - 09/30/2026)'),{start:'2026-09-01',end:'2026-09-30',asOf:''});
assert.equal(P.sectionDates('Availability (As of 09/17/2026)').asOf,'2026-09-17');
const employees=[{id:'g',name:'GM',role:'General Manager',region:'North'},{id:'r',name:'Regional',role:'Regional Manager',region:'North'},{id:'a',name:'Assistant',role:'Assistant General Manager',bonusRoleType:'gm',region:'North'},{id:'x',role:'General Manager',region:'South'},{id:'i',role:'General Manager',region:'North',status:'Inactive'}];
assert.deepEqual(P.eligible(employees,'gm','North').map(e=>e.id),['g']);
assert.deepEqual(P.eligible(employees,'regional','North').map(e=>e.id),['r']);
assert.equal(P.eligible(employees,'gm','').length,0);
const rows=[['02 - RISE - Box Score'],['Lead Activity (09/01/2026 - 09/30/2026)'],[],['Unit Type','New Leads','First Visits/Tours'],['A',20,5],['Unknown',31,18],['Total:',51,23],['Lead Conversions (09/01/2026 - 09/30/2026)'],['','Application','','','','','','Lease'],['Unit Type','Completed','Partially Completed','Completed (Cancelled)','Denied','Approved','Approved (Cancelled)','Completed'],['A',10,0,2,2,5,3,4],['Total:',10,0,2,2,5,3,4]];
const parsed=B.boxScore(rows);assert.equal(parsed.length,2);
const values=Object.assign({},...parsed.map(r=>r.values));
assert.equal(values.new_leads,51);assert.equal(values.leases_completed,4);assert.equal(values.cancelled_applications,undefined,'Do not sum overlapping cancellations');
const snapshots=parsed.map(r=>({...r.period,section:r.section,values:r.values,sourceFile:'box.xlsx',sourceSheet:'Baymeadows',importedAt:'2026-09-17T12:00:00Z'}));
const r=P.ranges('2026-09'),cells=P.metrics([...snapshots,...snapshots],r);
assert.equal(cells.new_leads.value,51);assert.equal(cells.applications.value,10);assert.equal(cells.denied_applications.value,2);assert.match(cells.new_leads.status,/In progress/);
assert.equal(P.metrics(snapshots,{start:'2026-09-10',end:'2026-09-20'}).new_leads.value,null);
assert.equal(P.metrics(snapshots,P.ranges('2026-08')).new_leads.value,null);
assert.equal(P.metrics([...snapshots,{...snapshots[0],values:{new_leads:60},importedAt:'2026-09-18'}],r).new_leads.value,60);
assert.equal(P.packageCoverage([{start:'2026-09-01',end:'2026-09-15'},{start:'2026-09-16',end:'2026-09-30'}],r).complete,false);
assert.equal(P.packageCoverage([{start:'2026-08-01',end:'2026-10-01',components:[{type:'rent'},{type:'gift_card'}]}],r).complete,true);
const html=readDashboardSource('docs/portfolio-operations-dashboard/index.html');
for(const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi))if(script[1].trim())new vm.Script(script[1]);
const extract=n=>html.match(new RegExp('^(?:async )?function '+n+'\\([^\\n]*\\) \\{[\\s\\S]*?^\\}','m'))[0];
const context={window:{AtlasPropertyIntelligence:P},findWorksheetRow:(rows,re)=>rows.find(r=>re.test(String(r[0]))),normalizeWorkbookNumber:v=>Number(v)||0,normalizeWorkbookPercent:v=>Number(v)||0,matchPropertyName:n=>n};vm.createContext(context);vm.runInContext(extract('extractMarketSurveyCompRows'),context);
const surveyRows=[['Applications (Last 7 days)','',2,8],['Applications (Last 30 days)','',19,19],['Leases (Last 7 days)','',1,2],['Leases (Last 30 days)','',16,5],['Cancel % (Last 7 days)','',0,0],['Cancel % (Last 30 days)','',.26,.31],['Concession Details','','Ten weeks free','One month free']];
const comps=context.extractMarketSurveyCompRows(surveyRows,['','Comp average','RISE Baymeadows','Elevate Baymeadows'],2,1);
assert.equal(comps[1].applicationsLast7,8);assert.equal(comps[1].leasesLast30,5);assert.equal(comps[1].cancelPctLast7,0);
assert.equal(context.extractMarketSurveyCompRows([],['','Average','Subject','Competitor'],2,1)[1].applicationsLast7,null);
const propertyIntelligenceFixture=process.env.ATLAS_PROPERTY_INTELLIGENCE_BOX_FIXTURE || process.env.ATLAS_BOX_FIXTURE;
if(propertyIntelligenceFixture){const XLSX=require('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js'),book=XLSX.read(fs.readFileSync(propertyIntelligenceFixture),{type:'buffer'});const parsed=B.boxScore(XLSX.utils.sheet_to_json(book.Sheets['RISE Baymeadows'],{header:1,defval:'',raw:true}));const v=Object.assign({},...parsed.map(r=>r.values));assert.deepEqual([v.new_leads,v.tours,v.applications,v.approvals,v.denied_applications,v.leases_completed],[51,23,10,5,2,4]);assert(parsed.filter(r=>r.period.start).every(r=>r.period.start==='2026-09-01'&&r.period.end==='2026-09-30'));console.log('PASS supplied Baymeadows workbook: 51 leads, 23 tours, 10 applications, 5 approvals, 2 denials, 4 leases.');}
if(process.env.ATLAS_MARKET_FIXTURE){const XLSX=require('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js'),book=XLSX.read(fs.readFileSync(process.env.ATLAS_MARKET_FIXTURE),{type:'buffer'}),rows=XLSX.utils.sheet_to_json(book.Sheets['Market Survey'],{header:1,defval:'',raw:true}),comps=context.extractMarketSurveyCompRows(rows,rows[2],2,1);assert.equal(comps.length,14);assert.equal(comps.find(c=>c.name==='Elevate Baymeadows').leasesLast30,5);console.log('PASS supplied APTIQ workbook: 14 properties; rolling apps, leases and cancellation percentages.');}
console.log('PASS area/role eligibility, section dates, duplicate and partial-period handling, layered offers, APTIQ missing vs zero, inline script syntax.');

assert.equal(P.offerRange({start:'2026-09-01',end:'2026-10-31',closedAt:'2026-09-17T11:00:00Z'}).end,'2026-09-17');
const windows=P.packageWindows([{start:'2026-09-01',end:'2026-09-15'},{start:'2026-09-16',end:'2026-09-30'}],r);
assert.equal(windows.length,2);assert.equal(windows[0].end,'2026-09-15');
assert.deepEqual(P.datedEvents([{property:'RISE Baymeadows',applicationId:'a',applicationCompleted:'2026-09-14',applicationApproved:'2026-09-18'},{property:'RISE Baymeadows',applicationId:'a',applicationCompleted:'2026-09-14',applicationApproved:'2026-09-18'}],'Baymeadows',windows[0]),{new_leads:null,applications:1,approvals:0,denied_applications:null,leases_completed:null});
