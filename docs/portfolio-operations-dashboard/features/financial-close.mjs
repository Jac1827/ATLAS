// Shared closed-month reader. No browser ledger is authoritative.
export const optionalNumber=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
export function contract(v){return v?{period:v.period_key,status:v.status,coverage:v.coverage,accountingBasis:v.accounting_basis,netRentalIncome:optionalNumber(v.metrics.netRentalIncome),grossPotentialRent:optionalNumber(v.metrics.grossPotentialRent),source:v.source_file,sourceHash:v.source_hash,approvedBy:v.approved_by,approvedAt:v.approved_at,version:v.version_id,revision:v.revision}:null;}
export function coverage(versions,year){const months=new Set(versions.filter(v=>v.period_key.startsWith(year+'-')).map(v=>Number(v.period_key.slice(5))));const first=months.size?Math.min(...months):0;let last=first;while(last&&months.has(last+1))last++;return{first,last,missing:Array.from({length:last},(_,i)=>i+1).filter(m=>!months.has(m)),completeYtd:first===1};}
export async function readYear(central,cid,year){
 const heads=await central.fetchJson(`/atlas_financial_close_heads?community_id=eq.${encodeURIComponent(cid)}&period_key=gte.${year}-01&period_key=lte.${year}-12&accounting_basis=eq.accrual&select=version_id&limit=12`);
 if(!heads.length)return[];
 return central.fetchJson(`/atlas_financial_close_versions?version_id=in.(${heads.map(h=>h.version_id).join(',')})&select=*&order=period_key&limit=12`);
}
export async function readRows(central,version){const out=[];for(let offset=0;offset<version.row_count;offset+=500){const rows=await central.fetchJson(`/atlas_financial_close_rows?version_id=eq.${version.version_id}&select=*&order=gl_code&limit=500&offset=${offset}`);out.push(...rows);if(!rows.length)break;}if(out.length!==version.row_count)throw Error('Closed GL readback is incomplete.');return out;}
export async function closeReview(central,review,{expectedVersion=null,reason,accountingApproved=false}={}){
 const response=await central.rpc('atlas_close_financial_review',{p_review_id:review.review_id,p_expected_version_id:expectedVersion,p_reason:reason,p_accounting_approved:accountingApproved});const v=Array.isArray(response)?response[0]:response;
 const [stored]=await central.fetchJson(`/atlas_financial_close_versions?version_id=eq.${v.version_id}&select=*&limit=1`);
 if(stored?.content_hash!==v.content_hash||stored?.status!=='closed')throw Error('Close acknowledgement could not be verified. Reload before retrying.');
 await readRows(central,stored);return stored;
}
export function createCache(central){
 const byName=new Map(),pending=new Map(),refreshed=new Map();let epoch=0;
 return{
  status:'Not loaded',
  get(name,period){return byName.get(name)?.find(v=>v.period_key===period)||null;},
  clear(){epoch++;byName.clear();pending.clear();refreshed.clear();this.status='Not loaded';},
  async refresh(year,force=false){if(!force&&Date.now()-(refreshed.get(year)||0)<60000)return;if(pending.has(year))return pending.get(year);const token=epoch;
   const task=(async()=>{try{const communities=await central.readCommunitiesForAccess();
    // One bounded summary query per authorized year; no GL detail or per-community N+1.
    const heads=await central.fetchJson(`/atlas_financial_close_heads?period_key=gte.${year}-01&period_key=lte.${year}-12&accounting_basis=eq.accrual&select=community_id,version_id&limit=1000`);
    if(heads.length===1000)throw Error('Financial coverage exceeds the summary limit; narrow the scope.');
    const versions=[];for(let i=0;i<heads.length;i+=100)versions.push(...await central.fetchJson(`/atlas_financial_close_versions?version_id=in.(${heads.slice(i,i+100).map(h=>h.version_id).join(',')})&select=*&limit=100`));
    if(token!==epoch)return;for(const c of communities){const entries=versions.filter(v=>v.community_id===c.community_id);for(const n of [c.community_id,c.display_name,c.canonical_name])byName.set(n,[...(byName.get(n)||[]).filter(v=>!v.period_key.startsWith(year+'-')),...entries]);}this.status='Verified';refreshed.set(year,Date.now());
   }catch(e){this.status=e.message;throw e;}finally{pending.delete(year);}})();pending.set(year,task);return task;
  }
 };
}
export async function mountCloseControls(container,central,review){
 const heads=await central.fetchJson(`/atlas_financial_close_heads?community_id=eq.${review.community_id}&period_key=eq.${review.period_key}&accounting_basis=eq.accrual&select=version_id&limit=1`);
 const panel=document.createElement('details');const title=document.createElement('summary');title.textContent=heads.length?'Admin: replace closed version':'Admin: close and publish monthly actuals';panel.append(title);
 const warning=document.createElement('p');warning.textContent=`${review.source_file} · ${review.period_key}. This closes actuals only. Original approved budgets remain unchanged. Replacements retain prior versions.`;panel.append(warning);
 const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';label.append(check,' I confirm this is the Accounting-approved package and have reviewed community, period, GL mapping and reconciliation.');panel.append(label);
 const reason=document.createElement('textarea');reason.placeholder='Close or replacement reason';reason.setAttribute('aria-label','Close or replacement reason');panel.append(reason);
 const button=document.createElement('button');button.textContent=heads.length?'Replace closed version':'Close and publish actuals';const status=document.createElement('p');status.setAttribute('role','status');panel.append(button,status);container.append(panel);
 button.onclick=async()=>{if(!check.checked||reason.value.trim().length<5){status.textContent='Confirm the review and enter a reason first.';return;}button.disabled=true;try{const v=await closeReview(central,review,{expectedVersion:heads[0]?.version_id||null,reason:reason.value.trim(),accountingApproved:check.checked});status.textContent=`Closed and read back: ${v.period_key} · revision ${v.revision} · ${v.row_count} GLs · ${v.version_id}`;await window.parent.refreshAtlasClosedFinancials?.(Number(v.period_key.slice(0,4)),true);}catch(e){status.textContent=e.message;button.disabled=false;}};
}
export function installBuilder(R,central,resolve){
 if(R.closedFinancial)return;const caches=new Map();let generation=0;R.closedFinancial={caches};
 const clear=()=>{generation++;caches.clear();selected='';};
 window.parent.addEventListener('atlas-central-auth-change',clear);
 window.addEventListener('pagehide',()=>{clear();window.parent.removeEventListener('atlas-central-auth-change',clear);},{once:true});
 const originalGet=R.actuals.get,originalClosed=R.actuals.closedThrough,compute=R.variance.compute;
 R.actuals.get=function(state,pid,gl,year){const c=caches.get(pid+'|'+year);return c?(c.rows.get(String(gl))?.monthly.slice()||null):originalGet.apply(this,arguments);};
 R.actuals.closedThrough=function(state,pid,year){const c=caches.get(pid+'|'+year);return c?c.coverage.last:originalClosed.apply(this,arguments);};
 R.variance.compute=function(state,calc,pid,year){const result=compute.apply(this,arguments),c=caches.get(pid+'|'+year);if(!c)return result;
  for(const row of result.rows){const source=c.rows.get(String(row.gl));row.actual=source?.monthly.slice()||Array(12).fill(null);row.hasActual=!!source;row.variance=row.actual.map((n,i)=>n===null?null:n-row.budget[i]);row.variancePct=row.variance.map((n,i)=>n===null||!row.budget[i]?null:n/Math.abs(row.budget[i]));row.ytdActual=source?.ytd??null;row.ytdVar=row.ytdActual===null?null:row.ytdActual-row.ytdBudget;row.ytdVarPct=row.ytdVar===null||!row.ytdBudget?null:row.ytdVar/Math.abs(row.ytdBudget);row.projection=row.ytdActual===null?null:row.ytdActual+row.remainingBudget;row.runRate=null;row.favourable=row.ytdVar===null?null:row.favourable;row.monthExceptions=(row.monthExceptions||[]).filter(e=>row.actual[e.month]!==null);}
  result.exceptions=result.exceptions.filter(e=>{const row=result.rows.find(r=>r.gl===e.gl);return row?.ytdActual!==null&&(e.month===undefined||row.actual[e.month]!==null);});
  result.summary=R.variance.summary(result.rows,result.closedThrough);
  const latest=c.versions.find(v=>Number(v.period_key.slice(5))===c.coverage.last),controls=latest?.metrics.sourceControls;
  if(controls){const income=optionalNumber(controls['Total Income']?.ytdActual),noi=optionalNumber(controls['Net Operating Income']?.ytdActual);for(const [key,value] of [['egi',income],['noi',noi],['expense',income===null||noi===null?null:income-noi]]){result.summary[key].actual=value;result.summary[key].variance=value===null?null:value-result.summary[key].budget;result.summary[key].pct=value===null||!result.summary[key].budget?null:result.summary[key].variance/Math.abs(result.summary[key].budget);}}
  result.canonicalCoverage=c.coverage;result.canonicalVersions=c.versions.map(v=>v.version_id);return result;
 };
 const render=R.app.render;let selected='';
 R.app.render=function(){const p=R.app.prop(),year=R.app.year(),key=p.id+'|'+year;if(selected!==key){selected=key;
   if(!caches.has(key)){const c={rows:new Map(),versions:[],coverage:coverage([],year),status:'Loading canonical actuals'};caches.set(key,c);R.app.invalidate();
    (async()=>{const run=generation;try{const cid=await resolve(p.name);if(!cid)throw Error('Community mapping unavailable');const versions=await readYear(central,cid,year);if(run!==generation)return;c.versions=versions;c.coverage=coverage(c.versions,year);
     for(let i=0;i<c.versions.length;i+=3){const batch=c.versions.slice(i,i+3);const rows=await Promise.all(batch.map(v=>readRows(central,v)));if(run!==generation)return;batch.forEach((v,j)=>rows[j].forEach(r=>{let item=c.rows.get(r.gl_code);if(!item){item={monthly:Array(12).fill(null),ytd:null};c.rows.set(r.gl_code,item);}item.monthly[Number(v.period_key.slice(5))-1]=optionalNumber(r.actual);if(Number(v.period_key.slice(5))===c.coverage.last)item.ytd=optionalNumber(r.ytd_actual);}));}
     c.status='Verified closed source';
    }catch(e){c.rows.clear();c.versions=[];c.coverage=coverage([],year);c.status=e.message;}if(selected===key){R.app.invalidate();R.app.render();}})();}
  }return render.apply(this,arguments);};
}
