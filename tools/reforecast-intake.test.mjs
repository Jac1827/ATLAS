import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {parseReforecastWorkbook,normalizeReforecastNumber,normalizeReforecastPeriod,normalizeReforecastAccount,mapReforecastIntake,validateReforecastPropertyAssignment,hashReforecastWorkbook} from '../docs/portfolio-operations-dashboard/features/reforecast-intake.mjs';
const require=createRequire(import.meta.url),XLSX=require('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js');
const A='10000000-0000-0000-0000-000000000001';
assert.equal(normalizeReforecastNumber(0),0);assert.equal(normalizeReforecastNumber('0'),0);assert.equal(normalizeReforecastNumber(null),null);assert.equal(normalizeReforecastNumber(''),null);assert.equal(normalizeReforecastNumber('-'),null);
assert.equal(normalizeReforecastNumber('($1,200.25)'),-1200.25);assert.equal(normalizeReforecastNumber('-5'),-5);assert.equal(normalizeReforecastNumber('1,20'),null);assert.equal(normalizeReforecastNumber(false),null);
assert.equal(normalizeReforecastAccount('005120 (Rent)').accountCode,'005120');assert.equal(normalizeReforecastAccount('6257_Credit Reports_Driver'),null);
assert.equal(normalizeReforecastPeriod('Sep 2026'),'2026-09');assert.equal(normalizeReforecastPeriod(1,{year:2027}),'2027-01');assert.equal(normalizeReforecastPeriod('September'),null);assert.equal(normalizeReforecastPeriod(46023,{isDate:true}),'2026-01');
const put=(s,address,value,formula)=>{s[address]={t:typeof value==='number'?'n':'s',v:value,...(formula?{f:formula}:{})};};
function synthetic(){
 const w=XLSX.utils.book_new(),s={'!ref':'A1:Q42','!merges':[XLSX.utils.decode_range('G31:J31')]};
 put(s,'B19','Entity');put(s,'C19','Page');put(s,'D19','304 (Source Property)');
 put(s,'B20','Department');put(s,'C20','Page');put(s,'D20','Operations');
 put(s,'B21','Currency');put(s,'C21','Page');put(s,'D21','USD');
 put(s,'B25','CurrentYear');put(s,'C25','Cell Reference');put(s,'D25',2026);
 put(s,'B26','LastClosedMonth');put(s,'C26','Cell Reference');put(s,'D26',6);
 for(const [c,month,scenario] of [['E',6,'Actual'],['F',7,'Plan'],['G',8,'Plan'],['H',9,'Plan']]){put(s,c+'14',2026);put(s,c+'15',month);put(s,c+'16',scenario);put(s,c+'17','Value');}
 put(s,'B36','5120 (Rent)');put(s,'E36',999);put(s,'F36',0);put(s,'G36',20,'SUM(10,10)');s.H36={t:'n',f:'G36+10'};
 put(s,'B37','6500 (Electricity)');put(s,'F37',40);put(s,'G37',50);put(s,'H37',60);
 put(s,'B38','6510 (External fee)');put(s,'F38',10,"'[Other.xlsx]Sheet1'!A1");put(s,'G38',11,'Missing!A1');s.H38={t:'e',v:23,f:'#REF!',w:'#REF!'};
 put(s,'B39','Prop_Move Ins');put(s,'D39','Move Ins');put(s,'F39',2);put(s,'G39',3);put(s,'H39',4);
 put(s,'B40','Driver');put(s,'D40','Payroll inflation driver');put(s,'F40',0.03);
 XLSX.utils.book_append_sheet(w,s,'Input');
 const hidden=XLSX.utils.aoa_to_sheet([['controls'],['2026-07',0]]);XLSX.utils.book_append_sheet(w,hidden,'Controls');
 w.Workbook={Sheets:[{name:'Input',Hidden:0},{name:'Controls',Hidden:2}],Names:[{Name:'Selection_Entity',Ref:'Input!$D$19'},{Name:'BrokenDriver',Ref:'Controls!#REF!'}]};
 return w;
}
const bytes=w=>XLSX.write(w,{type:'array',bookType:'xlsx'});
const w=synthetic(),array=bytes(w),before=Buffer.from(array).toString('hex');
const evidence=await parseReforecastWorkbook(array,{xlsx:XLSX,fileName:'Synthetic 2035 Wrong Property.xlsx',includeOriginalBytes:true});
assert.equal(Buffer.from(array).toString('hex'),before,'intake must not alter the source');
assert.equal(evidence.source.sha256,await hashReforecastWorkbook(array));
assert.deepEqual(Buffer.from(evidence.source.originalFile.data,'base64'),Buffer.from(array));
assert.equal(evidence.actualsAuthority,false);assert.equal(evidence.metadata.lastClosedMonth,'2026-06');assert.deepEqual(evidence.metadata.entities,['304 (Source Property)']);
assert.equal(evidence.sheets[1].visibility,2);assert.ok(evidence.sheets[0].merges.length);
assert.equal(evidence.lines.find(line=>line.id==='Input!F36').amount,0);assert.equal(evidence.lines.find(line=>line.id==='Input!H36').amount,null);
assert.equal(evidence.lines.find(line=>line.id==='Input!E36').sourceKind,'workbook_actual_evidence');
assert.equal(evidence.lines.find(line=>line.id==='Input!G36').formula,'SUM(10,10)');assert.equal(evidence.lines.find(line=>line.id==='Input!G36').cachedValue,20);
assert.ok(evidence.lines.every(line=>line.column>=5),'scalar CurrentYear / LastClosedMonth / PlanScenario control is not a monthly column');
for(const code of ['missing_formula_cache','external_formula_reference','missing_formula_sheet','broken_named_reference','broken_formula_reference','excel_error'])assert.ok(evidence.issues.some(issue=>issue.code===code),code);
assert.ok(evidence.drivers.some(driver=>driver.label?.includes('Payroll inflation')));assert.ok(evidence.schedules.some(schedule=>schedule.label.includes('Move Ins')));
assert.ok(evidence.lines.every(line=>!line.period.startsWith('2035')),'filename must not define period');
const assignment={explicit:true,communityId:A,actorId:'fixture-admin',assignedAt:'2026-09-23T12:00:00Z',reason:'Reviewed explicit mapping',sourceEntities:['304 (Source Property)']};
const mapping={version:'reviewed-v1',sourceScenario:'Plan',currency:'USD',propertyAssignment:assignment,selectedLineIds:['Input!F36','Input!G36','Input!F37','Input!G37'],accountMappings:[{sourceAccountCode:'5120',accountCode:'5120',category:'Rent',nature:'income',placement:'above_noi',signMultiplier:1},{sourceAccountCode:'6500',accountCode:'6500',category:'Utilities',nature:'expense',placement:'above_noi',signMultiplier:1}]};
const mapped=mapReforecastIntake(evidence,mapping,{authorizedCommunityIds:[A],cutoffPeriod:'2026-06'});
assert.equal(mapped.ready,false,'An unreviewed workbook with broken supporting formulas cannot be approved as a planning workbook');assert.equal(mapped.lines.length,4);assert.equal(mapped.lines[0].amount,0);assert.equal(mapped.lines[0].communityId,A);assert.equal(mapped.lines[0].sourceHash,evidence.source.sha256);
assert.equal(validateReforecastPropertyAssignment({...assignment,explicit:false},[A]).valid,false);
assert.equal(mapReforecastIntake(evidence,mapping,{authorizedCommunityIds:[],cutoffPeriod:'2026-06'}).ready,false);
assert.equal(mapReforecastIntake(evidence,{...mapping,accountMappings:[...mapping.accountMappings,mapping.accountMappings[0]]},{authorizedCommunityIds:[A],cutoffPeriod:'2026-06'}).ready,false);
assert.equal(mapReforecastIntake(evidence,{...mapping,selectedLineIds:['Input!H36']},{authorizedCommunityIds:[A],cutoffPeriod:'2026-06'}).ready,false);
const locked=mapReforecastIntake(evidence,mapping,{authorizedCommunityIds:[A],cutoffPeriod:'2026-07'});assert.ok(locked.lines.every(line=>line.period>'2026-07'));
const actual=mapReforecastIntake(evidence,{...mapping,sourceScenario:'Actual',selectedLineIds:['Input!E36']},{authorizedCommunityIds:[A],cutoffPeriod:'2026-05'});assert.equal(actual.lines.length,0,'workbook Actual header never establishes governed actuals');
const extern=mapReforecastIntake(evidence,{...mapping,selectedLineIds:['Input!F38'],accountMappings:[{sourceAccountCode:'6510',accountCode:'6510',category:'Fees',nature:'expense',placement:'above_noi',signMultiplier:1}]},{authorizedCommunityIds:[A],cutoffPeriod:'2026-06'});assert.ok(extern.issues.some(issue=>issue.code==='untrusted_formula_result'));
const duplicate=structuredClone(evidence);duplicate.lines.push({...duplicate.lines.find(line=>line.id==='Input!F36'),id:'Input!F99'});assert.equal(mapReforecastIntake(duplicate,{...mapping,selectedLineIds:['Input!F36','Input!F99']},{authorizedCommunityIds:[A],cutoffPeriod:'2026-06'}).ready,false);
const annual=XLSX.utils.book_new(),annualSheet=XLSX.utils.aoa_to_sheet([['GL',...Array.from({length:12},(_,month)=>`2026-${String(month+1).padStart(2,'0')}`),'Total'],['5120',...Array.from({length:12},()=>10),121],['6500',...Array.from({length:12},()=>0),0]]);XLSX.utils.book_append_sheet(annual,annualSheet,'Monthly');
const annualEvidence=await parseReforecastWorkbook(bytes(annual),{xlsx:XLSX});assert.ok(annualEvidence.reconciliation.some(check=>check.status==='mismatch'));assert.ok(annualEvidence.reconciliation.some(check=>check.status==='reconciled'&&check.sourceTotal===0));
await assert.rejects(()=>parseReforecastWorkbook(array,{xlsx:XLSX,fileName:'wrong.xlsm'}),/\.xlsx/);
await assert.rejects(()=>parseReforecastWorkbook(new Uint8Array([0,0,0,0]),{xlsx:XLSX}),/not an XLSX/);
await assert.rejects(()=>parseReforecastWorkbook(array,{xlsx:XLSX,maxCells:1}),/cell evidence limit/);
console.log('PASS XLSX evidence, hash, full original bytes, hidden metadata, calendars, formulas not evaluated, zero vs blank, reconciliation, exact scoped mapping, error and actual-authority boundaries.');

