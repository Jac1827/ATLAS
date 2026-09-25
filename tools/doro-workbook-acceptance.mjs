/* Read-only actual-workbook receipt. Source path is supplied at runtime. Never
 * commit the workbook, raw evidence, account amounts, or authenticated receipts. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {parseReforecastWorkbook} from '../docs/portfolio-operations-dashboard/features/reforecast-intake.mjs';
import {prepareScopedReforecastEvidence} from '../docs/portfolio-operations-dashboard/features/reforecast-authority.mjs';

const require=createRequire(import.meta.url),XLSX=require('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js');
const hash=value=>createHash('sha256').update(value).digest('hex');
const counts=(rows,key)=>rows.reduce((out,row)=>(out[key(row)]=(out[key(row)]||0)+1,out),{});
const sum=rows=>rows.reduce((total,row)=>total+(row.sourceSignedAmount??0),0);
const key=row=>JSON.stringify([row.sheet,row.sourceGL,row.department,row.period]);

export async function inspectActualWorkbook(bytes,{fileName,periods,sourceScenario='Plan'}={}){
 assert(Array.isArray(periods)&&periods.length&&periods.every(p=>/^20\d{2}-(0[1-9]|1[0-2])$/.test(p)),'Explicit calendar periods are required');
 const evidence=await parseReforecastWorkbook(bytes,{fileName,xlsx:XLSX});
 const selected=evidence.lines.filter(row=>row.scenario===sourceScenario&&periods.includes(row.period));
 const numeric=selected.filter(row=>Number.isFinite(row.amount));
 assert(numeric.length,'Selected source scope has no numeric values');
 const scoped=await prepareScopedReforecastEvidence(evidence,{sourceScenario,periods,selectedLineIds:numeric.map(row=>row.id)},{xlsx:XLSX,sourceBytes:bytes}),authority=scoped.authoritativeCells,audit=scoped.evidence.integrity;
 const cells=selected.map(row=>({sourceLineId:row.id,sheet:row.sheet,cell:row.address,row:row.row,sourceGL:row.accountCode,department:row.department,period:row.period,sourceScenario:row.scenario,sourceSignedAmount:row.amount,blank:row.blank,formula:row.formula,cachedValue:row.cachedValue,canonicalGL:null,mappingVersion:null,disposition:row.blank?'excluded_blank_pending_review':Number.isFinite(row.amount)?'numeric_candidate_pending_mapping':'excluded_unavailable_pending_review',actor:null,reviewedAt:null}));
 const duplicates=counts(cells,key),duplicateKeys=Object.entries(duplicates).filter(([,n])=>n>1).map(([k,n])=>({key:JSON.parse(k),count:n}));
 const grouped=new Map();for(const cell of cells){const k=JSON.stringify([cell.sourceGL,cell.department]);if(!grouped.has(k))grouped.set(k,[]);grouped.get(k).push(cell);}
 const reconciliation={schemaVersion:1,status:'source_evidence_only_not_a_saved_forecast',sourceHash:evidence.source.sha256,sourceScenario,periods,canonicalCutoff:null,canonicalCutoffVerified:false,mappingVersion:null,monthly:periods.map(period=>{const rows=cells.filter(c=>c.period===period);return {period,sourceSignedTotal:sum(rows),numericCells:rows.filter(c=>Number.isFinite(c.sourceSignedAmount)).length,zeroCells:rows.filter(c=>c.sourceSignedAmount===0).length,blankCells:rows.filter(c=>c.blank).length};}),byGL:[...grouped.values()].map(rows=>({sourceGL:rows[0].sourceGL,department:rows[0].department,sourceSignedTotal:sum(rows),monthly:Object.fromEntries(rows.map(r=>[r.period,r.sourceSignedAmount]))})),sourceSignedTotal:sum(cells),cells};
 const receipt={schemaVersion:1,capturedAt:new Date().toISOString(),scope:'Read-only local parsing and reconciliation of the actual source. No authenticated upload, mapping approval, saved revision, publication or export is claimed.',source:{sha256:evidence.source.sha256,byteLength:bytes.length,unchangedHash:hash(bytes)},parserVersion:evidence.parserVersion,retainedEvidence:{...evidence.summary,populatedCells:evidence.integrity.summary.populatedCells,packageParts:evidence.integrity.inventory.packageParts.length,definedNames:evidence.metadata.definedNames.length,dependencyNodes:audit.graph.nodes.length,dependencyEdges:audit.graph.edges.length,sheets:evidence.sheets.map(s=>({name:s.name,visibility:s.visibility,cellRecords:s.cells.length,formulaRecords:s.cells.filter(c=>c.formula).length,usedRange:s.range}))},sourceMetadata:{workbookCutoff:evidence.metadata.lastClosedMonth,workbookCutoffIsCanonical:false,entityCount:evidence.metadata.entities.length,departmentSelections:evidence.metadata.departments,sourceCurrency:evidence.metadata.currencies,sourceScenario,periods},sourceSelection:{glPeriodSlots:cells.length,numericCells:numeric.length,zeroCells:numeric.filter(c=>c.amount===0).length,blankCells:cells.filter(c=>c.blank).length,numericGLs:new Set(numeric.map(c=>c.accountCode)).size,sourceGLs:new Set(cells.map(c=>c.sourceGL)).size,departments:[...new Set(cells.map(c=>c.department))],duplicateKeys,formulaCells:numeric.filter(c=>c.formula).length},integrity:{unscopedFingerprint:evidence.integrity.fingerprint,scopedFingerprint:audit.fingerprint,scopeRoots:authority.length,requiredNodes:audit.authorityScope.requiredNodes.length,unscoped:evidence.integrity.summary,scoped:audit.summary,retainedInventoryIdentical:JSON.stringify(evidence.integrity.inventory.sheets.map(s=>s.cells.map(({mediaAuthority,...c})=>c)))===JSON.stringify(audit.inventory.sheets.map(s=>s.cells.map(({mediaAuthority,...c})=>c))),findingCounts:counts(audit.findings,f=>f.scope+'|'+f.severity+'|'+f.code),embeddedImages:audit.findings.filter(f=>f.code==='embedded_image_evidence').map(f=>({sheet:f.sheet,cell:f.address,scope:f.scope,...f.evidence})),blockers:audit.findings.filter(f=>f.severity==='blocking').map(f=>({code:f.code,sheet:f.sheet,cell:f.address,reason:f.reason}))},acceptance:{sourceParse:'passed',sourceBlankZeroSeparation:'passed',sourceAuthorityScope:audit.summary.blocking?'blocked':'requires_review',authenticatedProduction:'not_performed',serverReadback:'not_performed',twoAuthorizedSessions:'not_performed',officialPublicationExports:'not_performed',issue29:'must_remain_open'}};
 return {receipt,reconciliation,evidence,audit};
}

/** Compare reviewed source mappings to exact saved forecast cells. This rejects
 * an apparent total match when values moved between GLs or months. */
