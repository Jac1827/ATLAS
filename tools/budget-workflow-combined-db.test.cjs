const assert=require('node:assert/strict'),fs=require('node:fs'),{fixture}=require('./financial-intake-fixture.cjs');
const CALENDAR='20260925162055_governed_community_budget_calendar.sql',OPERATIONAL='20260925161938_governed_month_end_operational_review.sql',LIFECYCLE='20260925162050_budget_governed_draft_investor_lifecycle.sql';
const migration=name=>fs.readFileSync(__dirname+'/../supabase/migrations/'+name,'utf8'),preflight=fs.readFileSync(__dirname+'/budget-migration-preflight.sql','utf8');
const earlierPrerequisites=['20260924121641_planning_cell_workbook_integrity_governance.sql','20260924121647_immutable_workbook_audits_and_monthly_governance.sql','20260924165534_reforecast_builder_governance.sql','20260924165542_reforecast_report_receipts.sql','20260924232842_reforecast_governed_close_scope.sql','20260924232853_reforecast_str_overlay_isolation.sql','20260924235553_reforecast_active_import_close_scope.sql','20260925012933_reforecast_atomic_create_from_import.sql','20260925071533_reforecast_request_identity_consistency.sql'];
const productionContinuation=fs.readdirSync(__dirname+'/../supabase/migrations').filter(name=>name>='20260924232842'&&name<='20260925071533z').sort();
const prerequisites=[...earlierPrerequisites.filter(name=>name<'20260924232842'),...productionContinuation];
async function prepare({legacy=false}={}){const context=await fixture(),{db,cid,other}=context;await db.exec('reset role');
 await db.exec("alter table atlas_communities add column version integer default 1;alter table atlas_communities add column market text;alter table atlas_communities add column property_type text;alter table atlas_communities add column if not exists first_expected_financial_period text;update atlas_communities set display_name='RISE Doro',canonical_name='rise doro',market='Florida',property_type='High Rise' where community_id='"+cid+"';update atlas_communities set display_name='The Preserve at Tech',canonical_name='the preserve at tech',market='Student Housing' where community_id='"+other+"';");
 for(const file of legacy?earlierPrerequisites:prerequisites)await db.exec(migration(file));return context;
}
const definition=async(db,signature)=>(await db.query('select pg_get_functiondef(to_regprocedure($1)) d',[signature])).rows[0].d;
const history=async db=>(await db.query(`with records(kind,id,row_hash) as (
 select 'publication',publication_id::text,md5(to_jsonb(p)::text) from atlas_reforecast_publications p union all
 select 'revision',revision_id::text,md5(to_jsonb(r)::text) from atlas_reforecast_revisions r union all
 select 'actual_close',version_id::text,md5(to_jsonb(v)::text) from atlas_financial_close_versions v union all
 select 'original_budget',version_id::text,md5(to_jsonb(b)::text) from atlas_approved_budget_versions b)
 select kind,count(*) n,md5(string_agg(id||':'||row_hash,',' order by id)) hash from records group by kind order by kind`)).rows;
