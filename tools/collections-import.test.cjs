const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const previewDir=require('path').join(__dirname,'../output/test-fixtures');fs.mkdirSync(previewDir,{recursive:true,mode:0o700});
const src=fs.readFileSync('docs/portfolio-operations-dashboard/central-services.js','utf8');
const c={console,Date,Map,Set,cleanString:v=>String(v??'').trim(),asArray:v=>Array.isArray(v)?v:[],numberValue:v=>Number(String(v??'').replace(/[$,]/g,''))||0,whole:v=>Number(v)||0,normalizeEvictionCase:v=>v,normalizeDate:v=>v||'',normalizeEvictionStatus:v=>v,normalizeBankruptcyAccountClassification:()=>'',defaultOwner:()=> 'Unassigned',makeId:(p,a)=>p+'_'+a.join('|'),localPeriodKey:(m,y)=>`${y}-${String(m+1).padStart(2,'0')}`,getPortfolioProperties:()=>[{name:'Sereno'},{name:'Anthem House'}]};vm.createContext(c);
for(const name of ['normalizeKey','findGenericHeaderIndex','rowsToGenericObjects','findEvictionAliasedValue','centralMatchPropertyName','inferEvictionStatus','evictionDateFieldValue','normalizeDate','delinquencyNoteFields','collectionAccount','validateFilingInformation','evictionCoversheetHtml','filingTransition','mapDelinquencyRecord','mapDelinquencyRows']){const re=new RegExp('  function '+name+'\\([^\\n]*\\) \\{[\\s\\S]*?^  \\}','m');vm.runInContext(src.match(re)[0],c);}
vm.runInContext(src.match(/  const EVICTION_FIELD_ALIASES = \{[\s\S]*?^  \};/m)[0],c);
const X=require(process.env.ATLAS_XLSX),w=X.read(fs.readFileSync(process.env.ATLAS_DELINQUENCY_FIXTURE));
const raw=X.utils.sheet_to_json(w.Sheets['RISE Sereno'],{header:1,defval:''});
const parsed=c.mapDelinquencyRows(raw,{propertyName:'Sereno',monthIdx:8,year:2026,fileName:'fixture.xlsx'});
assert(parsed.length>0,'Real report creates resident records');
assert.equal(parsed[0].aging0To30,577.99);assert.equal(parsed[0].delinquentBalance,577.99);
assert.equal(parsed[0].aging31To60,0);assert(!parsed.some(r=>/total/i.test(r.residentName)));
const row={propertyName:'Sereno',residentName:'Test account',residentId:'123',unit:'1',delinquentBalance:100,aging0To30:40,aging31To60:20,aging61To90:10,aging90Plus:30};
const a=c.mapDelinquencyRows([row],{monthIdx:8,year:2026});assert.equal(a.length,1);assert.equal(a[0].aging90Plus,30);
const other=c.mapDelinquencyRows([{...row,propertyName:'Anthem House'}],{monthIdx:8,year:2026});assert.notEqual(a[0].id,other[0].id);
assert.equal(c.mapDelinquencyRows([{residentName:'Test',unit:'1',propertyName:'Sereno'}]).length,0,'No balance does not become zero');
console.log('PASS real Entrata multi-bucket resident parsing, exact balances, account scope, missing-balance rejection.');
c.getEvictionsForCurrentPeriod=()=>a;c.escapeAttr=v=>String(v??'');c.renderEvictionMonthNavigator=()=>'';c.escapeHtml=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
vm.runInContext(src.match(/  function renderCollections\([^\n]*\) \{[\s\S]*?^  \}/m)[0],c);
const rendered=c.renderCollections({ui:{}});assert(rendered.includes('$100.00'));assert(rendered.includes('$30.00'));assert.equal((rendered.match(/Test account/g)||[]).length,1);
fs.writeFileSync(previewDir+'/collections-preview.html','<!doctype html><meta charset="utf-8"><style>body{font:16px Arial;padding:30px;color:#183e50}table{border-collapse:collapse;width:100%}td,th{padding:14px;border-bottom:1px solid #ccc;text-align:left}.cs-panel-title{font-size:26px;font-weight:bold}.cs-panel-sub{margin:18px 0}</style>'+rendered);
console.log('PASS Collections renderer: one account row, all aging columns, exact currency.');

