// Real canonical-reader/report integration on the complete checked-in migration
// chain. No reader stubs, replaced SQL functions, remote calls, or live data.
const assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');
const {migrationHistoryFixture}=require('./migration-history-fixture.cjs');

(async()=>{
 const {db,migrations}=await migrationHistoryFixture({includeLater:true});
 try{
  assert(migrations.includes('20260928213956_community_plan_governed_economic_occupancy.sql'));
  const admin=randomUUID(),authorized=randomUUID(),outside=randomUUID(),community=randomUUID(),other=randomUUID();
  for(const [id,name]of [[community,'Synthetic Accounting Community'],[other,'Synthetic Separate Community']])
   await db.query("insert into atlas_communities(community_id,canonical_name,display_name,status) values($1,$2,$2,'active')",[id,name]);
  for(const [id,role,scope]of [[admin,'admin',[community]],[authorized,'regional',[community]],[outside,'community_manager',[other]]]){
   await db.query('insert into auth.users(id) values($1)',[id]);
   await db.query("insert into atlas_user_profiles(user_id,email,display_name,role,status,account_status,allowed_community_ids) values($1,$2,'Synthetic finance reader',$3,'active','active',$4)",[id,id+'@example.invalid',role,scope]);
  }
  const signIn=async(id,authenticated=true)=>{
   await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[id||'',JSON.stringify(id?{sub:id}:{})]);
   if(authenticated)await db.exec('set role authenticated');
  };
  const call=async(name,args)=>(await db.query('select to_jsonb(public.'+name+'('+args.map((_,index)=>'$'+(index+1)).join(',')+')) result',args)).rows[0].result;
  const calendar=(await db.query("select to_char(statement_timestamp() at time zone 'UTC','YYYY-MM') current_period,to_char((statement_timestamp() at time zone 'UTC')-interval '1 month','YYYY-MM') closed_period,to_char((statement_timestamp() at time zone 'UTC')-interval '2 months','YYYY-MM') missing_period")).rows[0];
  const period=calendar.closed_period,version=randomUUID(),review=randomUUID(),comparison=randomUUID();
  const sourceFile='synthetic-approved-'+period+'.pdf',sourceHash=createHash('sha256').update(sourceFile).digest('hex');
  const metrics={grossPotentialRent:3,netRentalIncome:1,totalIncome:1,operatingExpenses:0,netOperatingIncome:1,sourceControls:{'Net Cash Flow':{actual:1}}};
  const readerBefore=(await db.query("select pg_get_functiondef('public.atlas_read_finance(uuid[],text[])'::regprocedure) definition")).rows[0].definition;
  // Seed an already accepted historical package as the local fixture owner.
  // All foreign keys, check constraints, source guards and publication triggers
  // remain enabled. The approval workflow has its own month-end gate tests.
  // The reads, report generation and formal reopening below use ordinary roles.
  await signIn(admin,false);
  await db.query("insert into atlas_financial_package_reviews(review_id,community_id,period_key,source_property,source_file,source_hash,accounting_basis,parser_version,content_hash,certificate,created_by) values($1,$2,$3,'Synthetic Accounting Community',$4,$5,'accrual',1,$5,$6,$7)",
   [review,community,period,sourceFile,sourceHash,{intakeEvidence:{governance:{review:{owner:admin}}}},admin]);
  await db.query("insert into atlas_financial_comparison_versions(version_id,community_id,period_key,review_id,content_hash,source_hash,source_file,accounting_basis,row_count,reason,applied_by) values($1,$2,$3,$4,$5,$5,$6,'accrual',2,'Accepted synthetic historical accounting package',$7)",
   [comparison,community,period,review,sourceHash,sourceFile,admin]);
  await db.query("insert into atlas_financial_close_versions(version_id,community_id,period_key,accounting_basis,comparison_version_id,review_id,revision,source_hash,source_file,content_hash,approved_by,reason,row_count,metrics,mapping) values($1,$2,$3,'accrual',$4,$5,1,$6,$7,$6,$8,'Accepted synthetic historical close',2,$9,'{}')",
   [version,community,period,comparison,review,sourceHash,sourceFile,admin,metrics]);
  for(const [gl,name,amount]of [['5120','Gross Potential Rent',3],['5130','Rental concessions',-2]]){
   await db.query('insert into atlas_financial_comparison_rows(version_id,community_id,gl_code,account_name,actual,source_location) values($1,$2,$3,$4,$5,$6)',[comparison,community,gl,name,amount,{page:1,sourceFile}]);
   await db.query('insert into atlas_financial_close_rows(version_id,community_id,gl_code,account_name,actual,source_location) values($1,$2,$3,$4,$5,$6)',[version,community,gl,name,amount,{page:1,sourceFile}]);
  }
  await db.query('insert into atlas_financial_close_heads(community_id,period_key,version_id) values($1,$2,$3)',[community,period,version]);
  await signIn(admin);
  const read=async()=> (await db.query('select * from atlas_read_finance($1,$2)',[[community],[period]])).rows[0];
  const canonical=await read();
  assert(canonical.publication_id,'The real close-head trigger produces a canonical financial publication');
  assert.equal(canonical.summary.registryVersion,'atlas-finance-v1');
  assert.equal(canonical.summary.actualCloseVersion,version);assert.equal(canonical.summary.close.version_id,version);
  assert.equal(canonical.summary.period,period);assert.equal(canonical.summary.close.period_key,period);
  assert.equal(canonical.summary.periodState,'locked');assert.equal(canonical.summary.close.status,'closed');
  assert.equal(canonical.summary.close.coverage,'full_month');assert.equal(canonical.summary.close.metrics.netRentalIncome,1);assert.equal(canonical.summary.close.metrics.grossPotentialRent,3);
  const {isGovernedEconomicClose}=await import('../docs/portfolio-operations-dashboard/features/financial-close.mjs');
  assert(isGovernedEconomicClose(canonical.summary),'Actual SQL envelope satisfies the shared browser predicate');
  const plans=[];
  for(const selected of [period,calendar.current_period,calendar.missing_period])plans.push(await call('atlas_save_community_plan',[community,selected,0,{tasks:[],stage:'Active'}]));
  const generate=plan=>call('atlas_generate_community_plan_report',[plan.plan_id,plan.version,'Real canonical reader integration',null]);
  const exact=await generate(plans[0]),current=await generate(plans[1]),missing=await generate(plans[2]);
  for(const [report,state]of [[exact,'closed_exact'],[current,'open_month_latest_close']]){
   const economic=report.snapshot.closedEconomicOccupancy;
   assert.equal(report.snapshot.reportSchemaVersion,6);assert.equal(economic.state,state);assert.equal(economic.displayedClosePeriod,period);
   assert.equal(economic.closedPct,1/3*100,'Raw report percentage equals the browser calculation before formatting');
   assert.equal(economic.closeVersionId,version);assert.equal(economic.source,sourceFile);assert.equal(economic.sourceHash,sourceHash);
   assert.equal(economic.approvedBy,admin);assert(economic.approvedAt);assert.equal(economic.netRentalIncome,1);assert.equal(economic.grossPotentialRent,3);
  }
  assert.equal(current.snapshot.closedEconomicOccupancy.selectedPeriod,calendar.current_period);
  assert.equal(missing.snapshot.closedEconomicOccupancy.state,'missing_historical_close');assert.equal(missing.snapshot.closedEconomicOccupancy.closedPct,null);
  await signIn(authorized);
  assert.equal((await read()).summary.actualCloseVersion,version);assert.equal((await generate(plans[1])).report_id,current.report_id,'A second authorized session reuses the same immutable report');
  await signIn(outside);
  assert.equal(await read(),undefined,'Real canonical reader enforces community authorization');
  assert.equal((await db.query('select * from atlas_community_plan_reports where report_id=$1',[current.report_id])).rows.length,0,'Report RLS excludes out-of-scope source evidence');
  await assert.rejects(()=>generate(plans[1]),/access denied/);
  await signIn(admin);
  await call('atlas_reopen_actual_period',[community,period,version,'Synthetic source correction requires formal reopening',randomUUID()]);
  const reopened=await read();assert.equal(reopened.summary.periodState,'reopened');assert.equal(reopened.summary.close.status,'closed','Immutable prior close remains stored while the period is reopened');
  assert.equal(reopened.summary.actualCloseVersion,version);assert.equal(isGovernedEconomicClose(reopened.summary),false);
  const revised=await generate(plans[0]),revisedCurrent=await generate(plans[1]);
  for(const report of [revised,revisedCurrent]){assert.equal(report.snapshot.closedEconomicOccupancy.state,'reopened_or_superseded');assert.equal(report.snapshot.closedEconomicOccupancy.closedPct,null);}
  assert.notEqual(revised.report_id,exact.report_id);
  assert.equal((await db.query('select snapshot from atlas_community_plan_reports where report_id=$1',[exact.report_id])).rows[0].snapshot.closedEconomicOccupancy.closedPct,1/3*100,'Reopening does not rewrite retained report evidence');
  await db.exec('reset role');assert.equal((await db.query("select pg_get_functiondef('public.atlas_read_finance(uuid[],text[])'::regprocedure) definition")).rows[0].definition,readerBefore,'The actual migrated canonical reader was never replaced');
  await db.exec('set role anon');await assert.rejects(read,/permission denied/);await assert.rejects(()=>generate(plans[1]),/permission denied/);
  console.log(`PASS ${migrations.length} real migrations, native close publication and canonical reader, exact/latest selected periods, raw percentage/version/provenance, formal reopen, immutable reports, independent-session reuse and actual role/RLS isolation`);
 }finally{await db.close();}
})().catch(error=>{console.error(error.message,error.where||error.detail||'',error.migrationFile||'');process.exitCode=1;});
