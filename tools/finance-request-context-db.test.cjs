// Exact JSON parity against the previously deployed reader, using synthetic local evidence only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {fixture}=require('./reforecast-fixture.cjs');
const root=path.join(__dirname,'..'),sql=name=>fs.readFileSync(path.join(root,'docs/portfolio-operations-dashboard/centralization',name+'.sql'),'utf8');
(async()=>{
 const {db,A,B,BUDGET,CLOSE,signIn}=await fixture();await db.exec('reset role');
 const second=randomUUID(),prior=randomUUID(),other=randomUUID(),empty=randomUUID();
 const original=(await db.query('select payload from atlas_approved_budget_versions where version_id=$1',[BUDGET])).rows[0].payload;
 const part=(glCode,factor=1)=>({glCode,factor});
 const metricMappings={gpr:[part('5120')],netRentalIncome:[part('5120'),part('5220')],revenue:[part('5120'),part('5220')],expenses:[part('6100'),part('6200')],noi:[part('5120'),part('5220'),part('6100',-1),part('6200',-1)],cashFlow:[part('5120'),part('5220'),part('6100',-1),part('6200',-1),part('8100',-1)],capital:[part('8100')],debt:[part('missing')]};
 const payload={...original,metricMappings};
 await db.query('update atlas_approved_budget_versions set payload=$1,covered_months=$2 where version_id=$3',[JSON.stringify(payload),[0,1,2,3,4,5],BUDGET]);
 for(const [id,cid,year,months]of[[second,A,2026,[6,7,8,9,10,11]],[prior,A,2025,Array.from({length:12},(_,i)=>i)],[other,B,2026,Array.from({length:12},(_,i)=>i)]])await db.query("insert into atlas_approved_budget_versions values($1,$2,$3,'locked',$4,$5,'Synthetic.xlsx','fixture-hash')",[id,cid,year,months,JSON.stringify(payload)]);
 await db.query("insert into atlas_communities(community_id,status) values($1,'active')",[empty]);
 await db.exec(`create table fixture_financial_summaries(community_id uuid,period_key text,fiscal_year integer,publication_id uuid,summary jsonb);
 create function public.atlas_read_finance(p_community_ids uuid[],p_periods text[]) returns table(community_id uuid,period_key text,fiscal_year integer,publication_id uuid,summary jsonb) language plpgsql stable security definer set search_path='' as $$begin
 if auth.uid() is null or coalesce(cardinality(p_community_ids),0) not between 1 and 100 or coalesce(cardinality(p_periods),0) not between 1 and 24 or cardinality(p_community_ids)*cardinality(p_periods)>1200 or exists(select 1 from unnest(p_periods)p where p is null or p!~'^20[0-9]{2}-(0[1-9]|1[0-2])$') then raise exception 'Invalid finance read scope';end if;
 return query select f.* from public.fixture_financial_summaries f where f.community_id=any(p_community_ids) and f.period_key=any(p_periods) and atlas_private.command_access(f.community_id);end;$$;`);
 const metricNames=[...Object.keys(metricMappings),'grossIncome','contraRevenue','belowNoi','assets','liabilities','equity','margin',...Array.from({length:16},(_,i)=>'unsupported'+i)];
 const month=(year,i)=>year+'-'+String(i+1).padStart(2,'0'),yearMonths=Array.from({length:12},(_,i)=>month(2026,i));
 const budgetFor=(cid,p)=>cid===B?other:p<'2026-01'?prior:p<'2026-07'?BUDGET:second;
 for(const cid of[A,B])for(const period of yearMonths){
  const p=Number(period.slice(5)),fyStart=cid===A&&p<8?'2025-08':cid===A?'2026-08':'2026-01';
  const dates=[];for(let d=new Date(fyStart+'-01T00:00:00Z');d.toISOString().slice(0,7)<=period;d.setUTCMonth(d.getUTCMonth()+1))dates.push(d.toISOString().slice(0,7));
  const metrics=Object.fromEntries(metricNames.map((k,i)=>[k,{actual:i%5===0?null:i%3===0?0:-20+i,budget:i===0?0:i%4===0?null:10+i,status:'fixture',label:'Retained input'}]));
  const s={registryVersion:'atlas-finance-v1',communityId:cid,period,budgetVersion:budgetFor(cid,period),budgetVersions:Object.fromEntries(dates.map(p=>[p,budgetFor(cid,p)])),actualCloseVersion:period==='2026-01'?CLOSE:null,fiscalPeriods:dates,...metrics,ytd:structuredClone(metrics),unchanged:{sourceFile:'Synthetic-only.xlsx',n:0,missing:null}};
  await db.query('insert into fixture_financial_summaries values($1,$2,2026,$3,$4)',[cid,period,randomUUID(),JSON.stringify(s)]);
 }
 await db.exec(sql('reforecast-builder'));
 // Instrument only this local fixture. The production migration contains no counters or GUC writes.
 await db.exec(`alter function atlas_private.reforecast_metric(jsonb,text) rename to fixture_original_metric;
 create function atlas_private.reforecast_metric(lines jsonb,field text) returns jsonb language plpgsql immutable as $$begin perform set_config('fixture.metric_calls',(coalesce(nullif(current_setting('fixture.metric_calls',true),''),'0')::int+1)::text,false);return atlas_private.fixture_original_metric(lines,field);end;$$;
 alter function public.atlas_reforecast_effective_baseline(uuid[],text[]) rename to fixture_original_baseline;
 create function public.atlas_reforecast_effective_baseline(p_community_ids uuid[],p_periods text[]) returns jsonb language plpgsql stable security definer set search_path='' as $$begin perform set_config('fixture.baseline_months',(coalesce(nullif(current_setting('fixture.baseline_months',true),''),'0')::int+cardinality(p_community_ids)*cardinality(p_periods))::text,false);return public.fixture_original_baseline(p_community_ids,p_periods);end;$$;`);
 const counts=async()=> (await db.query("select current_setting('fixture.metric_calls')::int metrics,current_setting('fixture.baseline_months')::int baselines")).rows[0];
 const read=async(ids,periods)=> (await db.query('select r.*,to_jsonb(r)::text as exact_json from atlas_read_finance($1,$2)r order by community_id,period_key',[ids,periods])).rows;
 const scopes=[[[A,B,empty],yearMonths],[[A],['2026-12','2026-02']],[[B,A],['2026-08','2026-01']],[[empty],['2026-02']],[[A,A],['2026-02','2026-02']]];
 async function parity(label,{all=false}={}){
  await db.exec('reset role');await db.exec(sql('finance-request-context.rollback'));await signIn(1);await db.exec("set fixture.metric_calls='0';set fixture.baseline_months='0'");
  const wanted=all?scopes:[scopes[1]],before=[];for(const scope of wanted)before.push(await read(...scope));const oldCounts=await counts();
  await db.exec('reset role');await db.exec(sql('finance-request-context'));await signIn(1);await db.exec("set fixture.metric_calls='0';set fixture.baseline_months='0'");
  for(let i=0;i<wanted.length;i++)assert.deepEqual(await read(...wanted[i]),before[i],label+' complete output including all lineage and null fields');
  const newCounts=await counts();if(all){assert(newCounts.metrics*5<oldCounts.metrics,JSON.stringify({oldCounts,newCounts}));assert(newCounts.baselines<oldCounts.baselines);console.log('Work counts',JSON.stringify({oldCounts,newCounts}));}
  return before;
 }
 await parity('Original mappings without registry, cross-year fiscal periods, split budgets, negative/zero/missing and unknown metrics',{all:true});
 await db.exec('reset role');await db.query("update atlas_approved_budget_versions set payload=jsonb_set(payload,'{rows,2,monthly,1}','null') where version_id=$1",[BUDGET]);await parity('Missing monthly GL target remains missing in YTD');
 await db.exec('reset role');await db.query("update atlas_approved_budget_versions set payload=jsonb_set(payload,'{rows,2,monthly,1}','0') where version_id=$1",[BUDGET]);await parity('Zero remains a valid monthly target');
 await db.exec('reset role');await db.query("update atlas_approved_budget_versions set payload=jsonb_set(payload,'{rows,2,monthly,1}','200') where version_id=$1",[BUDGET]);await signIn(1);
 const call=async(name,args)=>(await db.query(`select to_jsonb(${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})) result`,args)).rows[0].result;
 const accounts=[['5120','income','above_noi'],['5220','contra_income','above_noi'],['6100','expense','above_noi'],['6200','expense','above_noi'],['8100','capital','below_noi']].map(([accountCode,nature,placement])=>({accountCode,category:accountCode,nature,placement,effectiveFrom:'2025-01'}));
 const registry=await call('atlas_save_reforecast_registry',[A,null,randomUUID(),JSON.stringify({accounts,driverMappings:{},reason:'Synthetic reviewed mapping',effectiveDate:'2025-01-01'})]);
 const periods=['2026-02'],uid='00000000-0000-0000-0000-000000000001';
 const base={name:'Synthetic parity forecast',governanceSchemaVersion:2,calendar:{basis:'calendar',startMonth:1,confirmed:true,periods,scenario:'Synthetic parity',reviewedBy:uid,reviewedAt:'2026-09-24T10:00:00Z'},model:'mixed',periods,baselineType:'original_budget',baselineVersionIds:[BUDGET],registryVersionId:registry.version_id,ownerId:uid,reviewerId:'00000000-0000-0000-0000-000000000005',drivers:[],overrides:[{period:'2026-02',accountCode:'6100',amount:215,reason:'Synthetic change'}],reason:'Parity proof'};
 let scenario=await call('atlas_save_reforecast_scenario',[A,randomUUID(),0,randomUUID(),'save_draft',JSON.stringify(base)]);
 for(const action of['reconcile','ready','submit','approve_lock'])scenario=await call('atlas_save_reforecast_scenario',[A,scenario.head.scenario_id,scenario.head.revision,randomUUID(),action,JSON.stringify(scenario.revision.payload)]);
 await parity('Mixed original and approved forecast monthly/YTD ancestry');
 await db.exec('reset role');await db.query("update atlas_financial_close_versions set source_hash='changed-fixture-source' where version_id=$1",[CLOSE]);await parity('Stale linked close fails closed');
 await db.exec('reset role');await db.query("update atlas_financial_close_versions set source_hash='close-sha' where version_id=$1",[CLOSE]);await signIn(1);
 await call('atlas_reopen_reforecast',[scenario.head.scenario_id,scenario.head.revision,randomUUID(),'Synthetic reopen for parity']);await parity('Reopened forecast stays unavailable');
 await signIn(2);assert((await read([A,B],yearMonths)).every(r=>r.community_id===A));await signIn(4);assert((await read([A,B],yearMonths)).every(r=>r.community_id===B));
 await db.exec('reset role');await db.exec("update atlas_user_profiles set status='disabled' where user_id='00000000-0000-0000-0000-000000000004'");await signIn(4);assert.deepEqual(await read([A,B],yearMonths),[]);
 await db.exec("reset role;set request.jwt.claim.sub='';set role authenticated");await assert.rejects(()=>read([A],['2026-01']),/scope/);await db.exec('reset role;set role anon');await assert.rejects(()=>read([A],['2026-01']),/permission/);
 await db.exec('reset role');for(const f of['reforecast_finance_month(jsonb,jsonb,jsonb)','reforecast_finance_context(jsonb,jsonb)','reforecast_finance_summary_context(jsonb,jsonb,jsonb)','reforecast_finance_summary(jsonb,jsonb)']){const p=(await db.query("select has_function_privilege('authenticated',$1,'EXECUTE') a,has_function_privilege('anon',$1,'EXECUTE') n",['atlas_private.'+f])).rows[0];assert.equal(p.a,false);assert.equal(p.n,false);}
 await signIn(1);await assert.rejects(()=>read([A],['2026-99']),/months/);await assert.rejects(()=>read([],['2026-01']),/scope/);
 // Original helper signature used by Bonus receives exactly the same result after optimization.
 await db.exec('reset role');const s=(await db.query('select summary from fixture_financial_summaries where community_id=$1 and period_key=$2',[A,'2026-12'])).rows[0].summary;
 const baseline=(await call('atlas_reforecast_effective_baseline',[[A],['2026-12']]))[0];await db.exec('reset role');await db.exec(sql('finance-request-context.rollback'));const expected=(await db.query('select atlas_private.reforecast_finance_summary($1,$2)::text result',[JSON.stringify(s),JSON.stringify(baseline)])).rows[0].result;await db.exec(sql('finance-request-context'));assert.deepEqual((await db.query('select atlas_private.reforecast_finance_summary($1,$2)::text result',[JSON.stringify(s),JSON.stringify(baseline)])).rows[0].result,expected);
 const migration=fs.readFileSync(path.join(root,'supabase/migrations/20260924203341_finance_request_context.sql'),'utf8');assert.equal(migration,sql('finance-request-context'));await db.close();
 console.log('PASS exact complete finance JSON parity, request-local work reduction, preserved Bonus helper, access denial, and reversible function-only migration');
})().catch(e=>{console.error(e.message,e.where||'',e.stack);process.exitCode=1});
