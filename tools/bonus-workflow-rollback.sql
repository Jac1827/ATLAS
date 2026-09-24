-- Production-schema acceptance: synthetic setup only; REVIEW and run the WHOLE file in one call.
-- No existing employee, plan, close, budget or payment is selected for mutation.
-- No Auth API, payroll provider or financial transfer is invoked.
-- A forced subtransaction rollback plus outer ROLLBACK leave no synthetic business data.
begin;
set local statement_timeout='45s';
set local lock_timeout='3s';
do $acceptance$
<<acceptance>>
declare
 cid uuid:=gen_random_uuid();other_cid uuid:=gen_random_uuid();admin_id uuid:=gen_random_uuid();calculator_id uuid:=gen_random_uuid();reviewer_id uuid:=gen_random_uuid();outside_id uuid:=gen_random_uuid();
 employee_id uuid:=gen_random_uuid();assignment_id uuid:=gen_random_uuid();role_id uuid:=gen_random_uuid();budget_id uuid:=gen_random_uuid();review_id uuid;comparison_id uuid;close_id uuid;
 starts date:=(date_trunc('quarter',current_date)-interval '3 months')::date;ends date:=(date_trunc('quarter',current_date)-interval '1 day')::date;
 period_key text;yr int;month text;months int[];d date;rows jsonb;mapping jsonb;metrics jsonb;config jsonb;plan jsonb;run jsonb;retry jsonb;request_id uuid:=gen_random_uuid();denied boolean;proof jsonb;trigger_name text;receipts jsonb;
