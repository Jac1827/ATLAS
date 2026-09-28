// Isolated old/new reader parity, including a full 292 GL x 4 month report.
// Optional private production evidence is never committed or sent anywhere.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto'),{fixture}=require('./reforecast-fixture.cjs');
const root=path.join(__dirname,'..'),read=name=>fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8'),change=read('20260928162637_indexed_governed_report_and_finance_reads.sql'),deferredChange=read('20260928164258_defer_finance_baseline_attachment.sql');
(async()=>{
 const {db,A,B,BUDGET,CLOSE,signIn}=await fixture();await db.exec('reset role');
 await db.exec(String.raw`create table fixture_financial_summaries(community_id uuid,period_key text,fiscal_year integer,publication_id uuid,summary jsonb);
 create function public.atlas_read_finance(p_community_ids uuid[],p_periods text[]) returns table(community_id uuid,period_key text,fiscal_year integer,publication_id uuid,summary jsonb) language plpgsql stable security definer set search_path='' as $$begin
 if auth.uid() is null or coalesce(cardinality(p_community_ids),0) not between 1 and 100 or coalesce(cardinality(p_periods),0) not between 1 and 24 then raise exception 'Invalid finance read scope';end if;
 return query select f.* from public.fixture_financial_summaries f where f.community_id=any(p_community_ids) and f.period_key=any(p_periods) and atlas_private.command_access(f.community_id);end;$$;`);
 await db.exec(read('20260924121641_planning_cell_workbook_integrity_governance.sql'));
 await db.exec(read('20260924121647_immutable_workbook_audits_and_monthly_governance.sql').split('alter function atlas_private.finance_intake_validation')[0]);
 for(const name of ['20260924165534_reforecast_builder_governance.sql','20260924165542_reforecast_report_receipts.sql','20260924203341_finance_request_context.sql','20260924232842_reforecast_governed_close_scope.sql','20260924232853_reforecast_str_overlay_isolation.sql','20260924235553_reforecast_active_import_close_scope.sql','20260925012933_reforecast_atomic_create_from_import.sql','20260925020220_reforecast_import_source_relationships.sql','20260925020222_reforecast_saved_json_str_programme.sql','20260925020226_reforecast_import_source_occurrence_index.sql','20260925071533_reforecast_request_identity_consistency.sql','20260925162050_budget_governed_draft_investor_lifecycle.sql'])await db.exec(read(name));
 await db.exec("create function atlas_private.budget_calendar(cid uuid) returns jsonb language sql as $$select '{\"verified\":true,\"basis\":\"calendar\",\"startMonth\":1}'::jsonb$$");
 for(const name of ['20260928141143_reviewed_noncash_forecast_presentation.sql','20260928142628_indexed_import_validation_evidence.sql','20260928144620_bounded_reforecast_validation_memory.sql','20260928150652_governed_reforecast_save_timeout.sql'])await db.exec(read(name));
 // Install the current exact month-end outer reader and its scoped event table.
 // The finance request context below must include its warning and serialization.
 const monthEnd=read('20260925161938_governed_month_end_operational_review.sql');
 await db.exec(monthEnd.slice(monthEnd.indexOf('create table public.atlas_actual_period_events ('),monthEnd.indexOf(');',monthEnd.indexOf('create table public.atlas_actual_period_events ('))+2));
 await db.exec(`alter table public.atlas_actual_period_events enable row level security;
 revoke all on public.atlas_actual_period_events from public,anon,authenticated;
 grant select on public.atlas_actual_period_events to authenticated;
 create policy scoped_read on public.atlas_actual_period_events for select to authenticated using(atlas_private.command_access(community_id));`);
 await db.exec(monthEnd.slice(monthEnd.indexOf('alter function public.atlas_read_finance(uuid[],text[]) rename to atlas_read_finance_before_month_end;'),monthEnd.indexOf('revoke all on function public.atlas_close_financial_review_before_operational')));
 await db.exec('revoke all on function public.atlas_read_finance(uuid[],text[]) from public,anon,authenticated;grant execute on function public.atlas_read_finance(uuid[],text[]) to authenticated');
 const names=['reforecast_report_snapshot(jsonb)','reforecast_finance_month(jsonb,jsonb,jsonb)'],defs={},meta={};
 const metadata=async sig=>(await db.query('select proowner,prosecdef,provolatile,proconfig,proacl from pg_proc where oid=$1::regprocedure',[sig])).rows[0];
 for(const name of names){const sig='atlas_private.'+name;defs[name]=(await db.query('select pg_get_functiondef($1::regprocedure) d',[sig])).rows[0].d;meta[name]=await metadata(sig);}
 const publicNames=['public.atlas_read_reforecast_publication(uuid)','public.atlas_verify_budget_consumer(uuid,text,uuid,uuid,text)','public.atlas_read_finance(uuid[],text[])'];
 const publicDefs={};for(const name of publicNames)publicDefs[name]=(await db.query('select pg_get_functiondef($1::regprocedure) d',[name])).rows[0].d;
 // Both prerequisite checks happen before either rewrite, and abort on drift.
 for(const name of names){await db.exec(defs[name].replace('\nbegin','\nbegin\n -- future-reader-review-required'));
  await assert.rejects(()=>db.exec(change),/Audited .* reader differs/);await db.exec('rollback');
  for(const other of names)if(other!==name)assert.equal((await db.query('select pg_get_functiondef($1::regprocedure) d',['atlas_private.'+other])).rows[0].d,defs[other]);
  await db.exec(defs[name]);}
 for(const name of names){const base=name.split('(')[0];await db.exec(defs[name].replace('atlas_private.'+base+'(','atlas_private.'+base+'_before_index_test('));}
 const call=async(name,args)=>(await db.query('select to_jsonb(public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+')) result',args)).rows[0].result;
 const projected=async(value,before=false)=>(await db.query('select atlas_private.reforecast_report_snapshot'+(before?'_before_index_test':'')+'($1)::text value',[value])).rows[0].value;
 const month=async(s,b,t,before=false)=>(await db.query('select atlas_private.reforecast_finance_month'+(before?'_before_index_test':'')+'($1,$2,$3)::text value',[s,b,t])).rows[0].value;
 const base={identity:{nonCashPresentation:{schemaVersion:1,classificationVersion:1,cashFlowBasis:'after_noncash'}},periods:['2026-09'],lines:[],monthly:[],totals:{reforecast:{cashFlow:null,nonCashDepreciationAmortization:null,cashFlowBeforeNoncash:null,cashFlowAfterNoncash:null}},diagnostics:[]};
 const cases=[base,{...base,identity:{}},{...base,lines:[
  {period:'a|b',accountCode:'c',nonCash:true,nonCashClassificationVersion:1,forecast:-1.005},
  {period:'a',accountCode:'b|c',nonCash:false,nonCashClassificationVersion:1,forecast:0},
  {period:'a|b',accountCode:'c',nonCash:false,forecast:null}, // first duplicate wins for both projected matches
  {period:null,accountCode:'c',nonCash:true},{accountCode:'c',nonCash:true},{period:'a',accountCode:null,nonCash:true},
  {period:'',accountCode:'',nonCash:null,nonCashClassificationVersion:null},
  {period:'x',accountCode:'y',nonCash:false},{period:'x',accountCode:'z'}],
 monthly:[{period:'x',reforecast:{cashFlow:0,nonCashDepreciationAmortization:null,cashFlowBeforeNoncash:null,cashFlowAfterNoncash:0}},{period:'x',reforecast:{nonCashDepreciationAmortization:9}},{period:null,reforecast:{nonCashDepreciationAmortization:1}}]}];
 const periods=['2026-09','2026-10','2026-11','2026-12'];
 const large={...base,periods,lines:periods.flatMap(period=>Array.from({length:292},(_,i)=>({period,accountCode:'GL'+i,nature:i%3===0?'income':i%3===1?'expense':'below_noi',placement:i%3===2?'below_noi':'above_noi',forecast:i%13===0?null:i%7===0?0:(i-149)/100,nonCash:i%3===2,nonCashClassificationVersion:1,mappingValid:true,source:{sourceType:'original_budget',evidence:'source evidence '.repeat(70)}}))),monthly:periods.map(period=>({period,reforecast:{cashFlow:-100,nonCashDepreciationAmortization:10,cashFlowBeforeNoncash:-90,cashFlowAfterNoncash:-100}}))};
 cases.push(large);
 const oldProjected=[];const oldStart=performance.now();for(const c of cases)oldProjected.push(await projected(c,true));const oldReportMs=Math.round(performance.now()-oldStart);
 const metricMappings={gpr:[{glCode:'dup',factor:1},{glCode:'zero',factor:-1}],missing:[{glCode:'absent',factor:1}],unknown:[{glCode:null,factor:1}],nullAmount:[{glCode:'null',factor:1}],empty:[]};
 await db.query("update atlas_approved_budget_versions set payload=payload||jsonb_build_object('metricMappings',$1::jsonb) where version_id=$2",[metricMappings,BUDGET]);
 const summary={communityId:A,period:'2026-09',budgetVersion:BUDGET,...Object.fromEntries([...Object.keys(metricMappings),'revenue','expenses','unsupported'].map(k=>[k,{actual:0,budget:null}]))};
 const baseline={status:'available',sourceType:'original_budget',versionId:BUDGET,lines:[{accountCode:'dup',amount:-1.005},{accountCode:'dup',amount:999},{accountCode:'zero',amount:0},{accountCode:'null',amount:null},{accountCode:null,amount:100},{amount:200}].map(v=>({...v,nature:'expense',placement:'above_noi'}))};
 const financeCases=[[summary,baseline,null],[summary,{...baseline,status:'unavailable'},null],[summary,{...baseline,sourceType:'approved_reforecast'},null],[summary,null,null],[summary,baseline,{gpr:0,missing:null}],...Object.entries({metric:{actual:2,budget:3},object:{note:'retained only until approved baseline attachment'},null:null}).flatMap(([,effectiveBaseline])=>[null,{}].map(targets=>[{...summary,effectiveBaseline,originalBudgetVersion:{actual:0,budget:null}},baseline,targets]))];
 const oldFinance=[];for(const c of financeCases)oldFinance.push(await month(...c,true));
 await db.exec(change);
 // Pin the indexed implementation as the oracle for the additive deferral.
 const indexedFinance=(await db.query("select pg_get_functiondef('atlas_private.reforecast_finance_month(jsonb,jsonb,jsonb)'::regprocedure) d")).rows[0].d;
 const indexedReport=(await db.query("select pg_get_functiondef('atlas_private.reforecast_report_snapshot(jsonb)'::regprocedure) d")).rows[0].d;
 await db.exec(indexedFinance.replace('\nbegin','\nbegin\n -- future-reader-review-required'));
 await assert.rejects(()=>db.exec(deferredChange),/Audited indexed finance reader differs/);await db.exec('rollback');
 assert.equal((await db.query("select pg_get_functiondef('atlas_private.reforecast_report_snapshot(jsonb)'::regprocedure) d")).rows[0].d,indexedReport);
 await db.exec(indexedFinance);await db.exec(deferredChange);
 const deferredFinance=(await db.query("select pg_get_functiondef('atlas_private.reforecast_finance_month(jsonb,jsonb,jsonb)'::regprocedure) d")).rows[0].d;
 await assert.rejects(()=>db.exec(deferredChange),/Audited indexed finance reader differs/);await db.exec('rollback');
 for(const name of names)assert.deepEqual(await metadata('atlas_private.'+name),meta[name],'owner/security/config/ACL/volatility unchanged');
 for(const name of publicNames)assert.equal((await db.query('select pg_get_functiondef($1::regprocedure) d',[name])).rows[0].d,publicDefs[name],'public authentication and timeout unchanged');
 const newStart=performance.now();for(let i=0;i<cases.length;i++)assert.equal(await projected(cases[i]),oldProjected[i],'full projection, field absence/nulls, ordering and fingerprint exact');const newReportMs=Math.round(performance.now()-newStart);
 for(let i=0;i<financeCases.length;i++)assert.equal(await month(...financeCases[i]),oldFinance[i],'first duplicate, zero, null, missing mapping and supplied-target parity');
 assert.equal(JSON.parse(await month(summary,baseline,null)).gpr.activeBaseline,-1.005);
 await assert.rejects(()=>db.exec(change),/Audited .* reader differs/);await db.exec('rollback');
 const owner='00000000-0000-0000-0000-000000000001';
 async function seedPublished(snapshot,source,payload,cid=A){
  const rid=randomUUID(),sid=randomUUID(),pid=randomUUID();await db.exec('reset role');
  // Restore already-published fixture history; this is not an import/approval
  // test. Only local fixture inserts bypass publication-time triggers. All
  // authenticated reader/consumer calls below run with ordinary triggers/RLS.
  await db.exec('set session_replication_role=replica');
  await db.query("insert into atlas_communities(community_id,status) values($1,'active') on conflict do nothing",[cid]);
  snapshot=(await db.query("select (($1::jsonb-'fingerprint')||jsonb_build_object('fingerprint',encode(sha256(convert_to(($1::jsonb-'fingerprint')::text,'UTF8')),'hex')))::text v",[snapshot])).rows[0].v;
  await db.query("insert into atlas_reforecast_revisions(revision_id,scenario_id,community_id,revision,status,action,request_id,request_hash,payload,source,snapshot,actor_id,actor_role) values($1,$2,$3,1,'pending_investor_approval','vp_approve',$4,'isolated-reader-fixture',$5,$6,$7,$8,'executive')",[rid,sid,cid,randomUUID(),payload,source,snapshot,owner]);
  await db.query("insert into atlas_reforecast_heads values($1,$2,1,$3,'pending_investor_approval')",[sid,cid,rid]);
  await db.query("insert into atlas_reforecast_publications(publication_id,community_id,scenario_id,revision_id,version,request_id,request_hash,periods,snapshot,source,reason,published_by,published_role) values($1,$2,$3,$4,1,$5,'isolated-reader-fixture',$6,$7,$8,'Isolated reader parity fixture',$9,'executive')",[pid,cid,sid,rid,randomUUID(),payload.periods,snapshot,source,owner]);
  for(const p of payload.periods)await db.query("insert into atlas_reforecast_active_heads values($1,$2,$3) on conflict(community_id,period_key) do update set publication_id=excluded.publication_id",[cid,p,pid]);
  await db.exec('set session_replication_role=origin');return{pid,rid,cid,snapshot:JSON.parse(snapshot)};
 }
 const seeded=await seedPublished(large,{registry:{accounts:[]},actuals:{closeVersions:[]},sourceReceipts:[]},{name:'Synthetic reader volume',periods,overrides:[]});
 await signIn(1);let started=performance.now(),report=await call('atlas_read_reforecast_publication',[seeded.pid]);const publicReportMs=Math.round(performance.now()-started);assert.equal(report.verified,true);
 const request=randomUUID();started=performance.now();const ack=await call('atlas_verify_budget_consumer',[seeded.pid,'excel_export',request,seeded.rid,report.reportContentHash]),ackMs=Math.round(performance.now()-started);assert.equal(ack.delivery_status,'verified');assert.deepEqual(await call('atlas_verify_budget_consumer',[seeded.pid,'excel_export',request,seeded.rid,report.reportContentHash]),ack);
 await assert.rejects(()=>call('atlas_verify_budget_consumer',[seeded.pid,'excel_export',request,randomUUID(),report.reportContentHash]),/reused/);
 await signIn(2);assert.deepEqual(await call('atlas_read_reforecast_publication',[seeded.pid]),report,'second authorized session same report');
 await signIn(4);await assert.rejects(()=>call('atlas_read_reforecast_publication',[seeded.pid]),/access denied/);await assert.rejects(()=>call('atlas_verify_budget_consumer',[seeded.pid,'excel_export',randomUUID(),seeded.rid,report.reportContentHash]),/access denied/);
 await db.exec("reset role;set request.jwt.claim.sub='';set role authenticated");await assert.rejects(()=>call('atlas_read_reforecast_publication',[seeded.pid]),/access denied/);
 await db.exec('reset role;set role anon');await assert.rejects(()=>call('atlas_read_reforecast_publication',[seeded.pid]),/permission denied/);
 await db.exec('reset role');for(const name of names)assert.equal((await db.query("select has_function_privilege('authenticated',$1,'execute') allowed",['atlas_private.'+name])).rows[0].allowed,false);
 const proof={status:'PASS',syntheticLines:1168,oldReportMs,newReportMs,publicReportMs,ackMs,exactJSONAndFingerprintParity:true,duplicateNullZeroParity:true,authorizationUnchanged:true};
 const allPeriods=Array.from({length:12},(_,i)=>'2026-'+String(i+1).padStart(2,'0'));
 async function compareFinanceYear(cid,pid,label){
  const query='select jsonb_agg(to_jsonb(r) order by period_key)::text value from public.atlas_read_finance($1,$2)r';
  const readYear=async()=>(await db.query(query,[[cid],allPeriods])).rows[0].value;
  await db.exec('reset role;set statement_timeout=0');await db.exec(indexedFinance);await signIn(1);
  let start=performance.now();const before=await readYear(),indexedMs=Math.round(performance.now()-start);
  await db.exec('reset role');await db.exec(deferredFinance);await signIn(1);await db.exec("set statement_timeout='8s'");
  assert.equal((await db.query('show statement_timeout')).rows[0].statement_timeout,'8s');
  start=performance.now();const after=await readYear(),deferredMs=Math.round(performance.now()-start);
  assert.equal(after,before,label+' entire authenticated 12-month response, YTD, warning wrapper and serialization exactly preserved');
  const rows=JSON.parse(after);assert.equal(rows.length,12);
  assert.equal(rows.filter(r=>r.summary.effectiveBaseline.sourceType==='original_budget'&&r.summary.effectiveBaseline.status==='available').length,8);
  assert.equal(rows.filter(r=>r.summary.effectiveBaseline.publicationId===pid&&r.summary.effectiveBaseline.status==='available').length,4);
  assert(rows.every(r=>Object.hasOwn(r.summary,'periodWarning')&&Object.hasOwn(r.summary,'periodState')));
  await signIn(4);assert.equal(await readYear(),null,'unauthorized community remains absent');
  await db.exec("reset role;set request.jwt.claim.sub='';set role authenticated");await assert.rejects(readYear,/Invalid finance read scope/);
  await db.exec('reset role;set role anon');await assert.rejects(readYear,/permission denied/);
  await signIn(1);await db.exec('reset statement_timeout');
  assert(deferredMs<8000,label+' full reader must finish inside existing authenticated 8-second deadline');
  return{indexedMs,deferredMs,financePeriods:12,originalBudgetPeriods:8,publishedPeriods:4,exactParity:true,serializedBytes:Buffer.byteLength(after),outputHash:createHash('sha256').update(after).digest('hex'),outerMonthEndWrapper:true,statementTimeoutMs:8000};
 }
 // Broad native-shaped public-reader case always runs without private input.
 // Every amount, identifier and evidence string here is explicitly synthetic.
 await db.exec('reset role');
 const syntheticMetrics=['gpr','revenue','expenses','noi','cashFlow','capital','debt','belowNoi'];
 const syntheticNames=[...syntheticMetrics,...Array.from({length:85},(_,i)=>'syntheticMetric'+i)];
 const syntheticMappings=Object.fromEntries(syntheticMetrics.map((k,i)=>[k,[{glCode:'GL'+i,factor:i%2===0?1:-1}]]));
 const originalRows=Array.from({length:292},(_,i)=>({glCode:'GL'+i,monthly:Array.from({length:12},(_,month)=>(i-month)/100)}));
 await db.query("update atlas_approved_budget_versions set payload=$1 where version_id=$2",[{rows:originalRows,metricMappings:syntheticMappings},BUDGET]);
 const financeLarge={...large,lines:large.lines.map((line,i)=>({...line,forecast:i%7===0?0:(i%292-149)/100})),diagnostics:[]};
 const financePublication=await seedPublished(financeLarge,{registry:{accounts:[]},actuals:{closeVersions:[]},sourceReceipts:[],retainedEvidence:'Synthetic source evidence. '.repeat(85000)},{name:'Synthetic native-shaped reader',periods,overrides:[]});
 for(const [i,period]of allPeriods.entries()){
  const metricValues=Object.fromEntries(syntheticNames.map((name,n)=>[name,{actual:n%5===0?null:n%3===0?0:(n-i)/100,budget:n%4===0?null:(n+i)/100}]));
  const value={communityId:A,period,budgetVersion:BUDGET,budgetVersions:Object.fromEntries(allPeriods.slice(0,i+1).map(p=>[p,BUDGET])),fiscalPeriods:allPeriods.slice(0,i+1),ytd:Object.fromEntries(syntheticNames.slice(0,31).map(k=>[k,metricValues[k]])),...metricValues,...Object.fromEntries(Array.from({length:26},(_,n)=>['syntheticMetadata'+n,{value:n,source:'Synthetic retained provenance'}]))};
  assert.equal(Object.keys(value).length,125);
  await db.query('insert into fixture_financial_summaries values($1,$2,2026,$3,$4)',[A,period,randomUUID(),value]);
 }
 // The existing immutable close stays live while its warning reaches consumers.
 await db.query("insert into atlas_actual_period_events(community_id,period_key,version_id,action,actor_id,actor_role,reason,request_id) values($1,'2026-01',$2,'reopened',$3,'admin','Synthetic scope and warning regression',$4)",[A,CLOSE,owner,randomUUID()]);
 proof.syntheticFinanceYear={...await compareFinanceYear(A,financePublication.pid,'Synthetic native-shaped'),inputKeys:125,monthlyMetrics:93,ytdMetrics:31};
 assert.equal((await db.query("select summary->>'periodState' state from public.atlas_read_finance($1,$2)",[[A],['2026-01']])).rows[0].state,'reopened');
 if(process.env.ATLAS_REPORT_PRIVATE_FIXTURE_DIR){
  await db.exec('reset role');
  const dir=process.env.ATLAS_REPORT_PRIVATE_FIXTURE_DIR,get=name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
  const snapshotText=fs.readFileSync(path.join(dir,'doro-published-v7-snapshot.exact.json'),'utf8'),payloadText=fs.readFileSync(path.join(dir,'doro-published-v7-payload.exact.json'),'utf8'),snapshot=JSON.parse(snapshotText),payload=JSON.parse(payloadText),ledger=get('postpublication-869c5d92-f1b2-4afe-a555-d62dd3b3b264/04-consumer-delivery.result.json'),source=ledger.latestConsumers.find(v=>v.consumer_key==='canonical_baseline').detail.readback[0].source,cid=source.communityId;
  assert.equal(snapshot.lines.length,1168);started=performance.now();const prior=await projected(snapshotText,true),priorProjectionMs=Math.round(performance.now()-started);started=performance.now();assert.equal(await projected(snapshotText),prior);const projectionMs=Math.round(performance.now()-started);
  const exact=await seedPublished(snapshotText,source,payload,cid);
  await db.exec('set session_replication_role=replica');await db.query('update atlas_reforecast_revisions set payload=$1 where revision_id=$2',[payloadText,exact.rid]);await db.exec('set session_replication_role=origin');
  assert.equal(exact.snapshot.fingerprint,snapshot.fingerprint,'retained production snapshot untouched in fixture');
  await signIn(1);started=performance.now();const projectedReport=await call('atlas_read_reforecast_publication',[exact.pid]);const reportMs=Math.round(performance.now()-started);assert.equal(projectedReport.verified,true);assert.equal(projectedReport.reportContentHash,'ed80e24e47bbf81ce754ef22bc6682c21fe368a3107078bed4ce6f432cecf448','exact retained report fingerprint');
  started=performance.now();assert.equal((await call('atlas_verify_budget_consumer',[exact.pid,'pdf_export',randomUUID(),exact.rid,projectedReport.reportContentHash])).delivery_status,'verified');const deliveryMs=Math.round(performance.now()-started);
  proof.privateSource={snapshotFingerprint:snapshot.fingerprint,reportFingerprint:projectedReport.reportContentHash,lines:1168,priorProjectionMs,projectionMs,reportMs,deliveryMs};
  // Use exact approved original-budget rows and formulas for all 12 months,
  // with the retained published snapshot controlling the last four months.
  // Retain native governed actuals and all base-reader joined provenance.
  await db.exec('reset role');const originalBudget=get('doro-approved-budget-payload.json'),budgetId=source.baseline.versionIds[0],registry=get('doro-v2-registry-exact.json');
  await db.query("insert into atlas_approved_budget_versions values($1,$2,2026,'locked',$3,$4,$5,$6)",[budgetId,cid,Array.from({length:12},(_,i)=>i),originalBudget,originalBudget.sourceFile,originalBudget.sourceHash]);
  await db.query("insert into atlas_reforecast_registries(version_id,community_id,request_id,effective_date,payload,content_hash,created_by,created_role) values($1,$2,$3,'2026-09-28',$4,'isolated-retained-registry',$5,'admin')",[source.registry.version,cid,randomUUID(),registry,owner]);
  await db.query('insert into atlas_reforecast_registry_heads values($1,$2)',[cid,source.registry.version]);
  const native=get('doro-native-finance-read-inputs.json');assert.equal(native.rows.length,12);
  for(const row of native.rows)await db.query('insert into fixture_financial_summaries values($1,$2,$3,$4,$5)',[row.community_id,row.period_key,row.fiscal_year,row.publication_id,row.summary_text]);
  const shape=JSON.parse(native.rows[0].summary_text);
  proof.privateSource={...proof.privateSource,originalBudgetRows:originalBudget.rows.length,...await compareFinanceYear(cid,exact.pid,'Exact retained native'),inputKeys:Object.keys(shape).length,monthlyMetrics:Object.values(shape).filter(v=>v&&typeof v==='object'&&Object.hasOwn(v,'budget')).length,ytdMetrics:Object.keys(shape.ytd).length,inputBytes:native.rows.reduce((n,r)=>n+Buffer.byteLength(r.summary_text),0),inputHash:createHash('sha256').update(native.rows.map(r=>r.summary_text).join('')).digest('hex')};
  assert(reportMs<20000&&deliveryMs<20000,'exact volume reader and consumer must finish within existing browser deadline');
 }
 assert(publicReportMs<20000&&ackMs<20000);await db.close();console.log(JSON.stringify(proof));
 if(process.env.ATLAS_REPORT_PROOF_PATH)fs.writeFileSync(process.env.ATLAS_REPORT_PROOF_PATH,JSON.stringify(proof,null,2)+'\n');
})().catch(error=>{console.error(error.message,error.where||'',error.stack);process.exitCode=1});
