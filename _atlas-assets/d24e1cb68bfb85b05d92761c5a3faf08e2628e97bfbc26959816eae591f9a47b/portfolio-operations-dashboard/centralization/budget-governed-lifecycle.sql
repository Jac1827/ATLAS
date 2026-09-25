-- Governed draft, VP publication and investor final approval lifecycle.
-- Existing immutable snapshots and source relationships are preserved.
begin;
create table atlas_private.budget_vp_designations (
 user_id uuid primary key references auth.users(id),
 assigned_by uuid not null references auth.users(id), assigned_at timestamptz not null default now(),
 reason text not null check(length(trim(reason))>=3)
);
alter table atlas_private.budget_vp_designations enable row level security;
revoke all on atlas_private.budget_vp_designations from public,anon,authenticated;
-- Executive is explicitly confirmed by the organization as VP authority. Additional designations require verified assignment; no client grant endpoint.
create or replace function atlas_private.is_budget_vp(person uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.atlas_user_profiles p where p.user_id=person and p.status='active'
 and (p.role in ('executive','vp','vice_president') or exists(select 1 from atlas_private.budget_vp_designations d where d.user_id=p.user_id)));
$$;
revoke all on function atlas_private.is_budget_vp(uuid) from public,anon;
grant execute on function atlas_private.is_budget_vp(uuid) to authenticated;
create or replace function atlas_private.reforecast_access(cid uuid, action text default 'read') returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.atlas_user_profiles p join public.atlas_communities c on c.community_id=cid
 where p.user_id=auth.uid() and p.status='active' and c.deleted_at is null and public.atlas_can_access_community(cid)
 and ((action='active_read' and (atlas_private.command_access(cid) or (not ('8'=any(coalesce(p.locked_tab_ids,'{}'))) and not ('reporting'=any(coalesce(p.locked_page_keys,'{}'))))))
 or (not ('12'=any(coalesce(p.locked_tab_ids,'{}'))) and not ('budget'=any(coalesce(p.locked_page_keys,'{}')))
 and (action in ('read','active_read') or action in ('edit','reopen') and p.role in ('admin','executive','regional','finance','centra','community_manager','vp','vice_president')
 or action='review' and (p.role in ('admin','executive','regional','finance') or atlas_private.is_budget_vp(p.user_id))
 or action in ('approve','publish') and atlas_private.is_budget_vp(p.user_id)))));
$$;
-- Administrative mapping governance remains distinct from financial publication approval.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.atlas_save_reforecast_registry(uuid,uuid,uuid,jsonb)'::regprocedure);
 definition:=replace(definition,$a$atlas_private.reforecast_access(p_community_id,'approve')$a$,$a$atlas_private.reforecast_access(p_community_id,'review')$a$);
 execute definition;
end;$$;
alter table public.atlas_reforecast_revisions drop constraint atlas_reforecast_revisions_status_check;
alter table public.atlas_reforecast_revisions add constraint atlas_reforecast_revisions_status_check check(status in
 ('uploaded','mapping_required','reconciled','working_draft','ready_for_review','submitted','approved','locked','pending_investor_approval','investor_approved','withdrawn','rejected','reopened','superseded','deleted'));