begin
 if to_regprocedure('public.atlas_bonus_workflow(uuid,text,integer,jsonb,uuid)') is null then raise exception 'Apply reviewed Bonus workflow migration before acceptance';end if;
 -- Reject unreviewed Auth/profile bootstrap or outbound behavior before the first fixture write.
 if exists(select 1 from pg_trigger t where not t.tgisinternal and t.tgenabled<>'D' and t.tgrelid='auth.users'::regclass) then raise exception 'Acceptance stopped: unreviewed Auth bootstrap trigger';end if;
 select t.tgname into trigger_name from pg_trigger t join pg_proc f on f.oid=t.tgfoid where not t.tgisinternal and t.tgenabled<>'D' and t.tgrelid=any(array['public.atlas_user_profiles'::regclass,'public.atlas_employees'::regclass,'public.atlas_employee_assignments'::regclass,'public.atlas_roles'::regclass,'public.atlas_communities'::regclass]) and f.proname not in ('workforce_changed','bonus_eligibility_guard','profile_access_guard') limit 1;
 if trigger_name is not null then raise exception 'Acceptance stopped: unreviewed identity/workforce trigger %',trigger_name;end if;
 if exists(select 1 from pg_proc f join pg_namespace n on n.oid=f.pronamespace where f.prokind='f' and (n.nspname='atlas_private' or n.nspname='public' and f.proname like 'atlas_%') and f.prosrc~* '(net[.]http|http_(get|post|put|delete)|pg_net|pg_notify|dblink|pg_background|send_email|webhook)') then raise exception 'Acceptance stopped: outbound-capable application function requires review';end if;
 period_key:=to_char(starts,'YYYY')||'-Q'||extract(quarter from starts)::int;yr:=extract(year from starts);
 begin
  insert into auth.users(id) values(admin_id),(calculator_id),(reviewer_id),(outside_id);
  insert into public.atlas_communities(community_id,canonical_name,display_name,status,units,source_module,first_expected_financial_period) values(cid,'bonus-rollback-'||cid,'Synthetic Bonus Rollback','active',2,'rollback_acceptance',to_char(starts,'YYYY-MM')),(other_cid,'bonus-outside-'||other_cid,'Synthetic Outside','active',1,'rollback_acceptance',to_char(starts,'YYYY-MM'));
  insert into public.atlas_user_profiles(user_id,email,display_name,role,status,allowed_community_ids,locked_tab_ids,locked_page_keys,bonus_permissions) values
  (admin_id,admin_id||'@acceptance.invalid','Synthetic Setup Admin','admin','active','{}','{}','{}','{}'),
  (calculator_id,calculator_id||'@acceptance.invalid','Synthetic Calculator','finance','active',array[cid],'{}','{}',array['view_bonus_module','run_calculations','approve_bonuses']),
  (reviewer_id,reviewer_id||'@acceptance.invalid','Synthetic Reviewer','regional','active',array[cid],'{}','{}','{}'),
  (outside_id,outside_id||'@acceptance.invalid','Synthetic Outside','community_manager','active',array[other_cid],'{}','{}','{}');
  insert into public.atlas_roles(role_id,role_code,title,bonus_role_type) values(role_id,'rollback-'||role_id,'Synthetic Quarterly Role','gm');
  insert into public.atlas_employees(employee_id,full_name,status,source_module) values(employee_id,'Synthetic Bonus Employee','Active','rollback_acceptance');
  insert into public.atlas_employee_assignments(assignment_id,employee_id,community_id,role_id,title,employment_status,primary_assignment,effective_start,effective_end,source_module) values(assignment_id,employee_id,cid,role_id,'Synthetic Quarterly Role','Active',true,starts,ends,'rollback_acceptance');
  perform set_config('request.jwt.claim.sub',admin_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  select jsonb_agg(jsonb_build_object('glCode',code,'name',name,'nature',nature,'group',name,'monthly',to_jsonb(array_fill(amount,array[12])))) into rows from (values('5120','Rent','income',1000::numeric),('5220','Vacancy','contra_income',-50::numeric),('6100','Payroll','expense',200::numeric),('6200','Utilities','expense',50::numeric),('8100','Capital','capital',20::numeric))v(code,name,nature,amount);
  mapping:='{"gpr":[{"glCode":"5120","factor":1}],"revenue":[{"glCode":"5120","factor":1},{"glCode":"5220","factor":1}],"expenses":[{"glCode":"6100","factor":1},{"glCode":"6200","factor":1}],"noi":[{"glCode":"5120","factor":1},{"glCode":"5220","factor":1},{"glCode":"6100","factor":-1},{"glCode":"6200","factor":-1}],"cashFlow":[{"glCode":"5120","factor":1},{"glCode":"5220","factor":1},{"glCode":"6100","factor":-1},{"glCode":"6200","factor":-1},{"glCode":"8100","factor":-1}]}'::jsonb;
  select array_agg(extract(month from v)::int-1) into months from generate_series(starts,ends,interval '1 month')v;
  -- Privileged synthetic facts exercise Bonus against the real canonical schema/projection.
  -- This test does not claim to test accounting intake approval itself.
  insert into public.atlas_approved_budget_versions(version_id,community_id,calendar_year,fiscal_year,fiscal_start_month,scenario_id,scenario_version,effective_date,source_file,source_hash,content_hash,approved_by,covered_months,payload) values(budget_id,cid,yr,yr,1,'bonus-rollback','one',starts,'synthetic-bonus-budget.xlsx',repeat('a',64),repeat('b',64),admin_id,months,jsonb_build_object('rows',rows,'metricMappings',mapping));
  for d in select generate_series(starts,ends,interval '1 month')::date loop
   month:=to_char(d,'YYYY-MM');review_id:=gen_random_uuid();comparison_id:=gen_random_uuid();close_id:=gen_random_uuid();
   insert into public.atlas_financial_package_reviews(review_id,community_id,period_key,source_property,source_file,source_hash,accounting_basis,parser_version,content_hash,certificate,created_by) values(review_id,cid,month,'Synthetic Bonus Rollback','synthetic-close.pdf',repeat('c',64),'accrual',1,repeat('d',64),jsonb_build_object('intakeEvidence',jsonb_build_object('governance',jsonb_build_object('review',jsonb_build_object('owner',admin_id)))),admin_id);
   insert into public.atlas_financial_comparison_versions(version_id,community_id,period_key,review_id,content_hash,source_hash,source_file,accounting_basis,row_count,reason,applied_by) values(comparison_id,cid,month,review_id,repeat('d',64),repeat('c',64),'synthetic-close.pdf','accrual',5,'Synthetic close fixture',admin_id);
   metrics:='{"grossPotentialRent":1050,"netRentalIncome":997.5,"totalIncome":997.5,"operatingExpenses":225,"netOperatingIncome":772.5,"sourceControls":{"Net Cash Flow":{"actual":752.5}}}'::jsonb;
   insert into public.atlas_financial_close_versions(version_id,community_id,period_key,accounting_basis,comparison_version_id,review_id,revision,source_hash,source_file,content_hash,approved_by,reason,row_count,metrics,mapping) values(close_id,cid,month,'accrual',comparison_id,review_id,1,repeat('c',64),'synthetic-close.pdf',repeat('d',64),admin_id,'Synthetic close fixture',5,metrics,'{}');
   insert into public.atlas_financial_close_rows(version_id,community_id,gl_code,account_name,actual,source_location) select close_id,cid,code,name,actual,'{"file":"synthetic-close.pdf","page":1}'::jsonb from(values('5120','Rent',1050::numeric),('5220','Vacancy',-52.5::numeric),('6100','Payroll',180::numeric),('6200','Utilities',45::numeric),('8100','Capital',20::numeric))v(code,name,actual);
   insert into public.atlas_financial_close_heads values(cid,month,'accrual',close_id);
  end loop;
  perform atlas_private.project_finance(cid);
  execute 'set local role authenticated';
  config:=jsonb_build_object('name','Synthetic rollback financial scorecard','roleId',role_id,'effectiveStart',starts,'effectiveEnd',ends,'targetBonus',1000,'maximumPayout',1000,'eligibilityRules',jsonb_build_object('requireBonusEligible',true,'communityIds',jsonb_build_array(cid)),'metrics','[{"id":"revenue","metricKey":"revenue","goal":100,"weight":50,"thresholdCurve":[{"thresholdPct":0,"payoutPct":0},{"thresholdPct":100,"payoutPct":80},{"thresholdPct":105,"payoutPct":100}]},{"id":"expenses","metricKey":"expenses","goal":100,"weight":50,"thresholdCurve":[{"thresholdPct":0,"payoutPct":0},{"thresholdPct":100,"payoutPct":80},{"thresholdPct":105,"payoutPct":100}]}]'::jsonb,'reason','Synthetic explicit plan setup');
  plan:=public.atlas_bonus_plan_save(null,0,config,gen_random_uuid());
  perform public.atlas_bonus_eligibility_save(employee_id,1,jsonb_build_object('bonusEligible',true,'bonusEffectiveDate',starts,'reason','Synthetic explicit eligibility'),gen_random_uuid());
  perform set_config('request.jwt.claim.sub',calculator_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',calculator_id,'role','authenticated')::text,true);
  config:=jsonb_build_object('assignmentId',assignment_id,'planId',plan->'id','periodKey',period_key,'reason','Synthetic canonical calculation');
  run:=public.atlas_bonus_workflow(null,'draft',0,config,request_id);retry:=public.atlas_bonus_workflow(null,'draft',0,config,request_id);
  if run is distinct from retry or (run->>'totalPayout')::numeric<>1000 or (run->'calculation'->'metricResults'->0->>'rawActual')::numeric<>2992.5 or (run->'calculation'->'metricResults'->0->>'baseline')::numeric<>2850 or (run->'calculation'->'metricResults'->1->>'variance')::numeric<>-75 or (run->'calculation'->'metricResults'->1->>'actual')::numeric<>110 then raise exception 'Canonical formula or idempotent readback mismatch';end if;
  run:=public.atlas_bonus_workflow((run->>'runId')::uuid,'submit',(run->>'revision')::int,'{"reason":"Synthetic submit"}',gen_random_uuid());
  denied:=false;begin perform public.atlas_bonus_workflow((run->>'runId')::uuid,'approve',(run->>'revision')::int,'{"reason":"Synthetic self approval"}',gen_random_uuid());exception when others then if sqlerrm not like '%different authorized reviewer%' then raise;end if;denied:=true;end;if not denied then raise exception 'Self approval accepted';end if;
  perform set_config('request.jwt.claim.sub',reviewer_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',reviewer_id,'role','authenticated')::text,true);
  denied:=false;begin perform public.atlas_bonus_workflow((run->>'runId')::uuid,'approve',1,'{"reason":"Synthetic stale revision"}',gen_random_uuid());exception when others then if sqlerrm not like '%revision changed%' then raise;end if;denied:=true;end;if not denied then raise exception 'Stale revision accepted';end if;
  run:=public.atlas_bonus_workflow((run->>'runId')::uuid,'approve',(run->>'revision')::int,'{"reason":"Synthetic independent approval"}',gen_random_uuid());
  receipts:=public.atlas_read_bonus_receipts(period_key);if receipts->0->>'verified'<>'true' then raise exception 'Approved canonical receipt failed verification';end if;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  run:=public.atlas_bonus_workflow((run->>'runId')::uuid,'lock',(run->>'revision')::int,'{"reason":"Synthetic reviewed lock"}',gen_random_uuid());
  denied:=false;begin perform public.atlas_bonus_workflow((run->>'runId')::uuid,'record_external_payment',(run->>'revision')::int,jsonb_build_object('reason','Synthetic invalid amount','externalReference','rollback-'||cid,'paidDate',ends,'amount',null),gen_random_uuid());exception when others then if sqlerrm not like '%explicit finite number%' then raise;end if;denied:=true;end;if not denied then raise exception 'Missing payment amount accepted';end if;
  run:=public.atlas_bonus_workflow((run->>'runId')::uuid,'record_external_payment',(run->>'revision')::int,jsonb_build_object('reason','Synthetic external receipt; no transfer','externalReference','rollback-'||cid,'paidDate',ends,'amount',1000),gen_random_uuid());
  if run->>'status'<>'paid' or (run->'payment'->>'amount')::numeric<>1000 or public.atlas_read_bonus_receipts(period_key)->0->'period'->>'status'<>'paid' then raise exception 'External receipt readback failed';end if;
  denied:=false;begin update public.atlas_bonus_calculation_runs set total_payout=999 where bonus_calculation_run_id=(run->>'runId')::uuid;exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Direct run mutation accepted';end if;
  denied:=false;begin perform public.atlas_record_bonus_calculation(period_key,yr,'Q'||extract(quarter from starts)::int,starts,ends,'{}','locked');exception when others then if sqlerrm not like '%legacy caller-supplied%' and sqlerrm not like '%permission denied%' then raise;end if;denied:=true;end;if not denied then raise exception 'Legacy status injection accepted';end if;
  perform set_config('request.jwt.claim.sub',outside_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',outside_id,'role','authenticated')::text,true);
  if public.atlas_bonus_workspace(null)->'runs'<>'[]'::jsonb or public.atlas_read_bonus_receipts(period_key)<>'[]'::jsonb then raise exception 'Out-of-scope Bonus evidence leaked';end if;
  execute 'set local role anon';perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);
  denied:=false;begin perform public.atlas_bonus_workspace(null);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Anonymous workspace accepted';end if;
  proof:=jsonb_build_object('status','PASS','syntheticCommunityId',cid,'period',period_key,'serverQuarterlyPayout',1000,'revenueActual',2992.5,'revenueBaseline',2850,'expenseVariance',-75,'expenseAttainment',110,'idempotencyVerified',true,'independentApprovalRequired',true,'staleRevisionDenied',true,'exactApprovalReceiptVerified',true,'missingPaymentAmountDenied',true,'externalReceiptRecordedWithoutTransfer',true,'directWriteDenied',true,'legacyStatusInjectionDenied',true,'outOfScopeDenied',true,'anonymousDenied',true);
  raise exception using errcode='ZX002',message='Deliberately roll back every synthetic Bonus fixture';
 exception when sqlstate 'ZX002' then null;
 end;
 if proof is null or exists(select 1 from auth.users where id=any(array[admin_id,calculator_id,reviewer_id,outside_id])) or exists(select 1 from public.atlas_communities where community_id=any(array[cid,other_cid])) or exists(select 1 from public.atlas_employees e where e.employee_id=acceptance.employee_id) or exists(select 1 from atlas_private.bonus_workflow_heads where community_id=cid) then raise exception 'Synthetic Bonus cleanup invariant failed';end if;
 perform set_config('atlas.bonus.acceptance.result',(proof||jsonb_build_object('allSyntheticRowsRolledBack',true))::text,true);
end;
$acceptance$;
select current_setting('atlas.bonus.acceptance.result',true)::jsonb as bonus_acceptance_result;
rollback;
