/* Pure, source-gated Community Command calculations. No storage or network access. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AtlasCommunityCommandContract=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const finite=v=>typeof v==='number'&&Number.isFinite(v);
  const missing=reason=>({status:'missing',label:reason,variance:null,actual:null,budget:null,canDrillDown:false});
  const same=(a,b)=>a&&b&&a.communityId===b.communityId&&a.fiscalYear===b.fiscalYear&&a.period===b.period;
  function occupancy(scope,actual,budget){
    if(!scope?.communityId||!scope.period||!Number.isInteger(scope.fiscalYear))return missing('Incomplete scope');
    if(!budget||budget.approvalStatus!=='approved'||budget.locked!==true||!budget.scenarioId||!budget.version)return missing('Missing budget');
    if(!same(scope,budget))return missing('Incomplete budget coverage');
    if(!actual||!same(scope,actual)||!actual.source||!actual.sourceTimestamp)return missing('Missing actual');
    const {occupiedUnits,rentableUnits}=actual,pct=budget.occupancyPct;
    if(!finite(occupiedUnits)||!Number.isInteger(occupiedUnits)||!finite(rentableUnits)||!Number.isInteger(rentableUnits)||rentableUnits<=0||occupiedUnits<0||occupiedUnits>rentableUnits)return missing('Invalid occupancy actual');
    if(!finite(pct)||pct<0||pct>100)return missing('Invalid occupancy budget');
    // Match ATLAS planning convention: round up to the whole unit needed to meet the target.
    const calculatedTarget=Math.ceil(pct*rentableUnits/100);
    if(budget.occupiedUnitTarget!=null&&(!Number.isInteger(budget.occupiedUnitTarget)||budget.occupiedUnitTarget!==calculatedTarget))return missing('Budget target requires reconciliation');
    const target=budget.occupiedUnitTarget??calculatedTarget,variance=occupiedUnits-target;
    return {status:variance<0?'unfavorable':'favorable',label:variance>0?`+${variance} Ahead`:variance<0?`−${Math.abs(variance)} Behind`:'On Budget',variance,actual:occupiedUnits,budget:target,occupancyPct:pct,rentableUnits,source:actual.source,sourceTimestamp:actual.sourceTimestamp,scenarioId:budget.scenarioId,scenarioVersion:budget.version,rounding:'ceiling_whole_unit',canDrillDown:false};
  }
  function financial(scope,approvedMapping,budget,actual){
    if(!scope?.communityId||!Number.isInteger(scope.fiscalYear)||!['gpr','expenses'].includes(scope.metric)||!['calendar_month','fiscal_month','fiscal_ytd'].includes(scope.periodBasis)||!Array.isArray(scope.periods)||!scope.periods.length||scope.periods.some(p=>!/^\d{4}-(0[1-9]|1[0-2])$/.test(p))||new Set(scope.periods).size!==scope.periods.length)return missing('Incomplete scope');
    if(!budget||budget.approvalStatus!=='approved'||budget.locked!==true||budget.scenarioId!==scope.scenarioId||budget.version!==scope.scenarioVersion)return missing('Budget not approved');
    if(!actual||actual.approvalStatus!=='approved'||!actual.publicationId||!actual.source||!actual.sourceTimestamp)return missing('Missing actuals');
    if(!approvedMapping||approvedMapping.approvalStatus!=='approved'||!approvedMapping.version||approvedMapping.communityId!==scope.communityId||approvedMapping.fiscalYear!==scope.fiscalYear)return missing('Incomplete Coverage');
    if([budget,actual].some(v=>v.communityId!==scope.communityId||v.fiscalYear!==scope.fiscalYear||v.periodBasis!==scope.periodBasis))return missing('Incomplete Coverage');
    const codes=approvedMapping.metrics?.[scope.metric];
    if(!Array.isArray(codes)||!codes.length||codes.some(c=>typeof c!=='string'||!c.trim())||new Set(codes).size!==codes.length)return missing('Incomplete Coverage');
    const buildRows=dataset=>{
      const map=new Map();
      for(const row of dataset.rows||[]){
        if(!codes.includes(row.glCode)||!scope.periods.includes(row.period))continue;
        if(row.communityId!==scope.communityId||row.fiscalYear!==scope.fiscalYear||!finite(row.amount))return null;
        const key=JSON.stringify([row.glCode,row.period]);if(map.has(key))return null;
        map.set(key,row);
      }
      return map;
    };
    const a=buildRows(actual),b=buildRows(budget);if(!a||!b)return missing('Incomplete Coverage');
    const rows=[];let actualCents=0,budgetCents=0;
    for(const glCode of codes){let ac=0,bc=0;
      for(const period of scope.periods){const key=JSON.stringify([glCode,period]),ar=a.get(key),br=b.get(key);if(!ar||!br)return missing('Incomplete Coverage');ac+=Math.round(ar.amount*100);bc+=Math.round(br.amount*100);}
      actualCents+=ac;budgetCents+=bc;
      rows.push({glCode,actual:ac/100,budget:bc/100,variance:(scope.metric==='expenses'?bc-ac:ac-bc)/100});
    }
    if(!Number.isSafeInteger(actualCents)||!Number.isSafeInteger(budgetCents))return missing('Invalid financial amount');
    const variance=(scope.metric==='expenses'?budgetCents-actualCents:actualCents-budgetCents)/100;
    rows.sort((x,y)=>x.variance-y.variance||x.glCode.localeCompare(y.glCode));
    return {status:variance<0?'unfavorable':'favorable',label:variance<0?(scope.metric==='expenses'?'Overspent':'Behind'):'On Track',variance,actual:actualCents/100,budget:budgetCents/100,rows,glCodes:codes.slice(),source:actual.source,sourceTimestamp:actual.sourceTimestamp,publicationId:actual.publicationId,mappingVersion:approvedMapping.version,scenarioId:budget.scenarioId,scenarioVersion:budget.version,canDrillDown:Boolean(budget.destinationId)};
  }
  const stages=['Suggested','Accepted/Open','In Progress','Completed','Verified','Cancelled'];
  function transitionTask(task,next,context){
    if(!task?.id||!task.communityId||!task.planId||!stages.includes(task.status)||!stages.includes(next))throw Error('Valid task identity and lifecycle are required');
    if(!context?.canEdit||context.communityId!==task.communityId||!context.actor||!context.at)throw Error('Authorized scoped task editor required');
    if(task.version!==context.expectedVersion)throw Error('Task changed; reload before updating');
    if(next==='Verified'&&(task.status!=='Completed'||!context.canVerify||!task.completionEvidence))throw Error('Completion evidence and verification permission required');
    if(next==='Completed'&&!context.completionEvidence&&!task.completionEvidence)throw Error('Completion evidence required');
    if(task.status==='Suggested'&&!['Accepted/Open','Cancelled'].includes(next))throw Error('Accept a recommendation before executing it');
    if(next===task.status)return task;
    const reopening=['Accepted/Open','In Progress'].includes(next);
    const updated={...task,status:next,version:task.version+1,lastEditedBy:context.actor,updatedAt:context.at,
      completionEvidence:context.completionEvidence??task.completionEvidence,
      completedAt:next==='Completed'?context.at:reopening?null:task.completedAt,
      verifiedAt:next==='Verified'?context.at:null,
      verificationStatus:next==='Verified'?'Verified':'Unverified',
      history:[...(task.history||[]),{at:context.at,actor:context.actor,action:'status',from:task.status,to:next,version:task.version+1}]};
    return updated;
  }
  return Object.freeze({occupancy,financial,transitionTask,stages:Object.freeze(stages)});
});