async function verifyInstalled({db,cid,other,signIn},label){
 await signIn(1);const calendar=async id=>(await db.query('select atlas_read_budget_calendar($1) c',[id])).rows[0].c;
 assert.equal((await calendar(cid)).startMonth,1);assert.equal((await calendar(other)).startMonth,8);
 await db.exec('reset role');await db.exec("alter table atlas_communities add column if not exists review_status text;alter table atlas_communities add column if not exists review_flags jsonb;update atlas_communities set budget_calendar=null,review_status='review_required',review_flags='[\"market_inferred\"]'::jsonb where community_id='"+other+"'");
 await signIn(1);assert.equal((await calendar(other)).verified,false,'Inferred classifications cannot silently govern a calendar');
 const verified=(await db.query('select atlas_set_budget_calendar($1,$2,$3,$4) c',[other,2,'Student Housing','Owner verified financial classification'])).rows[0].c;assert.equal(verified.startMonth,8);assert.equal(verified.verified,true);
 await db.exec('reset role');assert.deepEqual((await db.query("select community_id from atlas_community_aliases where alias='Ruston' and active")).rows,[{community_id:other}]);assert.equal((await db.query('select count(*) n from atlas_communities')).rows[0].n,2,'Never create a duplicate community');
 await signIn(1);assert.deepEqual((await db.query('select atlas_month_end_queue($1,$2) q',[[cid,other],2026])).rows[0].q,[]);
 assert.equal((await db.query("select routine_name from information_schema.routines where routine_schema='public' and routine_name in ('atlas_save_reforecast_scenario','atlas_reforecast_effective_baseline','atlas_read_month_end_review','atlas_close_financial_review_governed','atlas_read_finance','atlas_read_budget_calendar')")).rows.length,6);
 await db.exec('reset role');const rows=(await db.query("select relname,relrowsecurity from pg_class where relname in ('atlas_month_end_attestations','atlas_month_end_decisions','atlas_actual_period_events','atlas_budget_workflow_audit','atlas_budget_calendar_events')")).rows;assert.equal(rows.length,5);assert(rows.every(r=>r.relrowsecurity));
 for(const [signature,markers] of [
 ['public.atlas_read_reforecast_publication(uuid)',['pending_investor_approval','investorApprovalDate','contractBacked','originalCalculatedValue']],
 ['atlas_private.read_reforecast_save_receipt(uuid,uuid)',['investorPublicationId','budget_permissions']],
 ['atlas_private.create_reforecast_from_import(uuid,uuid,integer,uuid,uuid,jsonb,jsonb)',['initial_workbook']],
 [(await definition(db,'atlas_private.calculate_reforecast_before_saved_str(jsonb,jsonb)'))?'atlas_private.calculate_reforecast_before_saved_str(jsonb,jsonb)':'atlas_private.calculate_reforecast(jsonb,jsonb)',['initial_workbook','legitimateBlank']],
 ['atlas_private.reforecast_metric(jsonb,text)',['legitimateBlank']],
 ['public.atlas_reforecast_effective_baseline(uuid[],text[])',['legitimateBlank']],
 ['atlas_private.save_budget_workflow(uuid,uuid,integer,uuid,text,jsonb)',['atlas_private.publish_initial_budget(pub)']]]){const body=await definition(db,signature);for(const marker of markers)assert(body.includes(marker),label+': missing rewritten control '+signature+' '+marker);}
 assert.equal((await db.query("select to_regprocedure('atlas_private.budget_required_rewrite(text,text,text)') helper")).rows[0].helper,null,'Migration-only helper is removed after success');
}
async function install(order,label,options={}){const context=await prepare(options),{db}=context;try{
 const checks=(await db.query(preflight)).rows;assert.equal(checks.length,15);assert(checks.every(row=>row.ready),'Every prerequisite replacement anchor is present');const before=await history(db),wrapper=await definition(db,'atlas_private.calculate_reforecast(jsonb,jsonb)');
 for(const file of order)await db.exec(migration(file));assert.deepEqual(await history(db),before,label+': migrations retain financial history');await verifyInstalled(context,label);if(!options.legacy)assert.equal(await definition(db,'atlas_private.calculate_reforecast(jsonb,jsonb)'),wrapper,'Saved STR receipt and precision wrapper stays byte-identical');
 await db.exec(migration('20260925174317_shared_str_programme_draft_versions.sql'));await context.signIn(1);const shellPayload={schemaVersion:'atlas.str-programme-draft.v1',name:'Unfinished retained programme',sourcePropertyId:'source-property',sourceProgrammeId:'programme-1',config:null,property:{id:'source-property'},programme:{id:'programme-1',propertyId:'source-property',applied:false,config:null},groups:[],lines:[],years:[2026],reportSnapshot:null,reportUnavailableReason:'Driver settings have not been completed',reportBasisConfig:null,targetBudget:null,reason:'Preserve exact unfinished programme'};const shell=(await db.query('select atlas_save_str_programme_draft($1,gen_random_uuid(),0,gen_random_uuid(),$2) r',[context.cid,shellPayload])).rows[0].r;assert.equal(shell.revision.payload.reportSnapshot,null);assert.equal(shell.revision.status,'working_draft');assert.deepEqual((await db.query('select atlas_read_str_programme_drafts($1,$2,null) r',[[context.cid],shell.head.programme_id])).rows[0].r[0].revision.payload,shellPayload);
 console.log('PASS '+label+': Doro January, Preserve August, Ruston identity, preserved financial history, RLS and required function rewrite markers.');
 }finally{await db.close();}}
async function rejectDrift(signature,anchor,replacement,label){const {db}=await prepare();try{
 await db.exec(migration(CALENDAR));await db.exec(migration(OPERATIONAL));const body=await definition(db,signature);assert(body.includes(anchor));await db.exec(body.replace(anchor,replacement));
 assert((await db.query(preflight)).rows.some(row=>!row.ready),'Production preflight detects '+label);
 const retained=await definition(db,signature),scope=await definition(db,'atlas_private.reforecast_access(uuid,text)'),before=await history(db);
 await assert.rejects(()=>db.exec(migration(LIFECYCLE)),/Required Budget Builder migration rewrite missing/,label+' must abort instead of silently skipping a control');await db.exec('rollback');
 assert.equal(await definition(db,signature),retained,'Existing definition is preserved on failed migration');assert.equal(await definition(db,'atlas_private.reforecast_access(uuid,text)'),scope,'Authorization changes roll back with migration');assert.deepEqual(await history(db),before);
 const state=(await db.query("select to_regclass('public.atlas_budget_workflow_audit') audit,to_regprocedure('atlas_private.budget_required_rewrite(text,text,text)') helper,to_regprocedure('atlas_private.budget_calendar(uuid)') calendar")).rows[0];assert.equal(state.audit,null);assert.equal(state.helper,null);assert(state.calendar,'Prior successfully applied calendar remains available');
 console.log('PASS missing '+label+': read-only preflight rejects drift, required anchor aborts transaction, prior functions/history survive.');
 }finally{await db.close();}}
(async()=>{
 assert.equal(migration(LIFECYCLE),fs.readFileSync(__dirname+'/../docs/portfolio-operations-dashboard/centralization/budget-governed-lifecycle.sql','utf8'),'Lifecycle install mirror must match versioned migration');
 await install([OPERATIONAL,LIFECYCLE,CALENDAR],'chronological fresh installation');
 await install([CALENDAR,OPERATIONAL,LIFECYCLE],'calendar-first existing-live rollout');
 await install([OPERATIONAL,LIFECYCLE,CALENDAR],'direct calculator compatibility',{legacy:true});
 await rejectDrift('public.atlas_save_reforecast_registry(uuid,uuid,uuid,jsonb)',"reforecast_access(p_community_id,'approve')","reforecast_access(p_community_id, 'approve')",'early authority anchor');
 await rejectDrift('atlas_private.calculate_reforecast(jsonb,jsonb)','return atlas_private.calculate_reforecast_before_saved_str(source,calculation);','return atlas_private.calculate_reforecast_before_saved_str(source, calculation);','saved STR forwarding anchor');
 await rejectDrift('public.atlas_read_reforecast_publication(uuid)',"array['period','accountCode','originalValue','originalCalculatedValue','amount'","array['period','accountCode','originalValue','originalCalculatedValue', 'amount'",'late report-evidence anchor');
})().catch(error=>{console.error(error.message,error.where||'');process.exitCode=1;});
