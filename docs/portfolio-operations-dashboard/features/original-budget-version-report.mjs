import {readBudgetVersion,requiredBudgetCoverage} from './approved-budget.mjs?v=631bead1e9164b89';
import {financeAccessKey} from './canonical-finance.mjs?v=fd8a20e264fb5c1b';
import {canonicalJson,freezeSnapshot,retainedSnapshot} from './financial-snapshot.mjs?v=848d058bdec07b4e';
import {snapshotPdf} from './snapshot-pdf.mjs?v=e6a58eadc065a877';

const uuid=value=>/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value||'');
const hash=value=>/^[a-f0-9]{64}$/i.test(value||'');
const reports=new WeakSet(),metrics={gpr:'Gross potential rent',netRentalIncome:'Net rental income',revenue:'Income',expenses:'Expenses',noi:'NOI',cashFlow:'Cash flow',capital:'Capital',debt:'Debt'};
const period=(year,month)=>year+'-'+String(month+1).padStart(2,'0');
const same=(left,right)=>canonicalJson(left)===canonicalJson(right);
function accessGuard(central,cid){
 if(!uuid(cid)||!central?.getSession?.()?.user?.id||central.isAuthenticated?.()===false||central.isEnabled?.()===false)throw Error('Sign in and select an authorized community before reading saved budgets.');
 const key=financeAccessKey(central);
 return ()=>{if(financeAccessKey(central)!==key)throw Error('Session or financial access changed while reading the saved budget.');};
}
function coverage(row){
 const months=row.covered_months;
 if(!uuid(row.version_id)||!uuid(row.community_id)||row.status!=='locked'||row.record_type!=='budget_original'||!hash(row.content_hash)||!hash(row.source_hash)||!Number.isInteger(row.calendar_year)||row.calendar_year<2000||row.calendar_year>2099||!Array.isArray(months)||!months.length||new Set(months).size!==months.length||months.some(m=>!Number.isInteger(m)||m<0||m>11))throw Error('Saved original budget version, hash, status or covered months are invalid.');
 return [...months].sort((a,b)=>a-b);
}
// This is an RLS-protected metadata read, never a list of browser-saved models.
export async function listOriginalBudgetReportVersions(central,{cid}){
 const guard=accessGuard(central,cid),result=[],seen=new Set(),size=100;
 for(let offset=0;;offset+=size){
  const page=await central.fetchJson('/atlas_approved_budget_versions?community_id=eq.'+encodeURIComponent(cid)+'&status=eq.locked&record_type=eq.budget_original&select=version_id,community_id,calendar_year,status,record_type,content_hash,source_hash,source_file,covered_months,approved_at&order=approved_at.desc,version_id.asc&limit='+size+'&offset='+offset);guard();
  if(!Array.isArray(page)||page.length>size)throw Error('Saved budget version listing is incomplete.');
  for(const row of page){const months=coverage(row);if(row.community_id!==cid||seen.has(row.version_id))throw Error('Saved budget listing returned another community or a repeated version.');seen.add(row.version_id);result.push({versionId:row.version_id,contentHash:row.content_hash,year:row.calendar_year,periods:months.map(m=>period(row.calendar_year,m)),recordedAt:row.approved_at,sourceFile:row.source_file,sourceHash:row.source_hash,status:row.status});}
  if(page.length<size)break;
 }
 return freezeSnapshot(result);
}
// Sum the exact decimal spelling retained by JSON, including scientific notation.
// Historical approvals can contain more than two decimal places.
function decimal(value){const [coefficient,exponent='0']=String(value).toLowerCase().split('e'),[whole,fraction='']=coefficient.split('.');let units=BigInt(whole+fraction),scale=fraction.length-Number(exponent);if(scale<0){units*=10n**BigInt(-scale);scale=0;}return {units,scale};}
function total(values){
 const parts=values.map(decimal),scale=Math.max(0,...parts.map(p=>p.scale)),units=parts.reduce((sum,p)=>sum+p.units*10n**BigInt(scale-p.scale),0n),sign=units<0n?'-':'',digits=(units<0n?-units:units).toString().padStart(scale+1,'0'),number=Number(sign+(scale?digits.slice(0,-scale)+'.'+digits.slice(-scale):digits));
 if(!Number.isFinite(number))throw Error('A saved budget total exceeds the supported numeric range. Source values were not rounded.');
 const result=decimal(number),common=Math.max(scale,result.scale);if(result.units*10n**BigInt(common-result.scale)!==units*10n**BigInt(common-scale))throw Error('A saved budget total cannot be represented exactly. Source values were not rounded.');return number;
}
function verified(report){if(!reports.has(report)||!Object.isFrozen(report))throw Error('Read the immutable saved budget version before exporting.');return report;}
export async function readOriginalBudgetVersionReport(central,{cid,versionId,contentHash,year,communityName}){
 const guard=accessGuard(central,cid);
 if(!uuid(versionId)||!hash(contentHash)||!Number.isInteger(year)||year<2000||year>2099)throw Error('An exact saved budget version, content hash and year are required.');
 const version=await readBudgetVersion(central,{versionId,contentHash,cid,year});guard();
 const months=coverage(version),payload=version.payload,required=requiredBudgetCoverage(year,version.fiscal_year,version.fiscal_start_month),payloadCoverage=payload?.coverage??Array.from({length:12},(_,m)=>m);
 if(!payload||payload.communityId!==cid||payload.year!==year||!payload.approvedLocked||!payload.reviewConfirmed||!same(months,required)||!Array.isArray(payloadCoverage)||!same([...payloadCoverage].sort((a,b)=>a-b),months)||payload.fiscalYear!==version.fiscal_year||payload.fiscalStartMonth!==version.fiscal_start_month||payload.sourceHash!==version.source_hash||payload.sourceFile!==version.source_file||payload.effectiveDate!==version.effective_date||!Array.isArray(payload.rows)||!payload.rows.length)throw Error('Saved original budget source, fiscal coverage or approval evidence does not match its immutable version.');
 const periods=months.map(m=>period(year,m)),byGl=new Map(),rows=payload.rows.map(row=>{
  if(typeof row.glCode!=='string'||!row.glCode.trim()||byGl.has(row.glCode)||!Array.isArray(row.monthly)||row.monthly.length!==12)throw Error('Saved budget contains a duplicate GL or incomplete monthly detail.');
  for(let month=0;month<12;month++){const value=row.monthly[month];if(months.includes(month)?typeof value!=='number'||!Number.isFinite(value):value!==null)throw Error('Every covered GL/month needs an exact numeric amount; blanks and uncovered months cannot become zero.');}
  byGl.set(row.glCode,row);
  return {GL:row.glCode,Account:String(row.name||row.accountName||row.glCode),...Object.fromEntries(months.map(m=>[period(year,m),row.monthly[m]])),Covered_total:total(months.map(m=>row.monthly[m])),Source_sheet:payload.sourceSheet||null,Source_row:row.sourceRow&&typeof row.sourceRow==='object'?canonicalJson(row.sourceRow):row.sourceRow??null,Source_cells:row.sourceCells?canonicalJson(row.sourceCells):null};
 });
 if(!payload.metricMappings||typeof payload.metricMappings!=='object'||Array.isArray(payload.metricMappings))throw Error('Approved metric mappings are unavailable.');
 const mappingRows=[];
 for(const [key,parts] of Object.entries(payload.metricMappings)){
  if(!Array.isArray(parts))throw Error('Approved metric mapping is invalid.');const seen=new Set();
  for(const part of parts){if(!byGl.has(part.glCode)||seen.has(part.glCode)||![1,-1].includes(part.factor))throw Error('Approved metric mapping references an invalid or duplicate GL.');seen.add(part.glCode);mappingRows.push({Metric:metrics[key]||key,GL:part.glCode,Factor:part.factor});}
 }
 const monthly=months.map(month=>({Period:period(year,month),...Object.fromEntries(Object.entries(metrics).map(([key,label])=>{const parts=payload.metricMappings[key];return [label,parts?.length?total(parts.map(part=>byGl.get(part.glCode).monthly[month]*part.factor)):null];}))}));
 const metadata={Community:communityName||cid,Community_ID:cid,Version:versionId,Content_hash:contentHash,Status:'Approved and locked',Calendar_year:year,Fiscal_year:version.fiscal_year,Fiscal_start_month:version.fiscal_start_month,Covered_months:periods.join(', '),Currency:payload.currency||null,Effective_date:version.effective_date,Approved_at:version.approved_at,Approved_by:version.approved_by,Source_file:version.source_file,Source_hash:version.source_hash,Mapping_version:payload.mappingVersion||null};
 const snapshot=retainedSnapshot({kind:'approved_original_budget_version',identity:metadata,values:{rows,monthly,mappingRows}});
 const report=freezeSnapshot({title:'ATLAS Approved Original Budget',communityId:cid,versionId,contentHash,status:'locked',periods,rows,monthly,mappingRows,metadata,snapshot});reports.add(report);return report;
}
export function originalBudgetVersionWorkbook(report,XLSX){
 const r=verified(report),workbook=XLSX.utils.book_new(),sheets={'Monthly summary':r.monthly,'GL detail':r.rows,'Approved metric mapping':r.mappingRows,'Source and version':Object.entries({...r.metadata,Snapshot:r.snapshot.fingerprint,Missing_values:'Unavailable means missing; numeric zero is populated.'}).map(([Field,Value])=>({Field,Value}))};
 for(const [name,rows] of Object.entries(sheets)){
  const sheet=XLSX.utils.json_to_sheet(rows),keys=Object.keys(rows[0]||{});
  // Explicit strings prevent source labels, paths or account IDs becoming formulas.
  for(const [address,cell] of Object.entries(sheet)){if(address.startsWith('!'))continue;if(typeof cell.v==='string'){cell.t='s';delete cell.f;delete cell.l;}else if(typeof cell.v==='number'&&['Monthly summary','GL detail'].includes(name)&&keys[XLSX.utils.decode_cell(address).c]!=='Source_row')cell.z=decimal(cell.v).scale<=2?'#,##0.00;[Red](#,##0.00);0.00':'General';}
  sheet['!cols']=keys.map(key=>({wch:key==='Account'?38:key==='GL'?14:key==='Value'?85:key==='Source_cells'?45:Math.max(16,key.length+2)}));
  if(sheet['!ref'])sheet['!autofilter']={ref:sheet['!ref']};
  XLSX.utils.book_append_sheet(workbook,sheet,name);
 }
 return workbook;
}
export function originalBudgetVersionPdf(report){
 // The shared PDF formatter displays up to 20 fractional places. Preserve smaller
 // finite source values as their exact decimal/exponent spelling instead of zero.
 const printableRows=rows=>rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,typeof value==='number'&&decimal(value).scale>20?String(value):value])));
 const r=verified(report),sections=[{title:'Monthly financial summary',rows:printableRows(r.monthly),columns:[['Period','Month',70],...Object.values(metrics).map(label=>[label,label,88,'money'])],note:'Totals use only the metric GL mappings retained with this approved version. An unmapped metric is unavailable.'}];
 for(let index=0;index<r.periods.length;index+=6){const periods=r.periods.slice(index,index+6);sections.push({title:'Approved GL values: '+periods[0]+' to '+periods.at(-1),pageBreak:true,rows:printableRows(r.rows),columns:[['GL','GL',65],['Account','Account',225],...periods.map(p=>[p,p,80,'money'])],note:'All saved GLs are included. Source signs and numeric zero are preserved.'});}
 sections.push({title:'Approval and source version',pageBreak:true,fontSize:7.5,rows:Object.entries(r.metadata).map(([Field,Value])=>({Field:Field.replaceAll('_',' '),Value:typeof Value==='number'?String(Value):Value})),columns:[['Field','Source / approval field',190],['Value','Immutable value',584]]});
 return snapshotPdf({title:r.title,subtitle:[r.metadata.Community,'Approved and locked',r.periods.join(', ')].join(' / '),snapshot:r.snapshot,rows:[...r.rows,...r.monthly,...r.mappingRows],sections});
}
