import {finalizeFinancialPackageEvidence,evaluateFinancialPackageSafety} from './financial-package.mjs?v=fb2b9dde0a554114';
export const INTAKE_STATES=['uploaded','classified','community_period_confirmed','fully_mapped','reconciled','review_saved','admin_closed','canonically_published','readback_verified'];
export const INTAKE_LABELS=['Uploaded','Classified','Community/Period Confirmed','Fully Mapped','Reconciled','Review Saved','Admin Closed','Canonically Published','Readback Verified'];
const one=value=>Array.isArray(value)?value[0]:value;
const uuid=()=>crypto.randomUUID();
export function actorGuard(central){const actor=central.getSession?.()?.user?.id;if(!actor)throw Error('Sign in before saving financial evidence.');return {actor,check(){if(central.getSession?.()?.user?.id!==actor)throw Error('The signed-in account changed. Reopen this review.');}};}
export function createIntake(central,{workflow=null,receipt=null,onState=()=>{}}={}){
 const guard=actorGuard(central),requests=new Map();
 const api={workflow,receipt,guard,certificate:receipt?.evidence?.certificate||null,
  async stage(stage,certificate,communityId=null){
   guard.check();const previous=this.receipt?.receipt_id||null;
   const key=JSON.stringify([stage,previous,communityId,certificate]);
   if(!requests.has(key))requests.set(key,uuid());
   const response=one(await central.rpc('atlas_record_financial_intake',{p_workflow_id:this.workflow?.workflow_id||null,p_request_id:requests.get(key),p_expected_receipt_id:previous,p_stage:stage,p_community_id:communityId,p_evidence:{sourceHash:certificate.sourceHash,sourceFile:certificate.sourceFile,certificate}}));guard.check();
   if(!response?.workflow?.workflow_id||!response?.receipt?.receipt_id||response.receipt.source_hash!==certificate.sourceHash||response.receipt.status!==stage||response.receipt.actor_id!==guard.actor||(response.receipt.community_id??null)!==communityId)throw Error('Intake receipt was not verified. Your source is retained; reload shared intake before retrying.');
   await verifyIntakeReceipt(central,response.receipt);guard.check();if(response.workflow.current_receipt_id!==response.receipt.receipt_id)throw Error('Intake advanced in another session. Reload the latest receipt.');this.workflow=response.workflow;this.receipt=response.receipt;this.certificate=certificate;onState(this.receipt);return this.receipt;
  },
  async saveReview(certificate){
   guard.check();const safety=evaluateFinancialPackageSafety(certificate);if(!safety.safeToImport)throw Error('Review blocked: '+safety.issues.join(', '));
   if(this.receipt?.status!=='reconciled')throw Error('Complete reconciliation before saving the review.');
   const key='review|'+this.receipt.receipt_id;if(!requests.has(key))requests.set(key,uuid());
   const response=one(await central.rpc('atlas_save_financial_review_governed',{p_workflow_id:this.workflow.workflow_id,p_expected_receipt_id:this.receipt.receipt_id,p_request_id:requests.get(key),p_certificate:certificate}));guard.check();
   if(!response?.review?.review_id||!response?.receipt?.receipt_id||response.receipt.status!=='review_saved'||response.receipt.version_id!==response.review.review_id||!response.review.content_hash||response.receipt.content_hash!==response.review.content_hash)throw Error('Review acknowledgement has no matching durable receipt.');
   const [saved]=await central.fetchJson(`/atlas_financial_package_reviews?review_id=eq.${response.review.review_id}&select=*&limit=1`);guard.check();
   if(saved?.source_hash!==certificate.sourceHash||saved.community_id!==certificate.intakeEvidence.communityId||saved.period_key!==certificate.metadata.period||saved.content_hash!==response.review.content_hash||saved.certificate?.intakeEvidence?.evidenceFingerprint!==certificate.intakeEvidence.evidenceFingerprint)throw Error('Saved review readback does not match the selected source, community and period.');
   await verifyIntakeReceipt(central,response.receipt);guard.check();this.workflow=response.workflow;this.receipt=response.receipt;this.certificate=certificate;onState(this.receipt);return {...saved,intakeReceipt:this.receipt};
  }
 };return api;
}
export async function verifyIntakeReceipt(central,receipt){
 const [stored]=await central.fetchJson(`/atlas_financial_intake_receipts?receipt_id=eq.${receipt.receipt_id}&select=*&limit=1`);
 for(const field of ['receipt_id','workflow_id','source_hash','status','previous_receipt_id','version_id','content_hash','community_id','actor_id','mapping_version','inventory_count','leaf_count','control_count','exception_count','created_at'])if((stored?.[field]??null)!==(receipt[field]??null))throw Error('Durable intake receipt readback failed: '+field);
 if(!stored.actor_id||!stored.created_at)throw Error('Durable receipt lacks actor or timestamp.');return stored;
}
export async function prepareReview(central,certificate,{communityId,period,exclusionsReviewed,coverage,governance,intake,onState}={}){
 const flow=intake||createIntake(central,{onState});
 const retained=flow.certificate?.intakeEvidence?.communityConfirmed&&flow.certificate;
 if(retained&&(retained.sourceHash!==certificate.sourceHash||retained.intakeEvidence.communityId!==communityId||retained.metadata.period!==period))throw Error('This saved workflow is bound to another source or scope. Start a new source review.');
 const changed=retained&&(retained.intakeEvidence.exclusionsReviewed!==exclusionsReviewed||(coverage&&JSON.stringify(retained.intakeEvidence.coverage)!==JSON.stringify(coverage))||(governance&&JSON.stringify(retained.intakeEvidence.governance)!==JSON.stringify(governance)));
 const finalized=retained&&!changed?retained:await finalizeFinancialPackageEvidence(certificate,{communityId,period,actor:flow.guard.actor,exclusionsReviewed,coverage,governance});
 const safety=evaluateFinancialPackageSafety(finalized);
 if(!flow.receipt)await flow.stage('uploaded',certificate);
 if(flow.receipt.status==='uploaded')await flow.stage('classified',certificate);
 if(changed&&['community_period_confirmed','fully_mapped','reconciled'].includes(flow.receipt.status))await flow.stage('community_period_confirmed',finalized,communityId);
 if(flow.receipt.status==='classified')await flow.stage('community_period_confirmed',finalized,communityId);
 if(!safety.safeToImport)throw Error('Review blocked: '+safety.issues.join(', '));
 if(flow.receipt.status==='community_period_confirmed')await flow.stage('fully_mapped',finalized,communityId);
 if(flow.receipt.status==='fully_mapped')await flow.stage('reconciled',finalized,communityId);
 const review=await flow.saveReview(finalized);return {review,certificate:finalized,intake:flow};
}
