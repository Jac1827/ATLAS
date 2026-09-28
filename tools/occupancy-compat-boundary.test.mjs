import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {patchOccupancyImportBoundary} from './occupancy-compat-boundary.mjs';
const current=fs.readFileSync(new URL('../docs/portfolio-operations-dashboard/workspace-core.js',import.meta.url),'utf8');
const archiveUi=fs.readFileSync(new URL('../docs/portfolio-operations-dashboard/features/import-workspace.js',import.meta.url),'utf8');
const old=fs.readFileSync(new URL('./fixtures/occupancy-retained-import-boundary.js',import.meta.url),'utf8');
function functionText(s,name){return s.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}`,'m'))[0];}
const oldTypes='["box_score", "trending_occupancy", "delinquency", "leasing_resident_data"].includes(entry.reportType)';
const newTypes='["box_score", "trending_occupancy", "delinquency", "leasing_resident_data", "rent_roll"].includes(entry.reportType)';
const oldIndex='<html>retained startup and storage bytes\n'+old+'\nuntouched operational footer</html>';
const patch=(source=oldIndex,core=current,ui=archiveUi)=>patchOccupancyImportBoundary(source,core,ui);
test('eleven exact boundaries preserve all other retained operational bytes',()=>{
 const patched=patch();
 assert.equal(functionText(patched,'dataImportRowPeriod'),functionText(current,'dataImportRowPeriod'));
 assert(patched.includes('occupancyEvidence:'));
 assert(patched.includes('Rent roll reporting period is missing'));
 assert.equal(functionText(patched,'dataImportSupersedeRentRollPeriods'),functionText(current,'dataImportSupersedeRentRollPeriods'));
 for(const name of ['reprocessDataImportBoxScore','renderDataImportArchiveView']){
  const pattern=new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}`,'m');
  const expected=oldIndex.match(pattern)[0].replace(oldTypes,newTypes).replace('    dataImportFinishApprovalRuntime();','    dataImportFinishApprovalRuntime();'+(name==='reprocessDataImportBoxScore'?'\n    if (entry.reportType === "rent_roll") result.periodCorrection = dataImportSupersedeRentRollPeriods(plan, entry, result);':''));
  assert.equal(patched.match(pattern)[0],expected,'Only reviewed allowlist/correction call changes in '+name);
 }
 // Removing the two precise allowlist changes leaves an insertion-only patch.
 const insertionOnly=patched.replaceAll(newTypes,oldTypes);
 const before=oldIndex.split('\n'),after=insertionOnly.split('\n');let i=0,j=0,inserted=[];
 while(i<before.length||j<after.length){if(before[i]===after[j]){i++;j++;}else {assert(j<after.length,'Patch changed an existing line');inserted.push(after[j]);after.splice(j,1);}}
 assert.equal(after.join('\n'),oldIndex);assert(inserted.some(line=>line.includes('raw:true')));assert(inserted.some(line=>line.includes('occupancyEvidence:')));assert(inserted.some(line=>line.includes('Rent roll reporting period is missing')));
 assert(!inserted.some(line=>/fetchJson|localStorage|indexedDB|persistSaved\(|saveWorkspace|publication/.test(line)));
 assert.throws(()=>patch(patched),/anchor changed/);
});
test('changed or missing retained anchors fail closed instead of replacing operational functions',()=>{
 assert.throws(()=>patch(oldIndex.replace('const grouped = new Map();','const grouped = changedStorage();')),/anchor changed/);
 assert.throws(()=>patch(oldIndex.replace('function dataImportReadStructuredRows','function noLongerTheReader')),/function missing/);
 assert.throws(()=>patch(oldIndex,current.replace('occupancyEvidence:','unreviewedMetadata:')),/aggregate contract/);
 assert.throws(()=>patch(oldIndex.replace('  const sectionDate = sourceRow.period?.start || sourceRow.period?.asOf;','  const sectionDate = newReportingPolicy();')),/anchor changed/);
 assert.throws(()=>patch(oldIndex.replaceAll(oldTypes,oldTypes.replace('"box_score"','"unapproved_type"'))),/anchor changed/);
 assert.throws(()=>patch(oldIndex,current,archiveUi.replace(newTypes,oldTypes)),/replay boundary changed/);
 assert.throws(()=>patch(oldIndex,current.replace('Rent roll reporting period is missing','Ignore missing report month')),/period boundary is incomplete/);
 assert.throws(()=>patch(oldIndex,current.replace('result.periodCorrection = dataImportSupersedeRentRollPeriods(plan, entry, result)','result.periodCorrection = skipCorrection()')),/anchors are missing or ambiguous|correction call is incomplete/);
 assert.throws(()=>patch(oldIndex,current.replace('function dataImportSupersedeRentRollPeriods','function unreviewedCorrection')),/function missing/);
});
