import {readFinance} from './canonical-finance.mjs?v=74da135760e0bbd5';
/* Scout's prototype can inspect published financial evidence without an AI service. */
import {createActiveReforecastCache,scoutForecastEvidence} from './reforecast-consumers.mjs?v=99c5cabede9f9ec2';
import {effectiveActiveSnapshot} from './reforecast-store.mjs?v=a31fb99b0826a753';
import {esc,money} from './reforecast-report.mjs?v=255e3fd3cc5aa869';
const validPeriod=value=>/^20\d{2}-(0[1-9]|1[0-2])$/.test(value||'');
const actor=central=>central?.getSession?.()?.user?.id ? central.getAccessContextKey?.() ?? central.getSession().user.id : null;
const numeric=value=>typeof value==='number'&&Number.isFinite(value);
export async function readScoutReforecast(central,{communityId,period,cache=createActiveReforecastCache(central)}={}){
 const user=actor(central);if(!user)throw Error('Sign in to ATLAS to read published financial evidence.');
 if(!validPeriod(period))throw Error('Choose a reporting month.');
 const records=await cache.refresh([communityId],[period],{force:true});
 if(actor(central)!==user)throw Error('Your signed-in account changed. Reopen the evidence panel.');
 const matching=records.filter(row=>row.communityId===communityId&&row.publicationId&&Array.isArray(row.activePeriods)&&row.activePeriods.includes(period));
 if(matching.length>1)throw Error('Conflicting active publications require reconciliation.');
 if(!matching.length)return null;
 const publication=matching[0],evidence=scoutForecastEvidence(publication,period),snapshot=effectiveActiveSnapshot(publication),month=snapshot.monthly.find(row=>row.period===period);
 if(!evidence||!month||month.applicable===false)return null;
 let currentActuals=month.actuals,closed=month.closed,closeVersionId=month.closeVersionId||null;
 if(publication.verified===true){const [finance]=await readFinance(central,[communityId],[period]);if(actor(central)!==user)throw Error('Your signed-in account changed.');const summary=finance?.summary;currentActuals=Object.fromEntries(['revenue','expenses','noi','margin','cashFlow','capital','debt'].map(key=>[key,summary?.[key]?.actual??null]));closed=Boolean(summary?.actualCloseVersion);closeVersionId=summary?.actualCloseVersion||null;}
 return {...evidence,originalBudget:month.originalBudget,actuals:currentActuals,closed,closeVersionId,publishedFingerprint:publication.snapshot.fingerprint,publishedBy:publication.publishedBy,sourceVersion:publication.source?.sourceVersion};
}
export function scoutReforecastHtml(evidence,communityName){
 if(!evidence)return '<p>No locked reforecast is published for this community and month. Drafts and superseded publications are excluded.</p>';
 const metrics=[['revenue','Operating revenue'],['expenses','Operating expenses'],['noi','NOI'],['margin','NOI margin'],['cashFlow','Cash flow']],format=(value,key)=>key==='margin'?(numeric(value)?(value*100).toFixed(2)+'%':'Unavailable'):numeric(value)?'$'+money(value):'Unavailable';
 return `<h3>${esc(communityName)} · ${esc(evidence.period)}</h3><p>Published version ${esc(evidence.version)} · ${esc(evidence.publishedAt)} · Actual cutoff ${esc(evidence.cutoff||'No closed actuals')}</p><div style="overflow:auto"><table style="width:100%;border-collapse:collapse;text-align:right"><thead><tr><th style="text-align:left">Measure</th><th>Original budget</th><th>Active reforecast</th><th>Governed actuals</th></tr></thead><tbody>${metrics.map(([key,label])=>`<tr><th style="text-align:left;padding:8px 0">${label}</th><td>${format(evidence.originalBudget?.[key],key)}</td><td>${format(evidence.metrics?.[key],key)}</td><td>${format(evidence.actuals?.[key],key)}</td></tr>`).join('')}</tbody></table></div><p>${evidence.closed?'This month has closed. Governed actuals are shown separately from the locked active baseline.':'This month is open. Active values come from the locked publication; actuals remain unavailable.'} The immutable original budget remains a separate comparator.</p><details><summary>Publication and source evidence</summary><p style="overflow-wrap:anywhere">Publication ${esc(evidence.publicationId)} · revision ${esc(evidence.revisionId)} · published by ${esc(evidence.publishedBy||'Unavailable')}<br>Published snapshot ${esc(evidence.publishedFingerprint)}<br>Current projection ${esc(evidence.fingerprint)}<br>Governed close ${esc(evidence.closeVersionId||'Not closed')}</p><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify(evidence.sourceVersions,null,2))}</pre></details>`;
}
export async function mountScoutReforecast(container,{central=globalThis.ATLAS_CENTRAL,eventTarget=globalThis}={}){
 let generation=0,currentActor=actor(central),communities=[],cache=central?createActiveReforecastCache(central):null;
 const alive=token=>container.isConnected&&token===generation;
 const signedOut=()=>{container.innerHTML='<p>Sign in to ATLAS to inspect authorized published reforecasts here.</p><a href="./index.html">Open ATLAS sign-in</a>';};
 async function initialize(){
  const token=++generation;cache?.clear();currentActor=actor(central);
  if(!currentActor){signedOut();return;}
  container.innerHTML='<p role="status">Reading your authorized communities…</p>';
  try{
   const rows=await central.readCommunitiesForAccess();if(!alive(token))return;if(actor(central)!==currentActor)throw Error('Your signed-in account changed. Reload this page.');
   communities=rows;const now=new Date(),period=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
   container.innerHTML=`<form data-scout-scope style="display:flex;flex-wrap:wrap;gap:14px;align-items:end;margin:12px 0"><label>Authorized community<br><select data-community required style="max-width:100%;padding:8px"><option value="">Choose community</option>${communities.map(row=>`<option value="${esc(row.community_id)}">${esc(row.display_name)}</option>`).join('')}</select></label><label>Reporting month<br><input data-period type="month" required value="${period}" style="padding:8px"></label><button class="pill" type="submit">Read published evidence</button></form><div data-scout-result aria-live="polite"><p>Choose a community and reporting month to inspect its published benchmark.</p></div>`;
   const form=container.querySelector('[data-scout-scope]');form.onsubmit=event=>{event.preventDefault();return read();};
   for(const selector of ['[data-community]','[data-period]'])container.querySelector(selector).onchange=()=>{generation++;container.querySelector('[data-scout-result]').textContent='Selection changed. Read published evidence for this scope.';};
  }catch(error){if(alive(token))container.innerHTML=`<p role="alert">Published evidence unavailable: ${esc(error.message)}</p><a href="./index.html">Open ATLAS</a>`;}
 }
 async function read(){
  const token=++generation,result=container.querySelector('[data-scout-result]'),communityId=container.querySelector('[data-community]')?.value,period=container.querySelector('[data-period]')?.value,community=communities.find(row=>row.community_id===communityId);
  if(!result)return;if(!community){result.textContent='Choose an authorized community.';return;}
  result.textContent='Reading the active published reforecast…';
  try{const evidence=await readScoutReforecast(central,{communityId,period,cache});if(alive(token))result.innerHTML=scoutReforecastHtml(evidence,community.display_name);}
  catch(error){if(alive(token))result.innerHTML=`<p role="alert">Published evidence unavailable: ${esc(error.message)}</p>`;}
 }
 const authChanged=()=>{if(actor(central)!==currentActor)initialize();};
 const refresh=()=>{cache?.clear();if(container.querySelector('[data-community]')?.value)read();};
 for(const name of ['atlas-central-auth-change','storage'])eventTarget.addEventListener?.(name,authChanged);
 for(const name of ['atlas-reforecast-updated','atlas-finance-updated'])eventTarget.addEventListener?.(name,refresh);
 await initialize();return ()=>{generation++;cache?.clear();container.innerHTML='';for(const name of ['atlas-central-auth-change','storage'])eventTarget.removeEventListener?.(name,authChanged);for(const name of ['atlas-reforecast-updated','atlas-finance-updated'])eventTarget.removeEventListener?.(name,refresh);};
}
