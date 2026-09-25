-- Accounting eligibility and operational review are separate from upload/reconciliation.
create table public.atlas_month_end_attestations (
 attestation_id uuid primary key default gen_random_uuid(), review_id uuid not null references public.atlas_financial_package_reviews(review_id),
 community_id uuid not null references public.atlas_communities(community_id), actor_id uuid not null references auth.users(id), actor_role text not null,
 accounting_closed_at timestamptz not null, source_generated_at timestamptz not null, reason text not null,
 source_hash text not null, created_at timestamptz not null default now(), unique(review_id)
);
create table public.atlas_month_end_decisions (
 decision_id uuid primary key default gen_random_uuid(),review_id uuid not null references public.atlas_financial_package_reviews(review_id),community_id uuid not null references public.atlas_communities(community_id),
 request_id uuid not null unique,actor_id uuid not null references auth.users(id),actor_role text not null,source_fingerprint text not null,
 evidence jsonb not null,explanations jsonb not null,overrides jsonb not null,created_at timestamptz not null default now()
);
create table public.atlas_actual_period_events (
 event_id uuid primary key default gen_random_uuid(),community_id uuid not null references public.atlas_communities(community_id),period_key text not null,
 version_id uuid not null references public.atlas_financial_close_versions(version_id),action text not null check(action in ('reopened','relocked')),
 actor_id uuid not null references auth.users(id),actor_role text not null,reason text not null,request_id uuid not null unique,created_at timestamptz not null default now()
);
do $$declare t text;begin foreach t in array array['atlas_month_end_attestations','atlas_month_end_decisions','atlas_actual_period_events'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy scoped_read on public.%I for select to authenticated using(atlas_private.command_access(community_id))',t);
 execute format('create trigger immutable before update or delete on public.%I for each row execute function atlas_private.finance_immutable()',t);
end loop;end;$$;

-- All values are already normalized by approved account nature/sign mappings.
create function atlas_private.month_end_calculate(p_input jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare r jsonb;b numeric;a numeric;delta numeric;pct numeric;rows jsonb:='[]';required boolean;verification boolean;unbudgeted boolean;atotal numeric:=0;btotal numeric:=0;complete boolean:=true;note text;category text;
begin
 for r in select value from jsonb_array_elements(coalesce(p_input->'rows','[]')) loop
  a:=(r->>'actual')::numeric;b:=(r->>'budget')::numeric;category:=lower(coalesce(r->>'category',''));
  verification:=r->>'nature'='expense' and category in ('payroll','taxes','insurance');
  unbudgeted:=r->>'nature'='expense' and a>0 and (b is null or b=0);
  delta:=case when a is not null and b is not null then a-b end;
  pct:=case when b<>0 then delta/abs(b) end;
  required:=coalesce(r->>'nature'='expense' and not verification and delta>500 and pct>0.05,false);
  note:=case when verification then 'See Accounting for verification. Explanation not required for approval.' when unbudgeted then 'Unbudgeted Expense. Review classification within the mapped expense category; the approved category materiality/offset policy has not been configured.' end;
  rows:=rows||jsonb_build_array(r||jsonb_build_object('variance',delta,'percentageVariance',pct,'unbudgetedExpense',coalesce(unbudgeted,false),'requiresExplanation',required,'concernFlag',coalesce(r->>'nature'='expense' and (delta>500 or pct>0.05 or unbudgeted and a>500),false),'accountingVerification',verification,'systemNote',note,'systemNoteType',case when note is not null then 'system' end));
  if r->>'nature'='expense' then
   if a is null or (b is null and not unbudgeted) then complete:=false;end if;
   atotal:=atotal+coalesce(a,0);btotal:=btotal+coalesce(b,0);
  end if;
 end loop;
 return p_input||jsonb_build_object('rows',rows,'exceptionCount',(select count(*) from jsonb_array_elements(rows)x where x->>'requiresExplanation'='true'),'expenseActual',case when complete then atotal end,'expenseBudget',case when complete then btotal end,'expenseVariancePct',case when complete and btotal<>0 then (atotal-btotal)/abs(btotal) end,'reforecastRecommended',complete and btotal>0 and (atotal-btotal)/abs(btotal)>0.35,'categoryPolicyStatus','not_configured');
end;$$;
revoke all on function atlas_private.month_end_calculate(jsonb) from public,anon,authenticated;

create function atlas_private.month_end_review(p_review_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.atlas_financial_package_reviews;cal jsonb;periods text[];start_date date;baselines jsonb;line jsonb;mapping jsonb;source_row jsonb;rows jsonb:='[]';blockers jsonb:='[]';a numeric;b numeric;n integer;expected integer;gl text;item jsonb;hash text;latest_state text;
begin
 select * into r from public.atlas_financial_package_reviews where review_id=p_review_id;
 if auth.uid() is null or r.review_id is null or not atlas_private.command_access(r.community_id) then raise exception 'Month-end review access denied';end if;
 if to_regprocedure('atlas_private.budget_calendar(uuid)') is null then raise exception 'Verified Community Settings calendar is unavailable';end if;
 execute 'select atlas_private.budget_calendar($1)' into cal using r.community_id;
 if cal->>'verified' is distinct from 'true' then raise exception 'Resolve Community Settings calendar before month-end review';end if;
 start_date:=make_date(left(r.period_key,4)::int-case when right(r.period_key,2)::int<(cal->>'startMonth')::int then 1 else 0 end,(cal->>'startMonth')::int,1);
 select array_agg(to_char(d,'YYYY-MM') order by d) into periods from generate_series(start_date,(r.period_key||'-01')::date,interval '1 month')d;
 if r.certificate->'metadata'->>'ytdStart' is distinct from periods[1] then blockers:=blockers||'"Source YTD period does not match verified Community Settings"'::jsonb;end if;
 if r.certificate->'intakeEvidence'->'governance'->>'fiscalStartMonth' is distinct from cal->>'startMonth' then blockers:=blockers||'"Reviewed source calendar conflicts with verified Community Settings"'::jsonb;end if;
 if not exists(select 1 from public.atlas_month_end_attestations t where t.review_id=r.review_id) then blockers:=blockers||'"Accounting close and source generation verification required"'::jsonb;end if;
 if r.period_key>=to_char(current_date,'YYYY-MM') then blockers:=blockers||'"Accounting month has not ended"'::jsonb;end if;
 baselines:=public.atlas_reforecast_effective_baseline(array[r.community_id],periods);
 if jsonb_array_length(baselines)<>cardinality(periods) or exists(select 1 from jsonb_array_elements(baselines)x where x->>'verified' is distinct from 'true' or x->>'status' is distinct from 'available') then blockers:=blockers||'"Latest VP-approved baseline is unavailable for one or more fiscal YTD periods"'::jsonb;end if;
 if exists(select 1 from unnest(periods)p where p<>r.period_key and not exists(select 1 from public.atlas_financial_close_heads h where h.community_id=r.community_id and h.period_key=p and h.accounting_basis='accrual')) then blockers:=blockers||'"Prior fiscal YTD actual close is missing; missing months are not zero"'::jsonb;end if;
 for gl in select distinct code from (
  select value->>'glCode' code from jsonb_array_elements(r.certificate->'rows') where value->>'kind'='posting'
  union select l->>'accountCode' from jsonb_array_elements(baselines)x cross join lateral jsonb_array_elements(coalesce(x->'lines','[]'))l
 )q where code is not null order by code loop
  select value into mapping from jsonb_array_elements(r.certificate->'intakeEvidence'->'governance'->'mappings') where value->>'glCode'=gl;
  select value into source_row from jsonb_array_elements(r.certificate->'rows') where value->>'glCode'=gl and value->>'kind'='posting';
  select l into line from jsonb_array_elements(baselines)x cross join lateral jsonb_array_elements(coalesce(x->'lines','[]'))l where l->>'accountCode'=gl order by x->>'period' desc limit 1;
  select count(*),sum((l->>'amount')::numeric) into n,b from jsonb_array_elements(baselines)x cross join lateral jsonb_array_elements(coalesce(x->'lines','[]'))l where l->>'accountCode'=gl and jsonb_typeof(l->'amount')='number';
  if n<>cardinality(periods) then b:=null;end if;
  if exists(select 1 from jsonb_array_elements(baselines)x cross join lateral jsonb_array_elements(coalesce(x->'lines','[]'))l where l->>'accountCode'=gl and (l->>'nature' is distinct from line->>'nature' or l->>'category' is distinct from line->>'category')) then blockers:=blockers||jsonb_build_array('Conflicting approved account mappings for GL '||gl);end if;
  select count(*),sum(cr.actual*(m->>'signMultiplier')::numeric) into n,a
  from public.atlas_financial_close_heads h join public.atlas_financial_close_versions cv using(version_id) join public.atlas_financial_close_rows cr using(version_id) join public.atlas_financial_package_reviews pr on pr.review_id=cv.review_id
  left join lateral (select value m from jsonb_array_elements(pr.certificate->'intakeEvidence'->'governance'->'mappings') where value->>'glCode'=gl)q on true
  where h.community_id=r.community_id and h.period_key=any(periods) and h.period_key<>r.period_key and cr.gl_code=gl and h.accounting_basis='accrual' and m->>'signMultiplier' in ('1','-1');
  if n<>cardinality(periods)-1 or jsonb_typeof(source_row->'values'->'actual') is distinct from 'number' then a:=null;else a:=coalesce(a,0)+(source_row->'values'->>'actual')::numeric*(mapping->>'signMultiplier')::numeric;end if;
  if mapping->>'nature' is distinct from line->>'nature' and mapping is not null and line is not null then blockers:=blockers||jsonb_build_array('Actual and approved baseline account nature conflict for GL '||gl);end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('glCode',gl,'accountName',coalesce(source_row->>'accountName',line->>'accountName',line->>'name'),'nature',coalesce(mapping->>'nature',line->>'nature'),'category',line->>'category','actual',a,'budget',b,'budgetMissing',b is null));
 end loop;
 item:=atlas_private.month_end_calculate(jsonb_build_object('reviewId',r.review_id,'communityId',r.community_id,'period',r.period_key,'periods',periods,'calendar',cal,'sourceHash',r.source_hash,'baselines',baselines,'rows',rows,'blockers',blockers));
 hash:=encode(sha256(convert_to(item::text,'UTF8')),'hex');return item||jsonb_build_object('fingerprint',hash);
end;$$;
create function public.atlas_read_month_end_review(p_review_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select atlas_private.month_end_review(p_review_id)$$;

create function public.atlas_confirm_month_end_close(p_review_id uuid,p_accounting_closed_at timestamptz,p_source_generated_at timestamptz,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.atlas_financial_package_reviews;t public.atlas_month_end_attestations;role_name text;
begin
 select * into r from public.atlas_financial_package_reviews where review_id=p_review_id;
 select role into role_name from public.atlas_user_profiles where user_id=auth.uid() and status='active';
 if auth.uid() is null or role_name not in ('admin','executive','finance') or not atlas_private.financial_review_access(r.community_id,true) then raise exception 'Scoped Accounting, VP or Admin verification required';end if;
 if r.period_key>=to_char(current_date,'YYYY-MM') or p_accounting_closed_at is null or p_accounting_closed_at<((r.period_key||'-01')::date+interval '1 month') or p_accounting_closed_at>now() or p_source_generated_at is null or p_source_generated_at>now() or length(trim(coalesce(p_reason,'')))<5 then raise exception 'Verify accounting close, source generation time and reason';end if;
 insert into public.atlas_month_end_attestations(review_id,community_id,actor_id,actor_role,accounting_closed_at,source_generated_at,reason,source_hash) values(r.review_id,r.community_id,auth.uid(),role_name,p_accounting_closed_at,p_source_generated_at,p_reason,r.source_hash) on conflict(review_id) do nothing returning * into t;
 if t.attestation_id is null then select * into t from public.atlas_month_end_attestations where review_id=r.review_id;if t.accounting_closed_at is distinct from p_accounting_closed_at or t.source_generated_at is distinct from p_source_generated_at then raise exception 'This package already has immutable Accounting verification; correct it in a new package review';end if;end if;
 return to_jsonb(t);
end;$$;

create function public.atlas_save_month_end_decision(p_review_id uuid,p_fingerprint text,p_explanations jsonb,p_overrides jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare e jsonb;r jsonb;d public.atlas_month_end_decisions;role_name text;
begin
 e:=atlas_private.month_end_review(p_review_id);select role into role_name from public.atlas_user_profiles where user_id=auth.uid() and status='active';
 if not atlas_private.financial_review_access((e->>'communityId')::uuid,true) then raise exception 'Month-end decision access denied';end if;
 if p_fingerprint is distinct from e->>'fingerprint' then raise exception 'Month-end source or approved baseline changed; reload review';end if;
 if jsonb_array_length(e->'blockers')>0 then raise exception 'Month-end controls blocked: %',e->'blockers';end if;
 if jsonb_typeof(p_explanations) is distinct from 'object' or jsonb_typeof(p_overrides) is distinct from 'object' then raise exception 'Structured explanation and override evidence required';end if;
 if p_overrides<>'{}' and role_name<>'admin' then raise exception 'Only Admin may explicitly override an explanation';end if;
 for r in select value from jsonb_array_elements(e->'rows') where value->>'requiresExplanation'='true' loop
  if length(trim(coalesce(p_explanations->>(r->>'glCode'),'')))=0 and length(trim(coalesce(p_overrides->>(r->>'glCode'),'')))<5 then raise exception 'Required unfavorable expense explanation or explicit Admin override reason missing for GL %',r->>'glCode';end if;
 end loop;
 insert into public.atlas_month_end_decisions(review_id,community_id,request_id,actor_id,actor_role,source_fingerprint,evidence,explanations,overrides) values(p_review_id,(e->>'communityId')::uuid,p_request_id,auth.uid(),role_name,p_fingerprint,e,p_explanations,p_overrides) on conflict(request_id) do nothing returning * into d;
 if d.decision_id is null then select * into d from public.atlas_month_end_decisions where request_id=p_request_id;if d.actor_id<>auth.uid() or d.source_fingerprint<>p_fingerprint or d.explanations<>p_explanations or d.overrides<>p_overrides then raise exception 'Decision request ID reused for different evidence';end if;end if;
 return to_jsonb(d);
end;$$;

alter function public.atlas_close_financial_review_governed(uuid,uuid,uuid,text,boolean) rename to atlas_close_financial_review_before_operational;
create function public.atlas_close_financial_review_governed(p_review_id uuid,p_expected_version_id uuid,p_request_id uuid,p_reason text,p_accounting_approved boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare e jsonb;d public.atlas_month_end_decisions;result jsonb;role_name text;cid uuid;
begin
 select community_id into cid from public.atlas_financial_package_reviews where review_id=p_review_id;
 if auth.uid() is null or cid is null or not atlas_private.command_access(cid) then raise exception 'Month-end approval access denied';end if;
 perform pg_advisory_xact_lock(hashtextextended('reforecast-active:'||cid,0));perform pg_advisory_xact_lock(hashtextextended('finance:'||cid,0));
 -- Retry the same successful publication even if its baseline has changed later.
 if not exists(select 1 from public.atlas_financial_intake_receipts where request_id=p_request_id and actor_id=auth.uid() and status='canonically_published') then
  e:=atlas_private.month_end_review(p_review_id);
  select * into d from public.atlas_month_end_decisions where review_id=p_review_id and source_fingerprint=e->>'fingerprint' order by created_at desc limit 1;
  if d.decision_id is null then raise exception 'Complete and save the latest fiscal YTD operational review before approving actuals';end if;
 end if;
 result:=public.atlas_close_financial_review_before_operational(p_review_id,p_expected_version_id,p_request_id,p_reason,p_accounting_approved);
 select role into role_name from public.atlas_user_profiles where user_id=auth.uid() and status='active';
 if not exists(select 1 from public.atlas_actual_period_events where request_id=p_request_id) then
 insert into public.atlas_financial_close_events(version_id,community_id,event_type,actor,detail) values((result->'close'->>'version_id')::uuid,cid,'operational_review_approved',auth.uid(),jsonb_build_object('decisionId',d.decision_id,'role',role_name,'sourceFingerprint',d.source_fingerprint,'baselineVersions',d.evidence->'baselines','exceptions',d.explanations,'overrides',d.overrides,'previousVersion',p_expected_version_id,'publication',result->'publications'));
 insert into public.atlas_actual_period_events(community_id,period_key,version_id,action,actor_id,actor_role,reason,request_id) values((result->'close'->>'community_id')::uuid,result->'close'->>'period_key',(result->'close'->>'version_id')::uuid,'relocked',auth.uid(),role_name,p_reason,p_request_id);
 end if;
 return result;
end;$$;

create function public.atlas_reopen_actual_period(p_community_id uuid,p_period text,p_expected_version_id uuid,p_reason text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v uuid;e public.atlas_actual_period_events;role_name text;
begin
 select role into role_name from public.atlas_user_profiles where user_id=auth.uid() and status='active';
 if auth.uid() is null or role_name<>'admin' or not atlas_private.command_access(p_community_id,'finance') then raise exception 'Only scoped Admin may reopen actual periods';end if;
 if length(trim(coalesce(p_reason,'')))<5 then raise exception 'Formal reopening reason required';end if;
 perform pg_advisory_xact_lock(hashtextextended('finance:'||p_community_id,0));
 select version_id into v from public.atlas_financial_close_heads where community_id=p_community_id and period_key=p_period and accounting_basis='accrual';
 if v is null or v is distinct from p_expected_version_id then raise exception 'Closed actual version changed; reload before reopening';end if;
 insert into public.atlas_actual_period_events(community_id,period_key,version_id,action,actor_id,actor_role,reason,request_id) values(p_community_id,p_period,v,'reopened',auth.uid(),role_name,p_reason,p_request_id) on conflict(request_id) do nothing returning * into e;
 if e.event_id is null then select * into e from public.atlas_actual_period_events where request_id=p_request_id;if e.actor_id<>auth.uid() or e.version_id<>v or e.reason<>p_reason then raise exception 'Reopen request ID reused';end if;end if;return to_jsonb(e);
end;$$;

create function public.atlas_month_end_queue(p_community_ids uuid[],p_year integer default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or cardinality(p_community_ids)>100 then raise exception 'Authorized bounded community scope required';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.review_id,'reviewId',r.review_id,'communityId',r.community_id,'communityName',c.display_name,'aliases',(select coalesce(jsonb_agg(alias),'[]') from public.atlas_community_aliases where community_id=c.community_id and active),'recordType','month_end_actuals','year',left(review_evidence.e->'periods'->>0,4)::int,'periods',jsonb_build_array(r.period_key),'submittedVersion',r.source_hash,'submitter',r.created_by,'submittedAt',a.created_at,'actualCutoff',r.period_key,'exceptionCount',(review_evidence.e->>'exceptionCount')::int,'warnings',review_evidence.e->'blockers','state','ready_for_review','reviewAction',true) order by a.created_at),'[]') into result
 from public.atlas_financial_package_reviews r join public.atlas_month_end_attestations a using(review_id) join public.atlas_communities c on c.community_id=r.community_id cross join lateral(select atlas_private.month_end_review(r.review_id) e)review_evidence
 where r.community_id=any(p_community_ids) and atlas_private.command_access(r.community_id) and (p_year is null or left(review_evidence.e->'periods'->>0,4)::int=p_year) and r.period_key<to_char(current_date,'YYYY-MM') and jsonb_array_length(review_evidence.e->'blockers')=0 and not exists(select 1 from public.atlas_financial_close_versions v where v.review_id=r.review_id) and (atlas_private.finance_intake_validation(r.certificate,r.community_id)->>'reconciled')='true';
 return result;
end;$$;

-- Keep the immutable closed version live while clearly disclosing a formal reopening.
alter function public.atlas_read_finance(uuid[],text[]) rename to atlas_read_finance_before_month_end;
create function public.atlas_read_finance(p_community_ids uuid[],p_periods text[]) returns table(community_id uuid,period_key text,fiscal_year integer,publication_id uuid,summary jsonb) language sql stable security invoker set search_path='' as $$
 select f.community_id,f.period_key,f.fiscal_year,f.publication_id,f.summary||jsonb_build_object('periodState',case when e.action='reopened' then 'reopened' when f.summary->>'actualCloseVersion' is not null then 'locked' else 'open' end,'periodWarning',case when e.action='reopened' then 'This period has been reopened and its financial data is under revision. Related dashboards and reports may change until the period is re-approved and locked.' end)
 from public.atlas_read_finance_before_month_end(p_community_ids,p_periods)f left join lateral(select action from public.atlas_actual_period_events where community_id=f.community_id and period_key=f.period_key order by created_at desc,event_id desc limit 1)e on true;
$$;
revoke all on function public.atlas_close_financial_review_before_operational(uuid,uuid,uuid,text,boolean),atlas_private.month_end_review(uuid) from public,anon,authenticated;
-- Private review function enforces identity and scope for the invoker wrapper.
grant execute on function atlas_private.month_end_review(uuid) to authenticated;
revoke all on function public.atlas_read_month_end_review(uuid),public.atlas_confirm_month_end_close(uuid,timestamptz,timestamptz,text),public.atlas_save_month_end_decision(uuid,text,jsonb,jsonb,uuid),public.atlas_close_financial_review_governed(uuid,uuid,uuid,text,boolean),public.atlas_reopen_actual_period(uuid,text,uuid,text,uuid),public.atlas_month_end_queue(uuid[],integer),public.atlas_read_finance(uuid[],text[]) from public,anon,authenticated;
grant execute on function public.atlas_read_month_end_review(uuid),public.atlas_confirm_month_end_close(uuid,timestamptz,timestamptz,text),public.atlas_save_month_end_decision(uuid,text,jsonb,jsonb,uuid),public.atlas_close_financial_review_governed(uuid,uuid,uuid,text,boolean),public.atlas_reopen_actual_period(uuid,text,uuid,text,uuid),public.atlas_month_end_queue(uuid[],integer),public.atlas_read_finance(uuid[],text[]) to authenticated;
