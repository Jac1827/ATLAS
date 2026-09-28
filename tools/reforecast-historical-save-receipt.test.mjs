import assert from 'node:assert/strict';
import {readSaveReceipt,approveAndLock} from '../docs/portfolio-operations-dashboard/features/reforecast-store.mjs';
const id=n=>'70000000-0000-0000-0000-'+String(n).padStart(12,'0');
const communityId=id(1),scenarioId=id(2),requestId=id(3),actor=id(4),revisionId=id(5),publicationId=id(6),replacementId=id(7),periods=['2026-09','2026-10'];
const revision={revision_id:revisionId,community_id:communityId,scenario_id:scenarioId,request_id:id(8),status:'locked',payload:{scenarioPurpose:'conventional',periods},snapshot:{fingerprint:'saved-snapshot'}};
const publication={publication_id:publicationId,community_id:communityId,scenario_id:scenarioId,revision_id:revisionId,request_id:requestId,periods,snapshot:revision.snapshot,published_at:'2026-09-25T00:00:00Z'};
const receipt={head:{community_id:communityId,scenario_id:scenarioId,revision_id:revisionId,status:'locked',revision:5},revision,publication,source:{lockedPeriods:[]},snapshot:revision.snapshot};
const activeRow=(pub,months)=>({publicationId:pub,communityId,scenarioId:pub===publicationId?scenarioId:id(9),revisionId:pub===publicationId?revisionId:id(10),activePeriods:months,periods,verified:true,approved:true,locked:true,contentHash:'immutable-'+pub,snapshot:{fingerprint:'projected-'+pub}});
function fixture(active){
 let activeActor=actor,writes=0;const calls=[],storedRevision=structuredClone(revision),storedPublication=structuredClone(publication),rpcReceipt=structuredClone(receipt);
 const central={getSession:()=>({user:{id:activeActor}}),async fetchJson(path){calls.push(path);
  if(path==='/rpc/atlas_read_reforecast_save_receipt')return structuredClone(rpcReceipt);
  if(path==='/rpc/atlas_save_reforecast_scenario'){writes++;return structuredClone(rpcReceipt);}
  if(path.startsWith('/atlas_reforecast_revisions?'))return [structuredClone(storedRevision)];
  if(path.startsWith('/atlas_reforecast_publications?'))return [structuredClone(storedPublication)];
  if(path.startsWith('/atlas_reforecast_heads?'))return [structuredClone(rpcReceipt.head)];
  if(path==='/rpc/atlas_read_active_reforecast'){if(central.changeActor)activeActor=id(99);return structuredClone(active);}
  throw Error('Unexpected endpoint '+path);
 }};return {central,calls,rpcReceipt,get writes(){return writes;}};
}
const options={communityId,scenarioId,requestId};
const superseded=fixture([activeRow(replacementId,periods)]),historical=await readSaveReceipt(superseded.central,options);
assert.equal(historical.revision.revision_id,revisionId);assert.equal(historical.publication.publication_id,publicationId);assert.deepEqual(historical.supersededPeriods,periods);assert.equal(historical.active[0].publicationId,replacementId);assert.equal(superseded.writes,0,'Historical recovery never reactivates or rewrites the old publication');
assert(superseded.calls.some(path=>path.startsWith('/atlas_reforecast_revisions?')));assert(superseded.calls.some(path=>path.startsWith('/atlas_reforecast_publications?')),'Both immutable rows must be independently read');
const partial=await readSaveReceipt(fixture([activeRow(publicationId,[periods[0]]),activeRow(replacementId,[periods[1]])]).central,options);assert.deepEqual(partial.supersededPeriods,[periods[1]]);
assert.deepEqual((await readSaveReceipt(fixture([activeRow(publicationId,periods)]).central,options)).supersededPeriods,[]);
await assert.rejects(()=>readSaveReceipt(fixture([]).central,options),/requires active publication readback/);
await assert.rejects(()=>readSaveReceipt(fixture([activeRow(replacementId,[periods[0]])]).central,options),/requires active publication readback/,'Replacement coverage must include every eligible month');
await assert.rejects(()=>readSaveReceipt(fixture([{...activeRow(replacementId,periods),verified:false}]).central,options),/Active baseline unavailable/);
await assert.rejects(()=>readSaveReceipt(fixture([{...activeRow(replacementId,periods),communityId:id(99)}]).central,options),/Invalid active-reforecast/);
const altered=fixture([activeRow(replacementId,periods)]);altered.rpcReceipt.publication.snapshot.fingerprint='tampered';await assert.rejects(()=>readSaveReceipt(altered.central,options),/committed record could not be verified/);
const changedActor=fixture([activeRow(replacementId,periods)]);changedActor.central.changeActor=true;await assert.rejects(()=>readSaveReceipt(changedActor.central,options),/signed-in account changed/);
const fresh=fixture([activeRow(replacementId,periods)]);await assert.rejects(()=>approveAndLock(fresh.central,{...options,expectedRevision:3,payload:revision.payload}),/active baseline readback is unavailable/);assert.equal(fresh.writes,1,'A new approval still requires its own live active confirmation');
const validNew=fixture([activeRow(publicationId,periods)]);assert.equal((await approveAndLock(validNew.central,{...options,expectedRevision:3,payload:revision.payload})).publication.publication_id,publicationId);
console.log('PASS historical approval recovery: exact immutable receipt survives complete/partial supersession without writes; missing, unverified, wrong-community, tampered and changed-actor readbacks fail; new approval still requires its own active publication.');
