import {readPackage} from './financial-package-reader.mjs?v=202fc24b456f463b';
import {resolveCommunity} from './financial-package.mjs?v=49ea086d6d07f300';
import {closeReview} from './financial-close.mjs?v=b28f66ffab37210c';

// Never replace an existing close implicitly or interpret an upload as approval.
export async function publishPackage(central,item,{reason,accountingApproved}) {
 const c=item.certificate;
 if(!c?.technicalReconciled||c.exceptions?.length||!item.communityId)throw Error('Resolve extraction and community mapping before publication.');
 const heads=await central.fetchJson(`/atlas_financial_close_heads?community_id=eq.${item.communityId}&period_key=eq.${c.metadata.period}&accounting_basis=eq.${c.metadata.basis}&select=version_id&limit=1`);
 if(heads.length){
  const [v]=await central.fetchJson(`/atlas_financial_close_versions?version_id=eq.${heads[0].version_id}&select=*&limit=1`);
  if(v?.source_hash!==c.sourceHash)throw Error('A different closed source exists. Use the individual replacement review.');
  return {version:v,unchanged:true};
 }
 const response=await central.rpc('atlas_save_financial_package_review',{p_community_id:item.communityId,p_certificate:c});
 const review=Array.isArray(response)?response[0]:response;
 const [stored]=await central.fetchJson(`/atlas_financial_package_reviews?review_id=eq.${review.review_id}&select=*&limit=1`);
 if(stored?.source_hash!==c.sourceHash)throw Error('Shared source readback failed.');
 return {version:await closeReview(central,stored,{expectedVersion:null,reason,accountingApproved}),unchanged:false};
}
export function mountBatch(container,central){
 const panel=document.createElement('details');panel.innerHTML='<summary>Reconcile and publish multiple packages</summary><p>Choose primary PDF statements. Each package is checked separately. Existing closed sources are preserved; conflicts require individual replacement review.</p><label>Monthly packages <input type="file" multiple accept=".pdf"></label><label><input type="checkbox" data-approved> These are the Accounting-approved packages for publication.</label><label>Publication reason <input data-reason type="text"></label><button data-publish disabled>Publish reconciled packages</button><button data-stop>Stop after current package</button><p role="status"></p><ol data-results></ol>';
 container.append(panel);let items=[],running=false,stopped=false;
 const status=panel.querySelector('[role=status]'),list=panel.querySelector('[data-results]'),publish=panel.querySelector('[data-publish]'),input=panel.querySelector('input[type=file]');
 const line=(name,message)=>{const li=document.createElement('li');li.textContent=name+' — '+message;list.append(li);return li;};
 panel.querySelector('[data-stop]').onclick=()=>{stopped=true;status.textContent='Stopping after the current package completes.';};
 input.onchange=async()=>{
  if(running)return;running=true;stopped=false;items=[];list.replaceChildren();publish.disabled=true;input.disabled=true;
  try{
   const [communities,aliases]=await Promise.all([central.readCommunitiesForAccess(),central.fetchJson('/atlas_community_aliases?active=eq.true&select=community_id,alias,active&limit=1000')]);
   const keys=new Map();
   for(const file of Array.from(input.files)){
    if(stopped||!panel.isConnected)break;
    const li=line(file.name,'Reading…');
    try{const certificate=await readPackage(file,{onProgress:m=>{status.textContent=file.name+' — '+m;}}),match=resolveCommunity(certificate.metadata?.sourceProperty,communities,aliases);
     if(!certificate.technicalReconciled||certificate.exceptions.length||!match.communityId)throw Error('Needs review: '+(certificate.exceptions.map(e=>e.code).join(', ')||match.status));
     const key=match.communityId+'|'+certificate.metadata.period+'|'+certificate.metadata.basis;
     if(keys.has(key)){
      const prior=keys.get(key);
      if(prior.certificate.sourceHash===certificate.sourceHash){li.textContent=file.name+' — Duplicate file; skipped.';continue;}
      prior.conflict=true;prior.li.textContent=prior.certificate.sourceFile+' — Conflicting files for the same period; individual review required.';
      throw Error('Conflicting files for the same period; individual review required.');
     }
     const item={certificate,communityId:match.communityId,li};keys.set(key,item);items.push(item);
     li.textContent=file.name+' — Reconciled '+certificate.metadata.period+'; ready for publication.';
    }catch(e){li.textContent=file.name+' — '+e.message;}
   }
   items=items.filter(i=>!i.conflict);status.textContent=items.length+' packages ready. Confirm Accounting approval and enter a reason to publish.';publish.disabled=!items.length;
  }catch(e){status.textContent=e.message;}finally{running=false;input.disabled=false;input.value='';}
 };
 publish.onclick=async()=>{
  const accountingApproved=panel.querySelector('[data-approved]').checked,reason=panel.querySelector('[data-reason]').value.trim();
  if(!accountingApproved||reason.length<5){status.textContent='Confirm Accounting approval and enter a publication reason.';return;}
  if(running)return;running=true;stopped=false;publish.disabled=true;input.disabled=true;let verified=0;
  try{for(const item of items){if(stopped||!panel.isConnected)break;status.textContent='Publishing '+item.certificate.sourceFile;
    try{const result=await publishPackage(central,item,{reason,accountingApproved});item.li.textContent=item.certificate.sourceFile+' — '+(result.unchanged?'Already closed':'Published and reporting readback verified')+' · '+result.version.version_id;verified++;}
    catch(e){item.li.textContent=item.certificate.sourceFile+' — Not published: '+e.message;}
   }
   status.textContent=verified+' of '+items.length+' packages confirmed closed. See individual results for any remaining review.';
   const years=[...new Set(items.map(i=>Number(i.certificate.metadata.period.slice(0,4))))];
   for(const year of years)await window.parent.refreshAtlasClosedFinancials?.(year,true);
  }finally{running=false;input.disabled=false;publish.disabled=false;}
 };
}