const note=c.delinquencyNoteFields({'Last Delinquency Note':'09/14/2026 03:24 PM author: call logged'});assert.equal(note.lastDelinquencyNoteDate,'2026-09-14');
assert.equal(c.delinquencyNoteFields({'Last Delinquency Note':'No dated entry'}).lastDelinquencyNoteDate,'');
const original={...a[0],status:'Delinquency Review',activity:[]};
const info={sentToAttorneyDate:'2026-09-16',entrataConfirmed:true,depositProgram:'deposit',activeDutyMilitary:false,cosignProgram:true,depositAmount:250,adultOccupantCount:2,adultOccupantNames:['Test One','Test Two']};
const filed=c.filingTransition(original,info,{name:'Test user'},'2026-09-16T20:00:00Z');
assert.equal(filed.status,'Filing preparation');assert(!c.collectionAccount(filed));assert(c.collectionAccount(original));
assert.equal(filed.debtHistory[0].aging90Plus,30);assert.equal(filed.debtHistory[0].delinquentBalance,100);
assert.throws(()=>c.filingTransition(filed,info,{},''));assert.throws(()=>c.filingTransition(original,{...info,entrataConfirmed:false},{},''));
assert(rendered.includes('Last Delinquency Note'));assert(rendered.includes('File Eviction'));assert(!rendered.includes('<th>Source</th>'));
console.log('PASS note date extraction, missing-date handling, filing snapshot, validation, duplicate transition rejection and Collections removal.');

c.refreshEvictionDerivedFields=v=>v;c.evictionWorkflowHasStarted=()=>true;c.preserveExistingRenewalFields=(next,old,keys)=>keys.forEach(k=>{if(old[k]!==undefined)next[k]=old[k]});
vm.runInContext(src.match(/  const EVICTION_WORKFLOW_SOURCE_PROTECTED_FIELDS = \[[\s\S]*?^  \];/m)[0],c);
vm.runInContext(src.match(/  function mergeEvictionCase\([^\n]*\) \{[\s\S]*?^  \}/m)[0],c);
const refreshed=c.mergeEvictionCase(filed,{...original,delinquentBalance:150});
assert.equal(refreshed.status,'Filing preparation');assert.equal(refreshed.evictionFiledAt,filed.evictionFiledAt);assert.equal(refreshed.debtHistory[0].delinquentBalance,100);assert.equal(refreshed.delinquentBalance,150);
console.log('PASS subsequent upload preserves filing answers, timestamp and historical debt while refreshing balance.');

c.window={location:{href:'https://example.test/dashboard/'}};c.URL=URL;
const cover=c.evictionCoversheetHtml(filed);assert(cover.includes('Test One'));assert(cover.includes('Test Two'));assert(cover.includes('$250.00'));assert(cover.includes('From the desk of'));assert(cover.includes('Test user'));assert(cover.includes('Print / Save as PDF'));
assert.throws(()=>c.validateFilingInformation({...info,activeDutyMilitary:null}));assert.throws(()=>c.validateFilingInformation({...info,adultOccupantNames:['One']}));assert.throws(()=>c.validateFilingInformation({...info,depositAmount:null}));
console.log('PASS explicit answers, deposit validation, adult count/name consistency and branded coversheet content.');

c.window.location.href="http://127.0.0.1:8765/atlas/docs/portfolio-operations-dashboard/";fs.writeFileSync(previewDir+"/eviction-coversheet-preview.html",c.evictionCoversheetHtml(filed));

assert.equal(filed.filingInformation.sentToAttorneyDate,'');assert.equal(filed.historicalAttorneySentDate.date,'2026-09-16');assert.equal(filed.id,original.id);
