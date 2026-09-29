// Public RPC parity across reviewed workbook source and governed budget drivers.
// This fixture intentionally installs the combined production migration order.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto'),{fixture}=require('./reforecast-fixture.cjs');
const root=path.join(__dirname,'..'),migration=name=>fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8');
(async()=>{
 const {parseReforecastWorkbook}=await import('../docs/portfolio-operations-dashboard/features/reforecast-intake.mjs');
 const {planningMappingDispositions}=await import('../docs/portfolio-operations-dashboard/features/planning-governance.mjs');
 const {prepareScopedReforecastEvidence}=await import('../docs/portfolio-operations-dashboard/features/reforecast-authority.mjs');
 const XLSX=require('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js');
 const {db,A,B,BUDGET,CLOSE,signIn}=await fixture(),owner='00000000-0000-0000-0000-000000000001';
 const call=async(name,args)=>{const vp=name==='atlas_save_reforecast_scenario'&&args[4]==='vp_approve';if(vp)await signIn(5);try{return (await db.query(`select to_jsonb(public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})) result`,args)).rows[0].result}finally{if(vp)await signIn(1)}};
 await db.exec('reset role');
 await db.exec("alter table atlas_approved_budget_versions add column content_hash text,add column fiscal_year integer,add column fiscal_start_month integer,add column scenario_version text;alter table atlas_communities add column version integer default 1,add column budget_calendar jsonb;");
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
 const relationshipOriginalDefinition=(await db.query("select pg_get_functiondef('atlas_private.validate_reforecast_source_relationships(jsonb,jsonb,jsonb)'::regprocedure) d")).rows[0].d;
 const coreDefinition=(await db.query("select pg_get_functiondef('atlas_private.calculate_reforecast_before_saved_str(jsonb,jsonb)'::regprocedure) d")).rows[0].d;
 const changedCore=coreDefinition.replace("   state:=jsonb_set(state,array[p||'|'||code],line,true);","   state :=jsonb_set(state,array[p||'|'||code],line,true);");
 assert.notEqual(changedCore,coreDefinition);await db.exec(changedCore);await db.exec('begin');await assert.rejects(()=>db.exec(migration('20260928210158_verified_workbook_blank_forecast_semantics.sql')),/prerequisite differs/i);await db.exec('rollback');assert.equal((await db.query("select to_regprocedure('atlas_private.reforecast_workbook_policy(jsonb)') p")).rows[0].p,null);await db.exec(coreDefinition);
 await db.exec(migration('20260928210158_verified_workbook_blank_forecast_semantics.sql'));
 await db.exec(migration('20260928150652_governed_reforecast_save_timeout.sql'));
 await db.exec(migration('20260928213333_investor_approval_source_validation.sql'));
 const approvedMetricMappings={revenue:[{glCode:'5120',factor:1},{glCode:'5220',factor:1}],expenses:[{glCode:'6100',factor:1},{glCode:'6200',factor:1}],capital:[{glCode:'8100',factor:1}]};
 await db.query("update atlas_approved_budget_versions set payload=payload||jsonb_build_object('metricMappings',$1::jsonb,'mappingVersion','approved-fixture-v1') where version_id=$2",[approvedMetricMappings,BUDGET]);
 await signIn(1);
 const initialSource=await call('atlas_read_reforecast_builder_source',[A,['2026-02'],[BUDGET],null,'original_budget',null]);
 assert.equal(initialSource.registry.version,null);assert.equal(initialSource.baseline.approvedMetricMappings[0].versionId,BUDGET);assert.deepEqual(initialSource.baseline.approvedMetricMappings[0].metricMappings,approvedMetricMappings);
 assert.equal((await db.query('select count(*)::int n from atlas_reforecast_registries')).rows[0].n,0,'published metric evidence never creates a registry implicitly');
 const accounts=[['5120','Rent','income'],['5220','Vacancy','contra_income'],['6100','Payroll','expense'],['6200','Noncash','below_noi'],['8100','Capital','capital']].map(([accountCode,category,nature])=>({accountCode,category,nature,placement:['capital','below_noi'].includes(nature)?'below_noi':'above_noi',nonCash:nature==='below_noi',effectiveFrom:'2026-01'}));
 const registry=await call('atlas_save_reforecast_registry',[A,null,randomUUID(),{accounts,nonCashClassificationVersion:1,driverMappings:{},reason:'Reviewed exact import registry',effectiveDate:'2026-01-01'}]);
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Scenario','Plan','Currency','Local'],['GL','Account','Apr 2026','May 2026'],['5120','Rent',1001.005,1002.5],['5220','Vacancy',0,-1.005],['6100','Payroll',null,null],['6200','Noncash',null,null]]),'Plan');
 const bytes=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});let evidence=await parseReforecastWorkbook(bytes,{xlsx:XLSX,fileName:'Blank-source.xlsx',includeOriginalBytes:true});
 const periods=['2026-04','2026-05'],reviewedAt='2026-09-28T00:00:00Z',assignment={communityId:A,confirmed:true,sourceEntities:[],actorId:owner,reason:'Reviewed community'};
 const policy={schemaVersion:1,mode:'workbook_exact',blankDisposition:'preserve_null',confirmed:true,reviewedBy:owner,reviewedAt,reason:'Preserve source blanks and exact numeric values'};
 const mapping={confirmed:true,version:registry.version_id,propertyAssignment:assignment,sourceScenario:'Plan',currency:'USD',periods,selectedLineIds:evidence.lines.map(l=>l.id),accountMappings:accounts.map(a=>({...a,sourceAccountCode:a.accountCode,sheet:'Plan',department:null,signMultiplier:1,allowReversal:false})),reason:'Import exact reviewed forecast values',reviewedBy:owner,reviewedAt,workbookSourcePolicy:policy,calendar:{basis:'calendar',startMonth:1,confirmed:true,periods,scenario:'Plan',reviewedBy:owner,reviewedAt},integrityReviews:[]};
 evidence=(await prepareScopedReforecastEvidence(evidence,mapping,{xlsx:XLSX,sourceBytes:bytes})).evidence;
 const audit=await call('atlas_save_workbook_audit',[A,evidence.source.sha256,evidence.integrity,randomUUID()]);
 mapping.inputReviews=evidence.lines.filter(l=>l.amount!==null).map(l=>({cellId:l.id,confirmed:true,ownerId:owner,effectivePeriod:l.period,before:l.amount,after:l.amount,reason:'Reviewed input value',reviewedAt,integrityFingerprint:audit.fingerprint}));Object.assign(mapping,planningMappingDispositions(evidence,mapping));
 // A reviewed cell blank is separate from its source row's legacy disposition.
 mapping.rowDispositions=mapping.rowDispositions.map(row=>row.row>=5?{...row,disposition:'subtotal_control'}:row);
 mapping.currencyMapping={sourceCurrency:'Local',reportingCurrency:'USD',method:'identity',confirmed:true,reviewedBy:owner,reviewedAt,reason:'Reviewed Local as USD'};
 const upload=await call('atlas_save_reforecast_upload',[A,randomUUID(),{...evidence,integrity:{auditId:audit.audit_id,fingerprint:audit.fingerprint},propertyAssignment:assignment}]);
 const payload={name:'Reviewed workbook blanks',model:'conventional',scenarioPurpose:'conventional',governanceSchemaVersion:2,calendar:{...mapping.calendar,scenario:'Reviewed workbook blanks'},periods,baselineType:'original_budget',baselineVersionIds:[BUDGET],registryVersionId:registry.version_id,ownerId:owner,reviewerId:owner,drivers:[],overrides:[],reason:'Review exact workbook blank semantics'};
 const scenario=randomUUID(),request=randomUUID();
 const addClose=async(period,capital)=>{await db.exec('reset role');const id=randomUUID();await db.query('insert into atlas_financial_close_versions select $1,community_id,$2,$3,approved_at,metrics from atlas_financial_close_versions where version_id=$4',[id,period,'close-'+period,CLOSE]);await db.query("insert into atlas_financial_close_heads values($1,$2,'accrual',$3)",[A,period,id]);await db.query("insert into atlas_financial_close_rows select $1,gl_code,case when gl_code='8100' then $2::numeric else actual end,source_location from atlas_financial_close_rows where version_id=$3",[id,capital,CLOSE]);await signIn(1);};
 await addClose('2026-02',0);await addClose('2026-03',-30);
 let original=await call('atlas_create_reforecast_from_import',[A,scenario,0,request,upload.upload_id,mapping,payload]);
 assert.equal(original.snapshot.workbookCoverage.sourceAbsentCellCount,2);
 const originalJson=JSON.stringify(original.revision),receiptJson=JSON.stringify(original.receipt);
 await db.exec('reset role');
 for(const file of ['20260929145818_reviewed_forecast_blank_policy.sql','20260925174317_shared_str_programme_draft_versions.sql','20260929154018_budget_export_integrity_history.sql','20260929154033_budget_leasing_driver_authority.sql','20260929154111_verified_str_budget_application.sql','20260929162311_saved_str_v2_approval_authority.sql'])await db.exec(migration(file));
 await db.query('update atlas_communities set budget_calendar=$1',[{verified:true,classification:'Multifamily',startMonth:1,source:'Test reviewed calendar'}]);await signIn(1);
 const {projectImportUpdatePayload}=await import('../docs/portfolio-operations-dashboard/features/reforecast-store.mjs');
 const reviewed=structuredClone(mapping);reviewed.workbookSourcePolicy.reviewedForecastBlanks=periods.map(period=>({period,accountCode:'8100',confirmed:true,reviewedBy:owner,reviewedAt,reason:'Forecast intentionally blank until reviewed user input'}));
 const compact=projectImportUpdatePayload(original.revision.payload,{uploadId:upload.upload_id,mapping:reviewed,expectedLines:original.receipt.importedCells});
 let result=await call('atlas_create_reforecast_from_import',[A,scenario,original.head.revision,randomUUID(),upload.upload_id,reviewed,compact]);
 assert.equal(result.snapshot.workbookCoverage.reviewedForecastBlankCellCount,2);
 const {buildStrProgrammeReport}=await import('../docs/portfolio-operations-dashboard/features/saved-str-programmes.mjs');
 const sourcePropertyId='source-property',sourceProgrammeId='source-programme',strConfig={propertyId:sourcePropertyId,programmeId:sourceProgrammeId,name:'STR source parity',adr:125},property={id:sourcePropertyId,name:'Community',units:[]},years=[2026];
 const lines=[{id:'rent',gl:'5120',nature:'income',name:'STR rent',propertyId:sourcePropertyId,strProgramId:sourceProgrammeId,yearData:{2026:Array(12).fill(101.005)}}];
 const programme=await call('atlas_save_str_programme_draft',[A,randomUUID(),0,randomUUID(),{schemaVersion:'atlas.str-programme-draft.v1',name:strConfig.name,sourcePropertyId,sourceProgrammeId,config:strConfig,property,groups:[],programme:{id:sourceProgrammeId,propertyId:sourcePropertyId,name:strConfig.name,applied:false,config:strConfig},lines,years,reportBasisConfig:strConfig,sourceContext:{property,lines:[],libraries:{}},targetBudget:null,reason:'Reviewed source programme',reportSnapshot:buildStrProgrammeReport({name:strConfig.name,communityName:'Community',years,lines,config:strConfig})}]);
 const requestFor=r=>({communityId:A,requestId:randomUUID(),scenarioId:r.head.scenario_id,programmeRevisionId:programme.revision.revision_id,targetRevisionId:r.revision.revision_id,destination:'existing_draft',name:'Reviewed source parity target',reason:'Reviewed source parity',reviewedAt:'2026-09-29T12:00:00Z',mappings:[{sourceLineId:'rent',sourceGL:'5120',accountCode:'5120',parentAbsent:false,confirmed:true,reason:'Reviewed STR rent mapping'}]});
 const preview=r=>call('atlas_preview_str_budget_application',[requestFor(r)]);
 const readSource=async r=>{await db.exec('reset role');try{return (await db.query('select atlas_private.reforecast_source_for_config($1,$2) s',[A,r.revision.payload])).rows[0].s;}finally{await signIn(1);}};
 const mismatched=await readSource(result);assert(!('driverToleranceSettings' in result.source));assert.notEqual(mismatched.sourceVersion,result.source.sourceVersion);
 await assert.rejects(()=>preview(result),/destination source data changed/,'Reproduce actual combined public RPC failure before upgrade');
 const oldResult=structuredClone(result),oldRows=(await db.query('select jsonb_agg(to_jsonb(r) order by revision_id) rows from atlas_reforecast_revisions r')).rows[0].rows;
 const signatures=['atlas_private.reforecast_source_for_config(uuid,jsonb)','atlas_private.reviewed_forecast_save_source(uuid,jsonb,jsonb)','atlas_private.preview_str_budget_application(jsonb)','public.atlas_save_reforecast_scenario(uuid,uuid,integer,uuid,text,jsonb)','public.atlas_preview_str_budget_application(jsonb)','public.atlas_apply_str_budget_programme(jsonb,text)'];
 const functionEvidence=async()=>(await db.query("select oid::regprocedure::text signature,encode(sha256(convert_to(prosrc,'UTF8')),'hex') body_sha256,encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') definition_sha256,pg_get_functiondef(oid) full_definition,prosecdef,provolatile,proconfig,proacl::text from pg_proc where oid=any($1::regprocedure[]) order by 1",[signatures])).rows;
 await db.exec('reset role');const beforeFunctions=await functionEvidence();assert.equal(beforeFunctions.length,signatures.length,'Every public/private signature resolves');
 await db.exec('create role service_role;alter default privileges in schema atlas_private grant execute on functions to service_role');
 const upgrade=migration('20260929162702_reviewed_budget_source_envelope.sql');
 const originalSourceDefinition=(await db.query("select pg_get_functiondef('atlas_private.reviewed_forecast_save_source(uuid,jsonb,jsonb)'::regprocedure) d")).rows[0].d;
 await db.exec(originalSourceDefinition.replace(' return source;',' return  source;'));
 await assert.rejects(()=>db.exec(upgrade),/prerequisite differs/);await db.exec('rollback');
 assert.equal((await db.query("select to_regprocedure('atlas_private.budget_source_tolerance_envelope(uuid,jsonb)') f")).rows[0].f,null,'Drift rejection rolls back entire migration');await db.exec(originalSourceDefinition);
 await db.exec(upgrade);const afterFunctions=await functionEvidence();
 const metadata=rows=>rows.map(({body_sha256,definition_sha256,full_definition,...rest})=>rest);assert.deepEqual(metadata(afterFunctions),metadata(beforeFunctions),'Existing ACL/security/settings preserved');
 for(const f of afterFunctions.filter(f=>!f.signature.startsWith('atlas_private.')))assert.deepEqual(f,beforeFunctions.find(b=>b.signature===f.signature),'Public RPC definitions unchanged');
 assert.deepEqual((await db.query('select jsonb_agg(to_jsonb(r) order by revision_id) rows from atlas_reforecast_revisions r')).rows[0].rows,oldRows,'Upgrade never rewrites financial history');
 const helperSecurity=(await db.query("select prosecdef,provolatile,proconfig,has_function_privilege('anon',oid,'execute') anon_execute,has_function_privilege('authenticated',oid,'execute') authenticated_execute,has_function_privilege('service_role',oid,'execute') service_role_execute,exists(select 1 from aclexplode(proacl) a where grantee=0 and privilege_type='EXECUTE') public_execute from pg_proc where oid='atlas_private.budget_source_tolerance_envelope(uuid,jsonb)'::regprocedure")).rows[0];
 assert.equal((await db.query("select to_regprocedure('atlas_private.budget_source_required_rewrite(text,text,text)') helper")).rows[0].helper,null);
 assert.equal(helperSecurity.prosecdef,false);assert.equal(helperSecurity.provolatile,'s');assert.deepEqual(helperSecurity.proconfig,['search_path=""']);assert.equal(helperSecurity.anon_execute,false);assert.equal(helperSecurity.authenticated_execute,false);assert.equal(helperSecurity.service_role_execute,false);assert.equal(helperSecurity.public_execute,false);
 await signIn(1);
 await assert.rejects(()=>preview(oldResult),/destination source data changed/,'Legacy target requires explicit new save; historical source is never upgraded silently');
 const save=(r,c=r.revision.payload,action='save_draft')=>call('atlas_save_reforecast_scenario',[A,r.head.scenario_id,r.head.revision,randomUUID(),action,c]);
 result=await save(result);assert.deepEqual(await readSource(result),result.source,'Fresh reviewed save has exactly the governed current read envelope');
 // The separate shared-STR/workbook compatibility regression owns nonzero
 // overlays on imported rows; this test isolates governed source identity.
 let plain=await call('atlas_save_reforecast_scenario',[A,randomUUID(),0,randomUUID(),'save_draft',payload]);
 assert.deepEqual(await readSource(plain),plain.source);
 const pre=await preview(plain);assert.equal(pre.verified,true);assert.equal(pre.cells.find(c=>c.period===periods[0]).combinedAmount,1101.01);
 assert.equal(result.source.driverToleranceSettings.default.dollar,100);assert.equal(result.source.driverToleranceVersion,null);
 const checkedVersion=result.source.sourceVersion;result=await save(result);assert.equal(result.source.sourceVersion,checkedVersion,'Same-input save is stable');
 // Accepted governed recommendations retain their exact history binding without
 // changing canonical source identity on a repeated ready/save action.
 const {computeReforecast,recommendReforecast,applyRecommendations}=await import('../docs/portfolio-operations-dashboard/features/reforecast-engine.mjs');
 const computed=computeReforecast({...result.source,scenario:{...result.revision.payload,versionId:result.revision.revision_id,driverVersion:'parity-fixture'}});
 const recommended=recommendReforecast({snapshot:computed}).find(r=>r.driver.type==='historical_weighted_amount'&&r.accountCodes.includes('8100'));assert(recommended);
 const accepted=applyRecommendations(result.revision.payload,[recommended],{ids:[recommended.id],actor:owner,timestamp:reviewedAt,versionId:'accepted-source',driverVersion:'accepted-driver',edits:{[recommended.id]:55},reason:'Accept governed historical estimate'});
 result=await save(result,accepted);const acceptedHash=result.source.sourceVersion;result=await save(result);assert.equal(result.source.sourceVersion,acceptedHash);assert.equal(result.source.retainedReviewedForecastRecommendationBindings.length,1);
 assert.equal((await readSource(result)).sourceVersion,result.source.sourceVersion,'Retained recommendation authorization stays outside canonical fingerprint');
 await preview(plain);
 const forged=structuredClone(result.revision.payload);forged.drivers[0].evidence.observations[0].actual=999;
 await assert.rejects(()=>save(result,forged),/recommendation/i,'Source envelope does not weaken recommendation authority');
 // Administrator changes must invalidate current previews, while existing
 // revisions continue to retain their original tolerance rules and source hash.
 const historic=result;const changedRules={default:{dollar:250,percent:10,operator:'and'},accounts:{'5120':{dollar:5,percent:null,operator:'or'}},categories:{}};
 await call('atlas_save_budget_export_tolerances',[A,0,randomUUID(),changedRules,'Reviewed administrator thresholds']);
 await assert.rejects(()=>preview(plain),/destination source data changed/);assert.equal(historic.source.driverToleranceSettings.default.dollar,100);
 result=await save(result);assert.deepEqual(result.source.driverToleranceSettings,changedRules);assert(result.source.driverToleranceVersion);assert.notEqual(result.source.sourceVersion,historic.source.sourceVersion);plain=await save(plain);await preview(plain);
 await signIn(2);await assert.rejects(()=>call('atlas_save_budget_export_tolerances',[A,1,randomUUID(),changedRules,'Unprivileged threshold attempt']),/admin|denied/i);await signIn(1);
 // Move a workbook month into governed actuals. An explicit reconciliation save
 // retains its unchanged imported overrides as inert, and preview uses the same
 // validated closed-input path. Changed closed inputs still fail.
 await addClose(periods[0],123);await assert.rejects(()=>preview(result),/source data changed/);
 result=await save(result);assert(result.source.retainedClosedWorkbookCells.length>0);assert(result.source.retainedReviewedForecastRecommendationBindings.length>0);
 assert.equal(result.snapshot.lines.find(l=>l.period===periods[0]&&l.accountCode==='8100').actual,123);assert.equal(result.snapshot.lines.find(l=>l.period===periods[0]&&l.accountCode==='8100').immutable,true);
 const afterCloseHash=result.source.sourceVersion;result=await save(result);assert.equal(result.source.sourceVersion,afterCloseHash);
 plain=await save(plain);const requestAfterClose=requestFor(plain),afterClose=await call('atlas_preview_str_budget_application',[requestAfterClose]);assert.deepEqual(afterClose.excludedClosedPeriods,[periods[0]]);assert(afterClose.cells.every(c=>c.period===periods[1]));
 const badClosed=structuredClone(result.revision.payload);badClosed.overrides.find(o=>o.period===periods[0]&&o.accountCode==='5120').amount=999;
 await assert.rejects(()=>save(result,badClosed),/Locked month inputs/);
 const applied=await call('atlas_apply_str_budget_programme',[requestAfterClose,afterClose.previewHash]);assert.equal(applied.snapshot.lines.find(l=>l.period===periods[1]&&l.accountCode==='5120').forecast,1101.01);assert.deepEqual(await call('atlas_apply_str_budget_programme',[requestAfterClose,afterClose.previewHash]),applied,'Exact confirmed application retries remain idempotent');
 assert.equal(JSON.stringify((await call('atlas_read_reforecast_import_receipt',[A,request])).revision),originalJson);
 const replay=await call('atlas_read_reforecast_import_receipt',[A,request]);assert.equal(JSON.stringify(replay.receipt),receiptJson);
 const spoof=structuredClone(applied.revision.payload);spoof.driverToleranceSettings={default:{dollar:999999,percent:null,operator:'or'}};spoof.driverToleranceVersion=randomUUID();
 const authoritative=await save(applied,spoof);assert.deepEqual(authoritative.source.driverToleranceSettings,changedRules);assert.equal(authoritative.source.driverToleranceVersion,result.source.driverToleranceVersion);
 await db.exec('reset role');assert.deepEqual((await db.query('select to_jsonb(r) v from atlas_reforecast_revisions r where revision_id=$1',[oldResult.revision.revision_id])).rows[0].v,oldResult.revision);
 await signIn(4);await assert.rejects(()=>preview(applied),/denied/);await db.exec('reset role');await db.exec('set role anon');await assert.rejects(()=>preview(applied),/permission denied/);
 if(process.env.ATLAS_SOURCE_ENVELOPE_PROOF){await db.exec('reset role');fs.writeFileSync(process.env.ATLAS_SOURCE_ENVELOPE_PROOF,JSON.stringify({beforeFunctions,afterFunctions,helperSecurity,helperFunction:(await db.query("select pg_get_functiondef(oid) full_definition,encode(sha256(convert_to(prosrc,'UTF8')),'hex') body_sha256,encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') definition_sha256,proacl::text from pg_proc where oid='atlas_private.budget_source_tolerance_envelope(uuid,jsonb)'::regprocedure")).rows[0],migrationSha256:require('node:crypto').createHash('sha256').update(upgrade).digest('hex'),checks:['pre-upgrade reproduction','history unchanged','stable same-input save/read/preview','retained recommendation bindings','administrator threshold invalidation','retained closed cells','forged driver and locked edit rejection','public preview/apply exact retry','scope/ACL']},null,2)+'\n');}
 await db.close();
 console.log('PASS combined reviewed workbook/source envelope: reproduced old failure; stable read/save/STR preview and apply; administrator tolerance invalidation; closed-cell/recommendation authority; historical receipts; scoped ACLs and migration drift rollback.');
})().catch(error=>{console.error(error.message,error.where||'',error.stack);process.exitCode=1;});
