import test from 'node:test';
import assert from 'node:assert/strict';
import {recommendOccupancyGoals,applicationActivityRate,applyOccupancyRecommendation} from '../docs/portfolio-operations-dashboard/features/occupancy-goal-recommendations.mjs';
const fixture=()=>({communityId:'c1',period:'2026-09',corporateUnits:26,
 snapshot:{status:'valid',communityId:'c1',period:'2026-09',sourceFingerprint:'box-hash',asOf:'2026-09-28',rentableUnits:247,measurementBasis:'units',occupiedUnits:78,leasedUnits:115},
 budget:{status:'available',approvalStatus:'approved',communityId:'c1',period:'2026-09',versionId:'budget-v1',contentHash:'budget-hash',occupancyPct:47.6,rentableUnits:247,measurementBasis:'units'},
 closing:{status:'valid',kind:'application_to_lease_activity',communityId:'c1',period:'2026-09',asOf:'2026-09-28',sourceFingerprint:'leads-hash',applications:15,leases:1},
 pipeline:{status:'valid',communityId:'c1',sourceFingerprint:'roll-hash',period:'2026-09',asOf:'2026-09-28',signedVacantUnits:37,datedMoveIns:[{date:'2026-10-27',count:1},{date:'2026-12-01',count:2}],undatedUnits:34,complete:false},
 movements:{communityId:'c1',period:'2026-09',basis:'remaining_scheduled',remainingMoveOuts:null,complete:false}});
