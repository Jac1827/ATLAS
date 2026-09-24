/* Private source paths are supplied at run time. Only sanitized counts/hashes are written. */
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
import {auditWorkbook} from '../docs/portfolio-operations-dashboard/features/workbook-integrity.mjs';
const require=createRequire(import.meta.url),XLSX=require('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js');
const manifestPath=process.env.ATLAS_WORKBOOK_ACCEPTANCE_MANIFEST;if(!manifestPath)throw Error('Provide a private acceptance manifest; never embed source workbooks in the repository.');
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8')),proof=[];
const read=bytes=>XLSX.read(bytes,{type:'array',bookFiles:true,cellFormula:true,cellStyles:true,cellNF:true,sheetStubs:true});
for(const entry of manifest){
 const bytes=fs.readFileSync(entry.path),hash=createHash('sha256').update(bytes).digest('hex'),baseline=auditWorkbook(read(bytes),{sourceHash:hash,modelFamily:entry.family});
 const cells=baseline.inventory.sheets.flatMap(s=>s.cells),formula=cells.find(c=>c.formula&&!c.formula.includes('#REF!')),numeric=cells.find(c=>typeof c.value==='number'&&c.value!==0&&!c.formula),header=baseline.inventory.periodHeaders.find(h=>/20\d{2}|FY\s*\d/i.test(h.value));
 assert(formula&&numeric&&header,entry.family+' needs a real formula, nonzero constant and period header for mutation acceptance');
 const tests=[
  ['formula','formula_changed',book=>{book.Sheets[formula.sheet][formula.address].f='('+formula.formula+')+1';}],
  ['hardcode','formula_to_hardcode',book=>{delete book.Sheets[formula.sheet][formula.address].f;}],
  ['sign','source_sign_changed',book=>{book.Sheets[numeric.sheet][numeric.address].v=-numeric.value;}],
  ['period_header','period_header_changed',book=>{book.Sheets[header.sheet][header.address].v=String(header.value).replace(/20\d{2}/,v=>String(Number(v)+1));if(book.Sheets[header.sheet][header.address].v===header.value)book.Sheets[header.sheet][header.address].v=String(header.value)+' revised period';}],
  ['external_link','external_dependency',book=>{book.Sheets[formula.sheet][formula.address].f="'[external-validation.xlsx]Inputs'!A1";}],
  ['circular_reference','circular_reference',book=>{book.Sheets[formula.sheet][formula.address].f=formula.address;}]
 ];
 const results=[];
 for(const [mutation,expected,mutate]of tests){
  const changed=read(bytes);mutate(changed);const audit=auditWorkbook(changed,{sourceHash:hash,modelFamily:entry.family,previousEvidence:baseline});
  const blockers=audit.findings.filter(f=>f.severity==='blocking');assert(blockers.some(f=>f.code===expected||(expected==='external_dependency'&&/external/.test(f.code))),entry.family+': '+mutation+' was not independently detected');
  assert.equal(audit.safeToApprove,false);assert.notEqual(audit.fingerprint,baseline.fingerprint);results.push({mutation,expected,detected:true,approvalBlocked:true,fingerprintChanged:true});
 }
 const record={family:entry.family,sourceKind:entry.sourceKind||'real_private_workbook',sourceHash:hash,sourceBytes:bytes.length,inventory:baseline.summary,rowInventory:baseline.rowCoverage,baselineFindings:Object.fromEntries([...new Set(baseline.findings.map(f=>f.code))].map(code=>[code,baseline.findings.filter(f=>f.code===code).length])),auditFingerprint:baseline.fingerprint,mutations:results,sourceUnchanged:createHash('sha256').update(fs.readFileSync(entry.path)).digest('hex')===hash};
 proof.push(record);console.log(JSON.stringify({family:entry.family,sourceKind:record.sourceKind,sheets:baseline.summary.sheets,cells:baseline.summary.populatedCells,baselineBlockers:baseline.summary.blocking,mutationsPassed:results.length}));
 if(process.env.ATLAS_WORKBOOK_ACCEPTANCE_PROOF)fs.writeFileSync(process.env.ATLAS_WORKBOOK_ACCEPTANCE_PROOF,JSON.stringify({scope:'Private real workbook analysis and in-memory mutation copies; no source modifications or production approvals',results:proof},null,2)+'\n');
}
