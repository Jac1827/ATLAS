import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {patchOccupancyImportBoundary} from './occupancy-compat-boundary.mjs';
const current=fs.readFileSync(new URL('../docs/portfolio-operations-dashboard/workspace-core.js',import.meta.url),'utf8');
const old=fs.readFileSync(new URL('./fixtures/occupancy-retained-import-boundary.js',import.meta.url),'utf8');
function functionsOnly(s){return [...s.matchAll(/^(?:async )?function (dataImportReadStructuredRows|dataImportRouteStructuredFile)\([^\n]*\) \{[\s\S]*?^\}/gm)].map(m=>m[0]).join('\n\n');}
const oldIndex='<html>retained startup and storage bytes\n'+functionsOnly(old)+'\nuntouched operational footer</html>';
test('five explicit additions reproduce current reviewed boundary and leave all other bytes unchanged',()=>{
 const patched=patchOccupancyImportBoundary(oldIndex,current);
 assert.equal(patched,'<html>retained startup and storage bytes\n'+functionsOnly(current)+'\nuntouched operational footer</html>');
 const before=oldIndex.split('\n'),after=patched.split('\n');let i=0,j=0,inserted=[];
 while(i<before.length||j<after.length){if(before[i]===after[j]){i++;j++;}else {assert(j<after.length,'Patch changed an existing line rather than inserting evidence');inserted.push(after[j]);after.splice(j,1);}}
 assert.equal(after.join('\n'),oldIndex);assert(inserted.some(line=>line.includes('raw:true')));assert(inserted.some(line=>line.includes('occupancyEvidence:')));
 assert(!inserted.some(line=>/fetchJson|localStorage|indexedDB|persistSaved\(|saveWorkspace|publication/.test(line)));
 assert.throws(()=>patchOccupancyImportBoundary(patched,current),/anchor changed/);
});
test('changed or missing retained anchors fail closed instead of replacing operational functions',()=>{
 assert.throws(()=>patchOccupancyImportBoundary(oldIndex.replace('const grouped = new Map();','const grouped = changedStorage();'),current),/anchor changed/);
 assert.throws(()=>patchOccupancyImportBoundary(oldIndex.replace('function dataImportReadStructuredRows','function noLongerTheReader'),current),/function missing/);
 assert.throws(()=>patchOccupancyImportBoundary(oldIndex,current.replace('occupancyEvidence:','unreviewedMetadata:')),/aggregate contract/);
});
