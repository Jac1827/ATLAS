import {monthlyGovernanceIssues} from './financial-workbook-governance.mjs?v=ce3982266f91118e';
/* Pure source-evidence reconciliation. Workbook formulas are parsed as a small,
   explicit dependency grammar; no workbook code or arbitrary expression is executed. */
export const FINANCIAL_MAPPING_VERSION='atlas-bcr-row-disposition/2';
export const FINANCIAL_PARSER_VERSION='atlas-financial-package/2';
export const DISPOSITIONS=['mapped_leaf','mapped_control','header_or_section','memo_statistical','supporting','duplicate','excluded','unresolved'];
// PostgreSQL jsonb emits numbers as decimal text. Expand JSON's scientific form
// without rounding again so browser and server hash the identical evidence bytes.
const decimalNumber=value=>{const text=JSON.stringify(value);if(!/[eE]/.test(text))return text;const [coefficient,exponent]=text.toLowerCase().split('e'),negative=coefficient.startsWith('-'),unsigned=negative?coefficient.slice(1):coefficient,[whole,fraction='']=unsigned.split('.'),digits=whole+fraction,point=whole.length+Number(exponent);return (negative?'-':'')+(point<=0?'0.'+'0'.repeat(-point)+digits:point>=digits.length?digits+'0'.repeat(point-digits.length):digits.slice(0,point)+'.'+digits.slice(point));};
const serializeEvidence=value=>{if(typeof value==='number')return decimalNumber(value);if(Array.isArray(value))return '['+value.map(item=>serializeEvidence(item)??'null').join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).filter(key=>!['undefined','function','symbol'].includes(typeof value[key])).map(key=>JSON.stringify(key)+':'+serializeEvidence(value[key])).join(',')+'}';return JSON.stringify(value);};
export const canonicalEvidence=value=>serializeEvidence(sort(value));
const sort=value=>Array.isArray(value)?value.map(sort):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,sort(value[key])])):value;
const cents=value=>Math.round((value+Math.sign(value)*Number.EPSILON)*100);
export const normalizeFinancialLabel=value=>String(value??'').replace(/\s+/g,' ').trim();
const key=value=>normalizeFinancialLabel(value).toLowerCase().replace(/^(?:total|net)\s+/,'').replace(/\s*\(noi\)\s*/g,'');
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const col=address=>address.replace(/[\d$]/g,'').toUpperCase();
const rowNumber=address=>Number(address.replace(/[^\d]/g,''));
const address=value=>value.replace(/\$/g,'').toUpperCase();
const signMap=(mapping,sign=1)=>new Map([...mapping].map(([id,factor])=>[id,factor*sign]));
function merge(target,source,sign=1){for(const [id,factor]of source)target.set(id,(target.get(id)||0)+factor*sign);return target;}
export function metricKeyForLabel(label){const name=normalizeFinancialLabel(label);if(/^(?:total\s+)?(?:gross potential rent(?:\s*\(gpr\))?|gpr)$/i.test(name))return'gpr';if(/^net rental income$/i.test(name))return'netRentalIncome';if(/^total (?:operating )?(?:income|revenue)$/i.test(name))return'revenue';if(/^total (?:operating )?expenses$/i.test(name))return'expenses';if(/^net operating income(?:\s*\(noi\))?$/i.test(name))return'noi';if(/^net cash flow$/i.test(name))return'cashFlow';return null;}
function terms(formula){const result=[];let depth=0,start=0;for(let i=0;i<formula.length;i++){if(formula[i]==='(')depth++;if(formula[i]===')')depth--;if(depth<0)throw Error('Unbalanced source formula');if(depth===0&&i>start&&/[+-]/.test(formula[i])){result.push(formula.slice(start,i));start=i;}}if(depth!==0)throw Error('Unbalanced source formula');result.push(formula.slice(start));return result;}
function rangeCells(text){const match=text.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);if(!match||match[1]!==match[3]||+match[2]>+match[4]||+match[4]-+match[2]>10000)throw Error('Only bounded single-column source ranges are supported');return Array.from({length:+match[4]-+match[2]+1},(_,i)=>match[1]+(+match[2]+i));}
function formulaHierarchy(control,context){
 const {cells,actualColumn,rowsByAddress,headerByColumn}=context,visited=new Set(),trace=[];
 function ref(raw){const cellAddress=address(raw);if(context.blankLeafAddresses?.has(cellAddress))return new Map();if(visited.has(cellAddress))throw Error('Cyclic roll-up formula');const cell=cells[cellAddress],sourceRow=rowsByAddress.get(cellAddress);if(sourceRow?.kind==='posting')return new Map([[sourceRow.source.rowId,1]]);if(!cell?.f)throw Error('Roll-up reference does not resolve to monthly actual leaf accounts: '+cellAddress);visited.add(cellAddress);trace.push({address:cellAddress,formula:cell.f,cachedValue:cell.v??null});const result=expression(cell.f);visited.delete(cellAddress);return result;}
 function expression(raw){const f=String(raw).replace(/^=/,'').replace(/\s/g,'').replace(/\$/g,'').toUpperCase();if(/[!\[\]#]/.test(f))throw Error('External, cross-sheet or broken roll-up reference');
  // This standard sign wrapper selects a static account-type sign; it never executes Excel IF.
  const wrapper=f.match(/^IF\((-?\d+)=([A-Z]+\d+),([A-Z]+\d+)\*-1,\3\)$/);
  if(wrapper){if(!/GL ACCOUNT TYPE/i.test(headerByColumn[col(wrapper[2])]||''))throw Error('Unverified roll-up sign classification column');const type=cells[wrapper[2]]?.v;if(!finite(type))throw Error('Missing roll-up sign classification');return signMap(ref(wrapper[3]),type===Number(wrapper[1])?-1:1);}
  const pieces=terms(f);if(pieces.length>1){const result=new Map();for(const piece of pieces)merge(result,expression(piece.replace(/^[+-]/,'')),piece[0]==='-'?-1:1);return result;}
  if(f[0]==='-')return signMap(expression(f.slice(1)),-1);if(f[0]==='+')return expression(f.slice(1));
  const product=f.match(/^SUMPRODUCT\(([A-Z]+\d+:[A-Z]+\d+),([A-Z]+\d+:[A-Z]+\d+)\)$/);
  if(product){const values=rangeCells(product[1]),signs=rangeCells(product[2]);if(values.length!==signs.length||values.some(a=>col(a)!==actualColumn)||values.some((a,i)=>rowNumber(a)!==rowNumber(signs[i])))throw Error('Roll-up refers to a different column or row scope');if(!/INCOME\s*EXPEN[CS]E\s*CONVERTER/i.test(headerByColumn[col(signs[0])]||''))throw Error('Unverified source sign converter');const result=new Map();values.forEach((a,i)=>{const sign=cells[signs[i]]?.v;if(sign!==1&&sign!==-1)throw Error('Roll-up sign is missing or not +1/-1');merge(result,ref(a),sign);});return result;}
  const sum=f.match(/^SUM\((.+)\)$/);if(sum){const result=new Map();for(const part of sum[1].split(',')){for(const a of part.includes(':')?rangeCells(part):[part]){if(!/^[A-Z]+\d+$/.test(a)||col(a)!==actualColumn)throw Error('Roll-up uses a non-monthly-actual column');merge(result,ref(a));}}return result;}
  if(/^[A-Z]+\d+$/.test(f))return ref(f);
  throw Error('Unsupported or unbounded roll-up formula');
 }
 const factors=ref(control.source.cells.actual);if(!factors.size||[...factors.values()].some(factor=>factor!==1&&factor!==-1))throw Error('Roll-up contains duplicate, canceled or unsupported leaf contributions');return {factors,method:'source_formula_dependencies',formulaEvidence:trace};
}
function structuralHierarchy(control,rows,inventory){
 const index=rows.indexOf(control),prior=rows.slice(0,index),normalized=key(control.accountName),headers=inventory.filter(item=>item.disposition==='header_or_section'&&item.sectionBoundary&&item.sheet===control.source.sheet&&item.row<control.source.row);
 const heading=[...headers].reverse().find(item=>key(item.rawLabel)===normalized);
 if(heading){const members=prior.filter(row=>row.kind==='posting'&&row.source.sheet===control.source.sheet&&row.source.row>heading.row);if(members.length)return {factors:new Map(members.map(row=>[row.source.rowId,1])),method:'explicit_section_boundary',boundaryRowId:heading.id};}
 // Standard income-statement NOI is income less posting expenses between the
 // independently bounded income total and NOI, never the sum of the whole report.
 if(metricKeyForLabel(control.accountName)==='noi'){
  const income=prior.find(row=>metricKeyForLabel(row.accountName)==='revenue');
  const start=income&&headers.find(item=>key(item.rawLabel)==='income'&&item.row<income.source.row);
  if(start){const incomeLeaves=prior.filter(row=>row.kind==='posting'&&row.source.row>start.row&&row.source.row<income.source.row),expenses=prior.filter(row=>row.kind==='posting'&&row.source.row>income.source.row);if(incomeLeaves.length&&expenses.length)return{factors:new Map([...incomeLeaves.map(row=>[row.source.rowId,1]),...expenses.map(row=>[row.source.rowId,-1])]),method:'income_statement_noi',boundaryRowId:start.id};}
 }
 throw Error('No explicit bounded section or supported formula defines this printed roll-up');
}
export function buildFinancialHierarchy(rows,inventory,contexts={}){
 const hierarchy=[],exceptions=[],checks=[],byId=new Map(rows.map(row=>[row.source.rowId,row]));
 for(const control of rows.filter(row=>row.kind==='control'||metricKeyForLabel(row.accountName)==='gpr')){
  const id=control.source.rowId,context=contexts[control.source.sheet];let mapping;
  try{mapping=control.kind==='posting'?{factors:new Map([[id,1]]),method:'source_leaf_control'}:context?.cells?.[control.source.cells?.actual]?.f?formulaHierarchy(control,context):structuralHierarchy(control,rows,inventory);}
  catch(error){exceptions.push({code:'unresolved_rollup',sourceRowId:id,source:control.source,description:control.accountName+': '+error.message});hierarchy.push({id:'control:'+id,sourceRowId:id,label:control.accountName,metricKey:metricKeyForLabel(control.accountName),kind:'rollup',childRowIds:[],factors:{},sourceTotal:control.values.actual,tolerance:0.01,passed:false,method:'unresolved'});continue;}
  const ids=[...mapping.factors.keys()],contributors=ids.map(id=>byId.get(id));
  const node={id:'control:'+id,sourceRowId:id,label:control.accountName,metricKey:metricKeyForLabel(control.accountName),kind:control.kind==='posting'?'leaf_control':'rollup',childRowIds:ids,factors:Object.fromEntries(mapping.factors),sourceTotal:control.values.actual,tolerance:0.01,method:mapping.method,...(mapping.formulaEvidence?{formulaEvidence:mapping.formulaEvidence}:{}),...(mapping.boundaryRowId?{boundaryRowId:mapping.boundaryRowId}:{})};
  for(const field of ['actual','budget','ytdActual','ytdBudget','annualBudget']){
   const source=control.values[field];if(field!=='actual'&&source===null)continue;
   const calculated=contributors.length&&contributors.every(row=>finite(row?.values[field]))?contributors.reduce((total,row)=>total+cents(row.values[field])*mapping.factors.get(row.source.rowId),0)/100:null,difference=finite(source)&&finite(calculated)?(cents(calculated)-cents(source))/100:null;
   const passed=difference!==null&&Math.abs(difference)<=0.01;
   checks.push({label:control.accountName,field,source,calculated,difference,tolerance:0.01,sourceLocation:control.source,sourceRowId:id,contributingRows:ids,factors:node.factors,passed,method:node.method,required:field==='actual'});
   if(field==='actual'){node.calculatedTotal=calculated;node.difference=difference;node.passed=passed;}
  }
  hierarchy.push(node);
 }
 return {hierarchy,checks,exceptions};
}
export function auditFinancialLeaves(rows,inventory,metadata){
 const checks=[],exceptions=[],seen=new Map(),byId=new Map(inventory.map(row=>[row.id,row]));
 for(const row of rows.filter(row=>row.kind==='posting')){
  const id=row.source?.rowId,item=byId.get(id),issues=[];
  if(!item||!['mapped_leaf','duplicate'].includes(item.disposition))issues.push('inventory_missing');
  if(item&&item.actual?.value!==row.values.actual)issues.push('source_value_changed');
  if(!/^\d{4,8}(?:[-.]\d+)?$/.test(row.glCode||''))issues.push('invalid_gl_identity');
  if(!row.accountName?.trim())issues.push('missing_account_label');
  if(!finite(row.values.actual))issues.push(row.coverage.actual==='missing'?'missing_amount':'invalid_amount');
  if(row.columnMapping?.actual?.type!=='monthly_actual'||row.columnMapping.actual.period!==metadata?.period)issues.push('actual_column_provenance');
  if(!metadata?.sourceProperty||!metadata.period)issues.push('missing_identity_period');
  if(seen.has(row.glCode)){issues.push('duplicate_gl');if(item){item.disposition='duplicate';item.duplicateOf=seen.get(row.glCode);item.reason='Duplicate GL requires explicit resolution; neither source row is discarded.';}}else seen.set(row.glCode,id);
  if(item?.rawCells?.some(cell=>cell.address===row.source.cells?.actual&&(cell.type==='e'||cell.formula&&cell.hasCachedValue===false)))issues.push('invalid_formula_cache');
  const check={sourceRowId:id,glCode:row.glCode,community:metadata?.sourceProperty,period:metadata?.period,actual:row.values.actual,dataType:item?.actual?.type||typeof row.values.actual,blank:row.coverage.actual==='missing',sign:row.values.actual===0?'zero':row.values.actual<0?'negative':'positive',columnMapping:row.columnMapping?.actual,checked:true,passed:issues.length===0,issues};checks.push(check);
  for(const code of issues)exceptions.push({code,sourceRowId:id,glCode:row.glCode,field:'actual',source:row.source});
 }
 if(!checks.length)exceptions.push({code:'zero_leaf_rows',description:'No monthly account rows were parsed and checked.'});return{leafChecks:checks,exceptions};
}
export function evaluateFinancialPackageSafety(certificate){
 const e=certificate?.intakeEvidence||{},rows=certificate?.rows||[],inventory=e.rowInventory||[],leaves=rows.filter(row=>row.kind==='posting'),controls=rows.filter(row=>row.kind==='control'),issues=[];
 const fail=(code,condition)=>{if(condition)issues.push(code);};
 fail('wrong_monthly_source',e.sourceKind!=='bcr'||e.workflow!=='monthly_close');
 fail('inventory_incomplete',!inventory.length||inventory.length!==e.inventoryCounts?.total||new Set(inventory.map(row=>row.id)).size!==inventory.length||inventory.some(row=>!DISPOSITIONS.includes(row.disposition)));
 fail('inventory_row_loss',inventory.filter(item=>['mapped_leaf','mapped_control','duplicate'].includes(item.disposition)).length!==rows.length||rows.some(row=>!inventory.some(item=>item.id===row.source?.rowId))||Object.entries(e.inventoryCounts||{}).some(([disposition,count])=>disposition!=='total'&&inventory.filter(item=>item.disposition===disposition).length!==count));
 fail('unresolved_rows',inventory.some(row=>row.disposition==='unresolved'||row.disposition==='duplicate'));
 fail('unchecked_leaf_rows',!leaves.length||(e.leafChecks||[]).length!==leaves.length||(e.leafChecks||[]).some(check=>!check.checked||!check.passed)||leaves.some(row=>!e.leafChecks?.some(check=>check.sourceRowId===row.source?.rowId&&check.actual===row.values?.actual&&inventory.some(item=>item.id===row.source?.rowId&&item.actual?.value===row.values?.actual))));
 fail('unreconciled_controls',!controls.length||controls.some(row=>!e.hierarchy?.some(node=>node.sourceRowId===row.source?.rowId&&node.childRowIds?.length&&node.passed))||(certificate.checks||[]).some(check=>check.required&& !check.passed));
 const byId=new Map(rows.map(row=>[row.source?.rowId,row]));
 fail('hierarchy_value_changed',(e.hierarchy||[]).some(node=>{const source=byId.get(node.sourceRowId),children=node.childRowIds||[];if(!children.length||!finite(source?.values?.actual)||node.sourceTotal!==source.values.actual||children.some(id=>!finite(byId.get(id)?.values?.actual)||![1,-1].includes(node.factors?.[id])))return true;const computed=children.reduce((sum,id)=>sum+cents(byId.get(id).values.actual)*node.factors[id],0)/100;return !finite(node.calculatedTotal)||Math.abs(cents(computed)-cents(node.sourceTotal))>1||Math.abs(cents(computed)-cents(node.calculatedTotal))>1;}));
 fail('extraction_exceptions',(certificate.exceptions||[]).length>0);
 fail('period_column_ambiguous',e.selectedActualColumn?.type!=='monthly_actual'||e.selectedActualColumn?.period!==certificate.metadata?.period);
 const technicalReconciled=issues.length===0;
 if(e.governanceRequired)issues.push(...monthlyGovernanceIssues(certificate));
 fail('community_confirmation_required',e.communityConfirmed!==true||!e.communityId);
 fail('period_confirmation_required',e.periodConfirmed!==true);
 fail('exclusion_review_required',e.exclusionsReviewed!==true);
 fail('coverage_incomplete',e.coverage?.classification!=='full_month');
 fail('source_hash_required',!/^([a-f0-9]{64})$/i.test(certificate.sourceHash||''));
 return {safeToImport:issues.length===0,technicalReconciled,issues};
}
export async function finalizeFinancialPackageEvidence(certificate,options={}){
 const result=structuredClone(certificate),e=result.intakeEvidence;if(!e)throw Error('The package lacks full source-row evidence. Reparse it before saving.');
 if(options.period&&options.period!==e.selectedActualColumn?.period)throw Error('The confirmed month differs from the authoritative BCR monthly actual column.');
 if(options.communityId&&!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(options.communityId))throw Error('Choose an explicit canonical community.');
 if((options.communityId||options.period||options.exclusionsReviewed)&&!options.actor)throw Error('The confirming user is required.');
 if(options.communityId){e.communityId=options.communityId;e.communityConfirmed=true;}if(options.period)e.periodConfirmed=true;
 if(options.exclusionsReviewed!==undefined)e.exclusionsReviewed=options.exclusionsReviewed===true;
 if(options.coverage)e.coverage=structuredClone(options.coverage);
 if(options.mappingVersion)e.mappingVersion=options.mappingVersion;
 if(options.governance)e.governance=structuredClone(options.governance);
 if(options.actor){e.confirmedBy=options.actor;e.confirmedAt=options.timestamp||new Date().toISOString();}
 for(const item of e.rowInventory){item.sourceHash=result.sourceHash;item.mappingVersion=e.mappingVersion;}
 if(e.exclusionsReviewed)for(const item of [...e.columnExclusions,...e.rowInventory.filter(row=>['supporting','memo_statistical','excluded'].includes(row.disposition))]){item.reviewedBy=options.actor||e.confirmedBy;item.reviewedAt=options.timestamp||e.confirmedAt;}
 e.rowValues=result.rows.map(row=>({sourceRowId:row.source?.rowId,glCode:row.glCode,kind:row.kind,values:row.values,coverage:row.coverage,columnMapping:row.columnMapping}));
 delete e.evidenceFingerprint;
 const digest=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalEvidence(e)));e.evidenceFingerprint=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
 const safety=evaluateFinancialPackageSafety(result);result.safeToImport=safety.safeToImport;result.technicalReconciled=safety.technicalReconciled;result.safetyIssues=safety.issues;return result;
}
