-- Budget Builder v2: working drafts with GM → Regional → VP review, line notes and
-- investor commentary (inside the draft payload), learning observations, investor
-- package deliveries and an immutable event ledger.
--
-- Financial publication is NOT duplicated here. VP approval links the draft to the
-- governed publication created by atlas_save_reforecast_scenario('vp_approve'),
-- and is accepted only when that publication exists, belongs to the same community,
-- was published by the approving VP and names this draft. Every existing consumer
-- keeps reading atlas_reforecast_publications.

create table public.atlas_budget_builder_drafts (
 draft_id uuid primary key,
 community_id uuid not null references public.atlas_communities(community_id),
 fiscal_year integer not null check (fiscal_year between 2000 and 2100),
 plan_type text not null check (plan_type in ('budget','reforecast')),
 asset_class text not null check (asset_class in ('conventional','townhome','student_bed','student_apt','manufactured','military')),
 name text not null check (length(trim(name)) between 1 and 200),
 status text not null default 'gm_draft' check (status in ('gm_draft','regional_review','vp_review','approved_locked','sent_to_investors','archived')),
 revision integer not null default 1 check (revision > 0),
 payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 4194304),
 locked_summary jsonb,
 scenario_id uuid,
 publication_id uuid references public.atlas_reforecast_publications(publication_id),
 revised_after_approval boolean not null default false,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_by uuid not null references auth.users(id),
 updated_at timestamptz not null default now(),
 last_request_id uuid
);
create index atlas_budget_builder_drafts_community on public.atlas_budget_builder_drafts(community_id, fiscal_year);

create table public.atlas_budget_builder_events (
 event_id uuid primary key default gen_random_uuid(),
 draft_id uuid not null references public.atlas_budget_builder_drafts(draft_id),
 community_id uuid not null references public.atlas_communities(community_id),
 request_id uuid not null,
 actor_id uuid not null references auth.users(id),
 actor_role text not null,
 action text not null,
 from_status text, to_status text,
 revision integer not null,
 reason text,
 detail jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 unique (draft_id, request_id)
);

