import {readPackage} from './financial-package-reader.mjs?v=311d5c4092dde6d1';
import {resolveCommunity} from './financial-package.mjs?v=a378a0cb25083758';
import {prepareReview} from './financial-intake-store.mjs?v=e7ba2e324c419b26';
import {closeReview} from './financial-close.mjs?v=c94f975c1fc88f35';

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
 if(item.communityConfirmed!==true||item.exclusionsReviewed!==true||item.periodConfirmed!==true)throw Error('Open each monthly BCR review and explicitly confirm community, period and exclusions before batch close.');
 const saved=await prepareReview(central,c,{communityId:item.communityId,period:c.metadata.period,exclusionsReviewed:item.exclusionsReviewed,intake:item.intake});
 return {version:await closeReview(central,saved.review,{expectedVersion:null,reason,accountingApproved}),unchanged:false};
}
export function mountBatch(container){
 const note=document.createElement('p');note.textContent='Historical backfill: open each monthly BCR package separately. Confirm its property, period, row dispositions and exclusions, then save its review and perform an Admin close. T12 is supporting evidence and never creates automatic monthly closes.';container.append(note);
}
