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
export function parseComparisonLines(text,source={}) {
 if(classifyStatement(text)!==CLOSE_SOURCE)return {classification:classifyStatement(text),rows:[],metadata:null,exceptions:[]};
 const rows=[],exceptions=[];let section=null;
 // Only complete nine-column rows are accepted. Ambiguous OCR columns stay in review.
 for(const [index,line] of String(text).split(/\r?\n/).entries()) {
  const trimmed=line.trim();if(/^(Income|Operating Expenses|Expenses|Non[- ]Operating.*|Other Expenses|Debt Service|Capital.*)$/i.test(trimmed))section=trimmed;
  const numbers=[...trimmed.matchAll(/(?:^|\s)(\(?-?\d[\d,]*\.\d{2}\)?%?|N\/A|—|–)(?=\s|$)/g)];
  if(!numbers.length)continue;
  const prefix=trimmed.slice(0,numbers[0].index).trim(),gl=prefix.match(/^(\d{4,8}(?:[-.]\d+)?)\s+(.+)$/);
  const code=gl?.[1]||null,name=(gl?.[2]||prefix).replace(/\s+/g,' '),parts=numbers.map(n=>n[1]);
  if(!code&&!/^(?:Total\b|Net\b|Cash Flow\b|Controllable Cash Flow\b)/i.test(name))continue;
  if(parts.length!==9){exceptions.push({code:'column_coverage',page:source.page,line:index+1,glCode:code,description:'Expected nine comparison columns; review source layout.'});continue;}
  rows.push(makeRow(code,name,parts,{...source,line:index+1},section));
 }
 return {classification:CLOSE_SOURCE,metadata:statementMetadata(text),rows,exceptions};
}
export function parseComparisonSheet(matrix,sheet) {
 const header=matrix.slice(0,9).map(r=>r.filter(v=>v!==null&&v!==undefined).join('  ')).join('\n');
 if(classifyStatement(header+'\n'+sheet)!==CLOSE_SOURCE)return {classification:classifyStatement(header+'\n'+sheet),rows:[],metadata:null,exceptions:[]};
 const rows=[],exceptions=[];let section=null;
 for(let i=8;i<matrix.length;i++) {
  const r=matrix[i]||[],a=String(r[0]??'').trim(),name=String(r[1]??'').trim();
  if(a&&!name&&!/^\d/.test(a))section=a;
  const code=/^\d{4,8}(?:[-.]\d+)?$/.test(a)?a:null;
  if(!code&&!/^(?:Total\b|Net\b|Cash Flow\b|Controllable Cash Flow\b)/i.test(name))continue;
  const location={sheet,row:i+1,cells:Object.fromEntries(fields.map((f,j)=>[f,String.fromCharCode(67+j)+(i+1)]))};
  rows.push(makeRow(code,name,r.slice(2,11),location,section));
 }
 return {classification:CLOSE_SOURCE,metadata:statementMetadata(header),rows,exceptions};
}
export function reconcileComparison(parts) {
 const candidates=parts.filter(p=>p.classification===CLOSE_SOURCE),rows=candidates.flatMap(p=>p.rows),exceptions=candidates.flatMap(p=>p.exceptions),checks=[];
 const seen=new Set();
 for(const row of rows.filter(r=>r.kind==='posting')) {
  if(seen.has(row.glCode))exceptions.push({code:'duplicate_gl',glCode:row.glCode});seen.add(row.glCode);
  for(const field of ['actual','budget','ytdActual','ytdBudget','annualBudget'])if(row.values[field]===null)exceptions.push({code:'missing_amount',glCode:row.glCode,field});
 }
 // Section controls are recomputed from posting rows only, never sums of cached subtotals.
 const sum=(items,field)=>items.length&&items.every(r=>r.values[field]!==null)?items.reduce((n,r)=>n+cents(r.values[field]),0)/100:null;
 const incomeEnd=rows.findIndex(r=>r.kind==='control'&&/^Total Income$/i.test(r.accountName));
 let expenseEnd=rows.findIndex(r=>r.kind==='control'&&/^Total (?:Operating )?Expenses$/i.test(r.accountName));
 if(expenseEnd<0)expenseEnd=rows.findIndex(r=>r.kind==='control'&&/^Net Operating Income(?:\s*\(NOI\))?$/i.test(r.accountName));
 const noi=rows.find(r=>r.kind==='control'&&/^Net Operating Income(?:\s*\(NOI\))?$/i.test(r.accountName));
 const income=incomeEnd>=0?rows.slice(0,incomeEnd).filter(r=>r.kind==='posting'):[];
 const expense=incomeEnd>=0&&expenseEnd>incomeEnd?rows.slice(incomeEnd+1,expenseEnd).filter(r=>r.kind==='posting'):[];
 function check(label,source,calculated,field,location){checks.push({label,field,source,calculated,difference:source!==null&&calculated!==null?(cents(calculated)-cents(source))/100:null,sourceLocation:location,passed:source!==null&&calculated!==null&&cents(calculated)===cents(source)});}
 for(const field of ['actual','budget','ytdActual','ytdBudget','annualBudget']){
  const inc=sum(income,field),exp=sum(expense,field);
  check('Total Income',rows[incomeEnd]?.values[field]??null,inc,field,rows[incomeEnd]?.source);
  if(rows[expenseEnd]!==noi)check('Total Expenses',rows[expenseEnd]?.values[field]??null,exp,field,rows[expenseEnd]?.source);
  check('Net Operating Income',noi?.values[field]??null,inc!==null&&exp!==null?(cents(inc)-cents(exp))/100:null,field,noi?.source);
 }
 // Source variance direction must be reviewed against canonical GL nature. Detect arithmetic
 // errors without inferring favorable/unfavorable from the account's sign or number.
 for(const row of rows)for(const [a,b,v] of [['actual','budget','displayedVariance'],['ytdActual','ytdBudget','displayedYtdVariance']]){
  if([a,b,v].every(k=>row.values[k]!==null)&&Math.abs(Math.abs(cents(row.values[a])-cents(row.values[b]))-Math.abs(cents(row.values[v])))>1)exceptions.push({code:'variance_mismatch',glCode:row.glCode,source:row.source,field:v});
 }
 const identities=candidates.map(p=>p.metadata).filter(Boolean);
 if(!identities.length||identities[0].basis!=='accrual'||identities.some(m=>!m.sourceProperty||!m.period))exceptions.push({code:'missing_identity_period_or_basis'});
 if(new Set(identities.map(m=>`${m.sourceProperty}|${m.period}|${m.basis||identities[0].basis}|${m.ytdStart}`)).size>1)exceptions.push({code:'conflicting_source_scope'});
 return {schemaVersion:SCHEMA_VERSION,metadata:identities[0]||null,rows,checks,exceptions,technicalReconciled:checks.length>0&&checks.every(c=>c.passed)&&exceptions.length===0,status:'Import Review',accountingApproval:'Owner-confirmed upstream Accounting approval',publicationStatus:'Not published'};
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
