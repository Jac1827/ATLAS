import {readFinance,number} from './canonical-finance.mjs?v=491d9382e664ca55';
import {freezeSnapshot,lineageColumns} from './financial-snapshot.mjs?v=e84268921f32df41';
import {snapshotPdf} from './snapshot-pdf.mjs?v=b614627cd7378375';
import {loadXlsx} from './reforecast-intake.mjs?v=dbd1802780d0939a';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hash=value=>/^[a-f0-9]{64}$/i.test(value||'');
// The adapter selects the version. Never select a local baseline, a statement
// comparison budget, or the latest budget independently of the reporting month.
export async function readCanonicalBudgetVersion(central,record,cid,period){
 const id=record?.summary?.budgetVersion;if(!id)return null;
 const expectedHash=record.summary.budgetContentHash;
 if(!hash(expectedHash))throw Error('Canonical approved-budget hash is unavailable. Refresh before exporting.');
 const versions=await central.fetchJson(`/atlas_approved_budget_versions?version_id=eq.${encodeURIComponent(id)}&select=*&limit=1`),version=versions?.[0],year=Number(period.slice(0,4)),month=Number(period.slice(5))-1;
 if(!Array.isArray(versions)||versions.length!==1||version.version_id!==id||version.community_id!==cid||version.calendar_year!==year||version.status!=='locked')throw Error('Approved budget scope or status could not be verified.');
 if(version.content_hash!==expectedHash)throw Error('Approved budget hash does not match the canonical version.');
 const coverage=version.covered_months,payload=version.payload;
 if(!Array.isArray(coverage)||!coverage.length||new Set(coverage).size!==coverage.length||coverage.some(m=>!Number.isInteger(m)||m<0||m>11)||!coverage.includes(month))throw Error('Approved budget does not cover the requested calendar month.');
 if(!payload||payload.communityId!==cid||payload.year!==year||!Array.isArray(payload.rows)||!payload.rows.length)throw Error('Approved budget payload scope or detail is invalid.');
 if(payload.coverage&&(payload.coverage.length!==coverage.length||payload.coverage.some(m=>!coverage.includes(m))))throw Error('Approved budget fiscal coverage does not match the immutable version.');
 const seen=new Set(),rows=payload.rows.map(row=>{
  const gl=String(row.glCode??'');if(!gl.trim()||seen.has(gl)||!Array.isArray(row.monthly)||row.monthly.length!==12)throw Error('Approved budget contains duplicate GLs or incomplete monthly detail.');seen.add(gl);
  const raw=row.monthly[month],amount=number(raw);if(amount===null&&raw!==null&&raw!==undefined&&String(raw).trim()!=='')throw Error('Approved budget contains an invalid monthly amount.');
  return {gl_code:gl,account_name:row.name||row.accountName||gl,budget:amount,source_location:{sheet:payload.sourceSheet||null,row:row.sourceRow??null,cells:row.sourceCells??null},nature:row.nature??null,placement:row.placement??null};
 });
 return freezeSnapshot(structuredClone({versionId:id,contentHash:expectedHash,sourceFile:payload.sourceFile||null,sourceHash:version.source_hash||payload.sourceHash||null,mappingVersion:payload.mappingVersion||null,currency:payload.currency||null,fiscalYear:payload.fiscalYear??null,fiscalStartMonth:payload.fiscalStartMonth??null,coveredMonths:coverage,rows}));
}
export function assertBudgetReadback(record,readback){
 if(!readback||readback.publication_id!==record.publication_id||readback.summary?.budgetVersion!==record.summary?.budgetVersion||readback.summary?.budgetContentHash!==record.summary?.budgetContentHash||readback.summary?.financialSnapshot?.fingerprint!==record.summary?.financialSnapshot?.fingerprint)throw Error('The canonical version changed during the read. Refresh before exporting.');
}
export async function readBudgetSnapshot(central,cid,period){
 const actor=central.getSession?.()?.user?.id,[record]=await readFinance(central,[cid],[period]),budget=await readCanonicalBudgetVersion(central,record,cid,period);
 if(!budget)throw Error('No canonical approved original budget is available for this period.');
 const [readback]=await readFinance(central,[cid],[period]);
 if(central.getSession?.()?.user?.id!==actor)throw Error('Session changed while reading financial evidence.');assertBudgetReadback(record,readback);
 const actualsReason=record.summary.coveragePolicy?.fullMonthAllowed===false?record.summary.coveragePolicy.reason||record.summary.coverageReason:'No published full-month actuals are available for this period.';
 return freezeSnapshot(structuredClone({communityId:cid,period,publicationId:record.publication_id||null,financialSnapshot:record.summary.financialSnapshot,budget,actualsReason:actualsReason||'This period is excluded from authoritative full-month actuals.'}));
}
export function budgetReportRows(s){return s.budget.rows.map(row=>({...lineageColumns(s.financialSnapshot),Community:s.communityId,Period:s.period,GL:row.gl_code,Account:row.account_name,Original_budget:row.budget,Actual:null,Actual_minus_budget:null,Actuals_status:s.actualsReason,Budget_version:s.budget.versionId,Budget_content_hash:s.budget.contentHash,Publication:s.publicationId,Currency:s.budget.currency,Fiscal_year:s.budget.fiscalYear,Fiscal_start_month:s.budget.fiscalStartMonth,Mapping_version:s.budget.mappingVersion,Source_file:s.budget.sourceFile,Source_hash:s.budget.sourceHash,Source_location:JSON.stringify(row.source_location)}));}
export function budgetReportHtml(s){return `<h3>Approved original budget · ${esc(s.period)}</h3><p>Actuals unavailable: ${esc(s.actualsReason)}</p><p>Snapshot ${esc(s.financialSnapshot.fingerprint)}</p><details><summary>Source and version details</summary><p>${esc(s.budget.sourceFile)}</p><p>Budget version ${esc(s.budget.versionId)} · hash ${esc(s.budget.contentHash)}</p></details><div style="overflow:auto;max-height:600px"><table><thead><tr><th>GL</th><th>Account</th><th>Approved original budget</th></tr></thead><tbody>${budgetReportRows(s).map(row=>`<tr><td>${esc(row.GL)}</td><td>${esc(row.Account)}</td><td>${row.Original_budget===null?'Unavailable':esc(row.Original_budget)}</td></tr>`).join('')}</tbody></table></div>`;}
export function budgetReportCsv(s){const rows=budgetReportRows(s),keys=Object.keys(rows[0]||{}),quote=v=>'"'+String(typeof v==='string'&&/^[=+@-]/.test(v)?"'"+v:v??'').replaceAll('"','""')+'"';return [keys,...rows.map(row=>keys.map(k=>row[k]))].map(row=>row.map(quote).join(',')).join('\r\n');}
export function budgetReportWorkbook(s,XLSX){const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(budgetReportRows(s)),'Approved original budget');return workbook;}
export function budgetReportPdf(s){return snapshotPdf({title:'ATLAS Approved Original Budget',subtitle:s.communityId+' / '+s.period,snapshot:s.financialSnapshot,rows:budgetReportRows(s),columns:[['GL','GL',72],['Account','Account',290],['Original_budget','Approved original budget',165],['Actual','Actual',100],['Period','Period',100]]});}
export async function mountBudgetReport(container,central,cid,period,{isCurrent=()=>true}={}){
 const snapshot=await readBudgetSnapshot(central,cid,period);if(!container.isConnected||!isCurrent())return;
 container.innerHTML='<button data-export="csv">CSV</button><button data-export="xlsx">Excel</button><button data-export="pdf">Download PDF</button><p role="status"></p>'+budgetReportHtml(snapshot);
 for(const button of container.querySelectorAll('[data-export]'))button.onclick=async()=>{button.disabled=true;try{const kind=button.dataset.export,name='ATLAS-approved-original-budget-'+period;if(kind==='xlsx'){const XLSX=await loadXlsx();XLSX.writeFile(budgetReportWorkbook(snapshot,XLSX),name+'.xlsx');}else{const url=URL.createObjectURL(new Blob([kind==='pdf'?await budgetReportPdf(snapshot):budgetReportCsv(snapshot)],{type:kind==='pdf'?'application/pdf':'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=name+'.'+kind;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}catch(error){container.querySelector('[role=status]').textContent=error.message;}finally{button.disabled=false;}};
 return snapshot;
}