export function verifyMappedReadback({reconciliation,mappedLines,snapshot}){
 const source=new Map(reconciliation.cells.map(c=>[c.sourceLineId,c])),seen=new Set(),expected=new Map();
 assert(Array.isArray(mappedLines)&&mappedLines.length,'Reviewed mapping lines are required');
 for(const line of mappedLines){const cell=source.get(line.sourceLineId);assert(cell&&!cell.blank&&Number.isFinite(cell.sourceSignedAmount),'Mapped source must be a numeric selected cell');assert.equal(line.sourceHash,reconciliation.sourceHash,'Workbook identity must match');assert(line.mappingVersion,'Mapping version is required');assert([1,-1].includes(line.signMultiplier),'Reviewed sign multiplier is required');assert.equal(line.amount,cell.sourceSignedAmount*line.signMultiplier,'Mapped amount must preserve the reviewed source sign relationship');assert.equal(line.period,cell.period,'Mapped period must match source');assert.equal(line.department,cell.department,'Department evidence must match source');assert.deepEqual({sheet:line.sourceCoordinates?.sheet,address:line.sourceCoordinates?.address},{sheet:cell.sheet,address:cell.cell},'Source coordinates must match');assert(!seen.has(line.sourceLineId),'A source cell cannot be imported twice');seen.add(line.sourceLineId);const k=JSON.stringify([line.period,line.accountCode]);assert(!expected.has(k),'GL/month collision requires explicit aggregation before acceptance');expected.set(k,line.amount);}
 const actual=new Map();for(const line of snapshot.lines||[]){const k=JSON.stringify([line.period,line.accountCode]);assert(!actual.has(k),'Readback contains duplicate GL/month cells');actual.set(k,line.forecast);}
 for(const [k,value] of expected){assert(actual.has(k),'Imported GL/month missing from readback');assert.equal(actual.get(k),value,'Imported GL/month does not match exact server readback');}
 return {status:'matched',sourceHash:reconciliation.sourceHash,matchedCells:expected.size,matchedZeros:[...expected.values()].filter(v=>v===0).length,expectedCellsHash:hash(JSON.stringify([...expected].sort())),snapshotFingerprint:snapshot.fingerprint||null};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const args=Object.fromEntries(process.argv.slice(2).map(arg=>{const i=arg.indexOf('=');return [arg.slice(0,i),arg.slice(i+1)];}));
 assert(args['--workbook']&&args['--output'],'Supply --workbook=/private/source.xlsx --output=/private/receipts --periods=2026-09,2026-10,...');
 const bytes=fs.readFileSync(args['--workbook']),result=await inspectActualWorkbook(bytes,{fileName:path.basename(args['--workbook']),sourceScenario:args['--scenario']||'Plan',periods:(args['--periods']||'').split(',')});
 assert.equal(hash(fs.readFileSync(args['--workbook'])),result.receipt.source.sha256,'Source workbook changed during inspection');
 fs.mkdirSync(args['--output'],{recursive:true});
 fs.writeFileSync(path.join(args['--output'],'doro-workbook-source-receipt.json'),JSON.stringify(result.receipt,null,2)+'\n');
 fs.writeFileSync(path.join(args['--output'],'doro-source-gl-month-reconciliation.json'),JSON.stringify(result.reconciliation,null,2)+'\n');
 console.log(JSON.stringify({sourceHash:result.receipt.source.sha256,sourceSelection:result.receipt.sourceSelection,scopedAudit:result.receipt.integrity.scoped,status:result.receipt.acceptance}));
}
