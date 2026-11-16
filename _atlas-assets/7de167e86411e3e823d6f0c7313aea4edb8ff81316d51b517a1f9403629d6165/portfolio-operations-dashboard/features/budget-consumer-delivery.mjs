// Acknowledgments record an observed immutable identity; they never publish money.
// Failures remain pending in the server delivery ledger and may be safely retried.
const receipts=new WeakMap(),uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function acknowledgeBudgetConsumer(central,publication,consumer){
 const actor=central?.getSession?.()?.user?.id,publicationId=publication?.publicationId,revisionId=publication?.revisionId||publication?.versionId,hash=publication?.contentHash||publication?.snapshot?.fingerprint;
 if(!actor||!uuid.test(publicationId||'')||!uuid.test(revisionId||'')||!/^[a-f0-9]{64}$/.test(hash||''))return {status:'unavailable'};
 let scope=receipts.get(central);if(!scope||scope.actor!==actor){scope={actor,entries:new Map()};receipts.set(central,scope);}
 const key=[publicationId,revisionId,hash,consumer].join('|');if(scope.entries.has(key))return scope.entries.get(key);
 const requestId=crypto.randomUUID(),promise=(async()=>{
  try{
   const result=await central.fetchJson('/rpc/atlas_verify_budget_consumer',{method:'POST',body:JSON.stringify({p_publication_id:publicationId,p_consumer_key:consumer,p_request_id:requestId,p_observed_revision_id:revisionId,p_observed_fingerprint:hash})});
   if(central.getSession?.()?.user?.id!==actor)throw Error('The authorized session changed during consumer verification.');
   const row=Array.isArray(result)?result[0]:result;if(row?.publication_id!==publicationId||row.consumer_key!==consumer||row.content_fingerprint!==hash||row.delivery_status!=='verified')throw Error('Consumer readback remains unverified.');
   return {status:'verified',receipt:row};
  }catch(error){scope.entries.delete(key);return {status:'pending',reason:error.message};}
 })();scope.entries.set(key,promise);return promise;
}
