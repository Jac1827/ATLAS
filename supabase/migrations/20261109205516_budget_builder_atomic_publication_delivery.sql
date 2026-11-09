-- One durable operation per saved builder revision. Canonical publication and the
-- builder lock are committed by the same transaction, including legacy entrypoints.
create table public.atlas_budget_builder_publication_attempts (
 attempt_id uuid primary key default gen_random_uuid(),
 draft_id uuid not null references public.atlas_budget_builder_drafts(draft_id),
 community_id uuid not null references public.atlas_communities(community_id),
 draft_revision integer not null check (draft_revision > 0),
 scenario_id uuid not null unique default gen_random_uuid(),
 audit_request_id uuid not null default gen_random_uuid(),
 upload_request_id uuid not null default gen_random_uuid(),
 registry_request_id uuid not null default gen_random_uuid(),
 import_request_id uuid not null default gen_random_uuid(),
 submit_request_id uuid not null default gen_random_uuid(),
 publish_request_id uuid not null unique default gen_random_uuid(),
 summary jsonb not null check (jsonb_typeof(summary)='object'),
 publication_id uuid unique references public.atlas_reforecast_publications(publication_id),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(draft_id,draft_revision)
);
alter table public.atlas_budget_builder_publication_attempts enable row level security;
revoke all on public.atlas_budget_builder_publication_attempts from public,anon,authenticated;
grant select on public.atlas_budget_builder_publication_attempts to authenticated;
create policy builder_publication_read on public.atlas_budget_builder_publication_attempts for select to authenticated using(atlas_private.reforecast_access(community_id,'read'));

-- Never silently choose one of several historical publications, or invent a
-- missing investor summary. These records need an explicit financial reconciliation.
do $$begin
 if exists (
  select 1 from public.atlas_reforecast_publications p join public.atlas_reforecast_revisions r using(revision_id)
  left join public.atlas_budget_builder_drafts d on d.draft_id::text=r.payload->>'budgetBuilderDraftId'
  where r.payload ? 'budgetBuilderDraftId' and (d.draft_id is null or d.community_id<>p.community_id
   or (select count(*) from public.atlas_budget_builder_events e where e.draft_id=d.draft_id and e.action='vp_approve' and e.detail->>'publicationId'=p.publication_id::text)<>1)
 ) then raise exception 'Budget Builder publication history needs reconciliation: orphan or ambiguous publication association';end if;
 if exists(select 1 from public.atlas_budget_builder_drafts d where d.publication_id is not null and (d.locked_summary is null or not exists(select 1 from public.atlas_reforecast_publications p join public.atlas_reforecast_revisions r using(revision_id) where p.publication_id=d.publication_id and p.community_id=d.community_id and r.payload->>'budgetBuilderDraftId'=d.draft_id::text))) then
  raise exception 'Budget Builder publication history needs reconciliation: mismatched current association';end if;
end;$$;
insert into public.atlas_budget_builder_publication_attempts(draft_id,community_id,draft_revision,scenario_id,publish_request_id,summary,publication_id,created_by,created_at)
 select d.draft_id,d.community_id,e.revision-1,p.scenario_id,p.request_id,d.locked_summary,p.publication_id,p.published_by,p.published_at
 from public.atlas_budget_builder_drafts d join public.atlas_reforecast_publications p on p.publication_id=d.publication_id
 join public.atlas_budget_builder_events e on e.draft_id=d.draft_id and e.action='vp_approve' and e.detail->>'publicationId'=p.publication_id::text;

create function atlas_private.budget_builder_publication_state(a public.atlas_budget_builder_publication_attempts) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('attempt',to_jsonb(a),'draft',(select to_jsonb(d) from public.atlas_budget_builder_drafts d where d.draft_id=a.draft_id),
  'publication',(select to_jsonb(p) from public.atlas_reforecast_publications p where p.publication_id=a.publication_id),
  'upload',(select to_jsonb(u) from public.atlas_reforecast_uploads u where u.request_id=a.upload_request_id),
  'registry',(select to_jsonb(r) from public.atlas_reforecast_registries r where r.request_id=a.registry_request_id),
  'import',atlas_private.read_reforecast_import_receipt(a.community_id,a.import_request_id),
  'submitted',atlas_private.read_reforecast_save_receipt(a.community_id,a.submit_request_id));
