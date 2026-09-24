import {FINANCIAL_MAPPING_VERSION,FINANCIAL_PARSER_VERSION,normalizeFinancialLabel,buildFinancialHierarchy,auditFinancialLeaves,evaluateFinancialPackageSafety,finalizeFinancialPackageEvidence} from './financial-row-reconciliation.mjs?v=3ce78f4de3fe8982';
export {evaluateFinancialPackageSafety,finalizeFinancialPackageEvidence};
/* Statement extraction is a review candidate, never a publication or approval. */
export const SCHEMA_VERSION = 1;
export const CLOSE_SOURCE = 'budget_comparison';
export function classifyStatement(text) {
  const t=String(text||'').slice(0,2500).toLowerCase();
  if(/^\s*invoice\b/.test(t))return 'supporting_document';
  if (/\b(?:gl|general ledger)\s*[-–]?\s*(?:detail|transaction)/.test(t)) return 'gl_detail';
  if (/budget\s*comparison.*income\s*(?:statement|stmt)/s.test(t)) return CLOSE_SOURCE;
  if (/forecast(?:ed)?\s*income\s*(?:statement|stmt)/.test(t)) return 'forecast';
  if (/\b(?:t12|trailing\s*(?:12|twelve))\b/.test(t)) return 't12';
  if (/balance\s*sheet/.test(t)) return 'balance_sheet';
  if (/trial\s*balance/.test(t)) return 'trial_balance';
  if (/cash\s*flow/.test(t)) return 'cash_flow';
  if (/\binvoice\b/.test(t)) return 'supporting_document';
  return 'manual_review';
}
export function financialValue(input) {
  if(input===null||input===undefined||String(input).trim()==='')return {value:null,status:'missing'};
  if(typeof input==='number')return Number.isFinite(input)?{value:input,status:'present'}:{value:null,status:'invalid'};
  const s=String(input).trim();
  if(/^n\/?a$/i.test(s))return {value:null,status:'not_applicable'};
  if(/^(?:—|–|-|unavailable)$/i.test(s))return {value:null,status:'unavailable'};
  const clean=s.replace(/[$,]/g,'');
  if(!/^(?:-?\d+(?:\.\d+)?|\(\d+(?:\.\d+)?\))$/.test(clean))return {value:null,status:'invalid'};
  return {value:Number(clean.replace(/[()]/g,''))*(clean.startsWith('(')?-1:1),status:'present'};
}
export const cents=n=>Math.round((n+Math.sign(n)*Number.EPSILON)*100);
export function pdfItemsToText(items) {
 const lines=[];
 for(const item of items.filter(i=>i.str?.trim()).sort((a,b)=>b.transform[5]-a.transform[5]||a.transform[4]-b.transform[4])) {
  let line=lines.find(l=>Math.abs(l.y-item.transform[5])<2);
  if(!line){line={y:item.transform[5],items:[]};lines.push(line);}line.items.push(item);
 }
 return lines.map(l=>l.items.sort((a,b)=>a.transform[4]-b.transform[4]).map(i=>i.str).join('  ')).join('\n');
}
const fields=['actual','budget','displayedVariance','displayedPercent','ytdActual','ytdBudget','displayedYtdVariance','displayedYtdPercent','annualBudget'];
const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
export function statementMetadata(text) {
 const lines=String(text).split(/\r?\n/).map(t=>t.trim()).filter(Boolean);
 const title=lines.findIndex(t=>/budget.*comparison.*income/i.test(t));
 const date=lines.slice(Math.max(0,title),title+7).join(' ').match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(20\d{2})\b/i);
 const propertyLine=lines.find(t=>/\bProperty:\s*/i.test(t));
 const ytd=String(text).match(/YTD\s*\(\s*(\w+)\s+(20\d{2})\s*[-–]\s*(\w+)\s+(20\d{2})\s*\)/i);
 return {sourceProperty:propertyLine?.replace(/^.*?\bProperty:\s*/i,'')||((title>=0)?lines[title+1]:null),period:date?`${date[2]}-${String(months.indexOf(date[1].toLowerCase())+1).padStart(2,'0')}`:null,basis:/\baccrual\s*basis\b/i.test(text)?'accrual':/\bcash\s*basis\b/i.test(text)?'cash':null,ytdStart:ytd&&months.includes(ytd[1].slice(0,3).toLowerCase())?`${ytd[2]}-${String(months.indexOf(ytd[1].slice(0,3).toLowerCase())+1).padStart(2,'0')}`:null,generated:text.match(/generated\s+(.+?)(?:\s+and data as of|\n|$)/i)?.[1]||null};
}
function makeRow(code,name,values,location,section) {
 const row={glCode:code,accountName:name,kind:code?'posting':'control',section,source:location,values:{},coverage:{}};
 fields.forEach((key,i)=>{const raw=values[i];let v=financialValue(typeof raw==='string'?raw.replace(/%$/,''):raw);if(key.endsWith('Percent')&&typeof raw==='string'&&raw.endsWith('%')&&v.value!==null)v={...v,value:v.value/100};row.values[key]=v.value;row.coverage[key]=v.status;});
 return row;
}
const colName=index=>{let result='';for(let n=index+1;n;n=Math.floor((n-1)/26))result=String.fromCharCode(65+(n-1)%26)+result;return result;};
const hasValue=value=>value!==null&&value!==undefined&&String(value).trim()!=='';
const PERIOD=/^20\d{2}-(0[1-9]|1[0-2])$/;
function monthPeriod(value){const match=String(value??'').match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(20\d{2})\b/i);return match?match[2]+'-'+String(months.indexOf(match[1].toLowerCase())+1).padStart(2,'0'):PERIOD.test(String(value))?String(value):null;}
function columnEvidence(matrix,sheet,metadata){
 const headerIndex=matrix.findIndex(row=>row.some(value=>/^Account(?: Code)?$/i.test(String(value||'').trim()))&&row.some(value=>/^Account Name$/i.test(String(value||'').trim()))),header=matrix[headerIndex]||[],group=matrix[headerIndex-1]||[],width=Math.max(...matrix.map(row=>row.length),0),columns=[];
 let inherited='';
 for(let index=0;index<width;index++){
  if(hasValue(group[index]))inherited=String(group[index]);const name=normalizeFinancialLabel(header[index]),groupLabel=inherited,exact=/^(Actual|Budget|\$ Variance|% Variance|Annual Budget)$/i.test(name),ytd=/\bYTD\b/i.test(groupLabel),p=monthPeriod(groupLabel);
  let type='supporting';if(/^Account(?: Code)?$/i.test(name))type='gl_identity';else if(/^Account Name$/i.test(name))type='account_label';else if(/^Annual Budget$/i.test(name))type='annual_budget';else if(exact&&/^Actual$/i.test(name))type=ytd?'ytd_actual':p?'monthly_actual':'unconfirmed_actual';else if(exact&&/^Budget$/i.test(name))type=ytd?'ytd_budget':'monthly_budget';else if(/Variance/i.test(name))type=ytd?'ytd_variance':'variance';else if(/\b20\d{2}\b/.test(name))type='supporting_period';
  columns.push({sheet,column:colName(index),index,header:[groupLabel,name].filter(Boolean).join(' / '),rawHeader:name,groupHeader:groupLabel,headerRow:headerIndex+1,type,period:['monthly_actual','monthly_budget','variance'].includes(type)?p:null,affectedPeriod:p||metadata?.period||null,rowCount:matrix.filter(row=>hasValue(row[index])).length});
 }
 const actuals=columns.filter(column=>column.type==='monthly_actual'),actual=actuals.length===1?actuals[0]:null,fieldColumns={};
 if(actual){fieldColumns.actual=actual;const range=columns.filter(column=>column.index>=actual.index&&column.index<actual.index+4);fieldColumns.budget=range.find(column=>column.type==='monthly_budget');fieldColumns.displayedVariance=range.find(column=>/^\$ Variance$/i.test(column.rawHeader));fieldColumns.displayedPercent=range.find(column=>/^% Variance$/i.test(column.rawHeader));}
 const ytd=columns.find(column=>column.type==='ytd_actual');if(ytd){fieldColumns.ytdActual=ytd;fieldColumns.ytdBudget=columns.find(column=>column.index>ytd.index&&column.type==='ytd_budget');fieldColumns.displayedYtdVariance=columns.find(column=>column.index>ytd.index&&/^\$ Variance$/i.test(column.rawHeader));fieldColumns.displayedYtdPercent=columns.find(column=>column.index>ytd.index&&/^% Variance$/i.test(column.rawHeader));}fieldColumns.annualBudget=columns.find(column=>column.type==='annual_budget');
 const exclusions=columns.filter(column=>column.rowCount&& !['gl_identity','account_label','monthly_actual'].includes(column.type)).map(column=>({...column,included:false,reason:'This column is '+column.type.replaceAll('_',' ')+' evidence, not the selected monthly actual column.',coverageEffect:'Retained as supporting evidence; creates no monthly actuals or additional closes.',reviewedBy:null}));
 return {headerIndex,columns,fieldColumns,selectedActualColumn:actual,exclusions,exceptions:actuals.length!==1?[{code:'actual_column_ambiguity',sheet,description:'Expected exactly one explicit monthly Actual column paired with a reporting month; found '+actuals.length}]:actual.period!==metadata?.period?[{code:'actual_period_conflict',sheet,description:'Monthly actual column differs from the printed statement period.'}]:[]};
}
function inventoryItem({sheet,row,values,cells,sourceHash,mappingVersion,columnMapping,rawLabel,disposition,reason,sectionBoundary=false}){
 const rawCells=[];for(let index=0;index<values.length;index++){const address=colName(index)+row,cell=cells?.[address],value=values[index];if(!hasValue(value)&&!cell?.f)continue;rawCells.push({address,column:colName(index),value:value??null,type:cell?.t||typeof value,...(cell?.f?{formula:cell.f,cachedValue:cell.v??null,hasCachedValue:cell.t!=='z'&&cell.v!==undefined&&cell.v!==null}:{} )});}
 const actualColumn=columnMapping?.actual,raw=actualColumn?values[actualColumn.index]:null,amount=financialValue(raw);
 return {id:sheet+'!'+row,sheet,row,rawLabel:rawLabel??values.filter(hasValue).slice(0,2).join(' '),normalizedLabel:normalizeFinancialLabel(rawLabel??values.filter(hasValue).slice(0,2).join(' ')),disposition,reason,sourceHash:sourceHash||null,mappingVersion,included:['mapped_leaf','mapped_control'].includes(disposition),sectionBoundary,columnMapping:columnMapping||{},rawCells,actual:{value:amount.value,status:amount.status,type:raw===null||raw===undefined?'blank':typeof raw,blank:amount.status==='missing',column:actualColumn?.column||null,period:actualColumn?.period||null}};
}
export function parseComparisonSheet(matrix,sheet,options={}) {
 const sourceHash=options.sourceHash||null,mappingVersion=options.mappingVersion||FINANCIAL_MAPPING_VERSION,header=matrix.slice(0,20).map(row=>row.slice(0,12).filter(hasValue).join('  ')).join('\n'),classification=classifyStatement(header+'\n'+sheet),metadata=classification===CLOSE_SOURCE?statementMetadata(header):null,column=columnEvidence(matrix,sheet,metadata),rows=[],inventory=[],exceptions=classification===CLOSE_SOURCE?[...column.exceptions]:[];let section=null;
 const fallback=Object.fromEntries(fields.map((field,index)=>[field,{sheet,index:index+2,column:colName(index+2),type:'unconfirmed',period:null,header:'Unconfirmed comparison column'}]));
 const mapped=Object.fromEntries(fields.map(field=>[field,column.fieldColumns[field]||fallback[field]]));
 const accountIndex=column.columns.find(item=>item.type==='gl_identity')?.index??0,nameIndex=column.columns.find(item=>item.type==='account_label')?.index??1;
 for(let index=0;index<matrix.length;index++){
  const values=matrix[index]||[],row=index+1,cells=options.cells;if(!values.some(hasValue)&&!Object.keys(cells||{}).some(address=>new RegExp('^[A-Z]+'+row+'$').test(address)&&cells[address]?.f))continue;
  const rawCode=normalizeFinancialLabel(values[accountIndex]),name=normalizeFinancialLabel(values[nameIndex]),code=/^\d{4,8}(?:[-.]\d+)?$/.test(rawCode)?rawCode:null,actual=financialValue(values[mapped.actual.index]);let disposition='unresolved',reason='Unrecognized data-bearing statement row.';const rawLabel=[rawCode,name].filter(Boolean).join(' ');
  const sectionBoundary=classification===CLOSE_SOURCE&&index>column.headerIndex&&rawCode&&!name&&!code&&!values.slice(Math.max(accountIndex,nameIndex)+1).some(hasValue);
  if(classification!==CLOSE_SOURCE){disposition='supporting';reason=classification==='t12'?'T12 supports historical review; normal monthly intake creates no closes from this sheet.':'This '+classification+' sheet is retained as supporting evidence, not monthly actual authority.';}
  else if((column.headerIndex>=0?index<=column.headerIndex:index<8&&!code&&!fields.some(field=>hasValue(values[mapped[field].index])))||sectionBoundary){disposition='header_or_section';reason=sectionBoundary?'Explicit printed section boundary.':'Statement identity, period or column header.';if(sectionBoundary)section=rawCode;}
  else if(/^(?:memo|statistical|statistics|occupancy|unit count|square footage|units\b|per unit\b|per sq\b)/i.test(name||rawCode)||/^(?:memo|statistical|statistics)\b/i.test(section||'')){disposition='memo_statistical';reason='Explicitly labeled memo/statistical evidence; excluded from financial posting sums.';}
  else if(code){disposition='mapped_leaf';reason='Source GL account mapped to the selected monthly actual column.';}
  else if(!rawCode&&name&&(hasValue(values[mapped.actual.index])||fields.some(field=>hasValue(values[mapped[field].index])))){disposition='mapped_control';reason='Printed financial subtotal or total; requires bounded child-row reconciliation.';}
  else if(!values.slice(Math.max(accountIndex,nameIndex)+1).some(hasValue)&&/^(?:generated|page\s+\d|data as of|report filters|accounting basis)/i.test(rawLabel)){disposition='header_or_section';reason='Printed report footer or generation metadata.';}
  const item=inventoryItem({sheet,row,values,cells,sourceHash,mappingVersion,columnMapping:mapped,rawLabel,disposition,reason,sectionBoundary});if(code)item.glCode=code;inventory.push(item);
  if(['mapped_leaf','mapped_control'].includes(disposition)){
   const location={sheet,row,rowId:item.id,cells:Object.fromEntries(fields.map(field=>[field,mapped[field].column+row]))},record=makeRow(code,name,fields.map(field=>values[mapped[field].index]),location,section);record.columnMapping=mapped;record.sourceHash=sourceHash;record.mappingVersion=mappingVersion;rows.push(record);
  }else if(disposition==='unresolved')exceptions.push({code:'unresolved_source_row',sourceRowId:item.id,description:rawLabel||'Unlabeled data-bearing row'});
 }
 const rowsByAddress=new Map(rows.map(row=>[row.source.cells.actual,row]));
 return {classification,metadata,rows,exceptions,inventory,columnExclusions:classification===CLOSE_SOURCE?column.exclusions:[],selectedActualColumn:classification===CLOSE_SOURCE?column.selectedActualColumn:null,context:{cells:options.cells||{},actualColumn:column.selectedActualColumn?.column,headerByColumn:Object.fromEntries(column.columns.map(column=>[column.column,column.rawHeader])),rowsByAddress},sourceSheet:{sheet,classification,inventoryCount:inventory.length,columns:column.columns,sourceHash},mappingVersion};
}
export function parseComparisonLines(text,source={}) {
 const classification=classifyStatement(text),sheet=source.sheet||'PDF page '+(source.page||1),metadata=classification===CLOSE_SOURCE?statementMetadata(text):null,rows=[],exceptions=[],inventory=[],mappingVersion=source.mappingVersion||FINANCIAL_MAPPING_VERSION;let section=null;
 const mapped=Object.fromEntries(fields.map((field,index)=>[field,{sheet,column:'text-column-'+(index+1),index,type:index===0?'monthly_actual':index===1?'monthly_budget':index>=4&&index<=7?'ytd_supporting':index===8?'annual_budget':'variance',header:field,period:index<4?metadata?.period:null,method:'printed_nine_column_budget_comparison'}]));
 for(const [index,line]of String(text).split(/\r?\n/).entries()){
  const trimmed=line.trim();if(!trimmed)continue;const number=index+1,numbers=[...trimmed.matchAll(/(?:^|\s)(\(?-?\d[\d,]*\.\d{2}\)?%?|N\/A|—|–)(?=\s|$)/g)],prefix=numbers.length?trimmed.slice(0,numbers[0].index).trim():trimmed,gl=prefix.match(/^(\d{4,8}(?:[-.]\d+)?)\s+(.+)$/),code=gl?.[1]||null,name=normalizeFinancialLabel(gl?.[2]||prefix),parts=numbers.map(match=>match[1]),control=!code&&/^(?:Total\b|Net\b|Cash Flow\b|Controllable Cash Flow\b)/i.test(name);let disposition='header_or_section',reason='Printed identity, header, footer or section boundary.';
  const sectionBoundary=!numbers.length&& !/budget|comparison|income statement|accrual basis|cash basis|^property:|20\d{2}|generated|^page |^account\b|variance|^YTD/i.test(trimmed)&&trimmed!==metadata?.sourceProperty;
  if(sectionBoundary)section=trimmed;
  if(classification!==CLOSE_SOURCE){disposition='supporting';reason='Supporting '+classification+' page; never monthly actual authority.';}
  else if(numbers.length&&(code||control)){disposition=parts.length===9?(code?'mapped_leaf':'mapped_control'):'unresolved';reason=parts.length===9?'Nine printed comparison columns retain monthly, YTD and budget roles.':'Expected nine unambiguous comparison columns.';}
  else if(numbers.length){disposition=/^(?:memo|statistical|occupancy|unit count|units\b)/i.test(name)?'memo_statistical':'unresolved';reason='Numeric source line is not mapped to a posting or bounded total.';}
  const item={id:sheet+'!'+number,sheet,row:number,rawLabel:prefix,normalizedLabel:name,rawText:line,rawCells:parts.map((value,i)=>({address:'text-column-'+(i+1)+'-line-'+number,column:'text-column-'+(i+1),value,type:'s'})),glCode:code,disposition,reason,included:['mapped_leaf','mapped_control'].includes(disposition),sectionBoundary:disposition==='header_or_section'&&sectionBoundary,sourceHash:source.sourceHash||null,mappingVersion,columnMapping:mapped,actual:{...financialValue(parts[0]),type:typeof parts[0],blank:!hasValue(parts[0]),column:'text-column-1',period:metadata?.period}};inventory.push(item);
  if(['mapped_leaf','mapped_control'].includes(disposition)){const record=makeRow(code,name,parts,{...source,sheet,row:number,line:number,rowId:item.id,cells:Object.fromEntries(fields.map((field,i)=>[field,'text-column-'+(i+1)+'-line-'+number]))},section);record.columnMapping=mapped;record.sourceHash=source.sourceHash||null;record.mappingVersion=mappingVersion;rows.push(record);}
  if(disposition==='unresolved')exceptions.push({code:'unresolved_source_row',sourceRowId:item.id,page:source.page,line:number,glCode:code,description:reason});
 }
 return {classification,rows,metadata,exceptions,inventory,columnExclusions:fields.slice(1).map(field=>({...mapped[field],included:false,reason:'Supporting comparison column, not monthly actuals.',affectedPeriod:metadata?.period,rowCount:rows.length,coverageEffect:'No additional actuals or closes.'})),selectedActualColumn:classification===CLOSE_SOURCE?{...mapped.actual,header:metadata?.period+' / Actual'}:null,sourceSheet:{sheet,classification,inventoryCount:inventory.length,sourceHash:source.sourceHash||null},mappingVersion};
}
export function reconcileComparison(parts) {
 const candidates=parts.filter(part=>part.classification===CLOSE_SOURCE),rows=candidates.flatMap(part=>part.rows),exceptions=candidates.flatMap(part=>part.exceptions),inventory=parts.flatMap(part=>part.inventory||[]).map(item=>structuredClone(item)),identities=candidates.map(part=>part.metadata).filter(Boolean),metadata=identities[0]||null;
 if(!identities.length||metadata?.basis!=='accrual'||identities.some(item=>!item.sourceProperty||!item.period))exceptions.push({code:'missing_identity_period_or_basis'});
 if(new Set(identities.map(item=>`${item.sourceProperty}|${item.period}|${item.basis||metadata.basis}|${item.ytdStart}`)).size>1)exceptions.push({code:'conflicting_source_scope'});
 const contexts=Object.fromEntries(candidates.filter(part=>part.context).map(part=>[part.sourceSheet.sheet,part.context])),hierarchy=buildFinancialHierarchy(rows,inventory,contexts),leaf=auditFinancialLeaves(rows,inventory,metadata);exceptions.push(...hierarchy.exceptions,...leaf.exceptions);
 for(const row of rows)for(const [a,b,v]of [['actual','budget','displayedVariance'],['ytdActual','ytdBudget','displayedYtdVariance']])if([a,b,v].every(key=>row.values[key]!==null)&&Math.abs(Math.abs(cents(row.values[a])-cents(row.values[b]))-Math.abs(cents(row.values[v])))>1)exceptions.push({code:'variance_mismatch',glCode:row.glCode,source:row.source,field:v});
 const actualColumns=candidates.map(part=>part.selectedActualColumn).filter(Boolean),counts=Object.fromEntries(['mapped_leaf','mapped_control','header_or_section','memo_statistical','supporting','duplicate','excluded','unresolved'].map(disposition=>[disposition,inventory.filter(item=>item.disposition===disposition).length]));
 const evidence={version:1,parserVersion:FINANCIAL_PARSER_VERSION,sourceKind:'bcr',workflow:'monthly_close',mappingVersion:FINANCIAL_MAPPING_VERSION,communityConfirmed:false,periodConfirmed:false,exclusionsReviewed:false,rowInventory:inventory,inventoryCounts:{total:inventory.length,...counts},leafChecks:leaf.leafChecks,hierarchy:hierarchy.hierarchy,selectedActualColumn:actualColumns[0]||null,selectedActualColumns:actualColumns,columnExclusions:parts.flatMap(part=>part.columnExclusions||[]),sourceSheets:parts.map(part=>part.sourceSheet).filter(Boolean),coverage:{classification:'full_month',carryInPeriods:[],reason:'Printed monthly BCR period; canonical coverage policy and Accounting confirmation must be reviewed.'}};
 const certificate={schemaVersion:SCHEMA_VERSION,metadata,rows,checks:hierarchy.checks,exceptions,intakeEvidence:evidence,technicalReconciled:false,safeToImport:false,status:'Import Review',accountingApproval:'Requires explicit Accounting source confirmation',publicationStatus:'Not published'},safety=evaluateFinancialPackageSafety(certificate);certificate.technicalReconciled=safety.technicalReconciled;certificate.safetyIssues=safety.issues;return certificate;
}
export function resolveCommunity(sourceName,communities,aliases) {
 const key=s=>String(s||'').trim().toLowerCase().replace(/\s+/g,' ');
 const matches=new Set(communities.filter(c=>[c.canonical_name,c.display_name].some(n=>key(n)===key(sourceName))).map(c=>c.community_id));
 for(const a of aliases.filter(a=>a.active&&key(a.alias)===key(sourceName)))if(communities.some(c=>c.community_id===a.community_id))matches.add(a.community_id);
 return {communityId:matches.size===1?[...matches][0]:null,status:matches.size===1?'Matched':matches.size?'Ambiguous — review required':'Unmatched — review required',sourceName};
}
export function favorableVariance(actual,budget,nature) {
 if(actual===null||budget===null||!Number.isFinite(actual)||!Number.isFinite(budget)||!['higher_is_favorable','lower_is_favorable'].includes(nature))return null;
 return ((cents(actual)-cents(budget))*(nature==='higher_is_favorable'?1:-1))/100;
}
