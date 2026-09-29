// Pure advisory calculations. Source records and approved human goals are inputs,
// never mutation targets. Signed inventory is distinct from dated move-ins.
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const count=value=>finite(value)&&Number.isSafeInteger(value)&&value>=0;
const month=/^20\d{2}-(0[1-9]|1[0-2])$/;
const date=value=>/^20\d{2}-(0[1-9]|1[0-2])-\d{2}$/.test(value||'')&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const verified=value=>['available','valid'].includes(value?.status);
const missing=reason=>({status:'unavailable',rate:null,reason});
const applicationNeed=(leases,closing)=>{
 if(leases===0)return 0;
 if(!count(leases)||closing.status!=='available'||!closing.leases)return null;
 // Count arithmetic avoids ceil(21 / (7 / 10)) becoming 31 through binary rounding.
 const n=BigInt(leases)*BigInt(closing.applications),d=BigInt(closing.leases),value=(n+d-1n)/d;
 return value<=BigInt(Number.MAX_SAFE_INTEGER)?Number(value):null;
};
export function applicationActivityRate(evidence,{communityId,period}={}){
 if(!evidence||!month.test(period||''))return missing('Latest application-to-lease activity evidence is unavailable.');
 if(!verified(evidence)||evidence.kind!=='application_to_lease_activity'||evidence.communityId!==communityId||!month.test(evidence.period||'')||evidence.period>period||!evidence.sourceFingerprint||!Number.isFinite(Date.parse(evidence.asOf||''))||evidence.asOf.slice(0,7)>period)return missing(evidence.reason||'Closing activity needs one verified community, report period and source.');
 if(!count(evidence.applications)||!count(evidence.leases)||evidence.applications===0)return missing('Completed applications are required for the activity closing rate.');
 if(evidence.leases>evidence.applications)return missing('Completed leases exceed completed applications. The activity rate is inconsistent; it is not capped.');
 return {...evidence,status:'available',rate:evidence.leases/evidence.applications,label:'Application-to-lease activity rate',reason:'Completed leases / completed applications from the same report period; not a matched applicant cohort.'};
}
export function recommendOccupancyGoals({communityId,period,snapshot,budget,closing,pipeline,movements,corporateUnits=0}={}){
 const warnings=[],result={communityId,period,status:'unavailable',actualLeasedPct:null,actualPhysicalPct:null,leasedUnits:null,occupiedUnits:null,rentableUnits:null,budgetPct:null,targetUnits:null,leasedGoal:null,occupancyGoal:null,requiredMoveIns:null,netLeaseGoal:null,grossLeaseGoal:null,applicationGoal:null,signedLeaseGap:null,minimumApplications:null,datedPipelineMoveIns:null,undatedPipelineUnits:null,pipelineTimingComplete:false,remainingMoveOuts:null,warnings,source:{snapshot: snapshot||null,budget:budget||null,closing:closing||null,pipeline:pipeline||null,movements:movements||null,corporateUnits,reportedCountsAdjusted:false}};
 result.closing=applicationActivityRate(closing,{communityId,period});
 if(!communityId||!month.test(period||'')) {warnings.push('A verified community and full reporting month are required.');return result;}
 const sourceValid=verified(snapshot)&&snapshot.communityId===communityId&&month.test(snapshot.period||'')&&snapshot.period<=period&&snapshot.sourceFingerprint&&Number.isFinite(Date.parse(snapshot.asOf||''))&&snapshot.asOf.slice(0,7)<=period&&count(snapshot.occupiedUnits)&&count(snapshot.leasedUnits)&&count(snapshot.rentableUnits)&&snapshot.rentableUnits>0&&snapshot.occupiedUnits<=snapshot.leasedUnits&&snapshot.leasedUnits<=snapshot.rentableUnits;
 if(!sourceValid){warnings.push(snapshot?.reason||'Verified Box Score Leased, Occupied and Rentable counts are required.');return result;}
 // Reported occupancy always reproduces the report. A separate corporate/STR
 // comparison basis must never rewrite the Box Score numerator or denominator.
 const base=snapshot.rentableUnits,occupied=snapshot.occupiedUnits,leased=snapshot.leasedUnits;
 Object.assign(result,{leasedUnits:leased,occupiedUnits:occupied,rentableUnits:base,actualLeasedPct:leased/base*100,actualPhysicalPct:occupied/base*100});
 if(snapshot.period<period)warnings.push(`Planning uses the latest available Box Score as of ${snapshot.asOf.slice(0,10)}. Future inventory and departures still require review.`);
 const pipelineValid=verified(pipeline)&&pipeline.communityId===communityId&&pipeline.sourceFingerprint&&pipeline.period===snapshot.period&&typeof pipeline.asOf==='string'&&pipeline.asOf.slice(0,10)===snapshot.asOf.slice(0,10)&&count(pipeline.signedVacantUnits)&&pipeline.signedVacantUnits===leased-occupied&&count(pipeline.undatedUnits)&&Array.isArray(pipeline.datedMoveIns)&&pipeline.datedMoveIns.every(row=>date(row.date)&&count(row.count)&&row.date>snapshot.asOf.slice(0,10))&&pipeline.datedMoveIns.reduce((sum,row)=>sum+row.count,0)+pipeline.undatedUnits===pipeline.signedVacantUnits;
 if(pipelineValid){result.datedPipelineMoveIns=pipeline.datedMoveIns.filter(row=>row.date.slice(0,7)<=period&&row.date>snapshot.asOf.slice(0,10)).reduce((sum,row)=>sum+row.count,0);result.undatedPipelineUnits=count(pipeline.undatedUnits)?pipeline.undatedUnits:null;result.pipelineTimingComplete=pipeline.complete===true&&result.undatedPipelineUnits===0;}
 if(!result.pipelineTimingComplete)warnings.push('Move-in timing needs review. Signed leased units are not assumed to become occupied in this month.');
 const budgetValid=budget?.status==='available'&&budget.communityId===communityId&&budget.period===period&&budget.approvalStatus==='approved'&&budget.versionId&&budget.contentHash&&finite(budget.occupancyPct)&&budget.occupancyPct>=0&&budget.occupancyPct<=100;
 if(!budgetValid){warnings.push(budget?.reason||'An approved occupancy budget for this exact month is required. Browser targets are not an approved baseline.');return result;}
 result.budgetPct=budget.occupancyPct;
 if(!count(budget.rentableUnits)||budget.rentableUnits!==base||!['units','beds'].includes(snapshot.measurementBasis)||budget.measurementBasis!==snapshot.measurementBasis){warnings.push('Approved budget / verified Community Settings and Box Score need matching inventory counts and units-or-beds basis. Review the mapping before calculating a goal.');return result;}
 const target=Math.ceil(base*budget.occupancyPct/100);
 Object.assign(result,{budgetPct:budget.occupancyPct,occupancyGoal:budget.occupancyPct,leasedGoal:budget.occupancyPct,targetUnits:target,signedLeaseGap:Math.max(0,target-leased),netLeaseGoal:Math.max(0,target-leased),status:'partial'});
 result.minimumApplications=applicationNeed(result.signedLeaseGap,result.closing);
 const moveOutsValid=movements?.complete===true&&movements.communityId===communityId&&movements.period===period&&movements.sourceFingerprint&&movements.basis==='remaining_scheduled'&&count(movements.remainingMoveOuts)&&Number.isFinite(Date.parse(movements.asOf||''))&&movements.asOf.slice(0,10)===snapshot.asOf.slice(0,10);
 if(moveOutsValid){result.remainingMoveOuts=movements.remainingMoveOuts;result.requiredMoveIns=Math.max(0,target+result.remainingMoveOuts-occupied);result.grossLeaseGoal=Math.max(0,target+result.remainingMoveOuts-leased);}
 else warnings.push('Remaining scheduled move-outs are unavailable. Completed monthly move-outs are not added again. Full-month gross lease and move-in goals need review.');
 result.applicationGoal=applicationNeed(result.grossLeaseGoal,result.closing);
 if(result.closing.status!=='available')warnings.push(result.closing.reason);
 else if(result.closing.rate===0&&(result.signedLeaseGap>0||result.grossLeaseGoal>0))warnings.push('The latest activity closing rate is zero; an application goal cannot be calculated for a positive lease need.');
 if(result.requiredMoveIns!==null&&result.grossLeaseGoal!==null&&result.applicationGoal!==null)result.status='available';
 return result;
}
// Preserve manual and approved zeroes. Recalculation only changes advice.
export function applyOccupancyRecommendation(row,recommendation){
 return {...row,planningRecommendation:recommendation,budgetPct:recommendation.budgetPct,leasedGoal:recommendation.leasedGoal,requiredMoveIns:recommendation.requiredMoveIns,recommendedApps:recommendation.applicationGoal,recommendedGrossLeases:recommendation.grossLeaseGoal,netLeaseGoal:recommendation.netLeaseGoal};
}
