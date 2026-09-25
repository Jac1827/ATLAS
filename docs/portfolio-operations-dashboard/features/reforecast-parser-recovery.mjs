import {REFORECAST_PARSER_VERSION,parseReforecastWorkbook,hashReforecastWorkbook} from './reforecast-intake.mjs?v=87e68da483f77228';
export const currentReforecastParserVersion=REFORECAST_PARSER_VERSION;
export function needsReforecastParserRecovery(evidence){return evidence?.parserVersion!==REFORECAST_PARSER_VERSION;}
export async function upgradeReforecastParserEvidence(evidence,{xlsx,sourceBytes,previousUploadId=null,previousAuditId=null}={}){
 if(!needsReforecastParserRecovery(evidence))return {changed:false,evidence};
 const original=sourceBytes??evidence?.source?.originalFile;
 let bytes;if(original instanceof ArrayBuffer)bytes=new Uint8Array(original);else if(ArrayBuffer.isView(original))bytes=new Uint8Array(original.buffer,original.byteOffset,original.byteLength);else if(original?.encoding==='base64')bytes=Uint8Array.from(atob(original.data),c=>c.charCodeAt(0));else throw Error('The retained workbook used an older parser. Reload its exact original XLSX bytes before reviewing or writing an import.');
 if(await hashReforecastWorkbook(bytes)!==evidence?.source?.sha256)throw Error('The retained original workbook hash differs. Its prior review cannot be reused.');
 const parsed=await parseReforecastWorkbook(bytes,{xlsx,fileName:evidence.source.fileName,includeOriginalBytes:true}),old=new Map((evidence.lines||[]).map(line=>[line.id,line])),fresh=new Map(parsed.lines.map(line=>[line.id,line]));
 const upgrade={fromParserVersion:evidence.parserVersion||'unversioned',toParserVersion:REFORECAST_PARSER_VERSION,sourceHash:parsed.source.sha256,previousUploadId,previousAuditId,previousIntegrityFingerprint:evidence.integrity?.fingerprint||null,previousLineCount:old.size,currentLineCount:fresh.size,addedLineIds:[...fresh.keys()].filter(id=>!old.has(id)),removedLineIds:[...old.keys()].filter(id=>!fresh.has(id)),reviewRequired:true};
 // The prior immutable evidence/receipt is retained under its original identity.
 // Fresh recognition is a new review; no mapping, inclusion or approval survives.
 parsed.parserUpgrade=upgrade;return {changed:true,evidence:parsed,upgrade};
}