$$;
revoke all on function atlas_private.budget_builder_publication_state(public.atlas_budget_builder_publication_attempts) from public,anon,authenticated;
create function public.atlas_prepare_budget_builder_publication(p_draft_id uuid,p_expected_revision integer,p_summary jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.atlas_budget_builder_drafts;a public.atlas_budget_builder_publication_attempts;
begin
 perform pg_advisory_xact_lock(hashtextextended('budget-builder:'||p_draft_id,0));
 select * into d from public.atlas_budget_builder_drafts where draft_id=p_draft_id;
 if auth.uid() is null or d.draft_id is null or not atlas_private.reforecast_access(d.community_id,'read') or atlas_private.budget_builder_role() is distinct from 'vp' then raise exception 'Only an authorized VP can publish this budget';end if;
 select * into a from public.atlas_budget_builder_publication_attempts where draft_id=p_draft_id and draft_revision=p_expected_revision;
 if a.attempt_id is not null then
  if a.created_by<>auth.uid() and a.publication_id is null then raise exception 'This publication is already being prepared by another VP';end if;
  if a.publication_id is null and d.revision<>p_expected_revision then raise exception 'This budget changed in another session. Reload before publication';end if;
  return atlas_private.budget_builder_publication_state(a);
 end if;
 if d.revision<>p_expected_revision then raise exception 'This budget changed in another session. Reload before publication';end if;
 if d.status not in ('vp_review','approved_locked','sent_to_investors') or (d.status<>'vp_review' and not d.revised_after_approval) then raise exception 'Only a reviewed or revised budget can be published';end if;
 if jsonb_typeof(p_summary) is distinct from 'object' or octet_length(p_summary::text)>4194304 then raise exception 'The locked investor summary is required';end if;
 insert into public.atlas_budget_builder_publication_attempts(draft_id,community_id,draft_revision,summary,created_by) values(d.draft_id,d.community_id,d.revision,p_summary,auth.uid()) returning * into a;
 return atlas_private.budget_builder_publication_state(a);
end;$$;
revoke all on function public.atlas_prepare_budget_builder_publication(uuid,integer,jsonb) from public,anon;
grant execute on function public.atlas_prepare_budget_builder_publication(uuid,integer,jsonb) to authenticated;

-- This trigger protects every canonical publication entrypoint, not just the UI.
-- Its association, event and the canonical publisher's other writes all roll back
-- if any later step (including original-budget creation) fails.
create function atlas_private.associate_budget_builder_publication() returns trigger language plpgsql security definer set search_path='' as $$
declare r public.atlas_reforecast_revisions;d public.atlas_budget_builder_drafts;a public.atlas_budget_builder_publication_attempts;previous_status text;
begin
 select * into r from public.atlas_reforecast_revisions where revision_id=new.revision_id;
 if not (r.payload ? 'budgetBuilderDraftId') then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended('budget-builder:'||(r.payload->>'budgetBuilderDraftId'),0));
 select * into d from public.atlas_budget_builder_drafts where draft_id::text=r.payload->>'budgetBuilderDraftId';
 select * into a from public.atlas_budget_builder_publication_attempts where attempt_id::text=r.payload->>'budgetBuilderAttemptId';
 if auth.uid() is null or atlas_private.budget_builder_role() is distinct from 'vp' or d.draft_id is null or not atlas_private.reforecast_access(d.community_id,'publish')
  or a.attempt_id is null or a.draft_id<>d.draft_id or a.community_id<>new.community_id or a.created_by<>auth.uid() or new.published_by<>auth.uid()
  or a.scenario_id<>new.scenario_id or a.publish_request_id<>new.request_id or a.publication_id is not null or a.draft_revision<>d.revision
  or r.payload->>'budgetBuilderRevision' is distinct from d.revision::text
  or d.status not in ('vp_review','approved_locked','sent_to_investors') or (d.status<>'vp_review' and not d.revised_after_approval) then
  raise exception 'Use the current atomic Budget Builder publication attempt; no publication was committed';
 end if;
 previous_status:=d.status;
 update public.atlas_budget_builder_drafts set status='approved_locked',revision=revision+1,publication_id=new.publication_id,scenario_id=new.scenario_id,
  locked_summary=a.summary,revised_after_approval=false,updated_by=auth.uid(),updated_at=now(),last_request_id=a.publish_request_id where draft_id=d.draft_id returning * into d;
 update public.atlas_budget_builder_publication_attempts set publication_id=new.publication_id where attempt_id=a.attempt_id;
 insert into public.atlas_budget_builder_events(draft_id,community_id,request_id,actor_id,actor_role,action,from_status,to_status,revision,detail)
 values(d.draft_id,d.community_id,a.publish_request_id,auth.uid(),'vp','vp_approve',previous_status,d.status,d.revision,jsonb_build_object('publicationId',new.publication_id,'scenarioId',new.scenario_id,'attemptId',a.attempt_id));
 return new;
end;$$;
revoke all on function atlas_private.associate_budget_builder_publication() from public,anon,authenticated;
create trigger budget_builder_atomic_association after insert on public.atlas_reforecast_publications for each row execute function atlas_private.associate_budget_builder_publication();