test('reported Leased stays 115/247 with corporate inventory; minimum goals preserve unknown timing/departures',()=>{
 const input=fixture(),before=structuredClone(input),r=recommendOccupancyGoals(input);
 assert.equal(r.actualLeasedPct,115/247*100);assert.equal(r.actualPhysicalPct,78/247*100);assert.equal(r.targetUnits,118);assert.equal(r.leasedGoal,47.6);
 assert.equal(r.signedLeaseGap,3);assert.equal(r.minimumApplications,45);assert.equal(r.requiredMoveIns,null);assert.equal(r.grossLeaseGoal,null);assert.equal(r.applicationGoal,null);
 assert.equal(r.datedPipelineMoveIns,0);assert.equal(r.undatedPipelineUnits,34);assert.equal(r.pipelineTimingComplete,false);assert.equal(r.status,'partial');assert.deepEqual(input,before);
 const future=fixture();future.period=future.budget.period='2026-10';const x=recommendOccupancyGoals(future);assert.equal(x.datedPipelineMoveIns,1);assert.match(x.warnings.join(' '),/2026-09-28/);
});
test('complete remaining scheduled departures uses signed surplus once, separate physical move-in need',()=>{
 const f=fixture();f.movements={communityId:'c1',period:'2026-09',sourceFingerprint:'schedule',asOf:'2026-09-28',basis:'remaining_scheduled',remainingMoveOuts:4,complete:true};
 let r=recommendOccupancyGoals(f);assert.equal(r.requiredMoveIns,44);assert.equal(r.grossLeaseGoal,7);assert.equal(r.applicationGoal,105);assert.equal(r.netLeaseGoal,3);
 f.snapshot.leasedUnits=125;r=recommendOccupancyGoals(f);assert.equal(r.grossLeaseGoal,0);assert.equal(r.applicationGoal,0);assert.equal(r.requiredMoveIns,44);
 f.movements.basis='completed_mtd';r=recommendOccupancyGoals(f);assert.equal(r.grossLeaseGoal,null);assert.match(r.warnings.join(' '),/not added again/);
});
test('activity zero, missing, stale, inconsistent and same-period rules never use default or floor',()=>{
 for(const mutate of [f=>f.closing.applications=0,f=>f.closing.applications=null,f=>f.closing.leases=16,f=>f.closing.communityId='other',f=>f.closing.period='2026-10',f=>f.closing.asOf='2026-10-01',f=>f.closing.sourceFingerprint='']){
  const f=fixture();mutate(f);const r=recommendOccupancyGoals(f);assert.equal(r.minimumApplications,null);assert.equal(r.closing.status,'unavailable');
 }
 const f=fixture();f.closing.leases=0;assert.equal(applicationActivityRate(f.closing,f).rate,0);assert.equal(recommendOccupancyGoals(f).minimumApplications,null);
 f.snapshot.leasedUnits=118;assert.equal(recommendOccupancyGoals(f).minimumApplications,0);
 f.closing.leases=15;f.snapshot.leasedUnits=115;assert.equal(recommendOccupancyGoals(f).minimumApplications,3);
});
test('missing or mismatched approved budget and count evidence cannot become zero',()=>{
 for(const mutate of [f=>f.budget.occupancyPct=null,f=>f.budget.approvalStatus='draft',f=>f.budget.period='2026-08',f=>f.budget.versionId='',f=>f.budget.rentableUnits=221,f=>f.snapshot.leasedUnits=null,f=>f.snapshot.occupiedUnits=116,f=>f.snapshot.asOf='2026-10-01']){
  const f=fixture();mutate(f);assert.equal(recommendOccupancyGoals(f).signedLeaseGap,null);
 }
 const f=fixture();f.budget.occupancyPct=0;let r=recommendOccupancyGoals(f);assert.equal(r.targetUnits,0);assert.equal(r.leasedGoal,0);assert.equal(r.minimumApplications,0);
 f.pipeline.datedMoveIns[0].date='2026-02-30';assert.equal(recommendOccupancyGoals(f).datedPipelineMoveIns,null);
});
test('recalculated recommendations do not overwrite human zeroes, manual override or history',()=>{
 const original={approved:{version:3,applicationGoal:0,netLeaseGoal:0},approvedApps:0,approvedNetLeases:0,manualOverride:12,history:[{version:1}]},before=structuredClone(original);
 const row=applyOccupancyRecommendation(original,recommendOccupancyGoals(fixture()));assert.equal(row.approvedApps,0);assert.equal(row.approvedNetLeases,0);assert.equal(row.manualOverride,12);assert.deepEqual(original,before);assert.equal(row.planningRecommendation.source.closing.applications,15);assert.equal(row.planningRecommendation.source.snapshot.sourceFingerprint,'box-hash');
});
test('dated pipeline cannot claim complete coverage from stale or mismatched signed inventory',()=>{
 const valid=fixture();valid.pipeline.datedMoveIns=[{date:'2026-10-27',count:37}];valid.pipeline.undatedUnits=0;valid.pipeline.complete=true;
 assert.equal(recommendOccupancyGoals(valid).pipelineTimingComplete,true);
 for(const mutate of [f=>f.pipeline.asOf='2026-09-27',f=>f.pipeline.period='2026-08',f=>f.pipeline.signedVacantUnits=36,f=>f.pipeline.datedMoveIns[0].count=36,f=>f.pipeline.datedMoveIns[0].date='2026-09-27']){
  const f=structuredClone(valid);mutate(f);const r=recommendOccupancyGoals(f);assert.equal(r.pipelineTimingComplete,false);assert.equal(r.datedPipelineMoveIns,null);
 }
});
test('unknown units-or-beds comparison suppresses goals while preserving reported actual and approved percentage',()=>{
 for(const edit of [f=>f.snapshot.measurementBasis=null,f=>f.budget.measurementBasis=null,f=>f.snapshot.measurementBasis='beds',f=>f.budget.rentableUnits=null]){
  const f=fixture();edit(f);const r=recommendOccupancyGoals(f);assert.equal(r.actualLeasedPct,115/247*100);assert.equal(r.budgetPct,47.6);assert.equal(r.targetUnits,null);assert.equal(r.minimumApplications,null);assert.match(r.warnings.join(' '),/units-or-beds/);
 }
 const f=fixture();f.snapshot.measurementBasis=f.budget.measurementBasis='beds';assert.equal(recommendOccupancyGoals(f).signedLeaseGap,3);
});
test('activity-count arithmetic does not round an exact application boundary upward',()=>{
 const f=fixture();f.snapshot.leasedUnits=97;f.closing.applications=10;f.closing.leases=7;
 const r=recommendOccupancyGoals(f);assert.equal(r.signedLeaseGap,21);assert.equal(r.minimumApplications,30);
});