// Optional owner-supplied files stay outside the repository and are never embedded in fixtures.
if(process.env.ATLAS_REFORECAST_FIXTURE_DIR){
 for(const name of ['Reforecast Template - Conventional.xlsx','OPEX Template - Conventional.xlsx','New Property OPEX Template - Conventional.xlsx','Revenue Planning Template - Conventional.xlsx']){
  const buffer=fs.readFileSync(path.join(process.env.ATLAS_REFORECAST_FIXTURE_DIR,name));
  const real=await parseReforecastWorkbook(buffer,{xlsx:XLSX,fileName:name});
  assert.ok(real.sheets.length>=6);assert.ok(real.summary.formulas>1000);assert.ok(real.metadata.definedNames.length);assert.ok(real.metadata.entities.length);assert.ok(real.issues.some(issue=>issue.code==='excel_error'));
  if(name.startsWith('Reforecast')){assert.equal(real.metadata.lastClosedMonth,'2026-06');assert.equal(real.lines.length,0,'unpopulated dynamic GL template must not treat entity 304 as an account');}
  else assert.ok(real.lines.length>0,'supplied populated GL identifiers should normalize');
  if(name.startsWith('New Property'))assert.ok(real.metadata.entities.includes('300 (RISE Doro)'));
  assert.ok(real.lines.every(line=>!['300','304'].includes(line.accountCode)),'entity IDs are not GL identifiers');
  console.log(JSON.stringify({file:name,sheets:real.summary.sheets,cells:real.summary.cells,formulas:real.summary.formulas,lines:real.lines.length,schedules:real.schedules.length,drivers:real.drivers.length,issues:real.issues.length,periods:real.summary.periods,scenarios:real.summary.sourceScenarios}));
 }
}
