const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto'),{fixture}=require('./reforecast-fixture.cjs');
const guardMigration='20260928213333_investor_approval_source_validation.sql';
const root=path.join(__dirname,'..'),migration=name=>fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8');
(async()=>{
 const {parseReforecastWorkbook}=await import('../docs/portfolio-operations-dashboard/features/reforecast-intake.mjs');
 const {planningMappingDispositions}=await import('../docs/portfolio-operations-dashboard/features/planning-governance.mjs');
 const XLSX=require('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js');
 const {db,A,B,BUDGET,CLOSE,signIn}=await fixture(),owner='00000000-0000-0000-0000-000000000001';
 const call=async(name,args)=>(await db.query(`select to_jsonb(public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})) result`,args)).rows[0].result;
 await db.exec('reset role');
 await db.exec(migration('20260924121641_planning_cell_workbook_integrity_governance.sql'));
 // Install the exact immutable audit storage/resolution functions; the remainder
 // of this migration concerns financial close ingestion outside this fixture.
 await db.exec(migration('20260924121647_immutable_workbook_audits_and_monthly_governance.sql').split('alter function atlas_private.finance_intake_validation')[0]);
 for(const file of ['20260924165534_reforecast_builder_governance.sql','20260924165542_reforecast_report_receipts.sql','20260924232842_reforecast_governed_close_scope.sql','20260924232853_reforecast_str_overlay_isolation.sql','20260924235553_reforecast_active_import_close_scope.sql','20260925012933_reforecast_atomic_create_from_import.sql','20260925020220_reforecast_import_source_relationships.sql','20260925020222_reforecast_saved_json_str_programme.sql','20260925020226_reforecast_import_source_occurrence_index.sql'])await db.exec(migration(file));
 const approvedMetricMappings={revenue:[{glCode:'5120',factor:1},{glCode:'5220',factor:1}],expenses:[{glCode:'6100',factor:1},{glCode:'6200',factor:1}],capital:[{glCode:'8100',factor:1}]};
 await db.query("update atlas_approved_budget_versions set payload=payload||jsonb_build_object('metricMappings',$1::jsonb,'mappingVersion','approved-fixture-v1') where version_id=$2",[approvedMetricMappings,BUDGET]);
 await signIn(1);
 const initialSource=await call('atlas_read_reforecast_builder_source',[A,['2026-02'],[BUDGET],null,'original_budget',null]);
 assert.equal(initialSource.registry.version,null);assert.equal(initialSource.baseline.approvedMetricMappings[0].versionId,BUDGET);assert.deepEqual(initialSource.baseline.approvedMetricMappings[0].metricMappings,approvedMetricMappings);
 assert.equal((await db.query('select count(*)::int n from atlas_reforecast_registries')).rows[0].n,0,'published metric evidence never creates a registry implicitly');
 const accounts=[['5120','Rent','income'],['5220','Vacancy','contra_income'],['6100','Payroll','expense'],['6200','Utilities','expense'],['8100','Capital','capital']].map(([accountCode,category,nature])=>({accountCode,category,nature,placement:nature==='capital'?'below_noi':'above_noi',effectiveFrom:'2026-01'}));
 const registry=await call('atlas_save_reforecast_registry',[A,null,randomUUID(),{accounts,driverMappings:{},reason:'Reviewed exact import registry',effectiveDate:'2026-01-01'}]);
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Scenario','Plan','Currency','Local'],['GL','Account','Feb 2026','Mar 2026'],['5120','Rent',1001.25,1002.501234],['6100','Payroll',0,210],['6200','Utilities',null,55],['5120','duplicate rent',999,998]]),'Plan');
 const bytes=XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),evidence=await parseReforecastWorkbook(bytes,{xlsx:XLSX,fileName:'Synthetic.xlsx'});
 if(process.env.ATLAS_PROJECTED_AUDIT){await (await import('./workbook-projection-fixture.mjs')).installProjectionFixture(db);await signIn(1);}
 const audit=process.env.ATLAS_PROJECTED_AUDIT?await (await import('./workbook-projection-fixture.mjs')).saveProjectedAudit(db,A,evidence.integrity,bytes):await call('atlas_save_workbook_audit',[A,evidence.source.sha256,evidence.integrity,randomUUID()]);
 const assignment={communityId:A,confirmed:true,sourceEntities:[],actorId:owner,reason:'Reviewed community'};
 const uploadPayload={...evidence,source:{...evidence.source,originalFile:{encoding:'base64',data:Buffer.from(bytes).toString('base64')}},integrity:{auditId:audit.audit_id,fingerprint:audit.fingerprint,...(audit.manifest_hash?{manifestHash:audit.manifest_hash}:{})},propertyAssignment:assignment};
 const upload=await call('atlas_save_reforecast_upload',[A,randomUUID(),uploadPayload]);
 const periods=['2026-02','2026-03'],reviewedAt='2026-09-25T00:00:00Z',sourceScenario=evidence.lines[0].scenario;
 assert.equal(sourceScenario,'Plan');
 const selected=evidence.lines.filter(l=>l.row<6&&l.amount!==null);
 const mapping={confirmed:true,version:registry.version_id,propertyAssignment:assignment,sourceScenario,currency:'USD',periods,selectedLineIds:selected.map(l=>l.id),accountMappings:accounts.map(a=>({...a,sourceAccountCode:a.accountCode,sheet:'Plan',department:null,signMultiplier:1,allowReversal:false})),reason:'Import exact reviewed forecast values',reviewedBy:owner,reviewedAt,calendar:{basis:'calendar',startMonth:1,confirmed:true,periods,scenario:sourceScenario,reviewedBy:owner,reviewedAt},inputReviews:selected.map(l=>({cellId:l.id,confirmed:true,ownerId:owner,effectivePeriod:l.period,before:l.amount,after:l.amount,reason:'Reviewed input value',reviewedAt,integrityFingerprint:audit.fingerprint})),integrityReviews:[]};
 Object.assign(mapping,planningMappingDispositions(evidence,mapping));
 mapping.currencyMapping={sourceCurrency:'Local',reportingCurrency:'USD',method:'identity',confirmed:true,reviewedBy:owner,reviewedAt,reason:'Reviewed Local as USD with no currency conversion'};
 const payload={name:'Conventional from Plan',model:'conventional',scenarioPurpose:'conventional',governanceSchemaVersion:2,calendar:{...mapping.calendar,scenario:'Conventional from Plan'},periods,baselineType:'original_budget',baselineVersionIds:[BUDGET],registryVersionId:registry.version_id,ownerId:owner,reviewerId:owner,drivers:[],overrides:[],reason:'Create working forecast from reviewed Plan'};
 const scenario=randomUUID(),request=randomUUID(),args=[A,scenario,0,request,upload.upload_id,mapping,payload];
 const create=(overrides={})=>call('atlas_create_reforecast_from_import',[overrides.communityId??A,overrides.scenarioId??scenario,overrides.expectedRevision??0,overrides.requestId??randomUUID(),overrides.uploadId??upload.upload_id,overrides.mapping??mapping,overrides.payload??payload]);
 await db.exec('reset role');
 await db.exec(migration('20260925071533_reforecast_request_identity_consistency.sql'));
 await db.exec(migration('20260925162050_budget_governed_draft_investor_lifecycle.sql'));
 await db.exec("create function atlas_private.budget_calendar(cid uuid) returns jsonb language sql as $$select '{\"verified\":true,\"basis\":\"calendar\",\"startMonth\":1}'::jsonb$$");
 await db.exec(migration('20260928141143_reviewed_noncash_forecast_presentation.sql'));
 await db.exec(migration('20260928142628_indexed_import_validation_evidence.sql'));
 await db.exec(migration('20260928144620_bounded_reforecast_validation_memory.sql'));
 await db.exec(migration('20260928150652_governed_reforecast_save_timeout.sql'));
 await signIn(1);
 let result=await call('atlas_create_reforecast_from_import',args);
 assert.equal(result.head.status,'working_draft');assert.equal(result.snapshot.completeness.blockerCount,0,JSON.stringify(result.snapshot.diagnostics));
 assert.equal((await db.query('select count(*)::int n from atlas_reforecast_publications')).rows[0].n,0);
 const save=(r,action,body=r.revision.payload,requestId=randomUUID())=>call('atlas_save_reforecast_scenario',[A,r.head.scenario_id,r.head.revision,requestId,action,body]);

 await signIn(5);result=await save(result,'submit');result=await save(result,'vp_approve');
 const publication=result.publication, publishedBefore=JSON.stringify(publication), investorBody={...result.revision.payload,investorApprovalDate:'2026-09-24'};
 const publishWorkbook=async(exact=false)=>{
  await signIn(1);
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Scenario','Plan','Currency','Local'],['GL','Account','Feb 2026','Mar 2026'],...accounts.map((a,i)=>[a.accountCode,a.category,exact&&i===2?null:i===1?0:10+i,i===1?-5:20+i])]),'Plan');
  const b=XLSX.write(book,{type:'buffer',bookType:'xlsx'});let e=await parseReforecastWorkbook(b,{xlsx:XLSX,fileName:'Complete-source.xlsx',includeOriginalBytes:true});
  const m={...mapping,selectedLineIds:e.lines.filter(l=>exact||l.amount!==null).map(l=>l.id)};
  if(exact){m.workbookSourcePolicy={schemaVersion:1,mode:'workbook_exact',blankDisposition:'preserve_null',confirmed:true,reviewedBy:owner,reviewedAt,reason:'Preserve exact workbook blanks'};
   e=(await (await import('../docs/portfolio-operations-dashboard/features/reforecast-authority.mjs')).prepareScopedReforecastEvidence(e,m,{xlsx:XLSX,sourceBytes:b})).evidence;}
  const a=await call('atlas_save_workbook_audit',[A,e.source.sha256,e.integrity,randomUUID()]);
  m.inputReviews=e.lines.filter(l=>m.selectedLineIds.includes(l.id)).map(l=>({cellId:l.id,confirmed:true,ownerId:owner,effectivePeriod:l.period,before:l.amount,after:l.amount,reason:'Reviewed exact source input',reviewedAt,integrityFingerprint:a.fingerprint}));Object.assign(m,planningMappingDispositions(e,m));
  const u=await call('atlas_save_reforecast_upload',[A,randomUUID(),{...e,source:{...e.source,originalFile:{encoding:'base64',data:Buffer.from(b).toString('base64')}},integrity:{auditId:a.audit_id,fingerprint:a.fingerprint},propertyAssignment:assignment}]);
  let r=await call('atlas_create_reforecast_from_import',[A,randomUUID(),0,randomUUID(),u.upload_id,m,payload]);
  assert.equal(r.snapshot.completeness.blockerCount,0,JSON.stringify(r.snapshot.diagnostics));
  await signIn(5);r=await save(r,'submit');r=await save(r,'vp_approve');return r;
 };
 const numericLegacy=await publishWorkbook();
 await signIn(1);let preReceipt=await call('atlas_save_reforecast_scenario',[A,randomUUID(),0,randomUUID(),'save_draft',result.revision.payload]);
 assert.equal((await db.query('select count(*)::int n from atlas_reforecast_import_receipts where scenario_id=$1',[preReceipt.head.scenario_id])).rows[0].n,0);
 const preReceiptStripped=structuredClone(preReceipt.revision.payload);for(const field of ['uploadId','importMapping','importHistory','importIssues'])delete preReceiptStripped[field];preReceiptStripped.overrides=[];
 preReceipt=await save(preReceipt,'save_draft',preReceiptStripped);preReceipt=await save(preReceipt,'submit');await signIn(5);preReceipt=await save(preReceipt,'vp_approve');
 // Model old source metadata stripping through the then-supported public path.
 await signIn(1);let strippedLegacy=await create({scenarioId:randomUUID()});
 const strippedConfig=structuredClone(strippedLegacy.revision.payload);for(const field of ['uploadId','importMapping','importHistory','importIssues'])delete strippedConfig[field];strippedConfig.overrides=[];
 strippedLegacy=await save(strippedLegacy,'save_draft',strippedConfig);strippedLegacy=await save(strippedLegacy,'submit');await signIn(5);strippedLegacy=await save(strippedLegacy,'vp_approve');
 await signIn(1);let alreadyLocked=await create({scenarioId:randomUUID()});alreadyLocked=await save(alreadyLocked,'submit');await signIn(5);alreadyLocked=await save(alreadyLocked,'vp_approve');
 const committedLockRequest=randomUUID(),committedLockBody={...alreadyLocked.revision.payload,investorApprovalDate:'2026-09-24'},beforeCommittedLock=alreadyLocked;
 alreadyLocked=await save(alreadyLocked,'investor_approve',committedLockBody,committedLockRequest);
 await signIn(1);
 // JSON null is not a valid import-history collection in the existing writer;
 // do not silently normalize a malformed shape at final approval.
 await assert.rejects(()=>call('atlas_save_reforecast_scenario',[A,randomUUID(),0,randomUUID(),'save_draft',{...payload,importHistory:null}]),/cannot (?:extract elements from|get array length of) a scalar/i);
 let manualNullMapping=await call('atlas_save_reforecast_scenario',[A,randomUUID(),0,randomUUID(),'save_draft',{...payload,uploadId:null,importMapping:null}]);manualNullMapping=await save(manualNullMapping,'submit');await signIn(5);manualNullMapping=await save(manualNullMapping,'vp_approve');
 await signIn(1);let manual=await call('atlas_save_reforecast_scenario',[A,randomUUID(),0,randomUUID(),'save_draft',{...payload,uploadId:null,importMapping:{},importHistory:[]}]);manual=await save(manual,'submit');await signIn(5);manual=await save(manual,'vp_approve');
 await db.exec('reset role');
 await db.exec(migration('20260928210158_verified_workbook_blank_forecast_semantics.sql'));
 const metadata=async()=> (await db.query("select proname,prosecdef,provolatile,proconfig,proacl::text,pg_get_userbyid(proowner) owner from pg_proc where oid in ('atlas_private.save_reforecast_builder(uuid,uuid,integer,uuid,text,jsonb)'::regprocedure,'public.atlas_save_reforecast_scenario(uuid,uuid,integer,uuid,text,jsonb)'::regprocedure) order by proname")).rows;
 const metadataBefore=await metadata();
 assert.ok(metadataBefore.find(r=>r.proname==='atlas_save_reforecast_scenario').proconfig.includes('statement_timeout=45s'));
 const originalDefinition=(await db.query("select pg_get_functiondef('atlas_private.save_reforecast_builder(uuid,uuid,integer,uuid,text,jsonb)'::regprocedure) d")).rows[0].d;
 const bodyHash=(await db.query("select encode(sha256(convert_to(prosrc,'UTF8')),'hex') hash from pg_proc where oid='atlas_private.save_reforecast_builder(uuid,uuid,integer,uuid,text,jsonb)'::regprocedure")).rows[0].hash;
 assert.equal(bodyHash,'9e63b31e5f406427ce916dc1a67e66ae0d52e619fdef5c36fcac1073f8c6fb94');
 const fresh=(await db.query('select atlas_private.calculate_reforecast(atlas_private.attach_reforecast_workbook_context($1::jsonb,$2::jsonb),$2::jsonb) snapshot',[result.source,result.revision.payload])).rows[0].snapshot;
 assert.ok(fresh.diagnostics.some(d=>d.code==='workbook_source_policy_required'));
 await signIn(5);await db.exec('begin');
 const bypass=await save(result,'investor_approve',investorBody);
 assert.equal(bypass.head.status,'investor_approved');assert.deepEqual(bypass.snapshot,result.snapshot);
 const strippedBypass=await save(strippedLegacy,'investor_approve',{...strippedLegacy.revision.payload,investorApprovalDate:'2026-09-24'});assert.equal(strippedBypass.head.status,'investor_approved');
 await db.exec('rollback');
 // The old public path demonstrably locks an invalid historical publication.
 // Roll back that isolated probe before applying the repair.
 await db.exec('reset role');
 const history=async()=>Object.fromEntries(await Promise.all(['atlas_reforecast_revisions','atlas_reforecast_heads','atlas_reforecast_publications','atlas_reforecast_active_heads','atlas_budget_workflow_audit','atlas_budget_publication_deliveries','atlas_reforecast_import_receipts','atlas_reforecast_uploads','atlas_approved_budget_versions','atlas_financial_close_versions','atlas_financial_close_heads','atlas_financial_close_rows'].map(async table=>[table,(await db.query(`select md5(coalesce(jsonb_agg(v order by v::text),'[]')::text) hash from (select to_jsonb(t) v from ${table} t) q`)).rows[0].hash])));
 const preserved=await history();
 await db.exec(originalDefinition.replace('declare prior public.atlas_reforecast_revisions','declare  prior public.atlas_reforecast_revisions'));
 await db.exec('begin');await assert.rejects(()=>db.exec(migration(guardMigration)),/prerequisite differs/i);await db.exec('rollback');
 assert.equal((await db.query("select to_regprocedure('atlas_private.validate_reforecast_investor_source(uuid,uuid,integer,jsonb,jsonb)') p")).rows[0].p,null,'failed prerequisite rolls back new helper');
 await db.exec(originalDefinition);await db.exec(migration(guardMigration));
 assert.deepEqual(await metadata(),metadataBefore,'owner, security, ACL and public bounded timeout preserved');
 assert.deepEqual(await history(),preserved,'migration never rewrites financial history');
 await signIn(5);
 await assert.rejects(()=>save(result,'investor_approve',investorBody),/source evidence does not satisfy current validation/i);
 await assert.rejects(()=>save(strippedLegacy,'investor_approve',{...strippedLegacy.revision.payload,investorApprovalDate:'2026-09-24'}),/workbook provenance is missing despite retained scenario import history/i);
 await assert.rejects(()=>save(preReceipt,'investor_approve',{...preReceipt.revision.payload,investorApprovalDate:'2026-09-24'}),/workbook provenance is missing despite retained scenario import history/i);
 assert.deepEqual((await save(beforeCommittedLock,'investor_approve',committedLockBody,committedLockRequest)).revision,alreadyLocked.revision,'previously committed legacy lock replay returns before new gate');
 await db.exec('reset role');assert.deepEqual(await history(),preserved,'rejection and committed retry make no revision, audit, delivery or head changes');
 await signIn(4);await assert.rejects(()=>save(numericLegacy,'investor_approve',{...numericLegacy.revision.payload,investorApprovalDate:'2026-09-24'}),/access denied/i);
 await db.exec('reset role');await db.query("update atlas_user_profiles set allowed_community_ids=array[$1::uuid] where role='community_manager'",[A]);await signIn(4);await assert.rejects(()=>save(numericLegacy,'investor_approve',{...numericLegacy.revision.payload,investorApprovalDate:'2026-09-24'}),/authorized reviewer/i);
 await signIn(5);await assert.rejects(()=>save(numericLegacy,'investor_approve',{...numericLegacy.revision.payload,investorApprovalDate:'2999-01-01'}),/actual investor approval date/i);
 await assert.rejects(()=>save(numericLegacy,'investor_approve',{...numericLegacy.revision.payload,name:'Changed before lock',investorApprovalDate:'2026-09-24'}),/Save changed inputs/i);
 await assert.rejects(()=>db.query('select atlas_private.validate_reforecast_investor_source($1::uuid,$2::uuid,$3::integer,$4::jsonb,$5::jsonb)',[A,numericLegacy.head.scenario_id,numericLegacy.head.revision,numericLegacy.source,numericLegacy.revision.payload]),/permission denied/i);
 const exact=await publishWorkbook(true);assert.equal(exact.snapshot.lines.find(l=>l.accountCode==='6100'&&l.period==='2026-02').forecast,null);
 // A later close head must not rebase or invalidate a frozen valid publication.
 await db.exec('reset role');await db.query('update atlas_financial_close_heads set version_id=$1 where community_id=$2',[randomUUID(),A]);await signIn(5);
 for(const valid of [numericLegacy,exact,manual,manualNullMapping]){
  const id=randomUUID(),body={...valid.revision.payload,investorApprovalDate:'2026-09-24'};
  const locked=await save(valid,'investor_approve',body,id);
  assert.equal(locked.head.status,'investor_approved');assert.deepEqual(locked.snapshot,valid.snapshot);assert.deepEqual(locked.source,valid.source);
  assert.deepEqual((await save(valid,'investor_approve',body,id)).revision,locked.revision,'same request remains idempotent');
  assert.deepEqual((await db.query('select to_jsonb(p) value from atlas_reforecast_publications p where publication_id=$1',[valid.publication.publication_id])).rows[0].value,valid.publication);
  await assert.rejects(()=>save(locked,'save_draft'),/locked/i);
 }
 assert.equal(JSON.stringify((await db.query('select to_jsonb(p) value from atlas_reforecast_publications p where publication_id=$1',[publication.publication_id])).rows[0].value),publishedBefore);
 await db.exec('reset role');assert.equal((await db.query('select status from atlas_reforecast_heads where scenario_id=$1',[result.head.scenario_id])).rows[0].status,'pending_investor_approval');
 await assert.rejects(()=>db.exec("update atlas_reforecast_publications set reason='changed'"),/immutable/i);
 await db.close();
 console.log(JSON.stringify({status:'PASS',legacyBypassConfirmed:true,probeRolledBack:true,legacyFreshBlockers:[...new Set(fresh.diagnostics.filter(d=>d.severity==='error').map(d=>d.code))],legacyStoredBlockerCount:result.snapshot.completeness.blockerCount,guardRejectsLegacy:true,legacyStrippedOriginRejected:true,preReceiptLegacyOriginRejected:true,committedInvalidLegacyLockRetryPreserved:true,distinctManualScenarioApproved:true,manualNullMappingAndAbsentHistoryApprove:true,jsonNullHistoryRejectedByExistingWriter:true,validLegacyNumericAndExactBlankApprove:true,frozenSourceAndSnapshotPreserved:true,changedActualHeadDoesNotRebase:true,authorizationAndIdempotencyPreserved:true,prerequisiteDriftRollsBack:true,productionWrites:0}));
})().catch(error=>{console.error(error.message,error.where||error.stack);process.exitCode=1});
