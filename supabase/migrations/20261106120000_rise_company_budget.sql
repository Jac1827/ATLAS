-- RISE company budget (RISE Residential, LLC): the VP builds it, a designated
-- executive approves and locks it, and each month's Entrata Budget vs Actual is
-- stored with variance comments and a review status.
--
-- Visible only to budget VPs and designated company-budget approvers. The approver
-- must be a different person from whoever submitted or last revised the budget.

create table atlas_private.company_budget_approvers (
 user_id uuid primary key references auth.users(id),
 designated_by uuid not null references auth.users(id),
 designated_at timestamptz not null default now()
);
revoke all on atlas_private.company_budget_approvers from public,anon,authenticated;

create function atlas_private.company_budget_role() returns text language sql stable security definer set search_path='' as $$
 select case
  when auth.uid() is null then null
  when exists(select 1 from atlas_private.company_budget_approvers a join public.atlas_user_profiles p on p.user_id=a.user_id and p.status='active' where a.user_id=auth.uid()) then 'approver'
  when atlas_private.is_budget_vp(auth.uid()) then 'builder'
  else null end;
$$;
revoke all on function atlas_private.company_budget_role() from public,anon;
grant execute on function atlas_private.company_budget_role() to authenticated;

create function public.atlas_company_budget_my_role() returns text language sql stable security definer set search_path='' as $$ select atlas_private.company_budget_role(); $$;
revoke all on function public.atlas_company_budget_my_role() from public,anon;
grant execute on function public.atlas_company_budget_my_role() to authenticated;

create table public.atlas_company_budgets (
 budget_id uuid primary key,
 fiscal_year integer not null check (fiscal_year between 2000 and 2100),
 plan_type text not null default 'budget' check (plan_type in ('budget','reforecast')),
 name text not null check (length(trim(name)) between 1 and 200),
 status text not null default 'draft' check (status in ('draft','executive_review','approved_locked','archived')),
 revision integer not null default 1 check (revision > 0),
 payload jsonb not null check (jsonb_typeof(payload)='object' and octet_length(payload::text) <= 4194304),
 locked_summary jsonb,
 submitted_by uuid references auth.users(id),
 approved_by uuid references auth.users(id),
 approved_at timestamptz,
 revised_after_approval boolean not null default false,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_by uuid not null references auth.users(id),
 updated_at timestamptz not null default now(),
 last_request_id uuid
);
create index atlas_company_budgets_year on public.atlas_company_budgets(fiscal_year, status);

