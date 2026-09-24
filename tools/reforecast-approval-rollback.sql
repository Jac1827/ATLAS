-- Production-schema acceptance. REVIEW before execution. No migration or durable seed.
-- Every row write occurs inside a subtransaction deliberately rolled back by SQLSTATE ZX001.
-- The outer ROLLBACK is a second safeguard. Run the WHOLE file in one database call.
-- Requires a privileged SQL session for synthetic setup/SET LOCAL ROLE, never bypasses auth in RPCs.
-- Does not test Auth login/email, financial intake approval, Bonus approval, or payment processing.
begin;
set local statement_timeout='45s';
set local lock_timeout='3s';
do $acceptance$
declare
 cid uuid:=gen_random_uuid(); other_cid uuid:=gen_random_uuid(); admin_id uuid:=gen_random_uuid(); regional_id uuid:=gen_random_uuid(); outside_id uuid:=gen_random_uuid(); reader_id uuid:=gen_random_uuid();
 budget_id uuid:=gen_random_uuid(); test_scenario_id uuid:=gen_random_uuid(); request_id uuid:=gen_random_uuid(); approval_id uuid:=gen_random_uuid();
 p text:=to_char(current_date+interval '1 month','YYYY-MM');yr integer:=extract(year from current_date+interval '1 month');
 registry public.atlas_reforecast_registries;rec jsonb;retry jsonb;config jsonb;accounts jsonb;budget_rows jsonb;report jsonb;digest jsonb;active jsonb;baseline jsonb;before_head jsonb;approved jsonb;
 test_publication_id uuid;denied boolean;step text;baseline_count integer;proof jsonb;trigger_name text;
