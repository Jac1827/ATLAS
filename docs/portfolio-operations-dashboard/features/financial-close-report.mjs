import {financeSnapshot,lineageColumns} from './financial-snapshot.mjs?v=e84268921f32df41';
import {snapshotPdf} from './snapshot-pdf.mjs?v=b614627cd7378375';
import {readFinance} from './canonical-finance.mjs?v=491d9382e664ca55';
import {readRows} from './financial-close.mjs?v=efa74b93df9c7e39';
import {loadXlsx} from './reforecast-intake.mjs?v=dbd1802780d0939a';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const freeze=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o);}return o;};
export async function readCloseSnapshot(central,cid,period){
 const actor=central.getSession?.()?.user?.id,[record]=await readFinance(central,[cid],[period]);
 const projected=record?.summary?.close;if(!projected?.version_id||!record.publication_id)throw Error(record?.summary?.coverageReason||'No published full-month actuals are available for this period.');
 if(record.summary.actualCloseVersion!==projected.version_id)throw Error('Canonical close version mismatch. Refresh before exporting.');
 // The reporting projection deliberately carries only selected close fields. Read
 // lineage from the immutable close itself; a projected hash may be absent.
 const versions=await central.fetchJson(`/atlas_financial_close_versions?version_id=eq.${encodeURIComponent(projected.version_id)}&select=*&limit=1`),close=versions?.[0];
 if(central.getSession?.()?.user?.id!==actor)throw Error('Session changed while reading financial evidence.');
 if(!Array.isArray(versions)||versions.length!==1||close.version_id!==projected.version_id||close.community_id!==cid||close.period_key!==period||close.status!=='closed'||close.coverage!=='full_month')throw Error('Published close scope or status could not be verified. Refresh before exporting.');
 if(!/^[a-f0-9]{64}$/i.test(close.content_hash||'')||!Number.isInteger(close.row_count)||close.row_count<1)throw Error('Published close hash or row count is missing or invalid. Refresh before exporting.');
 if(['content_hash','community_id','period_key','source_hash','row_count'].some(key=>projected[key]!==undefined&&projected[key]!==close[key]))throw Error('Published close lineage does not match the immutable version. Refresh before exporting.');
 const rows=await readRows(central,close);
 const [readback]=await readFinance(central,[cid],[period]);
 if(central.getSession?.()?.user?.id!==actor||readback?.publication_id!==record.publication_id||readback.summary?.actualCloseVersion!==close.version_id||readback.summary?.close?.version_id!==close.version_id)throw Error('The canonical version changed during the read. Refresh before exporting.');
 if(readback.summary.close.content_hash!==undefined&&readback.summary.close.content_hash!==close.content_hash)throw Error('Published close lineage does not match the immutable version. Refresh before exporting.');
 if(rows.some(r=>r.version_id!==close.version_id||r.community_id!==cid))throw Error('Canonical detail version or community mismatch.');
 return freeze(structuredClone({communityId:cid,period,versionId:close.version_id,contentHash:close.content_hash,sourceHash:close.source_hash,sourceFile:close.source_file,publicationId:record.publication_id,budgetVersion:record.summary.budgetVersion||null,status:'Canonically Published',financialSnapshot:record.summary.financialSnapshot||financeSnapshot(record.summary,record.publication_id),coverage:record.summary.coveragePolicy||null,carryIn:record.summary.carryInDisclosure||[],metrics:close.metrics,rows}));
}
export function closeReportRows(s){return s.rows.map(r=>({...lineageColumns(s.financialSnapshot),Community:s.communityId,Period:s.period,GL:r.gl_code,Account:r.account_name,Actual:r.actual,Source_YTD:r.ytd_actual,Close_version:s.versionId,Content_hash:s.contentHash,Publication:s.publicationId,Budget_version:s.budgetVersion,Coverage_policy:s.coverage?.policyId||null,Carry_in_disclosure:JSON.stringify(s.carryIn||[]),Source_file:s.sourceFile,Source_hash:s.sourceHash,Source_location:JSON.stringify(r.source_location)}));}
export function closeReportHtml(s){const rows=closeReportRows(s),keys=Object.keys(rows[0]||{});return `<h3>Published monthly actuals · ${esc(s.period)}</h3><p>Snapshot ${esc(s.financialSnapshot.fingerprint)}</p><p>Version ${esc(s.versionId)} · hash ${esc(s.contentHash)} · publication ${esc(s.publicationId)}</p><p>Source YTD is supporting evidence and may include activity outside the selected full-month coverage.</p>${s.carryIn?.length?'<p>Carry-in disclosure: '+esc(s.carryIn.map(item=>item.reason+' (source periods '+item.sourcePeriods.join(', ')+'; '+item.treatment+')').join('; '))+'</p>':''}<div style="overflow:auto;max-height:600px"><table><thead><tr>${keys.map(k=>`<th>${esc(k)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${keys.map(key=>`<td>${row[key]===null?'Unavailable':esc(row[key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;}
export function closeReportCsv(s){const rows=closeReportRows(s),keys=Object.keys(rows[0]||{}),quote=v=>'"'+String(typeof v==='string'&&/^[=+@-]/.test(v)?"'"+v:v??'').replaceAll('"','""')+'"';return [keys,...rows.map(row=>keys.map(k=>row[k]))].map(row=>row.map(quote).join(',')).join('\r\n');}
export function closeReportWorkbook(s,XLSX){const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(closeReportRows(s)),'Canonical actuals');return workbook;}
export async function mountCloseReport(container,central,cid,period){
 const snapshot=await readCloseSnapshot(central,cid,period);if(!container.isConnected)return;
 container.innerHTML='<button data-export="csv">CSV</button><button data-export="xlsx">Excel</button><button data-export="pdf">Download PDF</button><p role="status"></p>'+closeReportHtml(snapshot);
 for(const button of container.querySelectorAll('[data-export]'))button.onclick=async()=>{button.disabled=true;try{const kind=button.dataset.export,name='ATLAS-closed-actuals-'+snapshot.period;if(kind==='xlsx'){const XLSX=await loadXlsx();XLSX.writeFile(closeReportWorkbook(snapshot,XLSX),name+'.xlsx');}else if(kind==='csv'){const url=URL.createObjectURL(new Blob([closeReportCsv(snapshot)],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=name+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}else{const url=URL.createObjectURL(new Blob([await closeReportPdf(snapshot)],{type:'application/pdf'})),a=document.createElement('a');a.href=url;a.download=name+'.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}catch(error){container.querySelector('[role=status]').textContent=error.message;}finally{button.disabled=false;}};
 return snapshot;
}

export function closeReportPdf(snapshot){return snapshotPdf({title:'ATLAS Published Monthly Actuals',subtitle:snapshot.communityId+' / '+snapshot.period,snapshot:snapshot.financialSnapshot,rows:closeReportRows(snapshot),columns:[['GL','GL',58],['Account','Account',270],['Actual','Actual',130],['Source_YTD','Source YTD',130],['Period','Period',90]]});}