-- Disable the obsolete split association write. A retry may read an association
-- already committed by the trigger, but may never swap a newer draft to an old pub.
alter function public.atlas_budget_builder_transition(uuid,integer,uuid,text,text,jsonb) rename to budget_builder_transition_legacy;
alter function public.budget_builder_transition_legacy(uuid,integer,uuid,text,text,jsonb) set schema atlas_private;
revoke all on function atlas_private.budget_builder_transition_legacy(uuid,integer,uuid,text,text,jsonb) from public,anon,authenticated;
create function public.atlas_budget_builder_transition(p_draft_id uuid,p_expected_revision integer,p_request_id uuid,p_action text,p_reason text default null,p_detail jsonb default '{}'::jsonb)
returns public.atlas_budget_builder_drafts language plpgsql security definer set search_path='' as $$
declare d public.atlas_budget_builder_drafts;
begin
 if p_action='vp_approve' then
  select * into d from public.atlas_budget_builder_drafts where draft_id=p_draft_id;
  if auth.uid() is null or d.draft_id is null or not atlas_private.reforecast_access(d.community_id,'read') or atlas_private.budget_builder_role() is distinct from 'vp' then raise exception 'Only the VP can approve this budget';end if;
  if not d.revised_after_approval and d.publication_id::text=p_detail->>'publicationId' and d.status in ('approved_locked','sent_to_investors') then return d;end if;
  raise exception 'Approve through the atomic governed publication; a separate association is not allowed';
 end if;
 return atlas_private.budget_builder_transition_legacy(p_draft_id,p_expected_revision,p_request_id,p_action,p_reason,p_detail);
end;$$;
revoke all on function public.atlas_budget_builder_transition(uuid,integer,uuid,text,text,jsonb) from public,anon;
grant execute on function public.atlas_budget_builder_transition(uuid,integer,uuid,text,text,jsonb) to authenticated;

-- A publication + normalized recipient set is a delivery identity across browser
-- retries and new request IDs. The immutable claimed summary prevents a race with
-- later VP edits. Legacy rows retain their evidence; ambiguous duplicates abort.
alter table public.atlas_budget_investor_deliveries add column locked_summary jsonb;
update public.atlas_budget_investor_deliveries x set locked_summary=d.locked_summary from public.atlas_budget_builder_drafts d where d.draft_id=x.draft_id and d.publication_id=x.publication_id;
update public.atlas_budget_investor_deliveries x set recipients=(select array_agg(distinct lower(trim(v)) order by lower(trim(v))) from unnest(x.recipients) v);
do $$begin
 if exists(select 1 from public.atlas_budget_investor_deliveries where status in ('claimed','unknown','sent') group by draft_id,publication_id,recipients having count(*)>1) then raise exception 'Investor delivery history needs reconciliation: duplicate unresolved or sent packages';end if;
end;$$;
do $$begin
 if exists(select 1 from public.atlas_budget_investor_deliveries where status in ('claimed','unknown') group by draft_id,publication_id having count(*)>1) then raise exception 'Investor delivery history needs reconciliation: multiple unresolved packages';end if;