begin
 -- Read-only safety preflight. New Auth/bootstrap or projection triggers require review before any write.
 if exists(select 1 from pg_trigger t where not t.tgisinternal and t.tgenabled<>'D' and t.tgrelid=any(array['auth.users'::regclass,'public.atlas_user_profiles'::regclass,'public.atlas_communities'::regclass,'public.atlas_command_financial_publications'::regclass,'public.atlas_command_financial_summaries'::regclass,'public.atlas_command_findings'::regclass])) then raise exception 'Acceptance stopped: unreviewed bootstrap/projection trigger';end if;
 select t.tgname into trigger_name from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and (c.relname like 'atlas_reforecast_%' or c.relname in ('atlas_approved_budget_versions','atlas_bonus_calculation_runs')) and not t.tgisinternal and t.tgenabled<>'D' and t.tgname not in ('approved_budget_immutable','budget_projects_reporting','reforecast_immutable','reforecast_bonus_stale','reforecast_reopen_bonus_stale','reforecast_planning_publication_validation','reforecast_planning_validation','zz_reforecast_builder_validation','zzz_reforecast_utility_validation','reforecast_report_immutable','reforecast_bonus_run_immutable') limit 1;
 if trigger_name is not null then raise exception 'Acceptance stopped: unreviewed finance trigger %',trigger_name;end if;
 if exists(select 1 from pg_proc f join pg_namespace n on n.oid=f.pronamespace where f.prokind='f' and (n.nspname='atlas_private' or n.nspname='public' and f.proname like 'atlas_%') and f.prosrc~* '(net[.]http|http_(get|post|put|delete)|pg_net|pg_notify|dblink|pg_background|send_email|webhook)') then raise exception 'Acceptance stopped: outbound-capable application function requires review';end if;
 if to_regprocedure('public.atlas_read_reforecast_publication(uuid)') is null or to_regprocedure('public.atlas_capture_reforecast_digest(uuid[],text[],uuid)') is null then raise exception 'Apply reviewed Forecast Builder migrations before acceptance';end if;
 begin
  -- These UUID-only auth records have no email, password, token, identity or session.
  -- Catalog preflight above requires zero user triggers; no Auth API/email is invoked.
  insert into auth.users(id) values(admin_id),(regional_id),(outside_id),(reader_id);
  insert into public.atlas_communities(community_id,canonical_name,display_name,status,units,source_module,first_expected_financial_period)
  values(cid,'rollback-acceptance-'||cid,'Synthetic Rollback Acceptance','active',2,'rollback_acceptance',p),(other_cid,'rollback-outside-'||other_cid,'Synthetic Out-of-Scope','active',1,'rollback_acceptance',p);
  insert into public.atlas_user_profiles(user_id,email,display_name,role,status,allowed_community_ids,locked_tab_ids,locked_page_keys)
  values(admin_id,admin_id||'@acceptance.invalid','Synthetic Admin','admin','active','{}','{}','{}'),
  (regional_id,regional_id||'@acceptance.invalid','Synthetic Regional','regional','active',array[cid],'{}','{}'),
  (outside_id,outside_id||'@acceptance.invalid','Synthetic Out-of-Scope','community_manager','active',array[other_cid],'{}','{}'),
  (reader_id,reader_id||'@acceptance.invalid','Synthetic Report Reader','viewer','active',array[cid],array['12','2'],'{}');
  perform set_config('request.jwt.claim.sub',admin_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  select jsonb_agg(jsonb_build_object('glCode',code,'name',name,'nature',nature,'group',name,'monthly',to_jsonb(array_fill(amount,array[12])))),jsonb_agg(jsonb_build_object('accountCode',code,'name',name,'nature',nature,'category',name,'placement',case when nature='capital' then 'below_noi' else 'above_noi' end,'effectiveFrom',yr||'-01')) into budget_rows,accounts
  from (values('5120','Rent','income',1000::numeric),('5220','Vacancy','contra_income',-50::numeric),('6100','Payroll','expense',200::numeric),('6200','Utilities','expense',50::numeric),('8100','Capital','capital',20::numeric))v(code,name,nature,amount);
  -- Fixture setup only: create an isolated original baseline with full production columns/triggers.
  -- Existing budgets, closes and financial facts are never selected for mutation.
  insert into public.atlas_approved_budget_versions(version_id,community_id,calendar_year,fiscal_year,fiscal_start_month,scenario_id,scenario_version,effective_date,source_file,source_hash,content_hash,approved_by,covered_months,payload)
  values(budget_id,cid,yr,yr,1,'rollback-acceptance','one',make_date(yr,1,1),'synthetic-rollback-budget.xlsx',repeat('a',64),encode(sha256(convert_to(budget_rows::text,'UTF8')),'hex'),admin_id,array[substring(p,6,2)::integer-1],jsonb_build_object('rows',budget_rows,'metricMappings','{"gpr":[{"glCode":"5120","factor":1}],"revenue":[{"glCode":"5120","factor":1},{"glCode":"5220","factor":1}],"expenses":[{"glCode":"6100","factor":1},{"glCode":"6200","factor":1}],"noi":[{"glCode":"5120","factor":1},{"glCode":"5220","factor":1},{"glCode":"6100","factor":-1},{"glCode":"6200","factor":-1}],"cashFlow":[{"glCode":"5120","factor":1},{"glCode":"5220","factor":1},{"glCode":"6100","factor":-1},{"glCode":"6200","factor":-1},{"glCode":"8100","factor":-1}]}'::jsonb));
  perform set_config('request.jwt.claim.sub',admin_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);execute 'set local role authenticated';
  if current_user<>'authenticated' or auth.uid()<>admin_id then raise exception 'Real authenticated role/claim setup failed';end if;
  registry:=public.atlas_save_reforecast_registry(cid,null,gen_random_uuid(),jsonb_build_object('accounts',accounts,'driverMappings','{}'::jsonb,'relationships','[]'::jsonb,'reason','Synthetic rollback mapping review','effectiveDate',yr||'-01-01'));
  perform set_config('request.jwt.claim.sub',regional_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',regional_id,'role','authenticated')::text,true);
  config:=jsonb_build_object('governanceSchemaVersion',2,'name','Synthetic rollback forecast','model','conventional','periods',jsonb_build_array(p),'calendar',jsonb_build_object('basis','calendar','startMonth',1,'confirmed',true,'periods',jsonb_build_array(p),'scenario','Synthetic rollback forecast','reviewedBy',regional_id,'reviewedAt',now()),'baselineType','original_budget','baselineVersionIds',jsonb_build_array(budget_id),'registryVersionId',registry.version_id,'ownerId',regional_id,'reviewerId',admin_id,'drivers','[]'::jsonb,'overrides',jsonb_build_array(jsonb_build_object('period',p,'accountCode','5120','amount',1200,'before',1000,'after',1200,'confirmed',true,'ownerId',regional_id,'effectivePeriod',p,'reviewedAt',now(),'reason','Synthetic reviewed rent increase')),'history','[]'::jsonb,'reason','Synthetic rollback lifecycle acceptance');
  rec:=public.atlas_save_reforecast_scenario(cid,test_scenario_id,0,request_id,'save_draft',config);
  retry:=public.atlas_save_reforecast_scenario(cid,test_scenario_id,0,request_id,'save_draft',config);
  if retry is distinct from rec or rec->'head'->>'status'<>'working_draft' or (rec->'snapshot'->'completeness'->>'blockerCount')::integer<>0 then raise exception 'Draft save/idempotent readback failed';end if;
  if (rec->'snapshot'->'monthly'->0->'reforecast'->>'noi')::numeric<>900 then raise exception 'Synthetic NOI arithmetic mismatch';end if;
  if public.atlas_read_active_reforecast(array[cid],array[p])<>'[]'::jsonb then raise exception 'Draft became an active baseline';end if;
  denied:=false;begin perform public.atlas_save_reforecast_scenario(cid,test_scenario_id,0,gen_random_uuid(),'save_draft',config);exception when others then if sqlerrm not like '%another session%' then raise;end if;denied:=true;end;if not denied then raise exception 'Stale revision save was accepted';end if;
  foreach step in array array['reconcile','ready','submit'] loop rec:=public.atlas_save_reforecast_scenario(cid,test_scenario_id,(rec->'head'->>'revision')::integer,gen_random_uuid(),step,rec->'revision'->'payload');end loop;
  before_head:=rec->'head';config:=rec->'revision'->'payload';
  denied:=false;begin perform public.atlas_save_reforecast_scenario(cid,test_scenario_id,(rec->'head'->>'revision')::integer,gen_random_uuid(),'approve_lock',config);exception when others then if sqlerrm not like '%Admin or executive%' then raise;end if;denied:=true;end;if not denied then raise exception 'Regional approval was accepted';end if;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  -- NULL publication request fails AFTER internal approve/lock, proving atomic failure rollback.
  denied:=false;begin perform public.atlas_save_reforecast_scenario(cid,test_scenario_id,(before_head->>'revision')::integer,null,'approve_lock',config);exception when others then if sqlerrm not like '%Publication request and reason required%' then raise;end if;denied:=true;end;
  if not denied or (select to_jsonb(h) from public.atlas_reforecast_heads h where h.scenario_id=test_scenario_id) is distinct from before_head or exists(select 1 from public.atlas_reforecast_publications v where v.community_id=cid) or (select count(*) from public.atlas_reforecast_revisions v where v.community_id=cid)<>4 then raise exception 'Failed publication left a partial approval or lock';end if;
  approved:=public.atlas_save_reforecast_scenario(cid,test_scenario_id,(before_head->>'revision')::integer,approval_id,'approve_lock',config);
  retry:=public.atlas_save_reforecast_scenario(cid,test_scenario_id,(before_head->>'revision')::integer,approval_id,'approve_lock',config);
  if retry is distinct from approved or approved->'head'->>'status'<>'locked' then raise exception 'Atomic approval/idempotent readback failed';end if;
  test_publication_id:=(approved->'publication'->>'publication_id')::uuid;
  active:=public.atlas_read_active_reforecast(array[cid],array[p]);baseline:=public.atlas_reforecast_effective_baseline(array[cid],array[p]);report:=public.atlas_read_reforecast_publication(test_publication_id);
  if jsonb_array_length(active)<>1 or active->0->>'verified'<>'true' or active->0->>'publicationId'<>test_publication_id::text or baseline->0->>'publicationId'<>test_publication_id::text or baseline->0->>'status'<>'available' or report->>'verified'<>'true' or report->>'contentHash'<>approved->'snapshot'->>'fingerprint' or (report->'snapshot'->'monthly'->0->'reforecast'->>'noi')::numeric<>900 then raise exception 'Active baseline/report exact evidence mismatch';end if;
  digest:=public.atlas_capture_reforecast_digest(array[cid],array[p],gen_random_uuid());if digest->>'verified'<>'true' or public.atlas_read_reforecast_digest((digest->>'snapshotId')::uuid) is distinct from digest then raise exception 'Immutable report digest receipt failed';end if;
  denied:=false;begin update public.atlas_reforecast_revisions set payload='{}' where community_id=cid;exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Authenticated client directly wrote an immutable revision';end if;
  perform set_config('request.jwt.claim.sub',regional_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',regional_id,'role','authenticated')::text,true);
  if public.atlas_read_reforecast_publication(test_publication_id) is distinct from report or public.atlas_read_reforecast_digest((digest->>'snapshotId')::uuid) is distinct from digest or jsonb_array_length(public.atlas_read_reforecast_workspace(array[cid]))<>1 then raise exception 'Independent Regional readback mismatch';end if;
  perform set_config('request.jwt.claim.sub',reader_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',reader_id,'role','authenticated')::text,true);
  if public.atlas_read_reforecast_publication(test_publication_id) is distinct from report or public.atlas_read_active_reforecast(array[cid],array[p]) is distinct from active then raise exception 'Scoped report reader cannot read approved evidence';end if;
  if exists(select 1 from public.atlas_reforecast_revisions where community_id=cid) or public.atlas_read_reforecast_workspace(array[cid])<>'[]'::jsonb or not exists(select 1 from public.atlas_reforecast_publications v where v.publication_id=test_publication_id) then raise exception 'Report-only RLS boundaries failed';end if;
  perform set_config('request.jwt.claim.sub',outside_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',outside_id,'role','authenticated')::text,true);
  if public.atlas_read_active_reforecast(array[cid],array[p])<>'[]'::jsonb or public.atlas_read_reforecast_workspace(array[cid])<>'[]'::jsonb or exists(select 1 from public.atlas_reforecast_publications v where v.community_id=cid) then raise exception 'Out-of-scope data became visible';end if;
  denied:=false;begin perform public.atlas_read_reforecast_publication(test_publication_id);exception when others then if sqlerrm not like '%access denied%' then raise;end if;denied:=true;end;if not denied then raise exception 'Out-of-scope report access accepted';end if;
  execute 'set local role anon';perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);
  denied:=false;begin perform public.atlas_read_active_reforecast(array[cid],array[p]);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Anonymous active read accepted';end if;
  proof:=jsonb_build_object('status','PASS','syntheticCommunityId',cid,'period',p,'expectedNoi',900,'regionalDraftReview',true,'staleWriteRejected',true,'regionalApprovalDenied',true,'failedPublicationAtomic',true,'approvedLockedIdempotent',true,'activeBaselineExact',true,'reportDigestVerified',true,'independentRegionalReadback',true,'reportOnlyRls',true,'outOfScopeDenied',true,'anonymousDenied',true,'directWriteDenied',true);
  raise exception using errcode='ZX001',message='Deliberately roll back all synthetic acceptance data';
 exception when sqlstate 'ZX001' then null;
 end;
 -- The forced subtransaction rollback restores role/claims and every synthetic row already.
 if proof is null or exists(select 1 from auth.users where id=any(array[admin_id,regional_id,outside_id,reader_id])) or exists(select 1 from public.atlas_communities where community_id=any(array[cid,other_cid])) or exists(select 1 from public.atlas_reforecast_publications where community_id=cid) or exists(select 1 from public.atlas_approved_budget_versions where version_id=budget_id) then raise exception 'Acceptance cleanup invariant failed';end if;
 perform set_config('atlas.acceptance.result',(proof||jsonb_build_object('allSyntheticRowsRolledBack',true))::text,true);
end;
$acceptance$;
select current_setting('atlas.acceptance.result',true)::jsonb as acceptance_result;
rollback;
