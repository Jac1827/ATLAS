// Budget Builder v2: GM → Regional → VP workflow, governed publication hand-off,
// VP in-place edits, investor delivery claims and learning observations, against the
// real migration chain in PGlite.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto'),{fixture}=require('./reforecast-fixture.cjs');
const root=path.join(__dirname,'..'),migration=name=>fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8');
(async()=>{
 const feature=f=>import(path.join(root,'docs/portfolio-operations-dashboard/features',f));
 const {parseReforecastWorkbook}=await feature('reforecast-intake.mjs');
 const {planningMappingDispositions}=await feature('planning-governance.mjs');
 const E=await feature('budget-v2/engine.mjs'),H=await feature('budget-v2/handoff.mjs');
 const XLSX=require('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js');
 const {db,B,signIn}=await fixture();
 const GM=4,VP=5,RM=6;
 const call=async(name,args)=>(await db.query(`select to_jsonb(public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})) result`,args)).rows[0].result;
 await db.exec('reset role');
 await db.exec(migration('20260924121641_planning_cell_workbook_integrity_governance.sql'));
 await db.exec(migration('20260924121647_immutable_workbook_audits_and_monthly_governance.sql').split('alter function atlas_private.finance_intake_validation')[0]);
 for(const file of ['20260924165534_reforecast_builder_governance.sql','20260924165542_reforecast_report_receipts.sql','20260924232842_reforecast_governed_close_scope.sql','20260924232853_reforecast_str_overlay_isolation.sql','20260924235553_reforecast_active_import_close_scope.sql','20260925012933_reforecast_atomic_create_from_import.sql','20260925020220_reforecast_import_source_relationships.sql','20260925020222_reforecast_saved_json_str_programme.sql','20260925020226_reforecast_import_source_occurrence_index.sql','20260925071533_reforecast_request_identity_consistency.sql','20260925162050_budget_governed_draft_investor_lifecycle.sql'])await db.exec(migration(file));
 await db.exec("create function atlas_private.budget_calendar(cid uuid) returns jsonb language sql as $$select '{\"verified\":true,\"basis\":\"calendar\",\"startMonth\":1}'::jsonb$$");
 await db.exec("alter table atlas_approved_budget_versions alter column version_id set default gen_random_uuid();alter table atlas_approved_budget_versions alter column status set default 'locked';alter table atlas_approved_budget_versions add column fiscal_year integer,add column fiscal_start_month integer,add column scenario_id text,add column scenario_version text,add column effective_date date,add column content_hash text,add column approved_by uuid;");
 await db.exec('grant select on atlas_approved_budget_versions to authenticated');
 await db.query("update atlas_communities set first_expected_financial_period='2026-01' where community_id=$1",[B]);
 await db.exec("insert into auth.users values('00000000-0000-0000-0000-000000000006')");
 await db.query("insert into atlas_user_profiles values('00000000-0000-0000-0000-000000000006','regional','active',$1,'{}','{}')",[[B]]);
 await db.exec(migration('20261104200000_budget_builder_v2.sql'));

 // A small synthetic property: two income GLs, three expense GLs, one reserve and one capex line.
 const periods=E.fiscalPeriods(2027,1);
 const p=v=>({total:v*12,monthly:Array(12).fill(v)});
 const model={property:{name:'Synthetic',units:10,assetClass:'conventional'},periods,start:'proposal',sources:{proposal:{}},
  lines:[{gl:'5120',name:'Gross Potential Rent (GPR)',section:'Rental Income',proposal:p(10000),t12:{total:118000}},{gl:'5220',name:'Rent Loss-Vacancy',section:'Cost Of Leasing',proposal:p(-500),t12:{total:-7000}},
   {gl:'6330',name:'General Manager',section:'Payroll Office',proposal:p(5000),t12:{total:58000}},{gl:'6463',name:'Water/Sewer Units',section:'Unit Utilities',proposal:p(300),t12:{total:3400}},
   {gl:'6537',name:'Landscaping Contract',section:'Contract Services',proposal:p(700),t12:{total:8200}},{gl:'1320',name:'Replacement Reserve Fund',section:'Replacement Reserves',proposal:p(208.33),t12:{total:600}},
   {gl:'1533',name:'Appliances',section:'Capital Expenditures',proposal:{total:1200,monthly:[0,0,1200,0,0,0,0,0,0,0,0,0]},t12:{total:900}}],
  schedule:{beginOccupied:9,moveIns:Array(12).fill(1),moveOuts:Array(12).fill(1)},
  assumptions:{marketRent:1000,ltlPct:0,concessionPct:0,badDebtPct:0,mgmtPct:3,inflation:3,electric:5,water:4,sewer:10,sewerShare:55,reservePerUnit:250},
  positions:[{id:'gm',title:'General Manager',gl:'6330',count:1,salary:60000}]};
 model.base=E.freezeBase(model);
 const result=E.calculate(model);
 assert.equal(Math.round(result.rows['5220'].annual),-6000,'base vacancy equals the proposal');
 assert.equal(Math.round(result.totals.annual.income),114000);
 const more=E.calculate({...model,schedule:{...model.schedule,moveOuts:Array(12).fill(2)}});
 assert(more.rows['5220'].annual<result.rows['5220'].annual,'more move-outs increase vacancy loss');
 assert(more.rows['6463'].annual<result.rows['6463'].annual,'fewer occupied units lower occupied water/sewer');

 const draftId=randomUUID(),meta={fiscalYear:2027,planType:'budget',assetClass:'conventional',name:'Synthetic FY2027'};
 const save=(rev,payload,reason=null,id=randomUUID())=>call('atlas_budget_builder_save',[draftId,B,rev,id,meta,payload,reason]);
 const move=(rev,action,reason=null,detail={})=>call('atlas_budget_builder_transition',[draftId,rev,randomUUID(),action,reason,detail]);

 await signIn(GM);
 let d=await save(0,{model});assert.equal(d.status,'gm_draft');assert.equal(d.revision,1);
 const replayId=randomUUID();d=await save(1,{model,notes:{'6537':'Landscape contract'}},null,replayId);assert.equal(d.revision,2);
 assert.equal((await save(1,{model},null,replayId)).revision,2,'a replayed save request is idempotent');
 await assert.rejects(()=>save(1,{model}),/changed in another session/);
 d=await move(2,'submit_to_regional');assert.equal(d.status,'regional_review');
 await assert.rejects(()=>save(3,{model}),/cannot be edited by your role/,'GM cannot edit after submitting');
 await assert.rejects(()=>move(3,'regional_approve'),/Regional reviewer/);

 await signIn(RM);
 await assert.rejects(()=>move(3,'regional_return'),/reason is required/);
 d=await save(3,{model,notes:{'6537':'Landscape contract — RM confirmed'}});assert.equal(d.revision,4,'Regional can edit during review');
 d=await move(4,'regional_approve');assert.equal(d.status,'vp_review');
 await assert.rejects(()=>move(5,'vp_approve',null,{}),/Only the VP/);

 await signIn(VP);
 await assert.rejects(()=>move(5,'vp_approve',null,{publicationId:randomUUID(),summary:{}}),/governed publication/);
 const api={
  uploadPayload:({evidence,audit,bytes,assignment})=>({...evidence,source:{...evidence.source,originalFile:{encoding:'base64',data:Buffer.from(bytes).toString('base64')}},integrity:{auditId:audit.audit_id,fingerprint:audit.fingerprint},propertyAssignment:assignment}),
  saveAudit:({communityId,sourceHash,integrity,requestId})=>call('atlas_save_workbook_audit',[communityId,sourceHash,integrity,requestId]),
  saveUpload:({communityId,requestId,payload})=>call('atlas_save_reforecast_upload',[communityId,requestId,payload]),
  readRegistry:async({communityId})=>(await db.query('select to_jsonb(r) row from atlas_reforecast_registry_heads h join atlas_reforecast_registries r using(version_id) where h.community_id=$1',[communityId])).rows[0]?.row||null,
  saveRegistry:({communityId,expectedVersionId,requestId,payload})=>call('atlas_save_reforecast_registry',[communityId,expectedVersionId,requestId,payload]),
  createFromImport:({communityId,scenarioId,expectedRevision,requestId,uploadId,mapping,payload})=>call('atlas_create_reforecast_from_import',[communityId,scenarioId,expectedRevision,requestId,uploadId,mapping,payload]),
  saveScenario:({communityId,scenarioId,expectedRevision,requestId,action,payload})=>call('atlas_save_reforecast_scenario',[communityId,scenarioId,expectedRevision,requestId,action,payload])
 };
 const steps=[];
 const published=await H.governedPublish({api,XLSX,parseWorkbook:parseReforecastWorkbook,dispositions:planningMappingDispositions,uuid:randomUUID,result,communityId:B,draftId,actorId:'00000000-0000-0000-0000-000000000005',
  periods,calendar:{basis:'calendar',startMonth:1},name:'Synthetic FY2027',model:'conventional',onStep:s=>steps.push(s)});
 assert.equal(published.recordType,'initial_budget');assert(published.publication?.publication_id,'governed publication created');assert(steps.length>=5);
 const original=(await db.query('select payload from atlas_approved_budget_versions where community_id=$1 and calendar_year=2027',[B])).rows[0]?.payload;
 assert(original,'VP publication created the canonical original budget');
 for(const gl of ['5120','5220','6330','6463','6537','1533'])assert.deepEqual(original.rows.find(r=>r.glCode===gl).monthly.map(Number),result.rows[gl].monthly,`published ${gl} equals the builder`);
 const summary={totals:result.totals.annual,groups:result.groups};
 d=await move(5,'vp_approve',null,{publicationId:published.publication.publication_id,summary});
 assert.equal(d.status,'approved_locked');assert.equal(d.publication_id,published.publication.publication_id);assert.deepEqual(d.locked_summary.totals,JSON.parse(JSON.stringify(summary.totals)));

 // VP edits a locked budget in place: a reason is required, it is logged and flagged.
 await assert.rejects(()=>save(6,{model}),/reason is required/);
 d=await save(6,{model,overrides:{'6537':9000}},'Landscape renewal quote received');assert.equal(d.status,'approved_locked');assert.equal(d.revised_after_approval,true);
 await assert.rejects(()=>call('atlas_claim_budget_investor_delivery',[draftId,randomUUID(),['investor@example.com']]),/after VP approval locks the current budget/);
 await signIn(GM);await assert.rejects(()=>save(7,{model},'GM try'),/cannot be edited by your role/);
 await signIn(RM);await assert.rejects(()=>call('atlas_claim_budget_investor_delivery',[draftId,randomUUID(),['investor@example.com']]),/Only the VP/);

 // The VP edit is republished as a revised budget against the approved original, then re-approved.
 await signIn(VP);
 await assert.rejects(()=>move(7,'vp_approve',null,{publicationId:published.publication.publication_id,summary}),/Republish the edited budget/);
 const revisedModel={...model,overrides:{'6537':9000}},revised=E.calculate(revisedModel);
 const baselineVersionIds=(await db.query('select version_id from atlas_approved_budget_versions where community_id=$1 and calendar_year=2027',[B])).rows.map(r=>r.version_id);
 const republished=await H.governedPublish({api,XLSX,parseWorkbook:parseReforecastWorkbook,dispositions:planningMappingDispositions,uuid:randomUUID,result:revised,communityId:B,draftId,actorId:'00000000-0000-0000-0000-000000000005',
  periods,calendar:{basis:'calendar',startMonth:1},name:'Synthetic FY2027 (VP revision)',model:'conventional',baselineVersionIds});
 assert.equal(republished.recordType,'revised_budget');
 assert.equal((await call('atlas_reforecast_effective_baseline',[[B],periods]))[0].publicationId,republished.publication.publication_id,'the VP revision is the effective baseline');
 assert.equal(republished.publication.snapshot.lines.filter(l=>l.accountCode==='6537').reduce((t,l)=>t+Number(l.forecast),0),9000,'published revision carries the VP edit');
 d=await move(7,'vp_approve',null,{publicationId:republished.publication.publication_id,summary});assert.equal(d.revised_after_approval,false);assert.equal(d.publication_id,republished.publication.publication_id);
 await assert.rejects(()=>move(8,'vp_approve',null,{publicationId:republished.publication.publication_id,summary}),/Nothing changed/);
 await assert.rejects(()=>call('atlas_claim_budget_investor_delivery',[draftId,randomUUID(),['not-an-email']]),/valid recipient/);
 const claimId=randomUUID(),claim=await call('atlas_claim_budget_investor_delivery',[draftId,claimId,['Investor@Example.com','investor@example.com']]);
 assert.deepEqual(claim.recipients,['investor@example.com']);assert.equal((await call('atlas_claim_budget_investor_delivery',[draftId,claimId,['investor@example.com']])).delivery_id,claim.delivery_id,'claim replay is idempotent');
 await assert.rejects(()=>call('atlas_finish_budget_investor_delivery',[claim.delivery_id,'sent',null]),/permission denied/);
 await db.exec('reset role');await call('atlas_finish_budget_investor_delivery',[claim.delivery_id,'sent','msg-1']);
 assert.equal((await db.query('select status from atlas_budget_builder_drafts where draft_id=$1',[draftId])).rows[0].status,'sent_to_investors');

 // Learning observations and aggregate-only benchmarks.
 await signIn(GM);
 assert.equal(await call('atlas_budget_learning_record',[B,[{source_kind:'t12',metric:'per_unit',value:1500,basis:{group:'Payroll',assetClass:'conventional'},period_from:'2025-09',period_to:'2026-08'}]]),1);
 assert.deepEqual(await call('atlas_budget_benchmarks',[null]),{},'fewer than three communities never reveals a benchmark');

 // Ledger is immutable and complete; anonymous and out-of-scope users see nothing.
 await db.exec('reset role');
 const events=(await db.query('select action from atlas_budget_builder_events where draft_id=$1 order by created_at',[draftId])).rows.map(r=>r.action);
 for(const a of ['create','save','submit_to_regional','regional_approve','vp_approve','vp_edit','investor_package_sent'])assert(events.includes(a),'event '+a);
 await db.exec("set role anon");await assert.rejects(()=>db.query('select * from atlas_budget_builder_drafts'),/permission denied/);
 await db.exec('reset role');await signIn(2);assert.equal((await db.query('select count(*)::int n from atlas_budget_builder_drafts')).rows[0].n,0,'Regional of another community sees no draft');
 await assert.rejects(()=>db.query("update atlas_budget_builder_events set reason='forged'"),/permission denied/);
 console.log('PASS Budget Builder v2: proposal-linked drivers, GM→Regional→VP workflow, idempotent saves, governed initial-budget publication equal to the builder, VP in-place edits with reasons, investor delivery claims, learning observations and access control');
})().catch(error=>{console.error(error);process.exit(1);});
