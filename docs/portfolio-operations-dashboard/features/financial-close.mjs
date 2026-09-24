import {readFinance,readApprovedBudget,financialSummary,bonusEvidence} from './canonical-finance.mjs?v=bed590780060af51';
// Shared closed-month reader. No browser ledger is authoritative.
export const optionalNumber=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
export function contract(v){return v?{period:v.period_key,status:v.status,coverage:v.coverage,accountingBasis:v.accounting_basis,netRentalIncome:optionalNumber(v.metrics.netRentalIncome),grossPotentialRent:optionalNumber(v.metrics.grossPotentialRent),netCashFlow:optionalNumber(v.metrics.netCashFlow??v.metrics.sourceControls?.['Net Cash Flow']?.actual),source:v.source_file,sourceHash:v.source_hash,approvedBy:v.approved_by,approvedAt:v.approved_at,version:v.version_id,revision:v.revision}:null;}
export function coverage(versions,year){
 const months=new Set(versions.filter(v=>v.period_key?.startsWith(year+'-')&&v.status==='closed'&&v.coverage==='full_month').map(v=>Number(v.period_key.slice(5))));
 const first=months.size?Math.min(...months):0,last=months.size?Math.max(...months):0;
 const expected=versions.map(v=>v.financeEnvelope?.firstExpectedFinancialPeriod).filter(Boolean).sort()[0];
 const firstExpectedMonth=expected&&expected.startsWith(year+'-')?Number(expected.slice(5)):1;
 const missing=Array.from({length:Math.max(0,last-firstExpectedMonth+1)},(_,i)=>i+firstExpectedMonth).filter(m=>!months.has(m));
 return {first,last,missing,firstExpectedMonth,completeYtd:last>0&&missing.length===0};
}
const closedRecords=records=>records.filter(r=>r.summary.close).map(r=>({...r.summary.close,financeEnvelope:r.summary})).sort((a,b)=>a.period_key.localeCompare(b.period_key));
const readYearRecords=(central,cid,year)=>readFinance(central,[cid],Array.from({length:12},(_,i)=>year+'-'+String(i+1).padStart(2,'0')));
export async function readYear(central,cid,year){return closedRecords(await readYearRecords(central,cid,year));}
// Exact monthly baseline evidence for the legacy Budget variance surface.
export function applyEffectiveBuilderTargets(row,c,year){
 const sum=values=>values.length&&values.every(value=>typeof value==='number'&&Number.isFinite(value))?values.reduce((a,b)=>a+b,0):null;
 const original=c.budget?.payload.rows.find(item=>String(item.glCode)===String(row.gl));
 row.originalBudget=original?.monthly.slice()||Array(12).fill(null);row.baselineEvidence={};const natures=new Set();
 row.budget=Array.from({length:12},(_,month)=>{const period=year+'-'+String(month+1).padStart(2,'0'),envelope=c.finance?.find(item=>item.period_key===period)?.summary||c.versions.find(item=>item.period_key===period)?.financeEnvelope,baseline=envelope?.effectiveBaseline;
 if(baseline?.status!=='available'||baseline.verified!==true||baseline.approved!==true||baseline.locked!==true)return null;
 const lines=baseline.lines?.filter(item=>String(item.accountCode)===String(row.gl));if(lines?.length!==1)return null;
 const line=lines[0];row.baselineEvidence[period]={sourceType:baseline.sourceType,versionId:baseline.versionId,publicationId:baseline.publicationId||null,contentHash:baseline.contentHash};natures.add(line.identifier||line.nature);return optionalNumber(line.amount);
 });
 row.canonicalNature=natures.size===1?[...natures][0]:null;
 row.ytdBudget=c.coverage.completeYtd?sum(row.budget.slice(c.coverage.firstExpectedMonth-1,c.coverage.last)):null;
 row.fullYearBudget=sum(row.budget);row.remainingBudget=sum(row.budget.slice(c.coverage.last));
 row.ytdOriginalBudget=c.coverage.completeYtd?sum(row.originalBudget.slice(c.coverage.firstExpectedMonth-1,c.coverage.last)):null;
 return row;
}
export async function readRows(central,version){const out=[];for(let offset=0;offset<version.row_count;offset+=500){const rows=await central.fetchJson(`/atlas_financial_close_rows?version_id=eq.${version.version_id}&select=*&order=gl_code&limit=500&offset=${offset}`);out.push(...rows);if(!rows.length)break;}if(out.length!==version.row_count)throw Error('Closed GL readback is incomplete.');return out;}
export async function closeReview(central,review,{expectedVersion=null,reason,accountingApproved=false,requestId=crypto.randomUUID()}={}){
 const actor=central.getSession?.()?.user?.id;
 const guard=()=>{if(central.getSession?.()?.user?.id!==actor)throw Error('Session changed while closing the month. Reload shared records.');};
 const response=await central.rpc('atlas_close_financial_review_governed',{p_review_id:review.review_id,p_expected_version_id:expectedVersion,p_request_id:requestId,p_reason:reason,p_accounting_approved:accountingApproved});guard();
 const result=Array.isArray(response)?response[0]:response,v=result?.close,receipt=result?.receipt;
 if(!v?.version_id||!v?.content_hash||!receipt?.receipt_id||receipt.status!=='canonically_published'||receipt.version_id!==v.version_id||receipt.content_hash!==v.content_hash)throw Error('Close did not return a complete publication receipt. Reload before retrying.');
 const [stored]=await central.fetchJson(`/atlas_financial_close_versions?version_id=eq.${v.version_id}&select=*&limit=1`);guard();
 if(stored?.version_id!==v.version_id||stored.community_id!==review.community_id||stored.period_key!==review.period_key||stored?.content_hash!==v.content_hash||stored?.status!=='closed')throw Error('Close acknowledgement could not be verified. Reload before retrying.');
 const detail=await readRows(central,stored);guard();if(detail.some(row=>row.version_id!==stored.version_id||row.community_id!==stored.community_id))throw Error('Closed detail scope or version does not match the committed close.');
 const [report]=await readFinance(central,[stored.community_id],[stored.period_key]);guard();
 if(report?.summary?.actualCloseVersion!==stored.version_id||!report.publication_id||!result.publications?.some(p=>p.publication_id===report.publication_id&&p.period_key===stored.period_key))throw Error('Close is stored but reporting readback is not current. Retry verification from the saved review.');
 const verified=await central.rpc('atlas_verify_finance_receipt',{p_receipt_id:receipt.receipt_id,p_version_id:v.version_id,p_content_hash:v.content_hash});guard();
 const finalReceipt=Array.isArray(verified)?verified[0]:verified;
 if(finalReceipt?.status!=='readback_verified'||finalReceipt.version_id!==v.version_id||finalReceipt.content_hash!==v.content_hash)throw Error('Close readback receipt could not be verified.');
 const {verifyIntakeReceipt}=await import('./financial-intake-store.mjs?v=e7ba2e324c419b26');await verifyIntakeReceipt(central,finalReceipt);guard();
 return {...stored,intakeReceipt:finalReceipt,publicationId:report.publication_id};
}
export function createCache(central){
 const byName=new Map(),pending=new Map(),refreshed=new Map();let epoch=0;
 const api={
  status:'Not loaded',
  get(name,period){return this.envelope(name,period)?.close||null;},
  envelope(name,period){return byName.get(name)?.find(s=>s.period===period)||null;},
  summary(name,period){return financialSummary(this.envelope(name,period));},
  bonus(name,metric,periods){return bonusEvidence(byName.get(name)||[],metric,periods,{requireEffectiveBaseline:true});},
  clear(){epoch++;byName.clear();pending.clear();refreshed.clear();this.status='Not loaded';},
  async refresh(year,force=false){
   if(!force&&Date.now()-(refreshed.get(year)||0)<60000)return false;
   if(pending.has(year))return pending.get(year);
   const token=epoch;
   const task=(async()=>{try{
    const communities=await central.readCommunitiesForAccess();
    const periods=Array.from({length:12},(_,i)=>year+'-'+String(i+1).padStart(2,'0'));
    const rows=await readFinance(central,communities.map(c=>c.community_id),periods);
    if(token!==epoch)return;
    byName.forEach((values,name)=>byName.set(name,values.filter(s=>!s.period.startsWith(year+'-'))));
    for(const c of communities){const entries=rows.filter(r=>r.community_id===c.community_id).map(r=>r.summary);for(const n of new Set([c.community_id,c.display_name,c.canonical_name]))byName.set(n,[...(byName.get(n)||[]),...entries]);}
    this.status='Verified';refreshed.set(year,Date.now());return true;
   }catch(e){if(token===epoch){byName.clear();refreshed.clear();refreshed.set(year,Date.now());this.status=e.message;}throw e;}
   finally{if(token===epoch)pending.delete(year);}})();pending.set(year,task);return task;
  }
 };return api;
}
export async function mountCloseControls(container,central,review){
 const requestId=crypto.randomUUID();
 const heads=await central.fetchJson(`/atlas_financial_close_heads?community_id=eq.${review.community_id}&period_key=eq.${review.period_key}&accounting_basis=eq.accrual&select=version_id&limit=1`);
 const panel=document.createElement('details');const title=document.createElement('summary');title.textContent=heads.length?'Admin: replace closed version':'Admin: close and publish monthly actuals';panel.append(title);
 const warning=document.createElement('p');warning.textContent=`${review.source_file} · ${review.period_key}. This closes actuals only. Original approved budgets remain unchanged. Replacements retain prior versions.`;panel.append(warning);
 const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';label.append(check,' I confirm this is the Accounting-approved package and have reviewed community, period, GL mapping and reconciliation.');panel.append(label);
 const reason=document.createElement('textarea');reason.placeholder='Close or replacement reason';reason.setAttribute('aria-label','Close or replacement reason');panel.append(reason);
 const button=document.createElement('button');button.textContent=heads.length?'Replace closed version':'Close and publish actuals';const status=document.createElement('p');status.setAttribute('role','status');panel.append(button,status);container.append(panel);
 if(!review.certificate?.intakeEvidence?.governance){button.disabled=true;status.textContent='This older review lacks the complete workbook and interpretation evidence required for a new close. Re-upload the source. Existing verified closes remain available.';}
 if(review.period_key>=new Date().toISOString().slice(0,7)){button.disabled=true;status.textContent='This accounting month is still open. Close becomes available after month-end.';}
 button.onclick=async()=>{if(!check.checked||reason.value.trim().length<5){status.textContent='Confirm the review and enter a reason first.';return;}button.disabled=true;try{const v=await closeReview(central,review,{expectedVersion:heads[0]?.version_id||null,reason:reason.value.trim(),accountingApproved:check.checked,requestId});status.textContent=`Readback Verified: ${v.period_key} · revision ${v.revision} · ${v.row_count} GLs · version ${v.version_id} · hash ${v.content_hash} · publication ${v.publicationId} · receipt ${v.intakeReceipt.receipt_id}`;container.dispatchEvent(new CustomEvent('atlas-financial-intake-state',{bubbles:true,detail:v.intakeReceipt}));await window.parent.refreshAtlasClosedFinancials?.(Number(v.period_key.slice(0,4)),true);}catch(e){status.textContent=e.message;button.disabled=false;}};
}
export function installBuilder(R,central,resolve){
 if(R.closedFinancial)return;const caches=new Map();let generation=0;R.closedFinancial={caches};
 const clear=()=>{generation++;caches.clear();selected='';};
 const refresh=()=>{clear();R.app.invalidate();R.app.render();};
 window.parent.addEventListener('atlas-finance-updated',refresh);
 window.parent.addEventListener('atlas-central-auth-change',clear);
 window.addEventListener('pagehide',()=>{clear();window.parent.removeEventListener('atlas-central-auth-change',clear);window.parent.removeEventListener('atlas-finance-updated',refresh);},{once:true});
 const originalGet=R.actuals.get,originalClosed=R.actuals.closedThrough,compute=R.variance.compute;
 const engine=R.engine.computeProperty;
 R.engine.computeProperty=function(state,pid,sid,year){
  const c=caches.get(pid+'|'+(year||state.budgetYear));
  if(!c?.budget)return engine.apply(this,arguments);
  const b=c.budget,snapshot={sourceFile:b.source_file,sourceSheet:b.payload.sourceSheet,effectiveDate:b.effective_date,rows:b.payload.rows.map(r=>({gl:r.glCode,name:r.name,monthly:r.monthly,sourceRow:r.sourceRow}))};
  return engine.call(this,{...state,approvedBudgetImports:{...state.approvedBudgetImports,[pid+'|'+(year||state.budgetYear)]:snapshot}},pid,sid,year);
 };
 R.actuals.get=function(state,pid,gl,year){const c=caches.get(pid+'|'+year);return c?(c.rows.get(String(gl))?.monthly.slice()||null):null;};
 R.engine.getActuals=function(state,pid,gl,year){return R.actuals.get(state,pid,gl,year);};
 R.engine.getActualsClean=function(state,pid,gl,year){return R.actuals.get(state,pid,gl,year);};
 R.actuals.closedThrough=function(state,pid,year){const c=caches.get(pid+'|'+year);return c?c.coverage.last:0;};
 R.variance.compute=function(state,calc,pid,year){const c=caches.get(pid+'|'+year);const result=compute.call(this,c?projectBuilderActuals(state,pid,caches):state,calc,pid,year);if(!c)return result;
  const approved=R.engine.getScenario(state,calc.scenarioId).type==='approved';
  for(const row of result.rows){if(approved)applyEffectiveBuilderTargets(row,c,year);const source=c.rows.get(String(row.gl));row.actual=source?.monthly.slice()||Array(12).fill(null);row.hasActual=!!source;row.canonicalSources=source?.sources||{};if(source?.name)row.name=source.name;row.variance=row.actual.map((n,i)=>n===null||row.budget[i]===null?null:n-row.budget[i]);row.variancePct=row.variance.map((n,i)=>n===null||!row.budget[i]?null:n/Math.abs(row.budget[i]));row.ytdActual=source?.ytd??null;row.ytdVar=row.ytdActual===null||row.ytdBudget===null?null:row.ytdActual-row.ytdBudget;row.ytdVarPct=row.ytdVar===null||!row.ytdBudget?null:row.ytdVar/Math.abs(row.ytdBudget);row.projection=row.ytdActual===null||row.remainingBudget===null?null:row.ytdActual+row.remainingBudget;row.runRate=null;row.favourable=row.ytdVar===null?null:approved?(['income','contra_income'].includes(row.canonicalNature)?row.ytdVar>=0:['expense','capital','debt','below_noi'].includes(row.canonicalNature)?row.ytdVar<=0:null):row.favourable;row.monthExceptions=(row.monthExceptions||[]).filter(e=>row.actual[e.month]!==null);}
  result.exceptions=result.exceptions.filter(e=>{const row=result.rows.find(r=>r.gl===e.gl);return row?.ytdActual!==null&&(e.month===undefined||row.actual[e.month]!==null);});
  result.summary=R.variance.summary(result.rows,result.closedThrough);
  const total=key=>c.coverage.completeYtd&&c.versions.every(v=>optionalNumber(v.metrics[key])!==null)?c.versions.reduce((n,v)=>n+Number(v.metrics[key]),0):null;
  {const income=total('totalIncome'),noi=total('netOperatingIncome');for(const [key,value] of [['egi',income],['noi',noi],['expense',income===null||noi===null?null:income-noi]]){result.summary[key].actual=value;result.summary[key].variance=value===null?null:value-result.summary[key].budget;result.summary[key].pct=value===null||!result.summary[key].budget?null:result.summary[key].variance/Math.abs(result.summary[key].budget);}}
  const envelope=c.versions.find(v=>Number(v.period_key.slice(5))===c.coverage.last)?.financeEnvelope;
  if(approved){const months=Array.from({length:Math.max(0,c.coverage.last-c.coverage.firstExpectedMonth+1)},(_,i)=>year+'-'+String(c.coverage.firstExpectedMonth+i).padStart(2,'0')),envelopes=months.map(period=>c.finance?.find(r=>r.period_key===period)?.summary||c.versions.find(v=>v.period_key===period)?.financeEnvelope);
   for(const [target,key] of [['egi','revenue'],['expense','expenses'],['noi','noi']]){const item=result.summary[target];if(!item)continue;for(const basis of ['actual','budget'])item[basis]=c.coverage.completeYtd&&envelopes.length&&envelopes.every(s=>optionalNumber(s?.[key]?.[basis])!==null)?envelopes.reduce((n,s)=>n+Number(s[key][basis]),0):null;item.variance=item.actual===null||item.budget===null?null:item.actual-item.budget;item.pct=item.variance===null||!item.budget?null:item.variance/Math.abs(item.budget);}
  }
  result.canonicalBudgetVersion=approved?envelope?.budgetVersion||null:null;result.canonicalBudgetVersions=approved?c.budget?.periodVersions||{}:{};result.canonicalCoverage=c.coverage;result.canonicalVersions=c.versions.map(v=>v.version_id);result.canonicalMonthlyFinance=Object.fromEntries((c.finance||c.versions.map(v=>({period_key:v.period_key,summary:v.financeEnvelope}))).map(r=>[r.period_key,r.summary]));result.effectiveBaselineVersions=Object.fromEntries(Object.entries(result.canonicalMonthlyFinance).map(([period,s])=>[period,s?.effectiveBaseline||null]));result.canonicalApprovedScenario=approved;result.canonicalCloseSources=c.versions.map(v=>({period:v.period_key,version:v.version_id,file:v.source_file,hash:v.source_hash}));return result;
 };
 const prepare=R.exporter?.reports?.prepare;
 if(prepare)R.exporter.reports.prepare=function(state,calc,opts={}){
  const pid=opts.propertyId||state.activeProperty,year=calc.year||state.budgetYear,c=caches.get(pid+'|'+year);
  const projected=projectBuilderActuals(state,pid,caches);
  const variance=R.variance.compute(projected,calc,pid,year);
  const snapshot=JSON.parse(JSON.stringify({community:pid,year,closeVersions:c?.versions.map(v=>({period:v.period_key,id:v.version_id,hash:v.source_hash}))||[],budgetVersion:c?.budget?.version_id||null,coverage:c?.coverage||coverage([],year),variance}));
  const freeze=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o);}return o;};freeze(snapshot);
  const result=prepare.call(this,projected,calc,{...opts,variance:snapshot.variance});result.ctx.reportingSnapshot=snapshot;return result;
 };
 const render=R.app.render;let selected='';
 R.app.render=function(){const p=R.app.prop(),year=R.app.year(),key=p.id+'|'+year;if(selected!==key){selected=key;
   if(!caches.has(key)){const c={rows:new Map(),versions:[],coverage:coverage([],year),status:'Loading canonical actuals'};caches.set(key,c);R.app.invalidate();
    (async()=>{const run=generation;try{const cid=await resolve(p.name);if(!cid)throw Error('Community mapping unavailable');const finance=await readYearRecords(central,cid,year);if(run!==generation)return;c.finance=finance;c.versions=closedRecords(finance);c.coverage=coverage(c.versions,year);c.budget=await readApprovedBudget(central,cid,year);if(run!==generation)return;
     for(let i=0;i<c.versions.length;i+=3){const batch=c.versions.slice(i,i+3);const rows=await Promise.all(batch.map(v=>readRows(central,v)));if(run!==generation)return;batch.forEach((v,j)=>rows[j].forEach(r=>{let item=c.rows.get(r.gl_code);if(!item){item={monthly:Array(12).fill(null),ytd:null};c.rows.set(r.gl_code,item);}item.monthly[Number(v.period_key.slice(5))-1]=optionalNumber(r.actual);item.name=r.account_name;item.sources||={};item.sources[v.period_key]={version:v.version_id,file:v.source_file,hash:v.source_hash,location:r.source_location};if(Number(v.period_key.slice(5))===c.coverage.last)item.ytd=optionalNumber(r.ytd_actual);}));}
     for(const item of c.rows.values())item.ytd=c.coverage.completeYtd&&item.monthly.slice(c.coverage.firstExpectedMonth-1,c.coverage.last).every(v=>v!==null)?item.monthly.slice(c.coverage.firstExpectedMonth-1,c.coverage.last).reduce((a,b)=>a+b,0):null;
     c.status='Verified closed source';
    }catch(e){c.rows.clear();c.budget=null;c.finance=[];c.versions=[];c.coverage=coverage([],year);c.status=e.message;}if(selected===key){R.app.invalidate();R.app.render();}})();}
  }return render.apply(this,arguments);};
}
export async function primeBuilderYear(R,central,cid,pid,year){
 const actor=central.getSession?.()?.user?.id;
 const finance=await readYearRecords(central,cid,year),versions=closedRecords(finance),c={rows:new Map(),finance,versions,budget:await readApprovedBudget(central,cid,year),coverage:coverage(versions,year),status:'Verified closed source'};
 for(let i=0;i<versions.length;i+=3){const batch=versions.slice(i,i+3),sets=await Promise.all(batch.map(v=>readRows(central,v)));batch.forEach((v,j)=>sets[j].forEach(r=>{const item=c.rows.get(r.gl_code)||{monthly:Array(12).fill(null),ytd:null};item.monthly[Number(v.period_key.slice(5))-1]=optionalNumber(r.actual);item.name=r.account_name;item.sources||={};item.sources[v.period_key]={version:v.version_id,file:v.source_file,hash:v.source_hash,location:r.source_location};if(Number(v.period_key.slice(5))===c.coverage.last)item.ytd=optionalNumber(r.ytd_actual);c.rows.set(r.gl_code,item);}));}
 if(central.getSession&&central.getSession()?.user?.id!==actor)throw Error('Session changed while reading financial sources.');
 for(const item of c.rows.values())item.ytd=c.coverage.completeYtd&&item.monthly.slice(c.coverage.firstExpectedMonth-1,c.coverage.last).every(v=>v!==null)?item.monthly.slice(c.coverage.firstExpectedMonth-1,c.coverage.last).reduce((a,b)=>a+b,0):null;
 R.closedFinancial.caches.set(pid+'|'+year,c);return c;
}
export function projectBuilderActuals(state,pid,caches){
 const projected={...state,actuals:{...state.actuals},periods:{...state.periods}};
 for(const [key,c] of caches){if(!key.startsWith(pid+'|'))continue;const year=Number(key.split('|').at(-1));
  for(const [k,a] of Object.entries(projected.actuals))if(a.propertyId===pid&&Number(a.year)===year)delete projected.actuals[k];
  const latest=c.versions.find(v=>Number(v.period_key.slice(5))===c.coverage.last);
  for(const [gl,row] of c.rows){const k=pid+'|'+gl+'|'+year;projected.actuals[k]={key:k,propertyId:pid,year,gl,monthly:row.monthly.slice(),source:latest?.source_file||'Canonical close',updatedAt:latest?.approved_at||null};}
  projected.periods[key]={closedThrough:c.coverage.last,loadedAt:latest?.approved_at||null,source:latest?latest.source_file+' / closed '+latest.version_id:null,coverage:c.versions.map(v=>Number(v.period_key.slice(5))-1),canonicalVersions:Object.fromEntries(c.versions.map(v=>[v.period_key,v.version_id]))};
 }return projected;
}