create table public.atlas_budget_learning_observations (
 observation_id uuid primary key default gen_random_uuid(),
 community_id uuid not null references public.atlas_communities(community_id),
 source_kind text not null check (source_kind in ('t12','proposal','approved_budget','decision','contract','utility','box_score','trending')),
 gl_code text check (gl_code is null or gl_code ~ '^[0-9]{4}$'),
 metric text not null check (length(metric) between 1 and 60),
 value numeric not null,
 basis jsonb not null default '{}'::jsonb check (octet_length(basis::text) <= 8192),
 period_from text check (period_from is null or period_from ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
 period_to text check (period_to is null or period_to ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create index atlas_budget_learning_community on public.atlas_budget_learning_observations(community_id, source_kind, created_at desc);

create table public.atlas_budget_investor_deliveries (
 delivery_id uuid primary key default gen_random_uuid(),
 draft_id uuid not null references public.atlas_budget_builder_drafts(draft_id),
 community_id uuid not null references public.atlas_communities(community_id),
 revision integer not null,
 publication_id uuid references public.atlas_reforecast_publications(publication_id),
 request_id uuid not null unique,
 recipients text[] not null check (cardinality(recipients) between 1 and 20),
 status text not null default 'claimed' check (status in ('claimed','sent','unknown','failed')),
 requested_by uuid not null references auth.users(id),
 provider_message_id text,
 created_at timestamptz not null default now(),
 sent_at timestamptz
);

do $$declare t text;begin
 foreach t in array array['atlas_budget_builder_drafts','atlas_budget_builder_events','atlas_budget_learning_observations','atlas_budget_investor_deliveries'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy budget_builder_read on public.%I for select to authenticated using(atlas_private.reforecast_access(community_id,''read''))',t);
 end loop;
end;$$;

create function atlas_private.budget_builder_role() returns text language sql stable security definer set search_path='' as $$
 select case when atlas_private.is_budget_vp(auth.uid()) then 'vp' else (select role from public.atlas_user_profiles where user_id=auth.uid() and status='active') end;
$$;
revoke all on function atlas_private.budget_builder_role() from public,anon;
grant execute on function atlas_private.budget_builder_role() to authenticated;

create function atlas_private.budget_builder_is_regional() returns boolean language sql stable security definer set search_path='' as $$
 select atlas_private.is_budget_vp(auth.uid()) or exists(select 1 from public.atlas_user_profiles where user_id=auth.uid() and status='active' and role in ('regional','admin','executive'));
$$;
revoke all on function atlas_private.budget_builder_is_regional() from public,anon;
grant execute on function atlas_private.budget_builder_is_regional() to authenticated;

create function public.atlas_budget_builder_save(p_draft_id uuid,p_community_id uuid,p_expected_revision integer,p_request_id uuid,p_meta jsonb,p_payload jsonb,p_reason text default null)
returns public.atlas_budget_builder_drafts language plpgsql security definer set search_path='' as $$
declare d public.atlas_budget_builder_drafts;role_name text:=atlas_private.budget_builder_role();allowed boolean;
begin
 if auth.uid() is null or p_draft_id is null or p_request_id is null or p_expected_revision is null or jsonb_typeof(p_payload) is distinct from 'object' or jsonb_typeof(coalesce(p_meta,'{}')) is distinct from 'object' then raise exception 'Invalid budget draft save request';end if;
 if not atlas_private.reforecast_access(p_community_id,'edit') then raise exception 'Budget edit access denied';end if;
 perform pg_advisory_xact_lock(hashtextextended('budget-builder:'||p_draft_id,0));
 select * into d from public.atlas_budget_builder_drafts where draft_id=p_draft_id;
 if exists(select 1 from public.atlas_budget_builder_events e where e.draft_id=p_draft_id and e.request_id=p_request_id) then return d;end if;
 if d.draft_id is null then
  if p_expected_revision<>0 then raise exception 'Budget draft not found';end if;
  insert into public.atlas_budget_builder_drafts(draft_id,community_id,fiscal_year,plan_type,asset_class,name,payload,created_by,updated_by,last_request_id)
  values(p_draft_id,p_community_id,(p_meta->>'fiscalYear')::integer,coalesce(p_meta->>'planType','budget'),coalesce(p_meta->>'assetClass','conventional'),coalesce(nullif(trim(p_meta->>'name'),''),'Budget draft'),p_payload,auth.uid(),auth.uid(),p_request_id)
  returning * into d;
  insert into public.atlas_budget_builder_events(draft_id,community_id,request_id,actor_id,actor_role,action,from_status,to_status,revision,reason)
  values(d.draft_id,d.community_id,p_request_id,auth.uid(),coalesce(role_name,'unknown'),'create',null,d.status,d.revision,p_reason);
  return d;
 end if;
 if d.community_id<>p_community_id then raise exception 'Budget draft community is immutable';end if;
 if d.revision<>p_expected_revision then raise exception 'This budget changed in another session. Keep your edits and reload before saving';end if;
 allowed:=case d.status
  when 'gm_draft' then true
  when 'regional_review' then atlas_private.budget_builder_is_regional()
  when 'vp_review' then role_name='vp'
  when 'approved_locked' then role_name='vp'
  when 'sent_to_investors' then role_name='vp'
  else false end;
 if not allowed then raise exception 'This budget is in % and cannot be edited by your role',replace(d.status,'_',' ');end if;
 if d.status in ('approved_locked','sent_to_investors') and length(trim(coalesce(p_reason,'')))<3 then raise exception 'A reason is required to edit an approved budget';end if;
 update public.atlas_budget_builder_drafts set payload=p_payload,name=coalesce(nullif(trim(p_meta->>'name'),''),name),asset_class=coalesce(p_meta->>'assetClass',asset_class),
  revision=revision+1,updated_by=auth.uid(),updated_at=now(),last_request_id=p_request_id,
  revised_after_approval=revised_after_approval or status in ('approved_locked','sent_to_investors')
 where draft_id=p_draft_id returning * into d;
 insert into public.atlas_budget_builder_events(draft_id,community_id,request_id,actor_id,actor_role,action,from_status,to_status,revision,reason,detail)
 values(d.draft_id,d.community_id,p_request_id,auth.uid(),coalesce(role_name,'unknown'),case when d.status in ('approved_locked','sent_to_investors') then 'vp_edit' else 'save' end,d.status,d.status,d.revision,p_reason,coalesce(p_meta->'changes','{}'::jsonb));
 return d;
end;$$;
revoke all on function public.atlas_budget_builder_save(uuid,uuid,integer,uuid,jsonb,jsonb,text) from public,anon;
grant execute on function public.atlas_budget_builder_save(uuid,uuid,integer,uuid,jsonb,jsonb,text) to authenticated;

create function public.atlas_budget_builder_transition(p_draft_id uuid,p_expected_revision integer,p_request_id uuid,p_action text,p_reason text default null,p_detail jsonb default '{}'::jsonb)
returns public.atlas_budget_builder_drafts language plpgsql security definer set search_path='' as $$
declare d public.atlas_budget_builder_drafts;role_name text:=atlas_private.budget_builder_role();next_status text;pub public.atlas_reforecast_publications;rev public.atlas_reforecast_revisions;
begin
 if auth.uid() is null or p_request_id is null then raise exception 'Invalid budget workflow request';end if;
 perform pg_advisory_xact_lock(hashtextextended('budget-builder:'||p_draft_id,0));
 select * into d from public.atlas_budget_builder_drafts where draft_id=p_draft_id;
 if d.draft_id is null or not atlas_private.reforecast_access(d.community_id,'read') then raise exception 'Budget draft not found';end if;
 if exists(select 1 from public.atlas_budget_builder_events e where e.draft_id=p_draft_id and e.request_id=p_request_id) then return d;end if;
 if d.revision<>p_expected_revision then raise exception 'This budget changed in another session. Reload before changing its status';end if;
 case p_action
 when 'submit_to_regional' then
  if d.status<>'gm_draft' or not atlas_private.reforecast_access(d.community_id,'edit') then raise exception 'Only an open GM draft can be submitted to Regional';end if;
  next_status:='regional_review';
 when 'regional_return' then
  if d.status<>'regional_review' or not atlas_private.budget_builder_is_regional() then raise exception 'Only a Regional reviewer can return this budget';end if;
  next_status:='gm_draft';
 when 'regional_approve' then
  if d.status<>'regional_review' or not atlas_private.budget_builder_is_regional() then raise exception 'Only a Regional reviewer can approve this budget for VP review';end if;
  next_status:='vp_review';
 when 'vp_return' then
  if d.status<>'vp_review' or role_name<>'vp' then raise exception 'Only the VP can return this budget';end if;
  next_status:='regional_review';
 when 'vp_approve' then
  if d.status not in ('vp_review','approved_locked','sent_to_investors') or role_name<>'vp' then raise exception 'Only the VP can approve and lock this budget';end if;
  if d.status<>'vp_review' and not d.revised_after_approval then raise exception 'Nothing changed since the last VP approval';end if;
  select * into pub from public.atlas_reforecast_publications where publication_id=nullif(p_detail->>'publicationId','')::uuid;
  select * into rev from public.atlas_reforecast_revisions where revision_id=pub.revision_id;
  if pub.publication_id is null or pub.community_id<>d.community_id or pub.published_by<>auth.uid() or rev.payload->>'budgetBuilderDraftId' is distinct from d.draft_id::text then
   raise exception 'Approve through the governed publication: the publication must exist for this community, be published by you and name this draft';
  end if;
  if d.status<>'vp_review' and pub.publication_id=d.publication_id then raise exception 'Republish the edited budget through the governed publication before re-approving';end if;
  if jsonb_typeof(p_detail->'summary') is distinct from 'object' then raise exception 'The locked investor summary is required';end if;
  next_status:='approved_locked';
 when 'archive' then
  if d.status<>'gm_draft' or not atlas_private.reforecast_access(d.community_id,'edit') then raise exception 'Only an open GM draft can be archived';end if;
  next_status:='archived';
 else raise exception 'Unknown budget workflow action';
 end case;
 if p_action in ('regional_return','vp_return','archive') and length(trim(coalesce(p_reason,'')))<3 then raise exception 'A reason is required';end if;
 update public.atlas_budget_builder_drafts set status=next_status,revision=revision+1,updated_by=auth.uid(),updated_at=now(),last_request_id=p_request_id,
  publication_id=case when p_action='vp_approve' then pub.publication_id else publication_id end,
  scenario_id=case when p_action='vp_approve' then pub.scenario_id else scenario_id end,
  locked_summary=case when p_action='vp_approve' then p_detail->'summary' else locked_summary end,
  revised_after_approval=case when p_action='vp_approve' then false else revised_after_approval end
 where draft_id=p_draft_id returning * into d;
 insert into public.atlas_budget_builder_events(draft_id,community_id,request_id,actor_id,actor_role,action,from_status,to_status,revision,reason,detail)
 values(d.draft_id,d.community_id,p_request_id,auth.uid(),coalesce(role_name,'unknown'),p_action,
  case p_action when 'submit_to_regional' then 'gm_draft' when 'regional_return' then 'regional_review' when 'regional_approve' then 'regional_review' when 'vp_return' then 'vp_review' when 'archive' then 'gm_draft' else null end,
  d.status,d.revision,p_reason,coalesce(p_detail,'{}'::jsonb)-'summary');
 return d;
end;$$;
revoke all on function public.atlas_budget_builder_transition(uuid,integer,uuid,text,text,jsonb) from public,anon;
grant execute on function public.atlas_budget_builder_transition(uuid,integer,uuid,text,text,jsonb) to authenticated;

create function public.atlas_budget_learning_record(p_community_id uuid,p_rows jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if not atlas_private.reforecast_access(p_community_id,'edit') then raise exception 'Budget learning access denied';end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>500 then raise exception 'Provide up to 500 observations';end if;
 insert into public.atlas_budget_learning_observations(community_id,source_kind,gl_code,metric,value,basis,period_from,period_to,created_by)
 select p_community_id,r->>'source_kind',nullif(r->>'gl_code',''),r->>'metric',(r->>'value')::numeric,coalesce(r->'basis','{}'::jsonb),nullif(r->>'period_from',''),nullif(r->>'period_to',''),auth.uid()
 from jsonb_array_elements(p_rows) r;
 get diagnostics n=row_count;return n;
end;$$;
revoke all on function public.atlas_budget_learning_record(uuid,jsonb) from public,anon;
grant execute on function public.atlas_budget_learning_record(uuid,jsonb) to authenticated;

-- Portfolio benchmarks are aggregate-only: medians per summary group and asset class,
-- from each community's latest observation, never community-identifying rows.
create function public.atlas_budget_benchmarks(p_asset_class text default null) returns jsonb language sql stable security definer set search_path='' as $$
 with latest as (
  select distinct on (o.community_id,o.basis->>'group') o.community_id,o.basis->>'group' grp,o.basis->>'assetClass' asset,o.value
  from public.atlas_budget_learning_observations o
  where o.metric='per_unit' and o.basis ? 'group' and (p_asset_class is null or o.basis->>'assetClass'=p_asset_class)
  order by o.community_id,o.basis->>'group',o.created_at desc)
 select case when exists(select 1 from public.atlas_user_profiles p where p.user_id=auth.uid() and p.status='active' and not ('12'=any(coalesce(p.locked_tab_ids,'{}'))))
  then coalesce((select jsonb_object_agg(grp,jsonb_build_object('median',med,'n',n)) from (select grp,percentile_cont(0.5) within group (order by value) med,count(*) n from latest group by grp having count(*)>=3) q),'{}'::jsonb)
  else '{}'::jsonb end;
$$;
revoke all on function public.atlas_budget_benchmarks(text) from public,anon;
grant execute on function public.atlas_budget_benchmarks(text) to authenticated;

create function public.atlas_claim_budget_investor_delivery(p_draft_id uuid,p_request_id uuid,p_recipients text[]) returns public.atlas_budget_investor_deliveries language plpgsql security definer set search_path='' as $$
declare d public.atlas_budget_builder_drafts;result public.atlas_budget_investor_deliveries;v text[];
begin
 select * into d from public.atlas_budget_builder_drafts where draft_id=p_draft_id;
 if d.draft_id is null or not atlas_private.reforecast_access(d.community_id,'read') then raise exception 'Budget not found';end if;
 if atlas_private.budget_builder_role() not in ('vp','admin','executive') then raise exception 'Only the VP may send the investor package';end if;
 if d.status not in ('approved_locked','sent_to_investors') or d.locked_summary is null or d.revised_after_approval then raise exception 'Send the investor package only after VP approval locks the current budget';end if;
 select * into result from public.atlas_budget_investor_deliveries where request_id=p_request_id;
 if result.delivery_id is not null then if result.draft_id<>p_draft_id then raise exception 'Delivery request reused';end if;return result;end if;
 select array_agg(distinct lower(trim(e)) order by lower(trim(e))) into v from unnest(p_recipients) e where trim(e)<>'';
 if coalesce(cardinality(v),0)<1 or cardinality(v)>20 or exists(select 1 from unnest(v) e where e !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$' or length(e)>254) then raise exception 'Enter 1 to 20 valid recipient emails';end if;
 insert into public.atlas_budget_investor_deliveries(draft_id,community_id,revision,publication_id,request_id,recipients,requested_by)
 values(d.draft_id,d.community_id,d.revision,d.publication_id,p_request_id,v,auth.uid()) returning * into result;
 return result;
end;$$;
revoke all on function public.atlas_claim_budget_investor_delivery(uuid,uuid,text[]) from public,anon;
grant execute on function public.atlas_claim_budget_investor_delivery(uuid,uuid,text[]) to authenticated;

-- Called by the Worker with the service key after the provider accepts (or rejects) the email.
create function public.atlas_finish_budget_investor_delivery(p_delivery_id uuid,p_status text,p_provider_message_id text default null) returns public.atlas_budget_investor_deliveries language plpgsql security definer set search_path='' as $$
declare r public.atlas_budget_investor_deliveries;
begin
 if p_status not in ('sent','unknown','failed') then raise exception 'Invalid delivery status';end if;
 update public.atlas_budget_investor_deliveries set status=p_status,provider_message_id=p_provider_message_id,sent_at=case when p_status='sent' then now() else sent_at end
 where delivery_id=p_delivery_id and status='claimed' returning * into r;
 if r.delivery_id is null then raise exception 'Delivery is not awaiting completion';end if;
 if p_status='sent' then
  update public.atlas_budget_builder_drafts set status='sent_to_investors',revision=revision+1,updated_at=now() where draft_id=r.draft_id and status='approved_locked';
  insert into public.atlas_budget_builder_events(draft_id,community_id,request_id,actor_id,actor_role,action,from_status,to_status,revision,detail)
  select d.draft_id,d.community_id,gen_random_uuid(),r.requested_by,'vp','investor_package_sent','approved_locked',d.status,d.revision,jsonb_build_object('deliveryId',r.delivery_id,'recipients',to_jsonb(r.recipients))
  from public.atlas_budget_builder_drafts d where d.draft_id=r.draft_id;
 end if;
 return r;
end;$$;
revoke all on function public.atlas_finish_budget_investor_delivery(uuid,text,text) from public,anon,authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role') then execute 'grant execute on function public.atlas_finish_budget_investor_delivery(uuid,text,text) to service_role';end if;end;$$;

