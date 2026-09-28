// Current governed atomic workflow regression for bounded private validation memory.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto'),{fixture}=require('./reforecast-fixture.cjs');
const root=path.join(__dirname,'..'),migration=name=>fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8');
(async()=>{
 const {parseReforecastWorkbook}=await import('../docs/portfolio-operations-dashboard/features/reforecast-intake.mjs');
 const {planningMappingDispositions}=await import('../docs/portfolio-operations-dashboard/features/planning-governance.mjs');
 const XLSX=require('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js');
 const {db,A,B,BUDGET,CLOSE,signIn}=await fixture(),owner='00000000-0000-0000-0000-000000000001';
 const call=async(name,args)=>{const vp=name==='atlas_save_reforecast_scenario'&&args[4]==='vp_approve';if(vp)await signIn(5);try{return (await db.query(`select to_jsonb(public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})) result`,args)).rows[0].result}finally{if(vp)await signIn(1)}};
 await db.exec('reset role');
 await db.exec(migration('20260924121641_planning_cell_workbook_integrity_governance.sql'));
 // Install the exact immutable audit storage/resolution functions; the remainder
 // of this migration concerns financial close ingestion outside this fixture.
 await db.exec(migration('20260924121647_immutable_workbook_audits_and_monthly_governance.sql').split('alter function atlas_private.finance_intake_validation')[0]);
 for(const file of ['20260924165534_reforecast_builder_governance.sql','20260924165542_reforecast_report_receipts.sql','20260924232842_reforecast_governed_close_scope.sql','20260924232853_reforecast_str_overlay_isolation.sql','20260924235553_reforecast_active_import_close_scope.sql','20260925012933_reforecast_atomic_create_from_import.sql','20260925020220_reforecast_import_source_relationships.sql','20260925020222_reforecast_saved_json_str_programme.sql','20260925020226_reforecast_import_source_occurrence_index.sql','20260925071533_reforecast_request_identity_consistency.sql','20260925162050_budget_governed_draft_investor_lifecycle.sql'])await db.exec(migration(file));

 await db.exec("create function atlas_private.budget_calendar(cid uuid) returns jsonb language sql as $$select '{\"verified\":true,\"basis\":\"calendar\",\"startMonth\":1}'::jsonb$$");
 await db.exec(migration('20260928141143_reviewed_noncash_forecast_presentation.sql'));
 await db.exec(migration('20260928142628_indexed_import_validation_evidence.sql'));
 const memoryMigration=migration('20260928144620_bounded_reforecast_validation_memory.sql');
 await db.exec(memoryMigration);
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
 mapping.retainedReviewNote='x'.repeat(1_100_000);
 const scenario=randomUUID(),request=randomUUID(),args=[A,scenario,0,request,upload.upload_id,mapping,payload];
 const create=(overrides={})=>call('atlas_create_reforecast_from_import',[overrides.communityId??A,overrides.scenarioId??scenario,overrides.expectedRevision??0,overrides.requestId??randomUUID(),overrides.uploadId??upload.upload_id,overrides.mapping??mapping,overrides.payload??payload]);
 assert.equal(await call('atlas_read_reforecast_import_receipt',[A,request]),null);
 let result=await call('atlas_create_reforecast_from_import',args);
 assert.equal(result.head.revision,1);assert.equal(result.head.status,'working_draft');assert.equal(result.receipt.verified,true);
 assert.equal(result.receipt.reconciliation.importedTotal,2268.751234);assert.equal(result.receipt.reconciliation.readbackTotal,2268.751234);assert.equal(result.receipt.reconciliation.zeroCellCount,1);assert.equal(result.receipt.reconciliation.blankExcludedCount,1);
 assert.equal(result.receipt.importedCells.length,5);assert.equal(result.receipt.excludedRows.length,3);
 assert.equal(result.snapshot.completeness.blockerCount,0,JSON.stringify(result.snapshot.diagnostics));
 for(const l of selected){const cell=result.receipt.importedCells.find(c=>c.sourceLineId===l.id);assert.equal(cell.amount,l.amount);assert.equal(cell.sourceCoordinates.address,l.address);assert.equal(cell.sourceAccountCode,l.accountCode);assert.equal(cell.mappingVersion,registry.version_id);assert.equal(result.snapshot.lines.find(c=>c.period===l.period&&c.accountCode===l.accountCode).forecast,l.amount);}
 const blank=result.receipt.excludedRows.find(c=>c.sourceLineId==='Plan!C5');assert.equal(blank.sourceAmount,null);assert.equal(blank.amount,null);assert.equal(blank.isBlank,true);

 const {projectImportUpdatePayload}=await import('../docs/portfolio-operations-dashboard/features/reforecast-store.mjs');
 const manual=[['6200',null,50],['8100',0,20],['5220',-1.005,-100]].map(([accountCode,amount,before])=>({period:'2026-02',accountCode,amount,before,after:amount,confirmed:true,ownerId:owner,effectivePeriod:'2026-02',reason:'Retain independent manual edit outside selected source cells',reviewedAt,source:{kind:'manual_revision'}}));
 const edited={...structuredClone(result.revision.payload),overrides:[...result.revision.payload.overrides,...manual]};
 result=await call('atlas_save_reforecast_scenario',[A,scenario,result.head.revision,randomUUID(),'save_draft',edited]);
 const oldReceipt=await call('atlas_read_reforecast_import_receipt',[A,request]),priorRevision=structuredClone(result.revision);
 const nextAccounts=accounts.map(a=>({...a,nonCash:false})),registry2=await call('atlas_save_reforecast_registry',[A,registry.version_id,randomUUID(),{accounts:nextAccounts,driverMappings:{},reason:'Explicit next reviewed classification',effectiveDate:'2026-01-01',nonCashClassificationVersion:1}]);
 const mapping2={...structuredClone(mapping),version:registry2.version_id,reason:'Explicit current registry remap preserving exact source values'};
 const update={...structuredClone(result.revision.payload),registryVersionId:registry2.version_id},failedId=randomUUID();
 const requestBytes=async payload=>(await db.query('select octet_length($1::jsonb::text)+octet_length($2::jsonb::text) bytes',[payload,mapping2])).rows[0].bytes;
 const beforeBytes=await requestBytes(update);assert(beforeBytes>2097152);
 await assert.rejects(()=>create({expectedRevision:result.head.revision,requestId:failedId,mapping:mapping2,payload:update}),/oversized atomic import/);
 assert.equal(await call('atlas_read_reforecast_import_receipt',[A,failedId]),null);
 const expectedLines=oldReceipt.receipt.importedCells,projected=projectImportUpdatePayload(update,{uploadId:upload.upload_id,mapping:mapping2,expectedLines}),afterBytes=await requestBytes(projected);assert(afterBytes<2097152);assert.deepEqual(projected.overrides,manual);
 const newId=randomUUID(),updateArgs=[A,scenario,result.head.revision,newId,upload.upload_id,mapping2,projected];
 const updated=await call('atlas_create_reforecast_from_import',updateArgs);
 for(const cell of expectedLines){assert.equal(updated.snapshot.lines.find(l=>l.accountCode===cell.accountCode&&l.period===cell.period).forecast,cell.amount);assert.equal(updated.revision.payload.overrides.find(l=>l.accountCode===cell.accountCode&&l.period===cell.period).sourceLineId,cell.sourceLineId);}
 for(const cell of manual)assert.deepEqual(updated.revision.payload.overrides.find(l=>l.accountCode===cell.accountCode&&l.period===cell.period),cell);
 assert.equal(updated.snapshot.lines.find(l=>l.accountCode==='6200'&&l.period==='2026-02').forecast,null);
 assert.equal(updated.snapshot.lines.find(l=>l.accountCode==='8100'&&l.period==='2026-02').forecast,0);
 assert.equal(updated.revision.payload.importMapping.version,registry2.version_id);
 assert.deepEqual((await call('atlas_read_reforecast_import_receipt',[A,request])).receipt,oldReceipt.receipt);
 assert.deepEqual((await db.query('select payload from atlas_reforecast_revisions where revision_id=$1',[priorRevision.revision_id])).rows[0].payload,priorRevision.payload);
 assert.equal((await call('atlas_create_reforecast_from_import',updateArgs)).revision.revision_id,updated.revision.revision_id);
 await assert.rejects(()=>call('atlas_create_reforecast_from_import',[...updateArgs.slice(0,6),update]),/oversized|request ID reused/);
 await assert.rejects(()=>call('atlas_create_reforecast_from_import',[A,scenario,priorRevision.revision,randomUUID(),upload.upload_id,mapping2,projected]),/another session/);
 await signIn(2);assert.equal((await call('atlas_read_reforecast_import_receipt',[A,newId])).revision.revision_id,updated.revision.revision_id);
 await signIn(4);await assert.rejects(()=>call('atlas_create_reforecast_from_import',updateArgs),/access denied/);
 await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from atlas_reforecast_publications')).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from atlas_reforecast_import_receipts')).rows[0].n,2);
 await db.close();console.log(JSON.stringify({status:'PASS',beforeBytes,afterBytes,selectedCells:expectedLines.length,zeroCells:updated.receipt.reconciliation.zeroCellCount,blankCells:updated.receipt.reconciliation.blankExcludedCount,preservedOutsideOverrides:manual.length,checks:'current migration chain; oversized old request rejected; absent receipt; new compact identity; exact source cells; null/zero/signed manual values; immutable history; retry/stale/authorization; no publication'}));
})().catch(error=>{console.error(error.message);process.exitCode=1});
