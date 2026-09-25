// Actual-file scale regression in an isolated database with synthetic governance.
// This is not authenticated production acceptance or an approval of its mappings.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto'),{fixture}=require('./reforecast-fixture.cjs');
(async()=>{
 if(!process.env.ATLAS_DORO_EVIDENCE){console.log('SKIP actual workbook volume: set ATLAS_DORO_EVIDENCE to private parsed evidence');return;}
 let evidence=JSON.parse(fs.readFileSync(process.env.ATLAS_DORO_EVIDENCE,'utf8'));
 const {prepareScopedReforecastEvidence}=await import('../docs/portfolio-operations-dashboard/features/reforecast-authority.mjs');
 const XLSX=require('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js');
 const {planningMappingDispositions}=await import('../docs/portfolio-operations-dashboard/features/planning-governance.mjs');
 const {db,A,BUDGET,signIn}=await fixture(),owner='00000000-0000-0000-0000-000000000001',read=name=>fs.readFileSync(path.join(__dirname,'../supabase/migrations',name),'utf8');
 const call=async(name,args)=>(await db.query(`select to_jsonb(public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})) result`,args)).rows[0].result;
 await db.exec('reset role');await db.exec(read('20260924121641_planning_cell_workbook_integrity_governance.sql'));
 await db.exec(read('20260924121647_immutable_workbook_audits_and_monthly_governance.sql').split('alter function atlas_private.finance_intake_validation')[0]);
 for(const name of ['20260924165534_reforecast_builder_governance.sql','20260924165542_reforecast_report_receipts.sql','20260924232842_reforecast_governed_close_scope.sql','20260924232853_reforecast_str_overlay_isolation.sql','20260924235553_reforecast_active_import_close_scope.sql','20260925004921_reforecast_atomic_create_from_import.sql'])await db.exec(read(name));
 await db.exec(read('20260925005521_workbook_audit_validation_performance.sql').split('-- Read committed upload status')[0]+'commit;');
 const periods=['2026-09','2026-10','2026-11','2026-12'],selected=evidence.lines.filter(l=>l.scenario==='Plan'&&periods.includes(l.period)&&l.amount!==null);
 const scoped=await prepareScopedReforecastEvidence(evidence,{sourceScenario:'Plan',periods,selectedLineIds:selected.map(l=>l.id)},{xlsx:XLSX,sourceBytes:evidence.source.originalFile??fs.readFileSync(process.env.ATLAS_DORO_WORKBOOK||'/Users/jacheflin/Desktop/Conventional only_ Doro Reforecast 09.2026.xlsx')});evidence=scoped.evidence;
 assert.equal(evidence.integrity.summary.blocking,0);
 const accounts=[...new Set(selected.map(l=>l.accountCode))].map(accountCode=>({accountCode,category:'Synthetic scale fixture',nature:'expense',placement:'above_noi',effectiveFrom:'2026-01'}));
 await db.query('update atlas_approved_budget_versions set payload=$1 where version_id=$2',[{rows:accounts.map(a=>({glCode:a.accountCode,monthly:Array(12).fill(0)}))},BUDGET]);
 await signIn(1);const registry=await call('atlas_save_reforecast_registry',[A,null,randomUUID(),{accounts,driverMappings:{},reason:'Isolated scale-test mapping only',effectiveDate:'2026-01-01'}]);
 const auditStarted=performance.now(),audit=await call('atlas_save_workbook_audit',[A,evidence.source.sha256,evidence.integrity,randomUUID()]);
 const assignment={communityId:A,confirmed:true,sourceEntities:evidence.metadata.entities,actorId:owner,reason:'Synthetic isolated volume fixture'};
 // Original upload bytes have been validated by the parser/transport suite. Seed
 // its immutable row here to isolate transaction volume from upload transport.
 const uploadId=randomUUID(),upload={...evidence,integrity:{auditId:audit.audit_id,fingerprint:audit.fingerprint},propertyAssignment:assignment};
 await db.exec('reset role');await db.query('insert into atlas_reforecast_uploads(upload_id,community_id,request_id,source_hash,content_hash,payload,created_by,created_role) values($1,$2,$3,$4,$5,$6,$7,\'admin\')',[uploadId,A,randomUUID(),evidence.source.sha256,'volume-only',upload,owner]);await signIn(1);
 const reviewedAt='2026-09-25T01:00:00Z';const mapping={confirmed:true,version:registry.version_id,propertyAssignment:assignment,sourceScenario:'Plan',currency:'USD',periods,selectedLineIds:selected.map(l=>l.id),accountMappings:accounts.map(a=>({...a,sourceAccountCode:a.accountCode,signMultiplier:1,allowReversal:true})),reason:'Volume test exact retained Plan cells',reviewedBy:owner,reviewedAt,calendar:{basis:'calendar',startMonth:1,confirmed:true,periods,scenario:'Plan',reviewedBy:owner,reviewedAt},inputReviews:selected.filter(l=>!l.formula).map(l=>({cellId:l.id,confirmed:true,ownerId:owner,effectivePeriod:l.period,before:l.amount,after:l.amount,reason:'Isolated input relationship verification',reviewedAt,integrityFingerprint:audit.fingerprint})),integrityReviews:evidence.integrity.findings.filter(f=>f.severity==='review').map(f=>({findingId:f.id,confirmed:true,reason:'Isolated explicit supporting finding review',ownerId:owner,effectivePeriod:periods[0],reviewedAt,integrityFingerprint:audit.fingerprint,before:f.evidence||null,after:f.evidence||null}))};
 mapping.currencyMapping={sourceCurrency:'Local',reportingCurrency:'USD',method:'identity',confirmed:true,reviewedBy:owner,reviewedAt,reason:'Reviewed Local as reporting currency, no conversion'};Object.assign(mapping,planningMappingDispositions(evidence,mapping));
 const payload={name:'Isolated Doro volume',model:'conventional',scenarioPurpose:'conventional',governanceSchemaVersion:2,calendar:{...mapping.calendar,scenario:'Isolated Doro volume'},periods,baselineType:'original_budget',baselineVersionIds:[BUDGET],registryVersionId:registry.version_id,ownerId:owner,reviewerId:owner,drivers:[],overrides:[],reason:'Volume test, not production approval'};
 const request=randomUUID(),args=[A,randomUUID(),0,request,uploadId,mapping,payload],start=performance.now();
 console.log(JSON.stringify({stage:'before_atomic',requestBytes:Buffer.byteLength(JSON.stringify(args)),mappingBytes:Buffer.byteLength(JSON.stringify(mapping))}));
 const result=await call('atlas_create_reforecast_from_import',args),durationMs=Math.round(performance.now()-start);
 assert.equal(result.receipt.importedCells.length,selected.length);assert.equal(selected.length,451);assert.equal(result.receipt.reconciliation.zeroCellCount,97);assert.equal(result.receipt.excludedRows.length,1281);
 assert.equal(result.receipt.excludedEvidenceSummary.sourceLineCount,10392);assert.equal(result.receipt.excludedEvidenceSummary.outsideReviewedScopeCount,8660);
 for(const c of result.receipt.importedCells)assert.equal(c.amount,selected.find(l=>l.id===c.sourceLineId).amount);
 assert.equal(result.snapshot.completeness.blockerCount,0,JSON.stringify(result.snapshot.diagnostics));
 const recovered=await call('atlas_read_reforecast_import_receipt',[A,request]);assert.deepEqual(recovered.receipt,result.receipt);
 assert.equal((await call('atlas_create_reforecast_from_import',args)).revision.revision_id,result.revision.revision_id);
 let approved=result;for(const action of ['reconcile','ready','submit','approve_lock'])approved=await call('atlas_save_reforecast_scenario',[A,args[1],approved.head.revision,randomUUID(),action,approved.revision.payload]);
 const publication=await call('atlas_read_reforecast_publication',[approved.publication.publication_id]);assert.equal(publication.verified,true);for(const cell of result.receipt.importedCells)assert.equal(publication.snapshot.lines.find(l=>l.accountCode===cell.accountCode&&l.period===cell.period).forecast,cell.amount);
 console.log(JSON.stringify({status:'PASS',kind:'actual-file isolated database volume; not production acceptance',sourceLineCount:evidence.lines.length,selectedCells:selected.length,atomicDurationMs:durationMs,setupAndAuditDurationMs:Math.round(start-auditStarted),requestBytes:Buffer.byteLength(JSON.stringify(args)),responseBytes:Buffer.byteLength(JSON.stringify(result)),receiptBytes:Buffer.byteLength(JSON.stringify(result.receipt)),mappingBytes:Buffer.byteLength(JSON.stringify(mapping)),blockers:result.snapshot.completeness.blockerCount,scopedRoots:scoped.authoritativeCells.length,scopedNodes:evidence.integrity.authorityScope.requiredNodes.length,reviewFindings:mapping.integrityReviews.length,approvedPublicationVerified:publication.verified}));
 await db.close();
})().catch(error=>{console.error(error.message.slice(0,1200));process.exitCode=1});
