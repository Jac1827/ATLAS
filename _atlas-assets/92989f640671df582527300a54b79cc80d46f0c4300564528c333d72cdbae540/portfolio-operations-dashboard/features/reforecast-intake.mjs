import {auditWorkbook} from './workbook-integrity.mjs?v=c0a7997612845f22';
import {validatePlanningCalendar, classifyPlanningCells, reviewPlanningIntegrity} from './planning-governance.mjs?v=a4de8d3f5a50966c';
/* Workbook evidence only. Formulas are retained, never executed or promoted to actuals. */
export const REFORECAST_PARSER_VERSION = 'atlas-reforecast-xlsx/2';
export const REFORECAST_EVIDENCE_SCHEMA = 2;
const ADDRESS = /^[A-Z]+[1-9][0-9]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERIOD = /^20\d{2}-(0[1-9]|1[0-2])$/;
const MONTHS = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ');
const NATURES = new Set(['income','contra_income','expense','capital','debt','below_noi']);
const text = value => value == null ? '' : String(value).trim();
const plain = value => value == null ? null : JSON.parse(JSON.stringify(value));
const issue = (code, message, context = {}, severity = 'warning') => ({code, severity, message, ...context});
let xlsxLoading;

export async function loadXlsx(provided) {
 if (provided?.read && provided?.utils) return provided;
 if (globalThis.XLSX?.read) return globalThis.XLSX;
 if (typeof document === 'undefined') throw Error('Supply the vendored XLSX reader as options.xlsx.');
 xlsxLoading ||= new Promise((resolve,reject) => {
  const script = document.createElement('script');
  script.src = new URL('../assets/xlsx.full.min.js',import.meta.url).href;
  script.onload = () => globalThis.XLSX?.read ? resolve(globalThis.XLSX) : reject(Error('Workbook reader did not load.'));
  script.onerror = () => {xlsxLoading = null;reject(Error('Workbook reader could not be loaded. Try again.'));};
  document.head.appendChild(script);
 });
 return xlsxLoading;
}
function bytesOf(input) {
 if (input instanceof ArrayBuffer) return new Uint8Array(input);
 if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer,input.byteOffset,input.byteLength);
 throw Error('Provide the selected workbook as an ArrayBuffer.');
}
export async function hashReforecastWorkbook(input) {
 const bytes = bytesOf(input);
 if (!globalThis.crypto?.subtle) throw Error('Secure file hashing is unavailable. Open ATLAS over HTTPS.');
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');
}
export function encodeOriginalWorkbook(input) {
 const bytes=bytesOf(input), parts=[];
 for(let offset=0;offset<bytes.length;offset+=24576) parts.push(btoa(String.fromCharCode(...bytes.subarray(offset,offset+24576))));
 // Chunks are a multiple of three bytes, so only the final chunk can contain padding.
 return {encoding:'base64',data:parts.join('')};
}
export function normalizeReforecastNumber(value) {
 if (value == null || value === '' || (typeof value==='string'&&!value.trim())) return null;
 if (typeof value === 'number') return Number.isFinite(value) ? value : null;
 if (typeof value !== 'string') return null;
 let source=value.trim();
 // A dash is often a display-only zero in accounting formats, but source text is ambiguous.
 if (/^(?:-|—|–|n\/?a)$/i.test(source)||source.startsWith('#')) return null;
 const negative=/^\(.*\)$/.test(source);
 if(negative)source=source.slice(1,-1).trim();
 source=source.replace(/^[\$£€]\s*/,'');
 if(!/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(source))return null;
 const numeric=Number(source.replaceAll(',',''));
 return Number.isFinite(numeric)?(negative?-numeric:numeric):null;
}
export function normalizeReforecastAccount(value) {
 const source=text(value);
 const match=source.match(/^([0-9]{3,}(?:[-.][0-9]+)*)(?:\s*\(([^)]+)\)|\s+[-–]\s+(.+))?$/);
 return match?{accountCode:match[1],accountName:text(match[2]||match[3]),raw:source}:null;
}
export function normalizeReforecastPeriod(value, {year, date1904=false, isDate=false}={}) {
 if(value instanceof Date&&!Number.isNaN(value.valueOf()))return value.toISOString().slice(0,7);
 const raw=text(value);
 if(PERIOD.test(raw))return raw;
 const iso=raw.match(/^(20\d{2})[-/](0?[1-9]|1[0-2])(?:[-/]\d{1,2})?$/);
 if(iso)return `${iso[1]}-${iso[2].padStart(2,'0')}`;
 const named=raw.match(/^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[\s-]+(20\d{2})$/i);
 if(named)return `${named[2]}-${String(MONTHS.indexOf(named[1].slice(0,3).toLowerCase())+1).padStart(2,'0')}`;
 const month=typeof value==='number'&&Number.isInteger(value)?value:MONTHS.indexOf(raw.toLowerCase().slice(0,3))+1;
 if(Number.isInteger(year)&&year>=2000&&year<=2099&&month>=1&&month<=12)return `${year}-${String(month).padStart(2,'0')}`;
 if(isDate&&typeof value==='number'&&value>0&&value<100000){
  const epoch=Date.UTC(date1904?1904:1899,date1904?0:11,date1904?1:30);
  const date=new Date(epoch+value*86400000),period=date.toISOString().slice(0,7);
  return PERIOD.test(period)?period:null;
 }
 return null;
}
function cellEvidence(address,cell,XLSX) {
 // SheetJS represents an uncached formula as a stub with v:0. That is not a saved zero.
 const position=XLSX.utils.decode_cell(address), hasValue=cell.t!=='z'&&Object.prototype.hasOwnProperty.call(cell,'v');
 return {address,row:position.r+1,column:position.c+1,type:cell.t||null,
  value:hasValue?plain(cell.v):null,hasValue,formula:cell.f||null,
  cachedValue:cell.f&&hasValue?plain(cell.v):null,hasCachedValue:Boolean(cell.f&&hasValue&&cell.v!==null&&cell.v!==''),
  formattedValue:cell.w??null,numberFormat:cell.z??null,
  ...(cell.F?{arrayFormulaRange:cell.F}:{}),...(cell.l?{hyperlink:plain(cell.l)}:{}),...(cell.c?{comments:plain(cell.c)}:{})};
}
const cellRef = (sheet,cell) => ({sheet,address:cell.address,row:cell.row,column:cell.column});
function namedValue(workbook,ref) {
 const match=text(ref).match(/^(?:'((?:[^']|'')+)'|([^!]+))!\$?([A-Z]+)\$?([1-9][0-9]*)$/);
 if(!match)return null;
 const sheet=(match[1]||match[2]).replaceAll("''","'"),address=match[3]+match[4],cell=workbook.Sheets[sheet]?.[address];
 return {sheet,address,value:cell?.v??null,formula:cell?.f??null};
}
function metadataOf(workbook,sheets,options) {
 const names=(workbook.Workbook?.Names||[]).map(name=>({...plain(name),resolved:namedValue(workbook,name.Ref)}));
 const selections=[];
 for(const named of names)if(/Selection_|CurrentYear|LastClosedMonth|PlanScenario|Currency|Fiscal|FirstMonth|NumberYears/i.test(named.Name)) selections.push({name:named.Name,reference:named.Ref,...named.resolved});
 const rowLabels=new Set(['Entity','Selection_Entity','Department','Selection_Department','Currency','CurrentYear','LastClosedMonth','PlanScenario','FiscalYear','Fiscal Start Month','Scenario']);
 for(const sheet of sheets)for(const cell of sheet.cells){
  if(cell.row>40||cell.column>6||!rowLabels.has(text(cell.value)))continue;
  const row=sheet.cellsByRow.get(cell.row)||[];
  const candidates=row.filter(c=>c.column>cell.column&&c.column<=cell.column+3&&c.value!=null&&!/^(Page|Rows|Columns|Cell Reference|Named Range|Row|Column)(?:\s|$)/i.test(text(c.value)));
  const value=candidates[0];if(value)selections.push({name:text(cell.value),sheet:sheet.name,address:value.address,value:value.value,formula:value.formula});
 }
 const values=pattern=>[...new Set(selections.filter(item=>pattern.test(item.name)).map(item=>text(item.value)).filter(Boolean))];
 const currentYears=values(/^CurrentYear$/i).map(Number).filter(Number.isInteger);
 const cutoffValues=values(/^LastClosedMonth$/i).map(value=>normalizeReforecastPeriod(Number(value),{year:currentYears.length===1?currentYears[0]:undefined})).filter(Boolean);
 const externalParts=Object.entries(workbook.files||{}).filter(([name])=>/^xl\/(?:externalLinks\/|connections\.xml|queryTables\/)/.test(name)).map(([name,file])=>({name,content:typeof file.content==='string'?file.content:new TextDecoder().decode(file.content||new Uint8Array())}));
 return {selections,entities:values(/^(Selection_)?Entity$/i),departments:values(/^(Selection_)?Department$/i),scenarios:values(/^(PlanScenario|Scenario)$/i),currencies:values(/^Currency$/i),currentYears,
  lastClosedMonth:cutoffValues.length===1?cutoffValues[0]:null,workbookCutoffCandidates:[...new Set(cutoffValues)],
  fiscalYears:values(/FiscalYear/i),fiscalStartMonth:options.fiscalStartMonth??null,
  definedNames:names,workbookProperties:plain(workbook.Props||{}),customProperties:plain(workbook.Custprops||{}),calculationProperties:plain(workbook.Workbook?.CalcPr||{}),
  date1904:Boolean(workbook.Workbook?.WBProps?.date1904),externalLinks:externalParts};
}
function periodColumns(sheet,XLSX,metadata,issues) {
 const byAddress=new Map(sheet.cells.map(cell=>[cell.address,cell])),result=new Map(),candidates=[];
 const get=(row,column)=>byAddress.get(XLSX.utils.encode_cell({r:row-1,c:column-1}));
 // Vena retains an exact year / month / scenario dimension stack, including hidden columns.
 for(const cell of sheet.cells){
  if(cell.row>30||!Number.isInteger(cell.value)||cell.value<2000||cell.value>2099)continue;
  const month=get(cell.row+1,cell.column),scenario=get(cell.row+2,cell.column);
  if(!month||!Number.isInteger(month.value)||month.value<1||month.value>12||!scenario||typeof scenario.value!=='string')continue;
  const period=normalizeReforecastPeriod(month.value,{year:cell.value});
  const next={column:cell.column,period,scenario:text(scenario.value),measure:text(get(cell.row+3,cell.column)?.value),headerRow:cell.row,headerAddresses:[cell.address,month.address,scenario.address],basis:'explicit_year_month_scenario'};
  candidates.push(next);
 }
 // CurrentYear / LastClosedMonth / PlanScenario can also be stacked vertically.
 // A monthly header is a repeated horizontal series, never that scalar control block.
 for(const next of candidates.filter(item=>candidates.filter(other=>other.headerRow===item.headerRow).length>=2)){
  const before=result.get(next.column);
  if(before&&(before.period!==next.period||before.scenario!==next.scenario))issues.push(issue('ambiguous_period_header','The same column has conflicting period or scenario headers.',{sheet:sheet.name,column:next.column,headers:[before,next]},'error'));
  else if(!before)result.set(next.column,next);
 }
 if(result.size){
  const columns=[...result.values()].sort((a,b)=>a.column-b.column);
  for(const column of columns){
   const months=new Set(columns.filter(other=>other.period.slice(0,4)===column.period.slice(0,4)&&other.scenario===column.scenario).map(other=>other.period));
   if(months.size===1&&!/^(?:Value|Total Value)$/i.test(column.measure)){
    column.periodBasis='unconfirmed_period';
    issues.push(issue('ambiguous_period_basis','A single Vena period column may be an annual or fiscal snapshot. Its basis must be resolved before treating it as a monthly amount.',{sheet:sheet.name,column:column.column,period:column.period,headerAddresses:column.headerAddresses}));
   }else column.periodBasis='calendar_month';
  }
  return columns;
 }
 // Simple conventional monthly tables require explicit calendar dates, never filename years.
 const simpleCandidates=[];
 for(const [row,cells] of sheet.cellsByRow){
  if(row>80)continue;
  const columns=cells.map(cell=>({cell,period:normalizeReforecastPeriod(cell.value,{date1904:metadata.date1904,isDate:Boolean(cell.numberFormat&&XLSX.SSF?.is_date(cell.numberFormat))})})).filter(item=>item.period);
  if(columns.length>=2)simpleCandidates.push({row,columns});
 }
 const header=simpleCandidates.sort((a,b)=>b.columns.length-a.columns.length||a.row-b.row)[0];
 if(!header)return [];
 return header.columns.map(({cell,period})=>({column:cell.column,period,scenario:metadata.scenarios.length===1?metadata.scenarios[0]:'',measure:'Value',headerRow:header.row,headerAddresses:[cell.address],basis:'explicit_calendar_header'}));
}
function formulaIssues(workbook,sheets,metadata) {
 const issues=[],sheetNames=new Set(workbook.SheetNames);
 const external=/\[(?:[^\]]+\.(?:xlsx?|xlsm|xlsb|csv)|\d+)\][^!]*!|(?:https?:\/\/|file:\/\/)/i;
 const brokenNames=metadata.definedNames.filter(named=>text(named.Ref).includes('#REF!')||external.test(text(named.Ref)));
 for(const sheet of sheets)for(const cell of sheet.cells){
  const context=cellRef(sheet.name,cell);
  if(cell.type==='e'||/^#(?:REF!|DIV\/0!|VALUE!|NAME\?|N\/A|NUM!|NULL!|SPILL!|CALC!)/.test(text(cell.value)))issues.push(issue('excel_error','Workbook contains an Excel error. Review the source before using the affected value.',{...context,error:cell.formattedValue||cell.value}));
  if(!cell.formula)continue;
  if(!cell.hasCachedValue)issues.push(issue('missing_formula_cache','Formula has no saved result. ATLAS does not execute uploaded formulas.',context));
  if(cell.formula.includes('#REF!'))issues.push(issue('broken_formula_reference','Formula contains a broken reference.',context));
  if(external.test(cell.formula))issues.push(issue('external_formula_reference','Formula depends on an external workbook or connection.',context));
  for(const named of brokenNames){
   const escaped=named.Name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
   if(new RegExp('(?:^|[^A-Za-z0-9_.])'+escaped+'(?:$|[^A-Za-z0-9_.])','i').test(cell.formula))issues.push(issue('broken_named_formula_reference','Formula uses a broken or external named reference.',{...context,name:named.Name,reference:named.Ref}));
  }
  for(const match of cell.formula.matchAll(/(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_. ]*))!/g)){
   const referenced=(match[1]||match[2]).replaceAll("''","'").trim();
   if(!referenced.includes('[')&&!sheetNames.has(referenced))issues.push(issue('missing_formula_sheet',`Formula references missing sheet ${referenced}.`,{...context,referencedSheet:referenced}));
  }
 }
 for(const named of metadata.definedNames){
  if(text(named.Ref).includes('#REF!'))issues.push(issue('broken_named_reference','Named range contains a broken reference.',{name:named.Name,reference:named.Ref}));
  if(external.test(text(named.Ref)))issues.push(issue('external_named_reference','Named range depends on an external workbook.',{name:named.Name,reference:named.Ref}));
 }
 if(metadata.externalLinks.length)issues.push(issue('external_connections','Workbook includes external link or data connection definitions.',{parts:metadata.externalLinks.map(part=>part.name)}));
 return issues;
}
function rowIdentifier(cells,firstPeriodColumn,headerRow,entities=[]) {
 const left=cells.filter(cell=>cell.column<firstPeriodColumn&&cell.row>headerRow&&cell.value!=null);
 const accounts=left.filter(cell=>!entities.includes(text(cell.value))).map(cell=>({cell,account:normalizeReforecastAccount(cell.value)})).filter(item=>item.account);
 if(!accounts.length)return null;
 const distinct=[...new Set(accounts.map(item=>item.account.accountCode))];
 if(distinct.length!==1)return {ambiguous:accounts.map(item=>({address:item.cell.address,...item.account}))};
 const chosen=accounts[0],label=left.slice().reverse().find(cell=>cell.column>chosen.cell.column&&typeof cell.value==='string'&&!/^(?:Value|Total Value|Fiscal Value|Driver|Comments|Undefined|[0-9]|#)/.test(text(cell.value)));
 return {...chosen.account,accountName:chosen.account.accountName||text(label?.value),accountAddress:chosen.cell.address,identifiers:left.map(cell=>({address:cell.address,value:cell.value}))};
}
function extractRows(sheet,metadata,issues) {
 const columns=sheet.periodColumns;if(!columns.length)return {lines:[],schedules:[],drivers:[]};
 const first=Math.min(...columns.map(column=>column.column)),headerEnd=Math.max(...columns.map(column=>column.headerRow+3));
 const lines=[],schedules=[],drivers=[],byAddress=new Map(sheet.cells.map(cell=>[cell.address,cell]));
 const at=(row,column)=>(sheet.cellsByRow.get(row)||[]).find(cell=>cell.column===column);
 const isVena=columns.some(column=>column.basis==='explicit_year_month_scenario');
 const minimumRow=isVena?Math.max(34,headerEnd+1):headerEnd-2;
 for(const [row,cells] of sheet.cellsByRow){
  if(row<minimumRow)continue;
  const id=rowIdentifier(cells,first,minimumRow-1,metadata.entities);
  const labels=cells.filter(cell=>cell.column<first&&typeof cell.value==='string'&&!text(cell.value).startsWith('#'));
  const label=labels.map(cell=>text(cell.value)).filter(Boolean).join(' / ');
  if(id?.ambiguous){issues.push(issue('ambiguous_account_row','Multiple account codes occur in one row. Select the intended GL explicitly.',{sheet:sheet.name,row,candidates:id.ambiguous}));continue;}
  const values=columns.map(column=>{
   const cell=at(row,column.column);
   return {...column,address:cell?.address||null,amount:cell?.type==='e'?null:normalizeReforecastNumber(cell?.value),blank:!cell||!cell.hasValue||cell.value==null||cell.value==='',formula:cell?.formula||null,cachedValue:cell?.cachedValue??null,type:cell?.type||null};
  });
  // Driver and schedule cells remain evidence until an explicit, reviewed mapping binds them.
  if(label&&/(driver|prop_|occup|move.?ins?|move.?outs?|lease|rent|concession|inflation|payroll|insurance|tax|utilit|contract|units|sqft)/i.test(label)){
   const evidence={id:`${sheet.name}!${row}`,sheet:sheet.name,row,label,identifiers:labels.map(cell=>({address:cell.address,value:cell.value})),values};
   schedules.push(evidence);
   if(/driver|inflation|escalation|growth|override|rate|%/i.test(label))drivers.push({...evidence,status:'requires_explicit_mapping'});
  }
  if(!id)continue;
  const departmentEvidence=(id.identifiers||[]).find(item=>/Department/.test(text(item.value)));
  const department=departmentEvidence?text(departmentEvidence.value):(metadata.departments.length===1?metadata.departments[0]:null);
  const entity=metadata.entities.length===1?metadata.entities[0]:null;
  for(const value of values){
   if(/^Empty$/i.test(value.scenario))continue;
   const address=value.address||`${columnName(value.column)}${row}`;
   const line={id:`${sheet.name}!${address}`,sheet:sheet.name,row,column:value.column,address,accountCode:id.accountCode,accountName:id.accountName,accountAddress:id.accountAddress,identifiers:id.identifiers,
    period:value.period,periodBasis:value.periodBasis||'calendar_month',scenario:value.scenario,measure:value.measure,entity,department,currency:metadata.currencies.length===1?metadata.currencies[0]:null,
    amount:value.amount,blank:value.blank,formula:value.formula,cachedValue:value.cachedValue,cellType:value.type,
    sourceKind:/^actual(?:\b|$)/i.test(value.scenario)?'workbook_actual_evidence':'workbook_forecast_evidence',headerAddresses:value.headerAddresses};
   lines.push(line);
   if(value.amount===null)issues.push(issue(value.blank?'missing_value':'invalid_value',value.blank?'GL period has no source amount. Blank is not zero.':'GL period does not contain a usable numeric value.',{sheet:sheet.name,address,sourceLineId:line.id,accountCode:line.accountCode,period:line.period}));
  }
 }
 return {lines,schedules,drivers};
}
function columnName(column){let n=column,out='';while(n){n--;out=String.fromCharCode(65+n%26)+out;n=Math.floor(n/26);}return out;}
function reconcileRows(sheets,lines,issues) {
 const checks=[];
 for(const sheet of sheets){
  const totalHeaders=sheet.cells.filter(cell=>cell.row<=80&&/^(Total|Full Year|CY Total)$/i.test(text(cell.value)));
  for(const header of totalHeaders){
   const previous=Math.max(0,...totalHeaders.filter(cell=>cell.row===header.row&&cell.column<header.column).map(cell=>cell.column));
   const columns=sheet.periodColumns.filter(column=>column.column>previous&&column.column<header.column&&!/^Empty$/i.test(column.scenario));
   if(columns.length!==12||new Set(columns.map(column=>column.period)).size!==12||new Set(columns.map(column=>column.period.slice(0,4))).size!==1)continue;
   const relevant=lines.filter(line=>line.sheet===sheet.name&&columns.some(column=>column.column===line.column));
   for(const row of [...new Set(relevant.map(line=>line.row))]){
    const cell=(sheet.cellsByRow.get(row)||[]).find(cell=>cell.column===header.column);
    if(!cell||cell.type==='e')continue;
    const amount=normalizeReforecastNumber(cell.value);if(amount===null)continue;
    const monthLines=relevant.filter(line=>line.row===row),complete=monthLines.length===12&&monthLines.every(line=>line.amount!==null);
    const calculated=complete?monthLines.reduce((sum,line)=>sum+line.amount,0):null;
    const difference=complete?Math.round((calculated-amount)*100)/100:null;
    const check={sheet:sheet.name,row,address:cell.address,accountCode:monthLines[0]?.accountCode,sourceTotal:amount,calculatedTotal:calculated,difference,status:!complete?'incomplete':Math.abs(difference)<=0.01?'reconciled':'mismatch',periods:columns.map(column=>column.period)};
    checks.push(check);
    if(check.status!=='reconciled')issues.push(issue('reconciliation_'+check.status,check.status==='mismatch'?'Monthly source amounts do not match the workbook annual total.':'Annual total cannot be reconciled because a monthly amount is missing.',check));
   }
  }
 }
 return checks;
}

export async function parseReforecastWorkbook(input, options={}) {
 const bytes=bytesOf(input), fileName=text(options.fileName)||'workbook.xlsx';
 if(!/\.xlsx$/i.test(fileName))throw Error('Choose an .xlsx workbook. Other formats are not accepted by this intake.');
 if(bytes.length<4||bytes[0]!==0x50||bytes[1]!==0x4b)throw Error('The selected file is not an XLSX ZIP workbook.');
 if(bytes.length>(options.maxBytes??32*1024*1024))throw Error('Workbook exceeds the 32 MB intake limit.');
 const XLSX=await loadXlsx(options.xlsx),sha256=await hashReforecastWorkbook(bytes);
 let workbook;try{workbook=XLSX.read(bytes,{type:'array',cellFormula:true,cellNF:true,cellStyles:true,cellDates:false,sheetStubs:true,bookFiles:true,bookVBA:false});}catch(error){throw Error('Workbook could not be read: '+error.message);}
 if(!workbook.SheetNames?.length)throw Error('Workbook has no worksheets.');
 const sheets=[];let totalCells=0;
 for(const [index,name] of workbook.SheetNames.entries()){
  const sheet=workbook.Sheets[name]||{},cells=[];
  for(const [address,cell] of Object.entries(sheet))if(ADDRESS.test(address)){
   if(++totalCells>(options.maxCells??500000))throw Error('Workbook exceeds the 500,000-cell evidence limit.');
   cells.push(cellEvidence(address,cell,XLSX));
  }
  cells.sort((a,b)=>a.row-b.row||a.column-b.column);
  const cellsByRow=new Map();for(const cell of cells){if(!cellsByRow.has(cell.row))cellsByRow.set(cell.row,[]);cellsByRow.get(cell.row).push(cell);}
  sheets.push({name,index,range:sheet['!ref']||null,visibility:workbook.Workbook?.Sheets?.[index]?.Hidden||0,cells,merges:plain(sheet['!merges']||[]),rowsMeta:plain(sheet['!rows']||[]),columnsMeta:plain(sheet['!cols']||[]),cellsByRow});
 }
 const metadata=metadataOf(workbook,sheets,options),issues=formulaIssues(workbook,sheets,metadata),lines=[],schedules=[],drivers=[];
 for(const named of metadata.definedNames.filter(named=>/driver/i.test(named.Name)))drivers.push({id:`name:${named.Name}`,name:named.Name,reference:named.Ref,...named.resolved,status:'requires_explicit_mapping'});
 for(const sheet of sheets){
  sheet.periodColumns=periodColumns(sheet,XLSX,metadata,issues);
  sheet.headers=sheet.cells.filter(cell=>cell.row<=80&&(!Number.isFinite(cell.value)||sheet.periodColumns.some(column=>column.headerAddresses.includes(cell.address)))).map(cell=>({address:cell.address,row:cell.row,column:cell.column,value:cell.value,formula:cell.formula}));
  if(/^(?:Controls|Sheet1|_vena|vena\.tmp)/i.test(sheet.name))continue;
  const found=extractRows(sheet,metadata,issues);lines.push(...found.lines);schedules.push(...found.schedules);drivers.push(...found.drivers);
 }
 const seen=new Map();
 for(const line of lines){const key=JSON.stringify([line.sheet,line.entity,line.department,line.scenario,line.period,line.accountCode]);if(seen.has(key))issues.push(issue('duplicate_gl_period','Multiple source rows match this GL, department, scenario and month. Choose an explicit aggregation or row mapping.',{sourceLineIds:[seen.get(key),line.id],accountCode:line.accountCode,period:line.period,sheet:line.sheet}));else seen.set(key,line.id);}
 const reconciliation=reconcileRows(sheets,lines,issues);
 const integrity=auditWorkbook(workbook,{sourceHash:sha256,modelFamily:options.modelFamily||'reforecast',previousEvidence:options.previousEvidence});
 const planningCells=classifyPlanningCells({sheets,lines,reconciliation});
 if(!lines.length)issues.push(issue('no_gl_lines','No populated GL identifiers with explicit monthly headers were found. The workbook is retained as evidence; complete or map the source rows.'));
 if(metadata.entities.length!==1)issues.push(issue('entity_assignment_required','Workbook entity selection is missing or ambiguous. Assign source entities to an authorized canonical community.',{entities:metadata.entities}));
 if(!metadata.lastClosedMonth)issues.push(issue('workbook_cutoff_unavailable','Workbook LastClosedMonth is missing or ambiguous. The canonical close remains the authority.'));
 if(metadata.currencies.length!==1||metadata.currencies[0]==='Local')issues.push(issue('currency_mapping_required','Confirm the reporting currency explicitly; Local is not an ISO currency code.',{currencies:metadata.currencies}));
 return {schemaVersion:REFORECAST_EVIDENCE_SCHEMA,parserVersion:REFORECAST_PARSER_VERSION,sourceHash:sha256,source:{fileName,sha256,byteLength:bytes.length,format:'xlsx',...(options.includeOriginalBytes?{originalFile:encodeOriginalWorkbook(bytes)}:{})},metadata,
  sheets:sheets.map(({cellsByRow,...sheet})=>sheet),lines,schedules,drivers,reconciliation,issues,integrity,planningCells,
  mapping:{version:null,propertyAssignments:[]},
  summary:{sheets:sheets.length,cells:totalCells,formulas:sheets.reduce((sum,sheet)=>sum+sheet.cells.filter(cell=>cell.formula).length,0),lines:lines.length,periods:[...new Set(lines.map(line=>line.period))].sort(),sourceScenarios:[...new Set(lines.map(line=>line.scenario))],issues:issues.length},
  actualsAuthority:false};
}

export function validateReforecastPropertyAssignment(assignment,authorizedCommunityIds=[]) {
 const issues=[];
 if(!assignment?.explicit||!UUID.test(assignment.communityId||'')||!text(assignment.actorId)||!text(assignment.reason)||!text(assignment.assignedAt))issues.push(issue('property_assignment_required','Explicit canonical community assignment, actor, time and reason are required before saving.',{},'error'));
 if(!authorizedCommunityIds.includes(assignment?.communityId))issues.push(issue('property_not_authorized','The selected community is not in the current authorized community list.',{},'error'));
 return {valid:issues.length===0,issues};
}
export function mapReforecastIntake(evidence,mapping,{authorizedCommunityIds=[],cutoffPeriod,noClosedPeriodsConfirmed=false}={}) {
 const property=validateReforecastPropertyAssignment(mapping?.propertyAssignment,authorizedCommunityIds),issues=[...property.issues,...validatePlanningCalendar(mapping?.calendar,mapping?.periods,mapping?.sourceScenario),...reviewPlanningIntegrity(evidence,mapping)],lines=[];
 if(!text(mapping?.version))issues.push(issue('mapping_version_required','Select an effective, reviewed GL mapping version.',{},'error'));
 if(!text(mapping?.sourceScenario))issues.push(issue('scenario_selection_required','Select the exact source scenario. ATLAS will not guess among Actual, Plan and budget columns.',{},'error'));
 if(!/^[A-Z]{3}$/.test(mapping?.currency||''))issues.push(issue('currency_mapping_required','Select an ISO reporting currency.',{},'error'));
 if(!PERIOD.test(cutoffPeriod||'')&&!(cutoffPeriod===null&&noClosedPeriodsConfirmed))issues.push(issue('canonical_cutoff_required','Load canonical close coverage before using workbook forecast months.',{},'error'));
 const entitySet=new Set(mapping?.propertyAssignment?.sourceEntities||[]);
 if(evidence.metadata?.entities?.some(entity=>!entitySet.has(entity)))issues.push(issue('source_entity_assignment_required','Explicitly acknowledge each workbook entity in the selected property assignment.',{entities:evidence.metadata.entities},'error'));
 if((evidence.metadata?.entities||[]).length>1)issues.push(issue('multiple_source_entities','This workbook contains multiple source entities. Split or explicitly normalize their rows before mapping a single canonical community.',{entities:evidence.metadata.entities},'error'));
 const selectedIds=mapping?.selectedLineIds?new Set(mapping.selectedLineIds):null;
 const accounts=mapping?.accountMappings||[],seen=new Map();
 for(const source of evidence.lines||[]){
  if(source.scenario!==mapping?.sourceScenario||(selectedIds&&!selectedIds.has(source.id))||(mapping?.periods&&!mapping.periods.includes(source.period)))continue;
  if(source.sourceKind==='workbook_actual_evidence'||source.period<=cutoffPeriod){issues.push(issue('closed_month_evidence_only','Workbook actuals and closed months remain source evidence. Governed close values will supply history.',{sourceLineId:source.id,period:source.period}));continue;}
  if(source.periodBasis==='unconfirmed_period'){issues.push(issue('ambiguous_period_basis','Resolve whether this source column is monthly or annual before applying its value.',{sourceLineId:source.id,period:source.period},'error'));continue;}
  const matches=accounts.filter(account=>account.sourceAccountCode===source.accountCode&&(!account.sheet||account.sheet===source.sheet)&&(!Object.prototype.hasOwnProperty.call(account,'department')||account.department===source.department));
  if(matches.length!==1){issues.push(issue(matches.length?'ambiguous_gl_mapping':'missing_gl_mapping',matches.length?'Multiple mappings match the source account.':'No reviewed GL mapping matches the source account.',{sourceLineId:source.id,accountCode:source.accountCode},'error'));continue;}
  const account=matches[0];
  if(!text(account.accountCode)||!text(account.category)||!NATURES.has(account.nature)||!['above_noi','below_noi'].includes(account.placement)||![1,-1].includes(account.signMultiplier)){issues.push(issue('incomplete_gl_mapping','Account code, category, nature, statement placement and explicit sign multiplier are required.',{accountCode:source.accountCode},'error'));continue;}
  if(source.amount===null||!Number.isFinite(source.amount)||source.cellType==='e'||(source.formula&&(source.cachedValue===null||source.cachedValue===''))){issues.push(issue('missing_mapped_value','A selected forecast GL amount is unavailable. Correct the source or explicitly provide an audited forecast input.',{sourceLineId:source.id,period:source.period},'error'));continue;}
  const sourceProblems=(evidence.issues||[]).filter(problem=>problem.sheet===source.sheet&&problem.address===source.address&&['excel_error','broken_formula_reference','external_formula_reference','missing_formula_sheet','broken_named_formula_reference'].includes(problem.code));
  if(sourceProblems.length){issues.push(issue('untrusted_formula_result','The selected value depends on a broken or external formula. Repair the source before using its cached result.',{sourceLineId:source.id,problems:sourceProblems.map(problem=>problem.code)},'error'));continue;}
  if((evidence.reconciliation||[]).some(check=>check.sheet===source.sheet&&check.row===source.row&&check.periods.includes(source.period)&&check.status==='mismatch')){issues.push(issue('source_reconciliation_failed','The selected source row has a monthly-to-annual reconciliation mismatch.',{sourceLineId:source.id,period:source.period},'error'));continue;}
  if(!source.sheet||!ADDRESS.test(source.address||'')||source.id!==`${source.sheet}!${source.address}`){issues.push(issue('source_coordinates_required','Each mapped cell requires exact source worksheet and coordinates.',{sourceLineId:source.id},'error'));continue;}
  const amount=source.amount*account.signMultiplier;
  if((account.nature==='contra_income'&&amount>0)||(['income','expense','capital','debt'].includes(account.nature)&&amount<0))issues.push(issue('sign_review_required','The mapped amount does not match the approved sign convention. Review the sign mapping or explicitly authorize a reversal.',{sourceLineId:source.id,amount,nature:account.nature},account.allowReversal?'warning':'error'));
  const line={period:source.period,accountCode:account.accountCode,amount,category:account.category,nature:account.nature,placement:account.placement,department:source.department,
   communityId:mapping?.propertyAssignment?.communityId,currency:mapping.currency,sourceLineId:source.id,sourceHash:evidence.source.sha256,sourceScenario:source.scenario,mappingVersion:mapping.version,sourceCoordinates:{sheet:source.sheet,address:source.address,row:source.row,column:source.column},signMultiplier:account.signMultiplier};
  const key=JSON.stringify([line.period,line.accountCode,line.department]);
  if(seen.has(key)){issues.push(issue('duplicate_mapped_line','The same mapped GL and month has more than one source row. Select source rows or approve a separate aggregation.',{sourceLineIds:[seen.get(key),source.id],period:line.period,accountCode:line.accountCode},'error'));continue;}
  seen.set(key,source.id);lines.push(line);
 }
 if(!lines.length)issues.push(issue('no_open_forecast_lines','No usable open-month forecast lines remain in the selected scope.',{},'error'));
 return {ready:!issues.some(item=>item.severity==='error'),lines,issues,mapping:plain(mapping),sourceHash:evidence.source?.sha256,parserVersion:evidence.parserVersion,actualsAuthority:false};
}
