import {parseReforecastWorkbook,hashReforecastWorkbook} from './reforecast-intake.mjs?v=74bbd52d93a197cc';
import {canonicalWorkbookEvidence,workbookEvidenceHash,compareWorkbookEvidence} from './workbook-integrity.mjs?v=612a2cdba3c9dba2';
import {reviewedWorkbookSourcePolicy,explicitWorkbookBlankSource} from './reforecast-workbook-source-policy.mjs?v=a930b680fb3c7265';

const PERIOD=/^20\d{2}-(0[1-9]|1[0-2])$/;
function selection(evidence,mapping){
 const sourceHash=evidence?.source?.sha256,periods=mapping?.periods,ids=mapping?.selectedLineIds;
 if(!/^[a-f0-9]{64}$/.test(sourceHash||'')||!mapping?.sourceScenario||!Array.isArray(periods)||!periods.length||periods.length>24||periods.some(p=>!PERIOD.test(p))||new Set(periods).size!==periods.length)throw Error('Choose the exact source scenario and distinct reporting months before reviewing forecast authority.');
 if(!Array.isArray(ids)||!ids.length||ids.length>20000||new Set(ids).size!==ids.length)throw Error('Choose distinct source forecast cells before reviewing forecast authority.');
 const byId=new Map();for(const line of evidence.lines||[]){if(!byId.has(line.id))byId.set(line.id,[]);byId.get(line.id).push(line);}
 const lines=ids.map(id=>{const matches=byId.get(id);if(matches?.length!==1)throw Error('Each selected forecast cell must occur exactly once in the complete evidence.');const line=matches[0],reviewedBlank=reviewedWorkbookSourcePolicy(mapping)&&explicitWorkbookBlankSource(line);if(line.scenario!==mapping.sourceScenario||!periods.includes(line.period)||line.sourceKind==='workbook_actual_evidence'||(!Number.isFinite(line.amount)&&!reviewedBlank))throw Error('Forecast authority must contain numeric cells or explicitly reviewed workbook blanks from the selected source scenario and months; blank is not zero.');if(!line.headerAddresses?.length||!line.identifiers?.length||!line.accountAddress)throw Error('Selected values require retained GL, department and period header relationships.');return line;});
 return {sourceHash,sourceScenario:mapping.sourceScenario,periods:[...periods].sort(),selectedLineIds:[...ids].sort(),lines};
}
export function reforecastAuthoritySelectionKey(evidence,mapping){
 const {lines,...scope}=selection(evidence,mapping);return workbookEvidenceHash(scope);
}
function originalBytes(value){
 if(value instanceof ArrayBuffer)return new Uint8Array(value);
 if(ArrayBuffer.isView(value))return new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
 if(value?.encoding==='base64'&&typeof value.data==='string'){let decoded;try{decoded=atob(value.data);}catch{throw Error('The retained original workbook bytes are invalid.');}return Uint8Array.from(decoded,c=>c.charCodeAt(0));}
 throw Error('Retain or reload the exact original workbook bytes before reviewing forecast authority.');
}

/** Rebuild authority from the complete original package. This neither approves
 * findings nor changes their source values; all supporting evidence remains. */
export async function prepareScopedReforecastEvidence(evidence,mapping,{xlsx,sourceBytes,previousEvidence}={}){
 const selected=selection(evidence,mapping),bytes=originalBytes(sourceBytes??evidence.source.originalFile);
 if(await hashReforecastWorkbook(bytes)!==selected.sourceHash)throw Error('Original workbook bytes do not match the retained source hash.');
 const previousFingerprint=evidence.integrity?.previousFingerprint;
 if(previousFingerprint&&previousEvidence?.fingerprint!==previousFingerprint)throw Error('Reload the exact earlier workbook audit before reviewing this comparison scope.');
 const roots=new Set(),blankSourceCells=[];
 for(const line of selected.lines){
  // The dependency graph inventories populated cells. An exact source blank
  // is proven by reparsing the complete original workbook below, together with
  // its selected coordinate and authoritative account/header relationships.
  // Do not invent a populated dependency node or waive a missing formula input.
  if(explicitWorkbookBlankSource(line))blankSourceCells.push(line.id);else roots.add(line.id);
  roots.add(line.sheet+'!'+line.accountAddress);for(const address of line.headerAddresses)roots.add(line.sheet+'!'+address);for(const cell of line.identifiers)roots.add(line.sheet+'!'+cell.address);
 }
 // These cells supplied source entity, department, currency and calendar
 // metadata. Their formula dependencies are part of the authority too.
 for(const cell of evidence.metadata?.selections||[])if(cell.sheet&&cell.address)roots.add(cell.sheet+'!'+cell.address);
 const authoritativeCells=[...roots].sort();
 const parsed=await parseReforecastWorkbook(bytes,{xlsx,fileName:evidence.source.fileName,includeOriginalBytes:true,authoritativeCells});
 const fresh=selection(parsed,mapping),freshById=new Map(fresh.lines.map(line=>[line.id,line]));
 for(const line of selected.lines)if(canonicalWorkbookEvidence(line)!==canonicalWorkbookEvidence(freshById.get(line.id)))throw Error('A selected GL, department, month or amount no longer matches the original workbook relationship.');
 if(canonicalWorkbookEvidence(evidence.metadata?.selections)!==canonicalWorkbookEvidence(parsed.metadata.selections))throw Error('Source identity and calendar metadata no longer match the original workbook.');
 if(blankSourceCells.length){
  parsed.integrity.authorityScope.verifiedBlankCells=fresh.lines.filter(explicitWorkbookBlankSource).map(({id,sheet,address,row,column})=>({id,sheet,address,row,column})).sort((a,b)=>a.id.localeCompare(b.id));
  delete parsed.integrity.fingerprint;
  parsed.integrity.fingerprint=workbookEvidenceHash(parsed.integrity);
 }
 if(previousEvidence)parsed.integrity=compareWorkbookEvidence(parsed.integrity,previousEvidence);
 const result={...evidence,...parsed};
 return {evidence:result,selectionKey:reforecastAuthoritySelectionKey(parsed,mapping),authoritativeCells,blankSourceCells:blankSourceCells.sort(),selectedLineIds:fresh.selectedLineIds,sourceHash:selected.sourceHash};
}