create table public.atlas_company_budget_events (
 event_id uuid primary key default gen_random_uuid(),
 budget_id uuid references public.atlas_company_budgets(budget_id),
 period text check (period is null or period ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
 request_id uuid not null unique,
 actor_id uuid not null references auth.users(id),
 actor_role text not null,
 action text not null,
 from_status text, to_status text,
 revision integer not null,
 reason text,
 detail jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 check (budget_id is not null or period is not null)
);

create table public.atlas_company_budget_months (
 period text primary key check (period ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
 fiscal_year integer not null check (fiscal_year between 2000 and 2100),
 revision integer not null default 1,
 payload jsonb not null check (jsonb_typeof(payload)='object' and jsonb_typeof(payload->'actuals')='object' and octet_length(payload::text) <= 1048576),
 source jsonb not null default '{}'::jsonb check (octet_length(source::text) <= 8192),
 status text not null default 'uploaded' check (status in ('uploaded','reviewed')),
 reviewed_by uuid references auth.users(id),
 reviewed_at timestamptz,
 updated_by uuid not null references auth.users(id),
 updated_at timestamptz not null default now(),
 last_request_id uuid
);

do $$declare t text;begin
 foreach t in array array['atlas_company_budgets','atlas_company_budget_events','atlas_company_budget_months'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy company_budget_read on public.%I for select to authenticated using(atlas_private.company_budget_role() is not null)',t);
 end loop;
end;$$;

create function public.atlas_company_budget_save(p_budget_id uuid,p_expected_revision integer,p_request_id uuid,p_meta jsonb,p_payload jsonb,p_reason text default null)
returns public.atlas_company_budgets language plpgsql security definer set search_path='' as $$
declare b public.atlas_company_budgets;r text:=atlas_private.company_budget_role();
begin
 if p_budget_id is null or p_request_id is null or p_expected_revision is null or jsonb_typeof(p_payload) is distinct from 'object' or jsonb_typeof(coalesce(p_meta,'{}')) is distinct from 'object' then raise exception 'Invalid company budget save request';end if;
 if r is distinct from 'builder' then raise exception 'Only the VP can edit the company budget';end if;
 perform pg_advisory_xact_lock(hashtextextended('company-budget:'||p_budget_id,0));
 select * into b from public.atlas_company_budgets where budget_id=p_budget_id;
 if exists(select 1 from public.atlas_company_budget_events e where e.request_id=p_request_id) then return b;end if;
 if b.budget_id is null then
  if p_expected_revision<>0 then raise exception 'Company budget not found';end if;
  insert into public.atlas_company_budgets(budget_id,fiscal_year,plan_type,name,payload,created_by,updated_by,last_request_id)
  values(p_budget_id,(p_meta->>'fiscalYear')::integer,coalesce(p_meta->>'planType','budget'),coalesce(nullif(trim(p_meta->>'name'),''),'RISE company budget'),p_payload,auth.uid(),auth.uid(),p_request_id) returning * into b;
  insert into public.atlas_company_budget_events(budget_id,request_id,actor_id,actor_role,action,to_status,revision,reason) values(b.budget_id,p_request_id,auth.uid(),r,'create',b.status,b.revision,p_reason);
  return b;
 end if;
 if b.revision<>p_expected_revision then raise exception 'This budget changed in another session. Keep your edits and reload before saving';end if;
 if b.status not in ('draft','approved_locked') then raise exception 'This budget is in % and cannot be edited',replace(b.status,'_',' ');end if;
 if b.status='approved_locked' and length(trim(coalesce(p_reason,'')))<3 then raise exception 'A reason is required to edit an approved budget';end if;
 update public.atlas_company_budgets set payload=p_payload,name=coalesce(nullif(trim(p_meta->>'name'),''),name),revision=revision+1,updated_by=auth.uid(),updated_at=now(),last_request_id=p_request_id,
  revised_after_approval=revised_after_approval or status='approved_locked',submitted_by=case when status='approved_locked' then auth.uid() else submitted_by end
 where budget_id=p_budget_id returning * into b;
 insert into public.atlas_company_budget_events(budget_id,request_id,actor_id,actor_role,action,from_status,to_status,revision,reason,detail)
 values(b.budget_id,p_request_id,auth.uid(),r,case when b.status='approved_locked' then 'vp_edit' else 'save' end,b.status,b.status,b.revision,p_reason,coalesce(p_meta->'changes','{}'::jsonb));
 return b;
end;$$;
revoke all on function public.atlas_company_budget_save(uuid,integer,uuid,jsonb,jsonb,text) from public,anon;
grant execute on function public.atlas_company_budget_save(uuid,integer,uuid,jsonb,jsonb,text) to authenticated;

create function public.atlas_company_budget_transition(p_budget_id uuid,p_expected_revision integer,p_request_id uuid,p_action text,p_reason text default null,p_detail jsonb default '{}'::jsonb)
returns public.atlas_company_budgets language plpgsql security definer set search_path='' as $$
declare b public.atlas_company_budgets;r text:=atlas_private.company_budget_role();nxt text;prev text;
begin
 if p_budget_id is null or p_request_id is null or p_expected_revision is null then raise exception 'Invalid company budget request';end if;
 perform pg_advisory_xact_lock(hashtextextended('company-budget:'||p_budget_id,0));
 select * into b from public.atlas_company_budgets where budget_id=p_budget_id;
 if b.budget_id is null then raise exception 'Company budget not found';end if;
 if exists(select 1 from public.atlas_company_budget_events e where e.request_id=p_request_id) then return b;end if;
 if b.revision<>p_expected_revision then raise exception 'This budget changed in another session. Reload before continuing';end if;
 case p_action
  when 'submit' then
   if r is distinct from 'builder' or b.status<>'draft' then raise exception 'Only the VP can submit a draft company budget';end if;
   nxt:='executive_review';
  when 'return' then
   if r is distinct from 'approver' or b.status<>'executive_review' then raise exception 'Only the executive approver can return a budget in review';end if;
   if length(trim(coalesce(p_reason,'')))<3 then raise exception 'A reason is required to return the budget';end if;
   nxt:='draft';
  when 'approve' then
   if r is distinct from 'approver' then raise exception 'Only the executive approver can approve the company budget';end if;
   if not (b.status='executive_review' or (b.status='approved_locked' and b.revised_after_approval)) then raise exception 'Nothing to approve: submit the budget or revise it first';end if;
   if auth.uid() in (b.submitted_by,b.updated_by) then raise exception 'The approver must be a different person from whoever prepared or revised the budget';end if;
   if jsonb_typeof(p_detail->'summary') is distinct from 'object' then raise exception 'The approved summary is required';end if;
   nxt:='approved_locked';
  when 'archive' then
   if r is distinct from 'builder' or b.status<>'draft' then raise exception 'Only a draft can be archived, by the VP';end if;
   nxt:='archived';
  else raise exception 'Unknown company budget action %',p_action;
 end case;
 prev:=b.status;
 update public.atlas_company_budgets set status=nxt,revision=revision+1,updated_at=now(),last_request_id=p_request_id,
  submitted_by=case when p_action='submit' then auth.uid() else submitted_by end,
  approved_by=case when p_action='approve' then auth.uid() else approved_by end,
  approved_at=case when p_action='approve' then now() else approved_at end,
  locked_summary=case when p_action='approve' then p_detail->'summary' else locked_summary end,
  revised_after_approval=case when p_action='approve' then false else revised_after_approval end
 where budget_id=p_budget_id returning * into b;
 insert into public.atlas_company_budget_events(budget_id,request_id,actor_id,actor_role,action,from_status,to_status,revision,reason,detail)
 values(b.budget_id,p_request_id,auth.uid(),r,p_action,prev,b.status,b.revision,p_reason,coalesce(p_detail,'{}'::jsonb)-'summary');
 return b;
end;$$;
revoke all on function public.atlas_company_budget_transition(uuid,integer,uuid,text,text,jsonb) from public,anon;
grant execute on function public.atlas_company_budget_transition(uuid,integer,uuid,text,text,jsonb) to authenticated;

-- One month of actuals: saved from the Entrata report, comments added, then reviewed.
create function public.atlas_company_budget_month_save(p_period text,p_expected_revision integer,p_request_id uuid,p_action text,p_payload jsonb,p_source jsonb default '{}'::jsonb,p_reason text default null)
returns public.atlas_company_budget_months language plpgsql security definer set search_path='' as $$
declare m public.atlas_company_budget_months;r text:=atlas_private.company_budget_role();
begin
 if p_period !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' or p_request_id is null or p_expected_revision is null or p_action not in ('save','review') then raise exception 'Invalid month request';end if;
 if r is distinct from 'builder' then raise exception 'Only the VP can record monthly actuals and comments';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or jsonb_typeof(p_payload->'actuals') is distinct from 'object' then raise exception 'Monthly actuals are required';end if;
 perform pg_advisory_xact_lock(hashtextextended('company-budget-month:'||p_period,0));
 select * into m from public.atlas_company_budget_months where period=p_period;
 if exists(select 1 from public.atlas_company_budget_events e where e.request_id=p_request_id) then return m;end if;
 if m.period is null then
  if p_expected_revision<>0 then raise exception 'Month not found';end if;
  insert into public.atlas_company_budget_months(period,fiscal_year,payload,source,status,reviewed_by,reviewed_at,updated_by,last_request_id)
  values(p_period,coalesce((p_payload->>'fiscalYear')::integer,left(p_period,4)::integer),p_payload,coalesce(p_source,'{}'),case when p_action='review' then 'reviewed' else 'uploaded' end,
   case when p_action='review' then auth.uid() end,case when p_action='review' then now() end,auth.uid(),p_request_id) returning * into m;
 else
  if m.revision<>p_expected_revision then raise exception 'This month changed in another session. Reload before saving';end if;
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

-- The VP (or an ATLAS admin) designates the executive approver by email. Nobody designates themselves.
create function public.atlas_company_budget_set_approver(p_email text,p_enabled boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid;
begin
 if not (atlas_private.is_budget_vp(auth.uid()) or exists(select 1 from public.atlas_user_profiles where user_id=auth.uid() and status='active' and role='admin')) then raise exception 'Only the VP or an ATLAS admin can designate the approver';end if;
 select id into uid from auth.users where lower(email)=lower(trim(p_email));
 if uid is null then raise exception 'No ATLAS account uses that email';end if;
 if uid=auth.uid() then raise exception 'You cannot designate yourself as the company budget approver';end if;
 if p_enabled then insert into atlas_private.company_budget_approvers(user_id,designated_by) values(uid,auth.uid()) on conflict (user_id) do nothing;
 else delete from atlas_private.company_budget_approvers where user_id=uid;end if;
 insert into public.atlas_company_budget_events(period,request_id,actor_id,actor_role,action,revision,detail)
 values(to_char(now(),'YYYY-MM'),gen_random_uuid(),auth.uid(),coalesce(atlas_private.company_budget_role(),'admin'),case when p_enabled then 'approver_designated' else 'approver_removed' end,0,jsonb_build_object('userId',uid));
 return jsonb_build_object('userId',uid,'approver',p_enabled);
end;$$;
revoke all on function public.atlas_company_budget_set_approver(text,boolean) from public,anon;
grant execute on function public.atlas_company_budget_set_approver(text,boolean) to authenticated;

-- Event ledger is append-only.
create function atlas_private.company_budget_events_immutable() returns trigger language plpgsql set search_path='' as $$begin raise exception 'Company budget events are immutable';end;$$;
create trigger company_budget_events_immutable before update or delete on public.atlas_company_budget_events for each row execute function atlas_private.company_budget_events_immutable();