end;$$;
create unique index atlas_budget_investor_delivery_unresolved on public.atlas_budget_investor_deliveries(draft_id,publication_id) where status in ('claimed','unknown');
create unique index atlas_budget_investor_delivery_identity on public.atlas_budget_investor_deliveries(draft_id,publication_id,recipients) where status in ('claimed','unknown','sent');
create function atlas_private.claim_budget_investor_delivery(p_draft_id uuid,p_request_id uuid,p_recipients text[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.atlas_budget_builder_drafts;r public.atlas_budget_investor_deliveries;v text[];
begin
 if auth.uid() is null or p_request_id is null then raise exception 'Invalid investor delivery request';end if;
 perform pg_advisory_xact_lock(hashtextextended('budget-builder:'||p_draft_id,0));
 select * into d from public.atlas_budget_builder_drafts where draft_id=p_draft_id;
 if d.draft_id is null or not atlas_private.reforecast_access(d.community_id,'read') then raise exception 'Budget not found';end if;
 if atlas_private.budget_builder_role() is distinct from 'vp' then raise exception 'Only the VP may send the investor package';end if;
 select array_agg(distinct lower(trim(e)) order by lower(trim(e))) into v from unnest(p_recipients) e where trim(e)<>'';
 if coalesce(cardinality(v),0)<1 or cardinality(v)>20 or exists(select 1 from unnest(v) e where e !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$' or length(e)>254) then raise exception 'Enter 1 to 20 valid recipient emails';end if;
 select * into r from public.atlas_budget_investor_deliveries where request_id=p_request_id;
 if r.delivery_id is not null then
  if r.draft_id<>p_draft_id or r.recipients<>v then raise exception 'Delivery request reused for different package or recipients';end if;
  return jsonb_build_object('delivery',to_jsonb(r),'sendAuthorized',false);
 end if;
 if d.status not in ('approved_locked','sent_to_investors') or d.publication_id is null or d.locked_summary is null or d.revised_after_approval then raise exception 'Send the investor package only after VP approval locks the current budget';end if;
 select * into r from public.atlas_budget_investor_deliveries where draft_id=d.draft_id and publication_id=d.publication_id and (status in ('claimed','unknown') or (status='sent' and recipients=v)) order by created_at limit 1;
 if r.delivery_id is not null then return jsonb_build_object('delivery',to_jsonb(r),'sendAuthorized',false);end if;
 if exists(select 1 from public.atlas_budget_investor_deliveries where draft_id=d.draft_id and publication_id=d.publication_id and status='sent' and recipients && v) then raise exception 'This package was already sent to one or more recipients. Use only new recipients';end if;
 insert into public.atlas_budget_investor_deliveries(draft_id,community_id,revision,publication_id,request_id,recipients,requested_by,locked_summary)
 values(d.draft_id,d.community_id,d.revision,d.publication_id,p_request_id,v,auth.uid(),d.locked_summary) returning * into r;
 return jsonb_build_object('delivery',to_jsonb(r),'sendAuthorized',true);
end;$$;
revoke all on function atlas_private.claim_budget_investor_delivery(uuid,uuid,text[]) from public,anon,authenticated;
create function public.atlas_claim_budget_investor_delivery_v2(p_draft_id uuid,p_request_id uuid,p_recipients text[]) returns jsonb language sql security definer set search_path='' as $$select atlas_private.claim_budget_investor_delivery(p_draft_id,p_request_id,p_recipients)$$;
revoke all on function public.atlas_claim_budget_investor_delivery_v2(uuid,uuid,text[]) from public,anon;
grant execute on function public.atlas_claim_budget_investor_delivery_v2(uuid,uuid,text[]) to authenticated;
create or replace function public.atlas_claim_budget_investor_delivery(p_draft_id uuid,p_request_id uuid,p_recipients text[]) returns public.atlas_budget_investor_deliveries language plpgsql security definer set search_path='' as $$
declare result jsonb;r public.atlas_budget_investor_deliveries;
begin
 result:=atlas_private.claim_budget_investor_delivery(p_draft_id,p_request_id,p_recipients);
 r:=jsonb_populate_record(null::public.atlas_budget_investor_deliveries,result->'delivery');
 if not (result->>'sendAuthorized')::boolean and r.status<>'sent' then raise exception 'Delivery outcome needs verification; automatic resend is blocked';end if;
 return r;
end;$$;

create or replace function public.atlas_finish_budget_investor_delivery(p_delivery_id uuid,p_status text,p_provider_message_id text default null) returns public.atlas_budget_investor_deliveries language plpgsql security definer set search_path='' as $$
declare r public.atlas_budget_investor_deliveries;d public.atlas_budget_builder_drafts;
begin
 if p_status not in ('sent','unknown','failed') then raise exception 'Invalid delivery status';end if;
 select * into r from public.atlas_budget_investor_deliveries where delivery_id=p_delivery_id;
 if r.delivery_id is null then raise exception 'Delivery not found';end if;
 perform pg_advisory_xact_lock(hashtextextended('budget-builder:'||r.draft_id,0));
 select * into r from public.atlas_budget_investor_deliveries where delivery_id=p_delivery_id for update;
 if r.status=p_status then return r;end if;
 if r.status<>'claimed' then raise exception 'Delivery is not awaiting completion';end if;
 update public.atlas_budget_investor_deliveries set status=p_status,provider_message_id=p_provider_message_id,sent_at=case when p_status='sent' then now() else sent_at end where delivery_id=p_delivery_id returning * into r;
 if p_status='sent' then
  update public.atlas_budget_builder_drafts set status='sent_to_investors',revision=revision+1,updated_at=now() where draft_id=r.draft_id and publication_id=r.publication_id and not revised_after_approval and status='approved_locked' returning * into d;
  if d.draft_id is not null then
   insert into public.atlas_budget_builder_events(draft_id,community_id,request_id,actor_id,actor_role,action,from_status,to_status,revision,detail)
   values(d.draft_id,d.community_id,gen_random_uuid(),r.requested_by,'vp','investor_package_sent','approved_locked',d.status,d.revision,jsonb_build_object('deliveryId',r.delivery_id,'recipients',to_jsonb(r.recipients)));
  end if;
 end if;
 return r;
end;$$;
