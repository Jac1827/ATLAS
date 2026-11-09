-- Enforce monthly review evidence and variance comments inside the write transaction.
-- Existing reports remain stored unchanged; blank amounts are never treated as zero.
begin;

create function atlas_private.company_budget_amount(value jsonb)
returns numeric language sql immutable set search_path='' as $$
 select case when jsonb_typeof(value)='number' then (value#>>'{}')::numeric else null end;
$$;
revoke all on function atlas_private.company_budget_amount(jsonb) from public,anon,authenticated;

create function atlas_private.company_budget_validate_month_review(p_period text,p_payload jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare
 approved jsonb; periods text[]; month_index integer; gl text; i integer; prior_payload jsonb;
 actual numeric; budget numeric; ytd_actual numeric; ytd_budget numeric; a numeric; b numeric;
 missing_actual boolean; missing_budget boolean; full_ytd boolean; note text;
begin
 if atlas_private.company_budget_role() is distinct from 'builder' then raise exception 'Only the VP can review monthly actuals';end if;
 -- Use the same baseline as monthly tracking: latest locked company budget, otherwise Entrata.
 select locked_summary into approved from public.atlas_company_budgets
 where fiscal_year=left(p_period,4)::integer and status='approved_locked'
 order by approved_at desc,budget_id limit 1 for share;
 if approved is not null then
  if jsonb_typeof(approved->'periods') is distinct from 'array' or jsonb_typeof(approved->'budgetByGl') is distinct from 'object' then
   raise exception 'The approved company budget has incomplete evidence. Reapprove a complete summary before reviewing months';
  end if;
  select array_agg(value order by ord) into periods from jsonb_array_elements_text(approved->'periods') with ordinality x(value,ord);
 else
  select array_agg(left(p_period,4)||'-'||lpad(m::text,2,'0') order by m) into periods from generate_series(1,12) m;
 end if;
 month_index:=array_position(periods,p_period);
 if month_index is null or array_length(periods,1)<>12 then raise exception 'The review month is outside the approved company budget';end if;
 full_ytd:=p_payload->>'ytdFrom'=periods[1] and p_payload->>'ytdTo'=p_period and p_payload->>'monthsYtd'=month_index::text;
 for gl in
  select distinct key from (
   select jsonb_object_keys(coalesce(p_payload->'actuals','{}')) key
   union select jsonb_object_keys(coalesce(p_payload->'entrataBudget','{}'))
   union select jsonb_object_keys(coalesce(p_payload->'ytdActual','{}'))
   union select jsonb_object_keys(coalesce(p_payload->'ytdBudget','{}'))
   union select jsonb_object_keys(coalesce(approved->'budgetByGl','{}'))
   union select jsonb_object_keys(m.payload->'actuals') from public.atlas_company_budget_months m where m.period=any(periods[1:month_index-1])
  ) accounts
 loop
  actual:=atlas_private.company_budget_amount(p_payload->'actuals'->gl);
  budget:=atlas_private.company_budget_amount(case when approved is not null then approved->'budgetByGl'->gl->(month_index-1) else p_payload->'entrataBudget'->gl end);
  ytd_actual:=0;ytd_budget:=0;missing_actual:=false;missing_budget:=false;
  for i in 1..month_index loop
   if i=month_index then prior_payload:=p_payload;
   else select payload into prior_payload from public.atlas_company_budget_months where period=periods[i];end if;
   a:=atlas_private.company_budget_amount(prior_payload->'actuals'->gl);
   b:=atlas_private.company_budget_amount(case when approved is not null then approved->'budgetByGl'->gl->(i-1) else prior_payload->'entrataBudget'->gl end);
   if a is null then missing_actual:=true;else ytd_actual:=ytd_actual+a;end if;
   if b is null then missing_budget:=true;else ytd_budget:=ytd_budget+b;end if;
  end loop;
  if missing_actual then ytd_actual:=case when full_ytd then atlas_private.company_budget_amount(p_payload->'ytdActual'->gl) end;end if;
  if approved is null and full_ytd and atlas_private.company_budget_amount(p_payload->'ytdBudget'->gl) is not null then
   ytd_budget:=atlas_private.company_budget_amount(p_payload->'ytdBudget'->gl);
  elsif missing_budget then ytd_budget:=null;end if;
  if actual is null or budget is null or ytd_actual is null or ytd_budget is null then
   raise exception 'Complete month and year-to-date evidence is required before review (GL %)',gl;
  end if;
  note:=case when jsonb_typeof(p_payload->'comments'->gl)='string' then btrim(p_payload->'comments'->>gl,E' \t\r\n') else '' end;
  if (abs(actual-budget)>1000 and (budget=0 or abs(actual-budget)>abs(budget)*0.10)
   or abs(ytd_actual-ytd_budget)>1000 and (ytd_budget=0 or abs(ytd_actual-ytd_budget)>abs(ytd_budget)*0.10))
   and coalesce(note,'')='' then raise exception 'A variance comment is required before review (GL %)',gl;end if;
 end loop;
 if not exists(select 1 from jsonb_object_keys(p_payload->'actuals')) then raise exception 'Monthly actuals are required before review';end if;
end;
$$;
revoke all on function atlas_private.company_budget_validate_month_review(text,jsonb) from public,anon,authenticated;

create or replace function public.atlas_company_budget_month_save(p_period text,p_expected_revision integer,p_request_id uuid,p_action text,p_payload jsonb,p_source jsonb default '{}'::jsonb,p_reason text default null)
returns public.atlas_company_budget_months language plpgsql security definer set search_path='' as $$
declare m public.atlas_company_budget_months;r text:=atlas_private.company_budget_role();
begin
 if p_period is null or p_period !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' or p_request_id is null or p_expected_revision is null or p_action is null or p_action not in ('save','review') then raise exception 'Invalid month request';end if;
 if r is distinct from 'builder' then raise exception 'Only the VP can record monthly actuals and comments';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or jsonb_typeof(p_payload->'actuals') is distinct from 'object' then raise exception 'Monthly actuals are required';end if;
 -- Serialize every month's write in the fiscal year so YTD evidence cannot change during review.
 perform pg_advisory_xact_lock(hashtextextended('company-budget-year:'||left(p_period,4),0));
 select * into m from public.atlas_company_budget_months where period=p_period;
 if exists(select 1 from public.atlas_company_budget_events e where e.request_id=p_request_id and e.period=p_period) then return m;end if;
 if m.period is null and p_expected_revision<>0 then raise exception 'Month not found';end if;
 if m.period is not null and m.revision<>p_expected_revision then raise exception 'This month changed in another session. Reload before saving';end if;
 if p_action='review' then perform atlas_private.company_budget_validate_month_review(p_period,p_payload);end if;
 if m.period is null then
  insert into public.atlas_company_budget_months(period,fiscal_year,payload,source,status,reviewed_by,reviewed_at,updated_by,last_request_id)
  values(p_period,left(p_period,4)::integer,p_payload,coalesce(p_source,'{}'),case when p_action='review' then 'reviewed' else 'uploaded' end,
   case when p_action='review' then auth.uid() end,case when p_action='review' then now() end,auth.uid(),p_request_id) returning * into m;
 else
  update public.atlas_company_budget_months set payload=p_payload,source=case when p_source='{}'::jsonb then source else p_source end,revision=revision+1,
   status=case when p_action='review' then 'reviewed' else 'uploaded' end,reviewed_by=case when p_action='review' then auth.uid() end,reviewed_at=case when p_action='review' then now() end,
   updated_by=auth.uid(),updated_at=now(),last_request_id=p_request_id where period=p_period returning * into m;
 end if;
 insert into public.atlas_company_budget_events(period,request_id,actor_id,actor_role,action,to_status,revision,reason,detail)
 values(p_period,p_request_id,auth.uid(),r,case when p_action='review' then 'month_reviewed' else 'month_saved' end,m.status,m.revision,p_reason,jsonb_build_object('source',p_source));
 return m;
end;$$;
revoke all on function public.atlas_company_budget_month_save(text,integer,uuid,text,jsonb,jsonb,text) from public,anon;
grant execute on function public.atlas_company_budget_month_save(text,integer,uuid,text,jsonb,jsonb,text) to authenticated;
commit;
