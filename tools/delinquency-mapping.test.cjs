const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('docs/portfolio-operations-dashboard/index.html','utf8');
const cs=fs.readFileSync('docs/portfolio-operations-dashboard/central-services.js','utf8');
const c={console,Date,Map,Set,window:{},dataImport2State:{exceptions:[]}};vm.createContext(c);
for(const f of html.matchAll(/^(?:async )?function [A-Za-z_$][\w$]*\([^\n]*\) \{[\s\S]*?^\}/gm))vm.runInContext(f[0],c);
c.dataImportFindSavedRuleForHeader=()=>({canonicalField:'physical_occupancy',locked:true});
for(const [header,field] of Object.entries({'61-90 Days':'aging_61_90','90+ Days':'aging_90_plus','Pre-Payments':'prepayments','Last Delinquency Note':'last_delinquency_note'}))assert.equal(c.dataImportSuggestDestinationForHeader(header,{reportType:'delinquency'}).field,field,'Source contract beats obsolete learned guesses');
const issue={status:'Open',batchId:'b',fileName:'source.xlsx',reportType:'delinquency',communityName:'Doro',type:'unmapped',title:'Source fields retained without a destination'};
const entry={batchId:'b',fileName:'source.xlsx',reportType:'delinquency'};
const success={rowsReviewed:1,centralRowsImported:1,rowsHeld:0,rowsRejected:0,issues:[],communities:['Doro']};
for(const change of [{rowsHeld:1},{rowsRejected:1},{centralRowsImported:0},{issues:[{}]},{rowsReviewed:0}]){c.dataImport2State.exceptions=[{...issue}];assert.equal(c.dataImportResolveReplayedDelinquencyExceptions(entry,{...success,...change}),0);}
c.dataImport2State.exceptions=[{...issue},{...issue,batchId:'other'},{...issue,fileName:'other.xlsx'},{...issue,communityName:'Other'},{...issue,title:'Community could not be resolved'},{...issue,type:'conflict'}];
assert.equal(c.dataImportResolveReplayedDelinquencyExceptions(entry,success),1);
assert.equal(c.dataImport2State.exceptions.filter(i=>i.status==='Open').length,5);
// Exercise the actual canonical reader and Central Services mapper together.
const raw=[['Bldg-Unit','Resident','Lease Status','0-30 Days','31-60 Days','61-90 Days','90+ Days','Pre-Payments','Balance','Last Delinquency Note'],['101','Fixture resident','Current','176.70','30','15','0','0','221.70','07/10/2026 08:02 AM source note'],['Total','','','176.70','30','15','0','0','221.70','']];
c.XLSX={read:()=>({SheetNames:['Doro'],Sheets:{Doro:raw}}),utils:{sheet_to_json:s=>s}};
Object.assign(c,{cleanString:v=>String(v??'').trim(),asArray:v=>Array.isArray(v)?v:[],numberValue:v=>Number(String(v??'').replace(/[$,]/g,''))||0,whole:v=>Number(v)||0,normalizeEvictionCase:v=>v,normalizeEvictionStatus:v=>v,normalizeBankruptcyAccountClassification:()=>'',defaultOwner:()=> 'Unassigned',makeId:(p,a)=>p+'_'+a.join('|'),localPeriodKey:(m,y)=>`${y}-${String(m+1).padStart(2,'0')}`,getPortfolioProperties:()=>[{name:'Doro'}]});
for(const name of ['compactCentralServicesStorage','numberValue','normalizeKey','findEvictionAliasedValue','centralMatchPropertyName','inferEvictionStatus','evictionDateFieldValue','normalizeDate','delinquencyNoteFields','mapDelinquencyRecord'])vm.runInContext(cs.match(new RegExp('  function '+name+'\\([^\\n]*\\) \\{[\\s\\S]*?^  \\}','m'))[0],c);
const compactInput={evictions:[{id:'a',unit:'',aging90Plus:null,delinquentBalance:0,flag:false,lastDelinquencyNote:'Keep me',activity:[{label:'Keep history'}]}],other:{blank:''}};
const compact=JSON.parse(c.compactCentralServicesStorage(JSON.stringify(compactInput)));
assert.deepEqual({...compact.evictions[0],unit:''},compactInput.evictions[0]);assert.deepEqual(compact.other,compactInput.other);
assert(cs.includes('if (!saveState(state)) throw new Error("Delinquency import was not saved.'));
assert.equal(c.numberValue('($342.00)'),-342);
assert.equal(c.numberValue('-342.00'),-342);
assert.equal(c.numberValue('$1,234.56'),1234.56);
vm.runInContext(cs.match(/  const EVICTION_FIELD_ALIASES = \{[\s\S]*?^  \};/m)[0],c);
(async()=>{const [sheet]=await c.dataImportReadStructuredRows({name:"fixture.xlsx",arrayBuffer:async()=>new ArrayBuffer(0)},{reportType:'delinquency'});assert.equal(sheet.rows.length,1);const row=sheet.rows[0];const mapped=c.dataImportMapSourceRow(row,{reportType:'delinquency'});const output=c.mapDelinquencyRecord(c.dataImportCentralDelinquencyRow({values:mapped.mapped,communityName:'Doro'}),{monthIdx:8,year:2026},[]);assert.equal(output.delinquentBalance,221.70);assert.equal(output.aging61To90,15);assert.equal(output.lastDelinquencyNote,raw[1][9]);assert.equal(output.lastDelinquencyNoteDate,'2026-07-10');const credit=c.mapDelinquencyRecord({...c.dataImportCentralDelinquencyRow({values:mapped.mapped,communityName:'Doro'}),aging90Plus:'(342.00)'},{monthIdx:8,year:2026},[]);assert.equal(credit.aging90Plus,-342);const unitless=c.mapDelinquencyRecord({propertyName:'Doro',residentName:'Unassigned-unit account',unit:'',delinquentBalance:24944.97},{monthIdx:8,year:2026},[]);assert.equal(unitless.delinquentBalance,24944.97);assert.equal(unitless.unit,'');console.log('PASS canonical source → Central Services balances, notes and dates; obsolete guesses; scoped exception resolution and incomplete replay protection.');})().catch(e=>{console.error(e);process.exitCode=1});
