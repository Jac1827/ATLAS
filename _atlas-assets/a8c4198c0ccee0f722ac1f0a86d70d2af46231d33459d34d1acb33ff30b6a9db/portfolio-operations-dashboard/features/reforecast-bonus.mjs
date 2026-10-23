// Read-only adapter for retained approved Bonus calculations. It never creates payability.
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export function retainedBonusRow(receipts,{employee,period}={}){
 const missing=(reason,retentionRequired=false)=>({status:'unavailable',reason,retentionRequired});
 if(!period?.periodKey)return missing('An exact bonus period is required.');
 if(!employee?.employeeId||!employee.assignmentId)return missing('Exact employee and assignment are required.',(receipts||[]).some(receipt=>receipt.period?.period_key===period.periodKey&&['locked','approved','paid','archived'].includes(receipt.period.status)));
 const candidates=[];let retentionRequired=false;
 for(const receipt of receipts||[]){
  if(receipt.period?.period_key!==period.periodKey||receipt.period.start_date!==period.start||receipt.period.end_date!==period.end)continue;
  const retained=['locked','approved','paid','archived'].includes(receipt.period.status)||receipt.run?.status==='locked';
  retentionRequired ||= ['locked','approved','paid','archived'].includes(receipt.period.status);
  for(const line of receipt.lines||[])if(line.employee_id===employee.employeeId&&line.assignment_id===employee.assignmentId){retentionRequired ||= retained;candidates.push({receipt,line,retained});}
 }
 if(candidates.length!==1)return missing(candidates.length?'Multiple canonical calculation receipts require review.':'No exact retained canonical calculation receipt is available.',retentionRequired);
 const {receipt,line,retained}=candidates[0],run=receipt.run,row=line.line_payload?.retainedRow;
 if(receipt.verified!==true||!run?.calculation_hash||!run.bonus_calculation_run_id||!['approved','locked'].includes(run.status)||!run.approved_by||!run.approved_at||line.bonus_calculation_run_id!==run.bonus_calculation_run_id||line.deleted_at||!line.bonus_line_id||!line.incentive_plan_id)return missing('Canonical approval, calculation hash or exact line evidence is incomplete.',retained);
 if(!retained&&(run.exceptions||[]).some(item=>item.code==='baseline_stale'))return missing('The unpaid calculation is stale and requires a governed recalculation.');
 if(!row||row.employee?.employeeId!==line.employee_id||row.employee?.assignmentId!==line.assignment_id||row.plan?.id!==line.incentive_plan_id||!row.plan.version||row.period?.periodKey!==period.periodKey||row.period.start!==period.start||row.period.end!==period.end||!finite(row.finalPayout)||Number(line.payout_amount)!==row.finalPayout||!Array.isArray(row.metricResults)||row.unresolvedCritical)return missing('Retained calculation values, assignment, plan version or payout do not match the canonical line.',retained);
 for(const result of row.metricResults){
  if(!result.metric?.id||!finite(result.earned)||!finite(result.actual))return missing('A retained metric calculation is incomplete.',retained);
  if(['budget_attainment','revenue','expenses','noi','cash_flow'].includes(result.metric.metricKey)){
   const evidence=result.financialEvidence,periods=evidence?.periods,baselines=evidence?.baselineEvidence;
   const expectedMonths=[0,1,2].map(index=>period.start.slice(0,5)+String(Number(period.start.slice(5,7))+index).padStart(2,'0'));
   if(!evidence?.snapshotFingerprint||!Array.isArray(periods)||periods.length!==3||periods.some((month,index)=>month!==expectedMonths[index])||!Array.isArray(baselines)||baselines.length!==3||periods.some(month=>baselines.filter(b=>b.period===month&&b.versionId&&b.contentHash&&(b.sourceType==='original_budget'||b.sourceType==='approved_reforecast'&&b.publicationId)).length!==1)||evidence.actualCloseVersions?.length!==3||evidence.actualCloseVersions.some(id=>!id))return missing('Retained financial metrics need all three original monthly baseline and actual-close versions.',retained);
  }
 }
 return {status:'available',row:freeze({...structuredClone(row),canonicalPayable:true,retained:true,approvalStatus:receipt.period.status==='paid'?'Paid':retained?'Locked':'Regional Approved',canonicalReceipt:{periodId:receipt.period.bonus_period_id,runId:run.bonus_calculation_run_id,lineId:line.bonus_line_id,calculationHash:run.calculation_hash,approvedBy:run.approved_by,approvedAt:run.approved_at,periodStatus:receipt.period.status,runStatus:run.status}})};
}
export function createBonusReceiptCache(central){
 const records=new Map(),pending=new Map();let epoch=0,actor=central.getSession?.()?.user?.id;
 return {
  clear(){epoch++;records.clear();pending.clear();actor=central.getSession?.()?.user?.id;},
  get(employee,period){if(actor!==central.getSession?.()?.user?.id)this.clear();if(Date.now()-(records.get(period.periodKey)?.at||0)>30000)records.delete(period.periodKey);const entry=records.get(period.periodKey);return !entry?{status:'unavailable',pending:true,reason:'Reading the canonical period and retained calculation evidence.'}:entry.error?{status:'unavailable',lookupUnavailable:true,reason:entry.error}:retainedBonusRow(entry.receipts||[],{employee,period});},
  async refresh(period){
   if(actor!==central.getSession?.()?.user?.id)this.clear();const user=actor,key=period.periodKey;
   if(!user)return false;if(records.has(key)&&Date.now()-records.get(key).at<30000)return false;records.delete(key);if(pending.has(key))return pending.get(key);const generation=epoch;
   const task=(async()=>{try{const receipts=await central.fetchJson('/rpc/atlas_read_bonus_receipts',{method:'POST',body:JSON.stringify({p_period_key:key})});if(generation!==epoch||user!==central.getSession?.()?.user?.id)throw Error('Session changed while reading retained Bonus evidence.');if(!Array.isArray(receipts)||receipts.some(row=>row.period?.period_key!==key))throw Error('Bonus receipt scope mismatch.');records.set(key,{receipts:freeze(structuredClone(receipts)),at:Date.now()});return true;}catch(error){if(generation===epoch)records.set(key,{error:error.message,at:Date.now()});return false;}finally{if(generation===epoch)pending.delete(key);}})();pending.set(key,task);return task;
  }
 };
}
