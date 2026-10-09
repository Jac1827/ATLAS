const assert = require('node:assert/strict');
const {randomUUID, createHash} = require('node:crypto');
const {migrationHistoryFixture} = require('./migration-history-fixture.cjs');
(async()=>{
 const {db}=await migrationHistoryFixture({includeLater:true});
 try {
  const u=randomUUID(),cid=randomUUID();
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[u,u+'@risere.com']);
  await db.query("insert into atlas_user_profiles(user_id,email,display_name,role,status,allowed_community_ids) values($1,$2,'Synthetic','admin','active',$3)",[u,u+'@risere.com',[cid]]);
  await db.query("insert into atlas_communities(community_id,canonical_name,display_name) values($1,'Synthetic Entrata','Synthetic Entrata')",[cid]);
  const base={applicationId:'synthetic-application',propertySource:'Synthetic Entrata',mappingStatus:'mapped',leaseId:'synthetic-lease',residentName:'Synthetic',email:'synthetic@example.test',primaryPhone:'+12025550101'};
  const publish=async(row,date)=>{
   await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[u]);await db.exec('set role authenticated');
   const item=(await db.query('select atlas_publish_application_import($1::jsonb) result',[JSON.stringify({validationStatus:'valid',sourceAsOf:date,reportPeriodKey:'2026-10',records:[row]})])).rows[0].result.imports[0];
   await db.exec('reset role');return item;
  };
  const attest=async(item,person)=>db.query(`insert into atlas_entrata_communication_identity_reviews(community_id,resident_id,lease_id,source_import_id,application_id,verified_at,valid_until,evidence_reference,email_fingerprint,phone_fingerprint)
   values($1,$2,$3,$4,$5,now(),now()+interval '30 days','synthetic-evidence',$6,$7)
   on conflict(community_id,resident_id) do update set source_import_id=excluded.source_import_id,valid_until=excluded.valid_until`,[cid,person,base.leaseId,item.import_id,base.applicationId,createHash('sha256').update(base.email).digest('hex'),createHash('sha256').update(base.primaryPhone).digest('hex')]);
  const identities=async()=> {await db.exec('set role service_role');try{return (await db.query('select * from atlas_resident_communication_identity')).rows;}finally{await db.exec('reset role');}};
  let item=await publish(base,'2026-10-01');await attest(item,base.applicationId);
  assert.equal((await identities()).length,0,'Application ID never substitutes for person ID');
  item=await publish({...base,personId:'synthetic-person'},'2026-10-02');
  assert.equal(item.records[0].personId,'synthetic-person','Canonical source ID survives publication');
  await attest(item,'synthetic-person');
  assert.equal((await identities()).length,1);assert.equal((await identities())[0].email_verified,true);assert.equal((await identities())[0].phone_verified,true);
  await db.query("update atlas_entrata_communication_identity_reviews set email_fingerprint=repeat('0',64) where resident_id='synthetic-person'");
  assert.equal((await identities())[0].email_verified,false,'Endpoint changed or unverified blocks email');
  await db.query("update atlas_entrata_communication_identity_reviews set valid_until=now()-interval '1 second',verified_at=now()-interval '2 days' where resident_id='synthetic-person'");
  assert.equal((await identities()).length,0,'Expired review fails closed');await attest(item,'synthetic-person');
  assert.equal((await publish({...base,personId:'synthetic-person'},'2026-10-02')).import_id,item.import_id,'Monthly upload retries are idempotent');
  const changed=await publish({...base,personId:'synthetic-person',leaseId:'changed-lease'},'2026-10-03');
  assert.equal((await identities()).length,0,'New snapshot invalidates previous lease review');
  await db.query('update atlas_application_imports set deleted_at=now() where import_id=$1',[changed.import_id]);
  assert.equal((await identities()).length,0,'Deleting newest snapshot never revives stale identity');
  item=await publish({...base,personId:'synthetic-person',residentId:'conflicting-person'},'2026-10-04');await attest(item,'synthetic-person');
  assert.equal((await identities()).length,0,'Conflicting source person identifiers require review');
  item=await publish({...base,residentId:'synthetic-person'},'2026-10-05');await attest(item,'synthetic-person');
  assert.equal((await identities()).length,1,'Explicit resident ID is retained without deriving an identity');
  await publish({...base,residentId:'synthetic-person',email:'changed@example.test'},'2026-10-05');
  assert.equal((await identities()).length,0,'Equal-date conflicting snapshots fail closed');
  await db.exec('set role authenticated');
  await assert.rejects(()=>db.query('select * from atlas_entrata_communication_identity_reviews'),/permission denied/);
  await assert.rejects(()=>db.query("update atlas_entrata_communication_identity_reviews set email_fingerprint=repeat('0',64)"),/permission denied/);
  console.log('PASS Entrata monthly publication: source IDs preserved; no Application ID fallback; reviewed current lease; endpoint fingerprints; expiry; idempotency; changed/deleted/conflicting snapshots; browser attestation denied');
 }finally{await db.close();}
})().catch(e=>{console.error(e.message,e.where||'');process.exitCode=1;});
