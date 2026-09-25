const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto'),{fixture}=require('./reforecast-fixture.cjs');
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
 for(const file of ['20260924165534_reforecast_builder_governance.sql','20260924165542_reforecast_report_receipts.sql','20260924232842_reforecast_governed_close_scope.sql','20260924232853_reforecast_str_overlay_isolation.sql','20260924235553_reforecast_active_import_close_scope.sql','20260925004921_reforecast_atomic_create_from_import.sql'])await db.exec(migration(file));
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
 const audit=await call('atlas_save_workbook_audit',[A,evidence.source.sha256,evidence.integrity,randomUUID()]);
 const assignment={communityId:A,confirmed:true,sourceEntities:[],actorId:owner,reason:'Reviewed community'};
 const uploadPayload={...evidence,source:{...evidence.source,originalFile:{encoding:'base64',data:Buffer.from(bytes).toString('base64')}},integrity:{auditId:audit.audit_id,fingerprint:audit.fingerprint},propertyAssignment:assignment};
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
 assert.equal(await call('atlas_read_reforecast_import_receipt',[A,request]),null);
 let result=await call('atlas_create_reforecast_from_import',args);
 assert.equal(result.head.revision,1);assert.equal(result.head.status,'working_draft');assert.equal(result.receipt.verified,true);
 assert.equal(result.receipt.reconciliation.importedTotal,2268.751234);assert.equal(result.receipt.reconciliation.readbackTotal,2268.751234);assert.equal(result.receipt.reconciliation.zeroCellCount,1);assert.equal(result.receipt.reconciliation.blankExcludedCount,1);
 assert.equal(result.receipt.importedCells.length,5);assert.equal(result.receipt.excludedRows.length,3);
 assert.equal(result.snapshot.completeness.blockerCount,0,JSON.stringify(result.snapshot.diagnostics));
 for(const l of selected){const cell=result.receipt.importedCells.find(c=>c.sourceLineId===l.id);assert.equal(cell.amount,l.amount);assert.equal(cell.sourceCoordinates.address,l.address);assert.equal(cell.sourceAccountCode,l.accountCode);assert.equal(cell.mappingVersion,registry.version_id);assert.equal(result.snapshot.lines.find(c=>c.period===l.period&&c.accountCode===l.accountCode).forecast,l.amount);}
 const blank=result.receipt.excludedRows.find(c=>c.sourceLineId==='Plan!C5');assert.equal(blank.sourceAmount,null);assert.equal(blank.amount,null);assert.equal(blank.isBlank,true);
 const receipt=await call('atlas_read_reforecast_import_receipt',[A,request]);assert.deepEqual(receipt,result);
 // Simulate a lost response: repeat the exact request after server commit.
 assert.deepEqual(await call('atlas_create_reforecast_from_import',args),result);
 assert.equal((await db.query('select count(*)::int n from atlas_reforecast_revisions where scenario_id=$1',[scenario])).rows[0].n,1);
 assert.equal((await db.query('select count(*)::int n from atlas_reforecast_import_receipts where request_id=$1',[request])).rows[0].n,1);
 await assert.rejects(()=>create({requestId:request,payload:{...payload,name:'Changed retry'}}),/request ID reused/);
 await assert.rejects(()=>create(),/another session/);
 await assert.rejects(()=>create({communityId:B,scenarioId:randomUUID()}),/community mismatch/);
 await assert.rejects(()=>create({scenarioId:randomUUID(),mapping:{...mapping,version:randomUUID()}}),/mapping version changed/i);
 await assert.rejects(()=>create({scenarioId:randomUUID(),mapping:{...mapping,selectedLineIds:[...mapping.selectedLineIds,'Plan!C5']}}),/blank is not zero/);
 await assert.rejects(()=>create({scenarioId:randomUUID(),mapping:{...mapping,selectedLineIds:[...mapping.selectedLineIds,'Plan!C6']}}),/same GL\/month/);
 await assert.rejects(()=>create({scenarioId:randomUUID(),mapping:{...mapping,selectedLineIds:[...mapping.selectedLineIds,mapping.selectedLineIds[0]]}}),/must be unique/);
 await assert.rejects(()=>create({scenarioId:randomUUID(),mapping:{...mapping,accountMappings:mapping.accountMappings.map(m=>({...m,signMultiplier:null}))}}),/one reviewed GL mapping/);
 await assert.rejects(()=>create({scenarioId:randomUUID(),mapping:{...mapping,accountMappings:null}}),/exact GL mappings/);
 await assert.rejects(()=>create({scenarioId:randomUUID(),mapping:{...mapping,reviewedBy:'00000000-0000-0000-0000-000000000002'}}),/exact GL mappings/);
 await assert.rejects(()=>create({scenarioId:randomUUID(),mapping:{...mapping,periods:['2026-02','2026-02']}}),/distinct complete reporting/);
 await assert.rejects(()=>create({scenarioId:randomUUID(),mapping:{...mapping,currencyMapping:null}}),/mapping validation failed/);
 await assert.rejects(()=>create({scenarioId:randomUUID(),mapping:{...mapping,currencyMapping:{...mapping.currencyMapping,confirmed:false}}}),/mapping validation failed/);
 await assert.rejects(()=>create({scenarioId:randomUUID(),mapping:{...mapping,currencyMapping:{...mapping.currencyMapping,method:'exchange'}}}),/mapping validation failed/);
 const forged=structuredClone(uploadPayload);forged.lines.find(l=>l.id==='Plan!C3').amount+=17;
 const forgedUpload=await call('atlas_save_reforecast_upload',[A,randomUUID(),forged]);
 await assert.rejects(()=>create({scenarioId:randomUUID(),uploadId:forgedUpload.upload_id}),/immutable workbook evidence/);
 await assert.rejects(()=>create({scenarioId:randomUUID(),payload:{...payload,baselineVersionIds:[]}}),/approved original budget/);
 await assert.rejects(()=>create({scenarioId:randomUUID(),payload:{...payload,scenarioPurpose:'str_overlay'}}),/derive RISE STR/);
 await assert.rejects(()=>create({scenarioId:randomUUID(),mapping:{...mapping,periods:['2026-01']},payload:{...payload,periods:['2026-01']}}),/eligible open months/);
 // A second authorized session reads the exact immutable import and continues editing.
 await signIn(2);assert.deepEqual(await call('atlas_read_reforecast_import_receipt',[A,request]),result);
 const edit=structuredClone(result.revision.payload),rent=edit.overrides.find(c=>c.accountCode==='5120'&&c.period==='2026-02');
 delete rent.sourceLineId;delete rent.uploadId;rent.amount=1010;rent.after=1010;rent.before=1001.25;rent.ownerId='00000000-0000-0000-0000-000000000002';rent.reason='Continued authorized working edit';rent.source={kind:'manual',priorImportRequestId:request};
 const saveRequest=randomUUID(),saveArgs=[A,scenario,1,saveRequest,'save_draft',edit];
 result=await call('atlas_save_reforecast_scenario',saveArgs);
 assert.equal(result.head.revision,2);assert.equal(result.snapshot.lines.find(c=>c.period==='2026-02'&&c.accountCode==='5120').forecast,1010);
 const saveReceipt=await call('atlas_read_reforecast_save_receipt',[A,saveRequest]);assert.equal(saveReceipt.revision.revision_id,result.revision.revision_id);
 assert.equal((await call('atlas_save_reforecast_scenario',saveArgs)).revision.revision_id,result.revision.revision_id);
 const historical=await call('atlas_read_reforecast_import_receipt',[A,request]);assert.equal(historical.head.revision,1);assert.equal(historical.currentHead.revision,2);assert.deepEqual(historical.receipt,receipt.receipt);
 await signIn(4);await assert.rejects(()=>call('atlas_read_reforecast_import_receipt',[A,request]),/access denied/);await assert.rejects(()=>call('atlas_read_reforecast_save_receipt',[A,saveRequest]),/access denied/);await assert.rejects(()=>call('atlas_create_reforecast_from_import',args),/access denied/);assert.equal((await db.query('select * from atlas_reforecast_import_receipts')).rows.length,0);
 await signIn(1);
 // Receipt insertion is part of the same transaction: injected late failure
 // leaves neither a head/revision nor a receipt and retains source evidence.
 await db.exec('reset role');await db.exec("create function atlas_private.test_fail_import_receipt() returns trigger language plpgsql as $$begin raise exception 'injected receipt failure';end;$$;create trigger test_fail_receipt before insert on atlas_reforecast_import_receipts for each row execute function atlas_private.test_fail_import_receipt()");await signIn(1);
 const failedRequest=randomUUID();await assert.rejects(()=>create({requestId:failedRequest,expectedRevision:2,payload:result.revision.payload}),/injected receipt failure/);
 assert.equal(await call('atlas_read_reforecast_import_receipt',[A,failedRequest]),null);assert.equal((await db.query('select revision from atlas_reforecast_heads where scenario_id=$1',[scenario])).rows[0].revision,2);
 await db.exec('reset role');await db.exec('drop trigger test_fail_receipt on atlas_reforecast_import_receipts');
 await signIn(1);
 for(const action of ['reconcile','ready','submit'])result=await call('atlas_save_reforecast_scenario',[A,scenario,result.head.revision,randomUUID(),action,result.revision.payload]);
 const approvalRequest=randomUUID();result=await call('atlas_save_reforecast_scenario',[A,scenario,result.head.revision,approvalRequest,'approve_lock',result.revision.payload]);
 const approvalReceipt=await call('atlas_read_reforecast_save_receipt',[A,approvalRequest]);assert.equal(approvalReceipt.publication.publication_id,result.publication.publication_id);assert.equal(approvalReceipt.head.status,'locked');
 // A forecast GL without an original row needs an explicit reviewed accounting
 // disposition. Keep its original cells null and preserve original aggregates.
 const prospectiveAccounts=[...accounts,{accountCode:'6400',category:'Prospective utility',nature:'expense',placement:'above_noi',effectiveFrom:'2026-03'}];
 const prospectiveRegistry=await call('atlas_save_reforecast_registry',[A,registry.version_id,randomUUID(),{accounts:prospectiveAccounts,driverMappings:{},reason:'Review prospective forecast account',effectiveDate:'2026-01-01'}]);
 const prospectiveMapping={...mapping,version:prospectiveRegistry.version_id,periods:['2026-03'],calendar:{...mapping.calendar,periods:['2026-03']},selectedLineIds:['Plan!D5'],accountMappings:mapping.accountMappings.map(m=>m.sourceAccountCode==='6200'?{...m,accountCode:'6400',category:'Prospective utility'}:m)};
 Object.assign(prospectiveMapping,planningMappingDispositions(evidence,prospectiveMapping));
 const prospectivePayload={...payload,name:'Explicit prospective GL',periods:['2026-03'],calendar:{...payload.calendar,periods:['2026-03'],scenario:'Explicit prospective GL'},registryVersionId:prospectiveRegistry.version_id};
 const prospectiveScenario=randomUUID();
 await assert.rejects(()=>create({scenarioId:prospectiveScenario,mapping:prospectiveMapping,payload:prospectivePayload}),/exact approved baseline value/);
 prospectiveMapping.accountMappings.find(m=>m.accountCode==='6400').baselineDisposition={kind:'no_original_budget_row',confirmed:true,reviewedBy:owner,reviewedAt,reason:'Reviewed new forecast GL has no approved original budget row'};
 let prospective=await create({scenarioId:prospectiveScenario,mapping:prospectiveMapping,payload:prospectivePayload});
 const prospectiveLine=prospective.snapshot.lines.find(l=>l.accountCode==='6400');
 assert.equal(prospectiveLine.forecast,55);assert.equal(prospectiveLine.originalBudget,null);assert.equal(prospectiveLine.selectedBaseline,null);assert.equal(prospectiveLine.baselineDisposition.kind,'no_original_budget_row');
 assert.equal(prospective.snapshot.monthly[0].originalBudget.expenses,250);assert.equal(prospective.snapshot.monthly[0].reforecast.expenses,305);assert.equal(prospective.snapshot.completeness.blockerCount,0,JSON.stringify(prospective.snapshot.diagnostics));
 assert.equal(prospective.receipt.reconciliation.noOriginalBudgetRowCellCount,1);assert.equal(prospective.receipt.reconciliation.noOriginalBudgetRowGLCount,1);
 for(const action of ['reconcile','ready','submit','approve_lock'])prospective=await call('atlas_save_reforecast_scenario',[A,prospectiveScenario,prospective.head.revision,randomUUID(),action,prospective.revision.payload]);
 const prospectiveReport=await call('atlas_read_reforecast_publication',[prospective.publication.publication_id]);
 assert.equal(prospectiveReport.snapshot.lines.find(l=>l.accountCode==='6400').baselineDisposition.kind,'no_original_budget_row');assert.equal(prospectiveReport.snapshot.monthly[0].originalBudget.expenses,250);
 // A present row with a blank value must never use the absence exception.
 await db.exec('reset role');
 const missingSource={communityId:A,baseline:{lines:[{period:'2026-03',accountCode:'6400',amount:null}]}};
 assert.equal((await db.query('select atlas_private.reforecast_original_absence_disposition($1,$2,$3,$4) result',[missingSource,prospective.revision.payload,'2026-03','6400'])).rows[0].result,null);
 await signIn(1);
 await db.exec('reset role');
 assert.equal((await db.query('select payload from atlas_approved_budget_versions where version_id=$1',[BUDGET])).rows[0].payload.rows.find(r=>r.glCode==='6100').monthly[1],200);
 assert.equal((await db.query('select actual from atlas_financial_close_rows where version_id=$1 and gl_code=\'6100\'',[CLOSE])).rows[0].actual,'190');
 await assert.rejects(()=>db.exec("update atlas_reforecast_import_receipts set receipt='{}'"),/immutable/);
 const grants=(await db.query("select p.proname,p.prosecdef,has_function_privilege('anon',p.oid,'EXECUTE') anon_exec from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('atlas_create_reforecast_from_import','atlas_read_reforecast_import_receipt','atlas_read_reforecast_save_receipt','create_reforecast_from_import','read_reforecast_import_receipt','read_reforecast_save_receipt')")).rows;
 for(const f of grants){assert.equal(f.anon_exec,false,f.proname);if(f.proname.startsWith('atlas_'))assert.equal(f.prosecdef,false,f.proname);}
 await db.exec('set role anon');await assert.rejects(()=>call('atlas_create_reforecast_from_import',args),/permission denied/);
 await db.close();console.log('PASS atomic workbook import: exact cells, zero/blank, mapping/baseline validation, rollback, receipts, idempotency, optimistic conflict, second-session edits, immutable actuals/original and unauthorized denial');
})().catch(error=>{console.error(error);process.exitCode=1});