create table public.atlas_budget_workflow_audit (
 event_id uuid primary key default gen_random_uuid(),community_id uuid not null references public.atlas_communities(community_id),
 scenario_id uuid not null,revision_id uuid references public.atlas_reforecast_revisions(revision_id),publication_id uuid references public.atlas_reforecast_publications(publication_id),
 actor_id uuid not null references auth.users(id),actor_role text not null,action text not null,created_at timestamptz not null default now(),
 previous_state text,new_state text,previous_revision_id uuid,source_version text,baseline_versions jsonb not null,
 reason text,detail jsonb not null
);
create table public.atlas_budget_publication_deliveries (
 delivery_id uuid primary key default gen_random_uuid(),publication_id uuid not null references public.atlas_reforecast_publications(publication_id),
 community_id uuid not null references public.atlas_communities(community_id),consumer_key text not null,
 request_id uuid not null,attempt integer not null,delivery_status text not null check(delivery_status in ('verified','pending','failed','superseded')),
 content_fingerprint text not null,detail jsonb not null,actor_id uuid not null references auth.users(id),created_at timestamptz not null default now(),
 unique(publication_id,consumer_key,request_id)
);
do $$declare t text;begin foreach t in array array['atlas_budget_workflow_audit','atlas_budget_publication_deliveries'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy budget_workflow_read on public.%I for select to authenticated using(atlas_private.reforecast_access(community_id,''read''))',t);
 execute format('create trigger budget_history_immutable before update or delete on public.%I for each row execute function atlas_private.finance_immutable()',t);
 end loop;end;$$;
create function atlas_private.audit_budget_workflow() returns trigger language plpgsql security definer set search_path='' as $$
declare previous public.atlas_reforecast_revisions;baselines jsonb;
begin
 select coalesce(jsonb_agg(jsonb_build_object('period',h.period_key,'publicationId',h.publication_id) order by h.period_key),'[]') into baselines from public.atlas_reforecast_active_heads h where h.community_id=new.community_id;
 if tg_table_name='atlas_reforecast_revisions' then
 select * into previous from public.atlas_reforecast_revisions where scenario_id=new.scenario_id and revision<new.revision order by revision desc limit 1;
 insert into public.atlas_budget_workflow_audit(community_id,scenario_id,revision_id,actor_id,actor_role,action,previous_state,new_state,previous_revision_id,source_version,baseline_versions,reason,detail)
 values(new.community_id,new.scenario_id,new.revision_id,new.actor_id,new.actor_role,new.action,previous.status,new.status,previous.revision_id,new.source->>'sourceVersion',baselines,new.payload->>'reason',
 jsonb_build_object('previousFingerprint',previous.snapshot->>'fingerprint','fingerprint',new.snapshot->>'fingerprint','sourceUploadId',new.payload->>'uploadId','investorApprovalDate',new.payload->>'investorApprovalDate','recordType',coalesce(new.payload->>'recordType','reforecast')));
 else
 insert into public.atlas_budget_workflow_audit(community_id,scenario_id,revision_id,publication_id,actor_id,actor_role,action,new_state,source_version,baseline_versions,reason,detail)
 values(new.community_id,new.scenario_id,new.revision_id,new.publication_id,new.published_by,new.published_role,'vp_publication','pending_investor_approval',new.source->>'sourceVersion',baselines,new.reason,
 jsonb_build_object('publicationVersion',new.version,'fingerprint',new.snapshot->>'fingerprint','affectedPeriods',new.periods,'deliveryStatus','pending_readback'));
 end if;return new;
end;$$;
revoke all on function atlas_private.audit_budget_workflow() from public,anon,authenticated;
create trigger budget_revision_audit after insert on public.atlas_reforecast_revisions for each row execute function atlas_private.audit_budget_workflow();
create trigger budget_publication_audit after insert on public.atlas_reforecast_publications for each row execute function atlas_private.audit_budget_workflow();


create or replace function atlas_private.save_reforecast_builder(p_community_id uuid,p_scenario_id uuid,p_expected_revision integer,p_request_id uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.atlas_reforecast_revisions;rec public.atlas_reforecast_revisions;head public.atlas_reforecast_heads;source jsonb;snapshot jsonb;config jsonb;periods text[];budget_ids uuid[];role_name text;hash text;next_status text;person uuid;owner_id uuid;reviewer_id uuid;submitted public.atlas_reforecast_revisions;config_overrides jsonb;
begin
 if not atlas_private.reforecast_access(p_community_id,'edit') then raise exception 'Reforecast edit access denied';end if;
 if p_scenario_id is null or p_request_id is null or p_expected_revision is null or p_expected_revision<0 or p_action not in ('create','save_draft','edit','reconcile','ready','submit','approve','withdraw','reject','reopen','investor_approve','delete') or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>2097152 then raise exception 'Invalid reforecast save request';end if;
 hash:=encode(sha256(convert_to(jsonb_build_array(p_community_id,p_scenario_id,p_expected_revision,p_action,p_payload)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('reforecast-active:'||p_community_id,0));perform pg_advisory_xact_lock(hashtextextended('reforecast-scenario:'||p_scenario_id,0));
 select * into rec from public.atlas_reforecast_revisions where request_id=p_request_id;
 if rec.revision_id is not null then
  if rec.community_id<>p_community_id or rec.actor_id<>auth.uid() or rec.request_hash<>hash then raise exception 'Reforecast save request ID reused for different changes';end if;
  select * into head from public.atlas_reforecast_heads where scenario_id=p_scenario_id;return jsonb_build_object('head',to_jsonb(head),'revision',to_jsonb(rec),'source',rec.source,'snapshot',rec.snapshot);
 end if;
 select r.* into prior from public.atlas_reforecast_heads h join public.atlas_reforecast_revisions r using(revision_id) where h.scenario_id=p_scenario_id;
 if prior.revision_id is not null and prior.community_id<>p_community_id then raise exception 'Scenario community is immutable';end if;
 if coalesce(prior.revision,0)<>p_expected_revision then raise exception 'Reforecast changed in another session. Keep your edits and reload before retrying';end if;
 if prior.status in ('locked','investor_approved') and p_action<>'reopen' then raise exception 'Investor Approved versions are locked. Use formal Reopen with a reason';end if;
 if prior.status='deleted' then raise exception 'Deleted drafts are retained only as audit history';end if;
 if prior.status='submitted' and p_action not in ('approve','withdraw','reject') then raise exception 'Submitted revisions are immutable; withdraw or reject before editing';end if;
 select role into role_name from public.atlas_user_profiles where user_id=auth.uid();
 if p_action in ('create','save_draft','edit','reconcile') then
  if prior.status in ('pending_investor_approval','approved') and p_action not in ('edit','save_draft') then raise exception 'Use Edit for a Pending Investor Approval version';end if;
  config:=p_payload;
 else
  if prior.revision_id is null then raise exception 'Save a working draft before a workflow transition';end if;
  if (p_payload-'reason'-'investorApprovalDate'-'deleteConfirmed') is distinct from (prior.payload-'reason'-'investorApprovalDate'-'deleteConfirmed') then raise exception 'Save changed inputs as a working draft before changing review status';end if;
  config:=prior.payload||jsonb_build_object('reason',p_payload->>'reason');
  if p_action='investor_approve' then config:=config||jsonb_build_object('investorApprovalDate',p_payload->>'investorApprovalDate');end if;
 end if;
 if coalesce(config->>'name','')='' or length(config->>'name')>200 or coalesce(config->>'model','') not in ('conventional','student','lease_up','short_term','owner_specific','mixed') or jsonb_typeof(config->'periods') is distinct from 'array' or length(trim(coalesce(config->>'reason','')))<3 then raise exception 'Scenario name, model, reporting periods and adjustment reason are required';end if;
 if jsonb_typeof(coalesce(config->'drivers','[]'))<>'array' or jsonb_array_length(coalesce(config->'drivers','[]'))>500 or jsonb_typeof(coalesce(config->'overrides','[]'))<>'array' or jsonb_array_length(coalesce(config->'overrides','[]'))>20000 then raise exception 'Invalid or oversized scenario inputs';end if;
 if exists(select 1 from jsonb_array_elements(coalesce(config->'overrides','[]'))v group by v->>'period',v->>'accountCode' having count(*)>1) then raise exception 'Keep one working-cell override for each GL and reporting month';end if;
 select array_agg(v order by v) into periods from jsonb_array_elements_text(config->'periods')v;
 if config->>'uploadId' is not null and not exists(select 1 from public.atlas_reforecast_uploads where upload_id=(config->>'uploadId')::uuid and community_id=p_community_id) then raise exception 'Workbook upload community mismatch';end if;
 select array_agg(v::uuid) into budget_ids from jsonb_array_elements_text(coalesce(config->'baselineVersionIds','[]'))v;
 if config->>'ownerId' is null and prior.revision_id is null then config:=config||jsonb_build_object('ownerId',auth.uid());end if;
 owner_id:=nullif(config->>'ownerId','')::uuid;reviewer_id:=nullif(config->>'reviewerId','')::uuid;
 foreach person in array array[owner_id,reviewer_id] loop
  if person is not null and not exists(select 1 from public.atlas_user_profiles where user_id=person and status='active' and (role in ('admin','executive','centra') or p_community_id=any(coalesce(allowed_community_ids,'{}')))) then raise exception 'Owner or reviewer is not active and authorized for this community';end if;
 end loop;
 if reviewer_id is not null and not exists(select 1 from public.atlas_user_profiles where user_id=reviewer_id and role in ('admin','executive','regional')) then raise exception 'Reviewer must be an Admin, executive or Regional';end if;
 if p_action in ('withdraw','reject','reopen','investor_approve','delete') then
  rec.revision_id:=gen_random_uuid();source:=prior.source;snapshot:=prior.snapshot;
 else
 select coalesce(jsonb_agg(case when old.value is not null and v->'amount' is distinct from old.value->'amount' and v->>'sourceLineId' is not null then
 (v-'sourceLineId'-'uploadId'-'formula'-'cachedValue')||jsonb_build_object('source',jsonb_build_object('kind','manual_revision','priorImport',jsonb_build_object('uploadId',coalesce(v->>'uploadId',prior.payload->>'uploadId'),'sourceLineId',v->>'sourceLineId','priorAmount',old.value->'amount'),'previousRevisionId',prior.revision_id)) else v end),'[]') into config_overrides
 from jsonb_array_elements(coalesce(config->'overrides','[]'))v left join lateral (select value from jsonb_array_elements(coalesce(prior.payload->'overrides','[]'))o where o->>'period'=v->>'period' and o->>'accountCode'=v->>'accountCode')old on true;
 config:=jsonb_set(config,'{overrides}',config_overrides);
 source:=atlas_private.reforecast_source_for_config(p_community_id,config);
 snapshot:=atlas_private.calculate_reforecast(source,config);
 if config->>'uploadId' is not null or jsonb_array_length(coalesce(config->'importHistory','[]'))>0 or exists(select 1 from jsonb_array_elements(coalesce(config->'overrides','[]'))v where v->>'sourceLineId' is not null) then snapshot:=jsonb_set(snapshot,'{diagnostics}',snapshot->'diagnostics'||atlas_private.reforecast_import_issues(source,config));end if;
 if owner_id is null or reviewer_id is null then snapshot:=jsonb_set(snapshot,'{diagnostics}',snapshot->'diagnostics'||jsonb_build_array(jsonb_build_object('code','ownership_required','severity','error','message','Assign an active owner and authorized reviewer.')));end if;
 snapshot:=jsonb_set(snapshot,'{completeness,blockerCount}',to_jsonb((select count(*) from jsonb_array_elements(snapshot->'diagnostics')d where d->>'severity'='error')));
 snapshot:=jsonb_set(snapshot,'{status}',to_jsonb(case when (snapshot->'completeness'->>'blockerCount')::integer>0 then 'action_required'::text else 'ready'::text end));
 rec.revision_id:=gen_random_uuid();
 snapshot:=snapshot||jsonb_build_object('identity',(snapshot->'identity')||jsonb_build_object('scenarioId',p_scenario_id,'scenarioVersion',p_expected_revision+1,'reforecastVersion',rec.revision_id));
 snapshot:=snapshot||jsonb_build_object('fingerprint',encode(sha256(convert_to((snapshot-'fingerprint')::text,'UTF8')),'hex'));
 end if;
 if p_action in ('ready','submit','approve') then
  if (snapshot->'completeness'->>'blockerCount')::integer>0 then raise exception 'Resolve mapping, missing values and ownership blockers before review or approval';end if;
  if prior.source->>'sourceVersion' is distinct from source->>'sourceVersion' then raise exception 'Canonical actuals, budget or registry evidence changed. Save and reconcile the working draft before review';end if;
 end if;
 case p_action
 when 'create' then next_status:='uploaded';
 when 'save_draft','edit' then next_status:=case when prior.status in ('pending_investor_approval','approved') and role_name<>'admin' and not atlas_private.is_budget_vp(auth.uid()) then 'submitted' when source->'registry'->>'version' is null then 'mapping_required' else 'working_draft' end;
 when 'reconcile' then next_status:=case when (snapshot->'completeness'->>'blockerCount')::integer=0 then 'reconciled' when exists(select 1 from jsonb_array_elements(snapshot->'diagnostics')d where d->>'code' in ('unmapped_account','mapping_required','driver_mapping_required')) then 'mapping_required' else 'working_draft' end;
 when 'ready' then if prior.status not in ('uploaded','mapping_required','working_draft','reconciled','withdrawn','rejected','reopened') then raise exception 'Reconcile a working draft before marking ready';end if;next_status:='ready_for_review';
 when 'submit' then if prior.status not in ('uploaded','mapping_required','working_draft','reconciled','ready_for_review','withdrawn','rejected','reopened') then raise exception 'Submit an open working draft';end if;next_status:='submitted';
 when 'approve' then
  if prior.status<>'submitted' or not atlas_private.reforecast_access(p_community_id,'approve') then raise exception 'Only a verified VP-level user may approve and publish a submitted revision';end if;
  next_status:='pending_investor_approval';
 when 'withdraw' then
  select * into submitted from public.atlas_reforecast_revisions where scenario_id=p_scenario_id and status='submitted' order by revision desc limit 1;
  if prior.status<>'submitted' or submitted.actor_id<>auth.uid() then raise exception 'Only the submitter may withdraw this submitted revision';end if;
  next_status:='withdrawn';
 when 'reject' then
  if prior.status<>'submitted' or not atlas_private.reforecast_access(p_community_id,'review') then raise exception 'An authorized reviewer may reject a submitted revision';end if;
  next_status:='rejected';
 when 'reopen' then
  if prior.status not in ('locked','investor_approved') then raise exception 'Only a final locked version requires formal Reopen';end if;
  next_status:='reopened';config:=config||jsonb_build_object('reopenedFromRevisionId',prior.revision_id,'priorInvestorApprovalDate',prior.payload->'investorApprovalDate')-'investorApprovalDate';
 when 'investor_approve' then
  if prior.status<>'pending_investor_approval' or not atlas_private.reforecast_access(p_community_id,'review') then raise exception 'Investor approval requires a VP-published version and an authorized reviewer';end if;
  if coalesce(p_payload->>'investorApprovalDate','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or (p_payload->>'investorApprovalDate')::date>current_date then raise exception 'Enter the actual investor approval date';end if;
  if not exists(select 1 from public.atlas_reforecast_publications p where p.revision_id=prior.revision_id and p.snapshot=prior.snapshot) then raise exception 'Publish the exact financial revision before investor approval';end if;
  next_status:='investor_approved';config:=config||jsonb_build_object('investorPublicationId',(select publication_id from public.atlas_reforecast_publications where revision_id=prior.revision_id),'investorApprovedBy',auth.uid(),'investorApprovedAt',clock_timestamp());
 when 'delete' then
  if prior.revision_id is null or prior.status not in ('uploaded','mapping_required','working_draft','reconciled','ready_for_review','withdrawn','rejected','reopened') or p_payload->>'deleteConfirmed' is distinct from 'true' then raise exception 'Confirm deletion of an open draft';end if;
  next_status:='deleted';
 end case;
 insert into public.atlas_reforecast_revisions(revision_id,scenario_id,community_id,revision,status,action,request_id,request_hash,payload,source,snapshot,actor_id,actor_role)
 values(rec.revision_id,p_scenario_id,p_community_id,p_expected_revision+1,next_status,p_action,p_request_id,hash,config,source,snapshot,auth.uid(),role_name) returning * into rec;
 insert into public.atlas_reforecast_heads values(p_scenario_id,p_community_id,rec.revision,rec.revision_id,next_status)
 on conflict(scenario_id) do update set revision=excluded.revision,revision_id=excluded.revision_id,status=excluded.status returning * into head;
 return jsonb_build_object('head',to_jsonb(head),'revision',to_jsonb(rec),'source',source,'snapshot',snapshot);
end;$$;


create or replace function public.atlas_publish_reforecast(p_scenario_id uuid,p_expected_revision integer,p_request_id uuid,p_reason text)
returns public.atlas_reforecast_publications language plpgsql security definer set search_path='' as $$
declare rec public.atlas_reforecast_revisions;pub public.atlas_reforecast_publications;source jsonb;periods text[];budget_ids uuid[];hash text;next_version integer;
begin
 select r.* into rec from public.atlas_reforecast_heads h join public.atlas_reforecast_revisions r using(revision_id) where h.scenario_id=p_scenario_id;
 if rec.revision_id is null or not atlas_private.reforecast_access(rec.community_id,'publish') then raise exception 'Only a verified VP-level user may publish an active financial revision';end if;
 if p_request_id is null or length(trim(coalesce(p_reason,'')))<3 then raise exception 'Publication request and reason required';end if;
 hash:=encode(sha256(convert_to(jsonb_build_array(p_scenario_id,p_expected_revision,p_reason)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('reforecast-active:'||rec.community_id,0));
 select * into pub from public.atlas_reforecast_publications where request_id=p_request_id;
 if pub.publication_id is not null then if pub.request_hash<>hash or pub.published_by<>auth.uid() then raise exception 'Publication request ID reused';end if;return pub;end if;
 if rec.status<>'pending_investor_approval' or rec.revision<>p_expected_revision then raise exception 'Only the expected VP-approved revision may be published';end if;
 select * into pub from public.atlas_reforecast_publications where revision_id=rec.revision_id;
 if pub.publication_id is not null then
  if rec.payload->>'scenarioPurpose' is distinct from 'str_overlay' and exists(select 1 from unnest(pub.periods)p where not atlas_private.reforecast_month_locked(pub.community_id,p) and not exists(select 1 from public.atlas_reforecast_active_heads h where h.community_id=pub.community_id and h.period_key=p and h.publication_id=pub.publication_id)) then raise exception 'This publication was superseded; create and approve a new revision rather than reactivating history';end if;return pub;
 end if;
 select array_agg(v order by v) into periods from jsonb_array_elements_text(rec.payload->'periods')v;
 select array_agg(v::uuid) into budget_ids from jsonb_array_elements_text(coalesce(rec.payload->'baselineVersionIds','[]'))v;
 source:=atlas_private.reforecast_source_for_config(rec.community_id,rec.payload);
 if source->>'sourceVersion' is distinct from rec.source->>'sourceVersion' then raise exception 'Closed actual evidence changed after locking. Preserve this locked version and create a revised working scenario';end if;
 if (rec.snapshot->'completeness'->>'blockerCount')::integer<>0 then raise exception 'Locked snapshot has unresolved blockers';end if;
 if rec.payload->>'scenarioPurpose' is distinct from 'str_overlay' and exists(select 1 from public.atlas_reforecast_publications b where rec.payload->'baselinePublicationIds' ? b.publication_id::text and b.snapshot->'identity'->>'scenarioPurpose'='str_overlay') then raise exception 'A RISE overlay cannot be selected as a Conventional operating baseline';end if;
 select coalesce(max(version),0)+1 into next_version from public.atlas_reforecast_publications where community_id=rec.community_id;
 insert into public.atlas_reforecast_publications(community_id,scenario_id,revision_id,version,request_id,request_hash,periods,snapshot,source,reason,published_by,published_role)
 values(rec.community_id,p_scenario_id,rec.revision_id,next_version,p_request_id,hash,periods,rec.snapshot,rec.source,p_reason,auth.uid(),(select role from public.atlas_user_profiles where user_id=auth.uid())) returning * into pub;
 insert into public.atlas_reforecast_active_heads select rec.community_id,p,pub.publication_id from unnest(periods)p where rec.payload->>'scenarioPurpose' is distinct from 'str_overlay' 
 on conflict(community_id,period_key) do update set publication_id=excluded.publication_id;
 return pub;
end;$$;


-- Published financial snapshots are immutable. A later actual close, draft edit,
-- contract update or review action cannot invalidate the last VP-approved values.
create or replace function atlas_private.reforecast_publication_period_valid(pub public.atlas_reforecast_publications,p text default null)
returns boolean language sql stable security definer set search_path='' as $$
 select pub.publication_id is not null and (p is null or p=any(pub.periods))
 and pub.snapshot->>'fingerprint'=encode(sha256(convert_to((pub.snapshot-'fingerprint')::text,'UTF8')),'hex')
 and exists(select 1 from public.atlas_reforecast_revisions r where r.revision_id=pub.revision_id and r.community_id=pub.community_id and r.snapshot=pub.snapshot and r.source=pub.source and r.status in ('locked','pending_investor_approval','investor_approved'));
$$;
create function atlas_private.budget_permissions(cid uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('canEdit',atlas_private.reforecast_access(cid,'edit'),'canReview',atlas_private.reforecast_access(cid,'review'),'canApprovePublication',atlas_private.reforecast_access(cid,'publish'));
$$;
revoke all on function atlas_private.budget_permissions(uuid) from public,anon,authenticated;

create function atlas_private.budget_publication_readback(p_publication_id uuid,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare pub public.atlas_reforecast_publications;consumer text;status text;details jsonb;attempt integer;readback jsonb;deliveries jsonb:='[]';existing jsonb;
begin
 select * into pub from public.atlas_reforecast_publications where publication_id=p_publication_id;
 if auth.uid() is null or pub.publication_id is null or not atlas_private.reforecast_access(pub.community_id,'publish') or p_request_id is null then raise exception 'Only a verified VP may retry publication delivery';end if;
 perform pg_advisory_xact_lock(hashtextextended('budget-delivery:'||p_publication_id,0));
 foreach consumer in array array['canonical_baseline','official_report','finance_summary','recommendations','dashboard','excel_export','pdf_export'] loop
 select to_jsonb(d) into existing from public.atlas_budget_publication_deliveries d where publication_id=p_publication_id and consumer_key=consumer and request_id=p_request_id;
 if existing is not null then deliveries:=deliveries||jsonb_build_array(existing);continue;end if;
 select to_jsonb(d) into existing from public.atlas_budget_publication_deliveries d where publication_id=p_publication_id and consumer_key=consumer and delivery_status='verified' order by d.attempt desc limit 1;
 if existing is not null and consumer not in ('canonical_baseline','official_report') then deliveries:=deliveries||jsonb_build_array(existing);continue;end if;
 select coalesce(max(d.attempt),0)+1 into attempt from public.atlas_budget_publication_deliveries d where publication_id=p_publication_id and consumer_key=consumer;
 status:='pending';details:=jsonb_build_object('publicationId',pub.publication_id,'revisionId',pub.revision_id,'periods',pub.periods,'reason','Awaiting consumer readback; the canonical publication remains live');
 begin
 if consumer='canonical_baseline' then
 readback:=public.atlas_reforecast_effective_baseline(array[pub.community_id],pub.periods);
 if exists(select 1 from jsonb_array_elements(readback)r where r->>'publicationId' is distinct from pub.publication_id::text) then status:='superseded';
 elsif jsonb_array_length(readback)=cardinality(pub.periods) and not exists(select 1 from jsonb_array_elements(readback)r where r->>'verified' is distinct from 'true' or r->>'contentHash' is distinct from pub.snapshot->>'fingerprint') then status:='verified';details:=details||jsonb_build_object('reason',null,'readback',readback);else status:='failed';end if;
 elsif consumer='official_report' then
 readback:=public.atlas_read_reforecast_publication(pub.publication_id);
 status:=case when readback->>'verified'='true' and readback->>'contentHash'=pub.snapshot->>'fingerprint' then 'verified' else 'failed' end;
 details:=details||jsonb_build_object('reason',readback->>'reason','reportFingerprint',readback->>'reportContentHash');
 end if;
 exception when others then status:='failed';details:=details||jsonb_build_object('reason',SQLERRM,'sqlState',SQLSTATE);end;
 insert into public.atlas_budget_publication_deliveries(publication_id,community_id,consumer_key,request_id,attempt,delivery_status,content_fingerprint,detail,actor_id)
 values(pub.publication_id,pub.community_id,consumer,p_request_id,attempt,status,pub.snapshot->>'fingerprint',details,auth.uid()) returning to_jsonb(atlas_budget_publication_deliveries) into existing;
 deliveries:=deliveries||jsonb_build_array(existing);
 end loop;
 return deliveries;
end;$$;
create function public.atlas_retry_budget_publication(p_publication_id uuid,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select atlas_private.budget_publication_readback(p_publication_id,p_request_id)$$;
revoke all on function atlas_private.budget_publication_readback(uuid,uuid),public.atlas_retry_budget_publication(uuid,uuid) from public,anon;
grant execute on function atlas_private.budget_publication_readback(uuid,uuid),public.atlas_retry_budget_publication(uuid,uuid) to authenticated;

create function atlas_private.save_budget_workflow(p_community_id uuid,p_scenario_id uuid,p_expected_revision integer,p_request_id uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;rec public.atlas_reforecast_revisions;pub public.atlas_reforecast_publications;calendar jsonb;deliveries jsonb;
begin
 if auth.uid() is null or not atlas_private.reforecast_access(p_community_id,'edit') then raise exception 'Budget workflow access denied';end if;
 if p_action in ('approve','lock') then raise exception 'Use explicit VP approval and publication or Investor Approved';end if;
 if p_action in ('vp_approve','approve_lock') then
 if not atlas_private.reforecast_access(p_community_id,'publish') then raise exception 'Only a verified VP-level user may approve and publish';end if;
 if p_request_id is null then raise exception 'Publication request ID required';end if;
 perform pg_advisory_xact_lock(hashtextextended('reforecast-active:'||p_community_id,0));
 select * into pub from public.atlas_reforecast_publications where request_id=p_request_id;
 if pub.publication_id is null then
 if to_regprocedure('atlas_private.budget_calendar(uuid)') is not null then
 execute 'select atlas_private.budget_calendar($1)' into calendar using p_community_id;
 if calendar->>'verified' is distinct from 'true' or p_payload->'calendar'->>'basis' is distinct from calendar->>'basis' or p_payload->'calendar'->>'startMonth' is distinct from calendar->>'startMonth' then raise exception 'Resolve the verified Community Settings fiscal calendar before publication';end if;
 end if;
 result:=atlas_private.save_reforecast_builder(p_community_id,p_scenario_id,p_expected_revision,gen_random_uuid(),'approve',p_payload);
 pub:=public.atlas_publish_reforecast(p_scenario_id,p_expected_revision+1,p_request_id,p_payload->>'reason');
 else
 select * into rec from public.atlas_reforecast_revisions where revision_id=pub.revision_id;
 if pub.published_by<>auth.uid() or pub.community_id<>p_community_id or pub.scenario_id<>p_scenario_id or rec.revision<>p_expected_revision+1 or (rec.payload-'reason') is distinct from (p_payload-'reason') or pub.reason is distinct from p_payload->>'reason' then raise exception 'Approval request ID reused for different changes';end if;
 end if;
 deliveries:=atlas_private.budget_publication_readback(pub.publication_id,p_request_id);
 result:=atlas_private.read_reforecast_save_receipt(p_community_id,p_request_id);
 return result||jsonb_build_object('permissions',atlas_private.budget_permissions(p_community_id),'deliveries',deliveries);
 end if;
 result:=atlas_private.save_reforecast_builder(p_community_id,p_scenario_id,p_expected_revision,p_request_id,p_action,p_payload);
 select * into rec from public.atlas_reforecast_revisions where revision_id=(result->'revision'->>'revision_id')::uuid;
 if rec.status='investor_approved' then select * into pub from public.atlas_reforecast_publications where publication_id::text=rec.payload->>'investorPublicationId';end if;
 return result||jsonb_build_object('permissions',atlas_private.budget_permissions(p_community_id))||case when pub.publication_id is null then '{}'::jsonb else jsonb_build_object('publication',to_jsonb(pub)) end;
end;$$;
create or replace function public.atlas_save_reforecast_scenario(p_community_id uuid,p_scenario_id uuid,p_expected_revision integer,p_request_id uuid,p_action text,p_payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$select atlas_private.save_budget_workflow(p_community_id,p_scenario_id,p_expected_revision,p_request_id,p_action,p_payload)$$;
revoke all on function atlas_private.save_budget_workflow(uuid,uuid,integer,uuid,text,jsonb),public.atlas_save_reforecast_scenario(uuid,uuid,integer,uuid,text,jsonb) from public,anon;
grant execute on function atlas_private.save_budget_workflow(uuid,uuid,integer,uuid,text,jsonb),public.atlas_save_reforecast_scenario(uuid,uuid,integer,uuid,text,jsonb) to authenticated;

create or replace function public.atlas_reopen_reforecast(p_scenario_id uuid,p_expected_revision integer,p_request_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.atlas_reforecast_revisions;existing public.atlas_reforecast_revisions;begin
 select * into existing from public.atlas_reforecast_revisions where request_id=p_request_id;
 if existing.revision_id is not null then
 if existing.scenario_id<>p_scenario_id or existing.actor_id<>auth.uid() or existing.action<>'reopen' or existing.revision<>p_expected_revision+1 or existing.payload->>'reason' is distinct from p_reason then raise exception 'Reopen request ID reused';end if;
 return atlas_private.read_reforecast_save_receipt(existing.community_id,p_request_id);end if;
 select r.* into prior from public.atlas_reforecast_heads h join public.atlas_reforecast_revisions r using(revision_id) where h.scenario_id=p_scenario_id;
 if prior.revision_id is null or not atlas_private.reforecast_access(prior.community_id,'edit') then raise exception 'Authorized community editor required to reopen';end if;
 return atlas_private.save_budget_workflow(prior.community_id,p_scenario_id,p_expected_revision,p_request_id,'reopen',prior.payload||jsonb_build_object('reason',p_reason));
end;$$;

create or replace function public.atlas_read_reforecast_workspace(p_community_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 if auth.uid() is null or p_community_ids is null or cardinality(p_community_ids)>100 then raise exception 'Select up to 100 authorized communities';end if;
 select coalesce(jsonb_agg(jsonb_build_object('head',to_jsonb(h),'revision',to_jsonb(r),'snapshot',r.snapshot,'source',r.source,'permissions',atlas_private.budget_permissions(h.community_id),
 'publication',(select to_jsonb(p) from public.atlas_reforecast_publications p where p.scenario_id=h.scenario_id order by p.version desc limit 1),
 'originator',(select actor_id from public.atlas_reforecast_revisions where scenario_id=h.scenario_id order by revision limit 1),
 'history',(select jsonb_agg(jsonb_build_object('revisionId',v.revision_id,'version',v.revision,'state',v.status,'action',v.action,'actor',v.actor_id,'at',v.created_at,'reason',v.payload->>'reason') order by v.revision) from public.atlas_reforecast_revisions v where v.scenario_id=h.scenario_id)) order by r.created_at desc),'[]') into result
 from public.atlas_reforecast_heads h join public.atlas_reforecast_revisions r using(revision_id)
 where h.community_id=any(p_community_ids) and h.status<>'deleted' and atlas_private.reforecast_access(h.community_id,'read');
 return result;
end;$$;

-- Update the established official snapshot reader in place; retain its allowlist.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.atlas_read_reforecast_publication(uuid)'::regprocedure);
 definition:=replace(definition,$a$rec.status<>'locked'$a$,$b$rec.status not in ('locked','pending_investor_approval','investor_approved')$b$);
 definition:=replace(definition,$a$'status','approved_locked',$a$,$b$'status',coalesce((select v.status from public.atlas_reforecast_revisions v where v.payload->>'investorPublicationId'=pub.publication_id::text and v.status='investor_approved' order by v.revision desc limit 1),'pending_investor_approval'),
 'investorStatus',coalesce((select v.status from public.atlas_reforecast_revisions v where v.payload->>'investorPublicationId'=pub.publication_id::text and v.status='investor_approved' order by v.revision desc limit 1),'pending_investor_approval'),
 'investorApprovedBy',(select v.payload->>'investorApprovedBy' from public.atlas_reforecast_revisions v where v.payload->>'investorPublicationId'=pub.publication_id::text and v.status='investor_approved' order by v.revision desc limit 1),
 'investorApprovedAt',(select v.payload->>'investorApprovedAt' from public.atlas_reforecast_revisions v where v.payload->>'investorPublicationId'=pub.publication_id::text and v.status='investor_approved' order by v.revision desc limit 1),
 'approverRole',pub.published_role,
 'investorApprovalDate',(select v.payload->>'investorApprovalDate' from public.atlas_reforecast_revisions v where v.payload->>'investorPublicationId'=pub.publication_id::text and v.status='investor_approved' order by v.revision desc limit 1),
 'finalRevisionId',(select v.revision_id from public.atlas_reforecast_revisions v where v.payload->>'investorPublicationId'=pub.publication_id::text and v.status='investor_approved' order by v.revision desc limit 1),$b$);
 execute definition;
end;$$;
-- The existing receipt reader remains immutable-request based and collision-safe.
-- Add shared permissions and publication linkage for investor governance receipts.
do $$declare definition text;begin
 definition:=pg_get_functiondef('atlas_private.read_reforecast_save_receipt(uuid,uuid)'::regprocedure);
 definition:=replace(definition,$a$select * into head from public.atlas_reforecast_heads where scenario_id=r.scenario_id;$a$,$b$
 if pub.publication_id is null and r.status='investor_approved' then select * into pub from public.atlas_reforecast_publications where publication_id::text=r.payload->>'investorPublicationId';end if;
 select * into head from public.atlas_reforecast_heads where scenario_id=r.scenario_id;$b$);
 definition:=replace(definition,$a$'currentHead',to_jsonb(head),'revision'$a$,$b$'currentHead',to_jsonb(head),'permissions',atlas_private.budget_permissions(p_community_id),'revision'$b$);
 execute definition;
end;$$;
revoke all on function atlas_private.save_reforecast_builder(uuid,uuid,integer,uuid,text,jsonb) from public,anon,authenticated;
-- Administrative source review does not grant authority to publish finances.
do $$declare signature text;definition text;begin
 foreach signature in array array['atlas_private.save_reforecast_registry_pre_builder(uuid,uuid,uuid,jsonb)','public.atlas_review_reforecast_source(uuid,uuid,jsonb)'] loop
 definition:=pg_get_functiondef(signature::regprocedure);
 definition:=replace(replace(definition,$a$reforecast_access(p_community_id,'approve')$a$,$b$reforecast_access(p_community_id,'review')$b$),$a$reforecast_access(u.community_id,'approve')$a$,$b$reforecast_access(u.community_id,'review')$b$);
 execute definition;end loop;
end;$$;
-- A consumer submits the immutable identity it actually read. The server
-- verifies it against the current canonical head and records every outcome.
create function atlas_private.verify_budget_consumer(p_publication_id uuid,p_consumer_key text,p_request_id uuid,p_observed_revision_id uuid,p_observed_fingerprint text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare pub public.atlas_reforecast_publications;receipt public.atlas_budget_publication_deliveries;attempt integer;status text;report jsonb;
begin
 select * into pub from public.atlas_reforecast_publications where publication_id=p_publication_id;
 if auth.uid() is null or pub.publication_id is null or not atlas_private.reforecast_access(pub.community_id,'active_read') then raise exception 'Consumer publication access denied';end if;
 if p_request_id is null or p_consumer_key not in ('finance_summary','recommendations','dashboard','excel_export','pdf_export') then raise exception 'Unknown publication consumer';end if;
 perform pg_advisory_xact_lock(hashtextextended('budget-delivery:'||p_publication_id,0));
 select * into receipt from public.atlas_budget_publication_deliveries where publication_id=p_publication_id and consumer_key=p_consumer_key and request_id=p_request_id;
 if receipt.delivery_id is not null then
 if receipt.actor_id<>auth.uid() or receipt.detail->>'observedRevisionId' is distinct from p_observed_revision_id::text or receipt.detail->>'observedFingerprint' is distinct from p_observed_fingerprint then raise exception 'Consumer readback request ID reused';end if;return to_jsonb(receipt);end if;
 report:=public.atlas_read_reforecast_publication(pub.publication_id);
 status:=case when exists(select 1 from unnest(pub.periods)p where not exists(select 1 from public.atlas_reforecast_active_heads h where h.community_id=pub.community_id and h.period_key=p and h.publication_id=pub.publication_id)) then 'superseded'
 when p_observed_revision_id=pub.revision_id and (p_observed_fingerprint=pub.snapshot->>'fingerprint' or p_consumer_key in ('excel_export','pdf_export') and report->>'verified'='true' and p_observed_fingerprint=report->>'reportContentHash') then 'verified' else 'failed' end;
 select coalesce(max(d.attempt),0)+1 into attempt from public.atlas_budget_publication_deliveries d where publication_id=p_publication_id and consumer_key=p_consumer_key;
 insert into public.atlas_budget_publication_deliveries(publication_id,community_id,consumer_key,request_id,attempt,delivery_status,content_fingerprint,detail,actor_id)
 values(pub.publication_id,pub.community_id,p_consumer_key,p_request_id,attempt,status,pub.snapshot->>'fingerprint',jsonb_build_object('observedRevisionId',p_observed_revision_id,'observedFingerprint',p_observed_fingerprint,'verificationMode','consumer_identity_readback','reason',case when status='verified' then null else 'Consumer identity does not identify the current exact approved snapshot' end),auth.uid()) returning * into receipt;
 return to_jsonb(receipt);
end;$$;
create function public.atlas_verify_budget_consumer(p_publication_id uuid,p_consumer_key text,p_request_id uuid,p_observed_revision_id uuid,p_observed_fingerprint text)
returns jsonb language sql security invoker set search_path='' as $$select atlas_private.verify_budget_consumer(p_publication_id,p_consumer_key,p_request_id,p_observed_revision_id,p_observed_fingerprint)$$;
revoke all on function atlas_private.verify_budget_consumer(uuid,text,uuid,uuid,text),public.atlas_verify_budget_consumer(uuid,text,uuid,uuid,text) from public,anon;
grant execute on function atlas_private.verify_budget_consumer(uuid,text,uuid,uuid,text),public.atlas_verify_budget_consumer(uuid,text,uuid,uuid,text) to authenticated;

create function atlas_private.budget_contract_issues(cid uuid,config jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare issues jsonb:='[]';over jsonb;evidence jsonb;u public.atlas_reforecast_uploads;r public.atlas_reforecast_source_reviews;terms jsonb;community jsonb;canonical_contract jsonb;location text;assumption jsonb;period text;rate numeric;expected numeric;inside boolean;full_month boolean;conflict record;decision jsonb;
begin
 select to_jsonb(c) into community from public.atlas_communities c where community_id=cid;
 location:=coalesce(nullif(community->>'location',''),nullif(trim(concat_ws(', ',community->>'city',community->>'state')),''),case when lower(coalesce(community->>'market','')) not in ('student housing','student','multifamily','conventional') then nullif(community->>'market','') end);
 for over in select value from jsonb_array_elements(coalesce(config->'overrides','[]')) where value->'source'->>'kind'='contract' loop
 evidence:=over->'source';period:=over->>'period';assumption:=evidence->'assumption';
 select * into u from public.atlas_reforecast_uploads where upload_id::text=evidence->>'contractUploadId' and community_id=cid and payload->>'sourceType'='contract';
 select * into r from public.atlas_reforecast_source_reviews where upload_id=u.upload_id order by review_order desc limit 1;
 terms:=u.payload->'contract';
 if u.upload_id is null or r.payload->>'status' is distinct from 'approved' or u.source_hash is distinct from evidence->>'sourceHash' or r.review_id::text is distinct from evidence->>'reviewId' or terms->>'accountCode' is distinct from over->>'accountCode' or terms->>'contractId' is distinct from evidence->>'contractId' then
 issues:=issues||jsonb_build_array(jsonb_build_object('code','contract_source_mismatch','severity','error','accountCode',over->>'accountCode','period',period,'message','Select the exact approved contract, GL mapping and source revision.'));continue;end if;
 canonical_contract:=null;
 if to_regclass('public.atlas_contracts') is not null then
 execute 'select to_jsonb(c) from public.atlas_contracts c where c.contract_id::text=$1 and c.community_id=$2 and c.deleted_at is null' into canonical_contract using terms->>'contractId',cid;
 end if;
 if canonical_contract is null or canonical_contract->>'status' not in ('active','expired')
 or canonical_contract->'version' is distinct from r.payload->'canonicalContract'->'version'
 or encode(sha256(convert_to(canonical_contract::text,'UTF8')),'hex') is distinct from r.payload->'canonicalContract'->>'contentHash'
 or canonical_contract->>'start_date' is distinct from terms->>'effectiveDate'
 or canonical_contract->>'end_date' is distinct from terms->>'endDate'
 or canonical_contract->'amount' is distinct from terms->'monthlyAmount' then
 issues:=issues||jsonb_build_array(jsonb_build_object('code','contract_canonical_stale','severity','error','accountCode',over->>'accountCode','period',period,'message','The canonical contract status, dates or rate changed. Review the current Contract Manager record and approve new source evidence before publication.'));continue;
 end if;
 if evidence->>'method'='user_entered' then
 if evidence->>'contractBacked' is distinct from 'false' or coalesce(assumption->>'reason','')='' or assumption->>'reviewState' is distinct from 'approved' or jsonb_typeof(assumption->'monthlyAmount') is distinct from 'number' or over->'originalCalculatedValue' is distinct from assumption->'monthlyAmount' then issues:=issues||jsonb_build_array(jsonb_build_object('code','contract_user_rate_review','severity','error','period',period,'message','User-entered rates require their own reviewed assumption and cannot be labeled contract-backed.'));end if;continue;
 end if;
 if coalesce(terms->>'effectiveDate','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or coalesce(terms->>'endDate','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or jsonb_typeof(terms->'monthlyAmount') is distinct from 'number' then issues:=issues||jsonb_build_array(jsonb_build_object('code','contract_dates_required','severity','error','period',period,'message','Retain reviewed effective dates and monthly contract rate.'));continue;end if;
 inside:=period>=left(terms->>'effectiveDate',7) and period<=left(terms->>'endDate',7);
 full_month:=(terms->>'effectiveDate')::date<=(period||'-01')::date and (terms->>'endDate')::date>=((period||'-01')::date+interval '1 month - 1 day')::date;
 rate:=(terms->>'monthlyAmount')::numeric;
 if terms->>'escalationMethod'='contract_clause' and terms->>'escalationRate' is not null then
 if jsonb_typeof(terms->'escalationRate') is distinct from 'number' or coalesce(terms->>'clauseReference','')='' or coalesce(terms->>'escalationMonth','')!~'^[0-9]{4}-[0-9]{2}$' then issues:=issues||jsonb_build_array(jsonb_build_object('code','contract_clause_required','severity','error','period',period,'message','Retain the effective escalation rate and contract clause.'));continue;end if;
 if least(period,left(terms->>'endDate',7))>=terms->>'escalationMonth' then rate:=rate*(1+(terms->>'escalationRate')::numeric);end if;
 end if;rate:=round(rate,2);
 if inside then
 expected:=rate;
 if not full_month or evidence->>'method'<>'contract_clause' or evidence->>'contractBacked'='true' and over->'amount' is distinct from over->'originalCalculatedValue' then issues:=issues||jsonb_build_array(jsonb_build_object('code','contract_coverage_review','severity','error','period',period,'message','Review partial-month proration and label any final user override separately from the contract-backed rate.'));end if;
 else
 if period<left(terms->>'effectiveDate',7) or evidence->>'contractBacked' is distinct from 'false' or evidence->>'method' is distinct from 'out_of_contract_estimate' or location is null or assumption->>'communityId' is distinct from cid::text or assumption->>'location' is distinct from location or assumption->>'confirmed' is distinct from 'true' or coalesce(assumption->>'source','')='' or coalesce(assumption->>'ownerId','')='' or coalesce(assumption->>'effectiveDate','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or period<left(assumption->>'effectiveDate',7) or jsonb_typeof(assumption->'percentage') is distinct from 'number' then
 issues:=issues||jsonb_build_array(jsonb_build_object('code','contract_inflation_review','severity','error','accountCode',over->>'accountCode','period',period,'message','Out of Contract - Estimated requires this community’s verified location, inflation percentage, source, effective date and owner.'));continue;end if;
 expected:=round(rate*(1+(assumption->>'percentage')::numeric/100),2);
 if (assumption->>'percentage')::numeric < -100 or evidence->'priorRate' is distinct from to_jsonb(rate) or evidence->'inflationPercentage' is distinct from assumption->'percentage' then issues:=issues||jsonb_build_array(jsonb_build_object('code','contract_inflation_calculation','severity','error','period',period,'message','Retain the last known contract rate and exact property inflation calculation.'));end if;
 end if;
 if jsonb_typeof(over->'originalCalculatedValue') is distinct from 'number' or (over->>'originalCalculatedValue')::numeric is distinct from expected then issues:=issues||jsonb_build_array(jsonb_build_object('code','contract_rate_mismatch','severity','error','period',period,'message','The retained original recommendation must match the approved rate, dates and inflation assumption; store the final user value separately.'));end if;
 end loop;
 -- Compare every approved uploaded contract, not only sources selected by the client.
 for conflict in with contracts as (
 select distinct on(coalesce(cu.payload->'contract'->>'contractId',cu.upload_id::text))cu.upload_id,cu.payload->'contract' terms
 from public.atlas_reforecast_uploads cu join lateral(select * from public.atlas_reforecast_source_reviews sr where sr.upload_id=cu.upload_id order by sr.review_order desc limit 1)sr on true
 where cu.community_id=cid and cu.payload->>'sourceType'='contract' and sr.payload->>'status'='approved'
 order by coalesce(cu.payload->'contract'->>'contractId',cu.upload_id::text),cu.created_at desc,cu.upload_id)
 select p period,c.terms->>'accountCode' account_code,jsonb_agg(c.upload_id) uploads from contracts c cross join jsonb_array_elements_text(config->'periods')p
 where p>=left(c.terms->>'effectiveDate',7) and p<=left(c.terms->>'endDate',7) group by p,c.terms->>'accountCode' having count(*)>1 loop
 select value into decision from jsonb_array_elements(coalesce(config->'contractSourceDecisions','[]'))d where d->>'period'=conflict.period and d->>'accountCode'=conflict.account_code;
 if decision is null or decision->>'approved' is distinct from 'true' or not(conflict.uploads ? (decision->>'uploadId')) or coalesce(decision->>'reason','')='' or coalesce(decision->>'reviewedBy','')='' or coalesce(decision->>'reviewedAt','')='' then
 issues:=issues||jsonb_build_array(jsonb_build_object('code','contract_source_conflict','severity','error','accountCode',conflict.account_code,'period',conflict.period,'uploadIds',conflict.uploads,'message','Multiple approved active contracts map to this GL and month. Select and approve the controlling source before publication.'));
 end if;
 if decision is not null and exists(select 1 from jsonb_array_elements(coalesce(config->'overrides','[]'))o where o->>'period'=conflict.period and o->>'accountCode'=conflict.account_code and o->'source'->>'kind'='contract' and o->'source'->>'contractUploadId' is distinct from decision->>'uploadId') then issues:=issues||jsonb_build_array(jsonb_build_object('code','contract_precedence_mismatch','severity','error','period',conflict.period,'message','The forecast must use the explicitly approved controlling contract source.'));end if;
 end loop;
 return issues;
end;$$;
revoke all on function atlas_private.budget_contract_issues(uuid,jsonb) from public,anon,authenticated;
create function atlas_private.budget_contract_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare issues jsonb;previous jsonb;decision jsonb;blockers integer;begin
 if new.action in ('withdraw','reject','reopen','investor_approve','delete') then return new;end if;
 select payload into previous from public.atlas_reforecast_revisions where scenario_id=new.scenario_id order by revision desc limit 1;
 for decision in select value from jsonb_array_elements(coalesce(new.payload->'contractSourceDecisions','[]')) loop
 if not(coalesce(previous->'contractSourceDecisions','[]') @> jsonb_build_array(decision)) and (decision->>'reviewedBy' is distinct from auth.uid()::text or not atlas_private.reforecast_access(new.community_id,'review')) then raise exception 'A changed controlling-contract decision must identify the signed-in authorized reviewer';end if;end loop;
 issues:=atlas_private.budget_contract_issues(new.community_id,new.payload);
 new.snapshot:=jsonb_set(new.snapshot,'{diagnostics}',coalesce(new.snapshot->'diagnostics','[]')||issues);
 select count(*) into blockers from jsonb_array_elements(new.snapshot->'diagnostics')d where d->>'severity' in ('error','blocking');
 new.snapshot:=jsonb_set(new.snapshot,'{completeness,blockerCount}',to_jsonb(blockers));new.snapshot:=jsonb_set(new.snapshot,'{status}',to_jsonb(case when blockers>0 then 'action_required'::text else 'ready'::text end));
 if blockers>0 and new.action in ('ready','submit','approve') then raise exception 'Resolve contract, mapping or assumption blockers before publication';end if;
 new.snapshot:=new.snapshot||jsonb_build_object('fingerprint',encode(sha256(convert_to((new.snapshot-'fingerprint')::text,'UTF8')),'hex'));return new;
end;$$;
revoke all on function atlas_private.budget_contract_guard() from public,anon,authenticated;
create trigger zzzz_budget_contract_validation before insert on public.atlas_reforecast_revisions for each row execute function atlas_private.budget_contract_guard();

-- Initial budgets start with reviewed workbook evidence, not a fabricated prior approval.
alter function atlas_private.reforecast_source_for_config(uuid,jsonb) rename to reforecast_source_before_initial_budget;
create function atlas_private.reforecast_source_for_config(cid uuid,config jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare source jsonb;u public.atlas_reforecast_uploads;lines jsonb;periods text[];registry_id uuid;
begin
 if config->>'baselineType' is distinct from 'initial_workbook' then return atlas_private.reforecast_source_before_initial_budget(cid,config);end if;
 if coalesce(config->>'recordType','') not in ('initial_budget','revised_budget') then raise exception 'Initial workbook source is available only to an explicit budget draft';end if;
 select * into u from public.atlas_reforecast_uploads where upload_id::text=config->>'uploadId' and community_id=cid;
 if u.upload_id is null or config->'importMapping'->'propertyAssignment'->>'communityId' is distinct from cid::text then raise exception 'An initial budget requires its reviewed workbook and community mapping';end if;
 select array_agg(p order by p) into periods from jsonb_array_elements_text(config->'periods')p;registry_id:=nullif(config->>'registryVersionId','')::uuid;
 source:=atlas_private.reforecast_source_with_registry(cid,periods,'{}'::uuid[],registry_id);
 select coalesce(jsonb_agg(jsonb_build_object('period',l->>'period','accountCode',m->>'accountCode','accountName',l->>'accountName','amount',case when jsonb_typeof(l->'amount')='number' then to_jsonb((l->>'amount')::numeric*(m->>'signMultiplier')::numeric) else 'null'::jsonb end,
 'legitimateBlank',l->'amount'='null'::jsonb or l->'amount' is null,'source',jsonb_build_object('kind','initial_workbook','uploadId',u.upload_id,'sourceHash',u.source_hash,'sourceFile',u.payload->'source'->>'fileName','sourceLineId',l->>'id')) order by l->>'period',m->>'accountCode'),'[]') into lines
 from jsonb_array_elements(u.payload->'lines')l join lateral(select value m from jsonb_array_elements(config->'importMapping'->'accountMappings')map where map->>'sourceAccountCode'=l->>'accountCode' and (map->>'sheet' is null or map->>'sheet'=l->>'sheet') and (map->>'department' is null or map->>'department'=l->>'department'))map on true
 where config->'periods' ? (l->>'period') and l->>'scenario'=config->'importMapping'->>'sourceScenario' and l->>'sourceKind' is distinct from 'workbook_actual_evidence'
 and (config->'importMapping'->'selectedLineIds' ? (l->>'id') or (l->'amount'='null'::jsonb or l->'amount' is null));
 if exists(select 1 from jsonb_array_elements(lines)l group by l->>'period',l->>'accountCode' having count(*)>1) then raise exception 'Resolve duplicate initial budget GL and month source mappings';end if;
 source:=jsonb_set(source,'{baseline}',jsonb_build_object('sourceType','initial_workbook','versionIds','[]'::jsonb,'originalBudgetLines','[]'::jsonb,'lines',lines,'periodVersions','[]'::jsonb,'workbookUploadId',u.upload_id));
 source:=source||jsonb_build_object('lockedPeriods','[]'::jsonb,'inheritedLines','[]'::jsonb,'sourceReceipts','[]'::jsonb,'recommendationHistory','[]'::jsonb);
 return (source-'sourceVersion')||jsonb_build_object('sourceVersion',encode(sha256(convert_to((source-'sourceVersion')::text,'UTF8')),'hex'));
end;$$;
revoke all on function atlas_private.reforecast_source_before_initial_budget(uuid,jsonb),atlas_private.reforecast_source_for_config(uuid,jsonb) from public,anon,authenticated;
do $$declare definition text;begin
 definition:=pg_get_functiondef('atlas_private.create_reforecast_from_import(uuid,uuid,integer,uuid,uuid,jsonb,jsonb)'::regprocedure);
 definition:=replace(definition,$a$if coalesce(p_payload->>'baselineType','original_budget') not in ('original_budget','approved_reforecast') or jsonb_array_length(coalesce(p_payload->'baselineVersionIds','[]'))=0 then$a$,
 $b$if not(p_payload->>'recordType'='initial_budget' and p_payload->>'baselineType'='initial_workbook') and (coalesce(p_payload->>'baselineType','original_budget') not in ('original_budget','approved_reforecast') or jsonb_array_length(coalesce(p_payload->'baselineVersionIds','[]'))=0) then$b$);
 execute definition;
 definition:=pg_get_functiondef('atlas_private.calculate_reforecast(jsonb,jsonb)'::regprocedure);
 definition:=replace(definition,$a$if jsonb_array_length(source->'baseline'->'versionIds')=0 then$a$,$b$if jsonb_array_length(source->'baseline'->'versionIds')=0 and source->'baseline'->>'sourceType' is distinct from 'initial_workbook' then$b$);
 definition:=replace(definition,$a$'selectedBaseline',base,'baselineDisposition'$a$,$b$'selectedBaseline',base,'legitimateBlank',coalesce((b->>'legitimateBlank')::boolean,false),'baselineDisposition'$b$);
 definition:=replace(definition,$a$line->>'sourceKind'='forecast' and line->>'forecast' is null then$a$,$b$line->>'sourceKind'='forecast' and line->>'forecast' is null and line->>'legitimateBlank' is distinct from 'true' then$b$);
 execute definition;
 definition:=pg_get_functiondef('atlas_private.reforecast_metric(jsonb,text)'::regprocedure);
 definition:=replace(definition,$a$count(*) filter(where v->>field is null)$a$,$b$count(*) filter(where v->>field is null and (v->>'legitimateBlank' is distinct from 'true' or field='originalBudget'))$b$);execute definition;
 definition:=pg_get_functiondef('public.atlas_reforecast_effective_baseline(uuid[],text[])'::regprocedure);
 definition:=replace(definition,$a$jsonb_typeof(v->'amount') is distinct from 'number' or v->>'mappingValid'$a$,$b$(jsonb_typeof(v->'amount') is distinct from 'number' and v->>'legitimateBlank' is distinct from 'true') or v->>'mappingValid'$b$);execute definition;
end;$$;
create function atlas_private.publish_initial_budget(pub public.atlas_reforecast_publications) returns void language plpgsql security definer set search_path='' as $$
declare rec public.atlas_reforecast_revisions;u public.atlas_reforecast_uploads;segment integer;months integer[];rows jsonb;payload jsonb;metric_mappings jsonb;fiscal_start integer;fiscal_year integer;first_period text;
begin
 select * into rec from public.atlas_reforecast_revisions where revision_id=pub.revision_id;
 if rec.payload->>'recordType' is distinct from 'initial_budget' then return;end if;
 if exists(select 1 from public.atlas_reforecast_publications p where p.scenario_id=pub.scenario_id and p.version<pub.version) then return;end if;
 if not atlas_private.is_budget_vp(auth.uid()) or rec.payload->>'baselineType' is distinct from 'initial_workbook' then raise exception 'Initial budget publication requires explicit VP authority and reviewed workbook lineage';end if;
 select * into u from public.atlas_reforecast_uploads where upload_id::text=rec.payload->>'uploadId' and community_id=pub.community_id;
 if u.upload_id is null then raise exception 'Retain the initial budget source workbook';end if;
 select min(p) into first_period from unnest(pub.periods)p;fiscal_start:=(rec.payload->'calendar'->>'startMonth')::integer;fiscal_year:=left(first_period,4)::integer+case when fiscal_start>1 then 1 else 0 end;
 for segment in select distinct left(p,4)::integer from unnest(pub.periods)p loop
 select array_agg(right(p,2)::integer-1 order by p) into months from unnest(pub.periods)p where left(p,4)::integer=segment;
 if exists(select 1 from public.atlas_approved_budget_versions b where b.community_id=pub.community_id and b.calendar_year=segment and b.payload->>'originPublicationId'=pub.publication_id::text) then continue;end if;
 if exists(select 1 from public.atlas_approved_budget_versions b where b.community_id=pub.community_id and b.calendar_year=segment and b.covered_months && months) then raise exception 'An original budget already covers these months. Create a Revised Budget against the approved baseline';end if;
 select jsonb_agg(jsonb_build_object('glCode',code,'accountName',sample->>'accountName','nature',sample->>'nature','placement',sample->>'placement','category',sample->>'category',
 'monthly',(select jsonb_agg((select l->'forecast' from jsonb_array_elements(pub.snapshot->'lines')l where l->>'accountCode'=code and l->>'period'=segment::text||'-'||lpad((m+1)::text,2,'0')) order by m) from generate_series(0,11)m),
 'source',jsonb_build_object('publicationId',pub.publication_id,'revisionId',pub.revision_id,'sourceUploadId',u.upload_id,'sourceHash',u.source_hash)) order by code) into rows
 from (select distinct on(l->>'accountCode')l->>'accountCode' code,l sample from jsonb_array_elements(pub.snapshot->'lines')l where left(l->>'period',4)::integer=segment order by l->>'accountCode')q;
 select jsonb_object_agg(metric,entries) into metric_mappings from (select metric,(select coalesce(jsonb_agg(jsonb_build_object('glCode',r->>'glCode','factor',1)),'[]') from jsonb_array_elements(rows)r where case metric when 'revenue' then r->>'nature' in ('income','contra_income') and r->>'placement'='above_noi' when 'expenses' then r->>'nature'='expense' and r->>'placement'='above_noi' when 'capital' then r->>'nature'='capital' when 'debt' then r->>'nature'='debt' when 'gpr' then r->>'glCode'='5120' end) entries from unnest(array['revenue','expenses','capital','debt','gpr'])metric)q;
 payload:=jsonb_build_object('rows',rows,'metricMappings',metric_mappings,'occupancyPct',(select jsonb_agg(null::numeric) from generate_series(0,11)),'originPublicationId',pub.publication_id,'originRevisionId',pub.revision_id,'workbookUploadId',u.upload_id,'calendar',rec.payload->'calendar','investorStatus','pending_investor_approval','snapshotFingerprint',pub.snapshot->>'fingerprint');
 insert into public.atlas_approved_budget_versions(community_id,calendar_year,fiscal_year,fiscal_start_month,scenario_id,scenario_version,effective_date,source_file,source_hash,content_hash,approved_by,covered_months,payload)
 values(pub.community_id,segment,fiscal_year,fiscal_start,pub.scenario_id::text,pub.version::text,current_date,u.payload->'source'->>'fileName',u.source_hash,encode(sha256(convert_to(payload::text,'UTF8')),'hex'),auth.uid(),months,payload);
 end loop;
end;$$;
revoke all on function atlas_private.publish_initial_budget(public.atlas_reforecast_publications) from public,anon,authenticated;
do $$declare definition text;begin
 definition:=pg_get_functiondef('atlas_private.save_budget_workflow(uuid,uuid,integer,uuid,text,jsonb)'::regprocedure);
 definition:=replace(definition,$a$deliveries:=atlas_private.budget_publication_readback(pub.publication_id,p_request_id);$a$,$b$perform atlas_private.publish_initial_budget(pub);deliveries:=atlas_private.budget_publication_readback(pub.publication_id,p_request_id);$b$);
 execute definition;
end;$$;

-- Include only report-safe recommendation fields; original attachments and internal
-- source coordinates stay in the authorized evidence ledger.
do $$declare definition text;anchor text;begin
 definition:=pg_get_functiondef('public.atlas_read_reforecast_publication(uuid)'::regprocedure);
 anchor:=$a$atlas_private.reforecast_report_fields(v,array['period','accountCode','originalValue','originalCalculatedValue','amount','overrideValue','reason','actor','actorId','timestamp','createdAt'])$a$;
 if position(anchor in definition)=0 then
 anchor:=$a$atlas_private.reforecast_report_fields(v,array['period','accountCode','originalValue','amount','overrideValue','reason','actor','actorId','timestamp','createdAt'])$a$;
 end if;
 if position(anchor in definition)>0 then
 definition:=replace(definition,anchor,$b$atlas_private.reforecast_report_fields(v,array['period','accountCode','originalValue','originalCalculatedValue','amount','overrideValue','reason','actor','actorId','ownerId','timestamp','createdAt','reviewedAt'])||jsonb_build_object('source',atlas_private.reforecast_report_fields(v->'source',array['kind','coverage','recommendationCoverage','contractBacked','priorRate','inflationPercentage','calculation'])||jsonb_build_object('assumption',atlas_private.reforecast_report_fields(v->'source'->'assumption',array['source','effectiveDate','percentage','location','ownerId'])))$b$);
 execute definition;
 end if;
end;$$;


-- The former direct original-budget endpoint cannot bypass the shared VP workflow.
do $migration$begin
 if to_regprocedure('public.atlas_approve_original_budget(uuid,jsonb)') is not null then
 execute $definition$create or replace function public.atlas_approve_original_budget(p_community_id uuid,p_payload jsonb)
 returns public.atlas_approved_budget_versions language plpgsql security invoker set search_path='' as $body$
 begin raise exception 'Create or update a Working Draft, submit it, and use explicit VP publication approval for initial budgets';end;$body$;$definition$;
 end if;
end;$migration$;

commit;
