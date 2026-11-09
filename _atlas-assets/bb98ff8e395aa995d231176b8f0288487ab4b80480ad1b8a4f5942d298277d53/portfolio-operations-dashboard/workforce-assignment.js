(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.AtlasWorkforceAssignment=factory();})(typeof globalThis!=='undefined'?globalThis:this,()=>{
 'use strict';
 const date=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||''))?String(v):null;
 function resolve(employees,assignments,{start,end}){
  if(!date(start)||!date(end)||start>end)throw Error('Invalid workforce period');
  const people=new Map(employees.filter(e=>e.employeeId).map(e=>[e.employeeId,e]));
  const scoped=assignments.filter(a=>people.has(a.employeeId)&&a.recordStatus!=='deleted'&&date(a.effectiveStart)&&a.effectiveStart<=end&&(!a.effectiveEnd||a.effectiveEnd>=start)&&!/inactive|terminated|deleted/i.test(a.status||''));
  return scoped.map(a=>{
   const person=people.get(a.employeeId),overlap=scoped.some(b=>b.assignmentId!==a.assignmentId&&b.employeeId===a.employeeId&&b.communityName===a.communityName&&b.effectiveStart<=(a.effectiveEnd||end)&&a.effectiveStart<=(b.effectiveEnd||end));
   return {...person,assignmentId:a.assignmentId,communityName:a.communityName,assignedCommunity:a.communityName,communityId:a.communityId,roleId:a.roleId,title:a.title,bonusRoleType:a.bonusRoleType,bonusRole:a.bonusRole||'',region:a.region||person.region,managerId:a.managerId,regionalManagerId:a.regionalManagerId,effectiveStart:a.effectiveStart,effectiveEnd:a.effectiveEnd,active:true,sourceUpdatedAt:a.sourceUpdatedAt,assignmentVersion:a.version,assignmentSource:a.source,workforceIssue:overlap?'Overlapping workforce assignments require People review':null};
  }).sort((a,b)=>String(a.assignmentId).localeCompare(String(b.assignmentId)));
 }
 return {resolve};
});
