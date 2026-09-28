-- Separate operating reforecasts. Original budgets and closed actuals are never edited.
begin;
create or replace function atlas_private.reforecast_access(cid uuid, action text default 'read')
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.atlas_user_profiles p join public.atlas_communities c on c.community_id=cid
 where p.user_id=auth.uid() and p.status='active' and c.deleted_at is null and public.atlas_can_access_community(cid)
 and ((action='active_read' and (atlas_private.command_access(cid) or (not ('8'=any(coalesce(p.locked_tab_ids,'{}'))) and not ('reporting'=any(coalesce(p.locked_page_keys,'{}'))))))
 or (not ('12'=any(coalesce(p.locked_tab_ids,'{}'))) and not ('budget'=any(coalesce(p.locked_page_keys,'{}')))
 and (action in ('read','active_read') or action='edit' and p.role in ('admin','executive','regional','finance','community_manager')
 or action='approve' and p.role in ('admin','executive','regional') or action='publish' and p.role='admin'))));
$$;
revoke all on function atlas_private.reforecast_access(uuid,text) from public,anon;
grant execute on function atlas_private.reforecast_access(uuid,text) to authenticated;
create table public.atlas_reforecast_uploads(
 upload_id uuid primary key default gen_random_uuid(),community_id uuid not null references public.atlas_communities(community_id),request_id uuid not null unique,
 source_hash text not null,content_hash text not null,payload jsonb not null,created_by uuid not null references auth.users(id),created_role text not null,created_at timestamptz not null default now(),unique(upload_id,community_id)
);
create table public.atlas_reforecast_registries(
 version_id uuid primary key default gen_random_uuid(),community_id uuid not null references public.atlas_communities(community_id),previous_version_id uuid references public.atlas_reforecast_registries(version_id),request_id uuid not null unique,
 effective_date date not null,payload jsonb not null,content_hash text not null,created_by uuid not null references auth.users(id),created_role text not null,created_at timestamptz not null default now(),unique(version_id,community_id)
);
create table public.atlas_reforecast_registry_heads(community_id uuid primary key references public.atlas_communities(community_id),version_id uuid not null,
 foreign key(version_id,community_id) references public.atlas_reforecast_registries(version_id,community_id));
create table public.atlas_reforecast_revisions(
 revision_id uuid primary key default gen_random_uuid(),scenario_id uuid not null,community_id uuid not null references public.atlas_communities(community_id),revision integer not null check(revision>0),
 status text not null check(status in ('uploaded','mapping_required','reconciled','working_draft','ready_for_review','submitted','approved','locked')),
 action text not null,request_id uuid not null unique,request_hash text not null,payload jsonb not null,source jsonb not null,snapshot jsonb not null,
 actor_id uuid not null references auth.users(id),actor_role text not null,created_at timestamptz not null default now(),unique(scenario_id,revision),unique(revision_id,community_id,scenario_id)
);
create table public.atlas_reforecast_heads(
 scenario_id uuid primary key,community_id uuid not null references public.atlas_communities(community_id),revision integer not null,revision_id uuid not null,status text not null,
 foreign key(revision_id,community_id,scenario_id) references public.atlas_reforecast_revisions(revision_id,community_id,scenario_id)
);
create table public.atlas_reforecast_publications(
 publication_id uuid primary key default gen_random_uuid(),community_id uuid not null references public.atlas_communities(community_id),scenario_id uuid not null,revision_id uuid not null,
 version integer not null,request_id uuid not null unique,request_hash text not null,periods text[] not null,snapshot jsonb not null,source jsonb not null,reason text not null,
 published_by uuid not null references auth.users(id),published_role text not null,published_at timestamptz not null default now(),unique(revision_id),unique(publication_id,community_id),
 foreign key(revision_id,community_id,scenario_id) references public.atlas_reforecast_revisions(revision_id,community_id,scenario_id)
);
create table public.atlas_reforecast_active_heads(
 community_id uuid not null references public.atlas_communities(community_id),period_key text not null check(period_key~'^20[0-9]{2}-(0[1-9]|1[0-2])$'),publication_id uuid not null,
 primary key(community_id,period_key),foreign key(publication_id,community_id) references public.atlas_reforecast_publications(publication_id,community_id)
);
create index reforecast_revision_scope on public.atlas_reforecast_revisions(community_id,scenario_id,revision desc);
create index reforecast_publication_scope on public.atlas_reforecast_publications(community_id,published_at desc);
do $$ declare t text;begin foreach t in array array['atlas_reforecast_uploads','atlas_reforecast_registries','atlas_reforecast_registry_heads','atlas_reforecast_revisions','atlas_reforecast_heads','atlas_reforecast_publications','atlas_reforecast_active_heads'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy reforecast_read on public.%I for select to authenticated using(atlas_private.reforecast_access(community_id))',t);
 end loop;
 foreach t in array array['atlas_reforecast_uploads','atlas_reforecast_registries','atlas_reforecast_revisions','atlas_reforecast_publications'] loop
 execute format('create trigger reforecast_immutable before update or delete on public.%I for each row execute function atlas_private.finance_immutable()',t);
 end loop;end;$$;

create or replace function public.atlas_save_reforecast_upload(p_community_id uuid,p_request_id uuid,p_payload jsonb)
returns public.atlas_reforecast_uploads language plpgsql security definer set search_path='' as $$
declare r public.atlas_reforecast_uploads;hash text;binary_hash text;role_name text;
begin
 if not atlas_private.reforecast_access(p_community_id,'edit') then raise exception 'Reforecast upload access denied';end if;
 if p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>33554432 or p_payload->'propertyAssignment'->>'communityId' is distinct from p_community_id::text or p_payload->'propertyAssignment'->>'confirmed' is distinct from 'true' then raise exception 'Select and explicitly confirm an authorized community before saving this workbook';end if;
 if p_payload->'source'->'originalFile'->>'encoding' is distinct from 'base64' or coalesce(p_payload->'source'->'originalFile'->>'data','')='' or coalesce(p_payload->'source'->>'fileName','')='' or coalesce(p_payload->'source'->>'sha256','')!~'^[0-9a-f]{64}$' then raise exception 'Immutable workbook bytes, file name and SHA-256 are required';end if;
 binary_hash:=encode(sha256(decode(p_payload->'source'->'originalFile'->>'data','base64')),'hex');
 if binary_hash<>p_payload->'source'->>'sha256' then raise exception 'Workbook source hash does not match retained bytes';end if;
 hash:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('reforecast-upload:'||p_request_id,0));
 select * into r from public.atlas_reforecast_uploads where request_id=p_request_id;
 if r.upload_id is not null then if r.community_id<>p_community_id or r.created_by<>auth.uid() or r.content_hash<>hash then raise exception 'Upload request ID reused for different evidence';end if;return r;end if;
 select role into role_name from public.atlas_user_profiles where user_id=auth.uid();
 insert into public.atlas_reforecast_uploads(community_id,request_id,source_hash,content_hash,payload,created_by,created_role) values(p_community_id,p_request_id,binary_hash,hash,p_payload,auth.uid(),role_name) returning * into r;return r;
end;$$;

create or replace function public.atlas_save_reforecast_scenario(p_community_id uuid,p_scenario_id uuid,p_expected_revision integer,p_request_id uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.atlas_reforecast_revisions;rec public.atlas_reforecast_revisions;head public.atlas_reforecast_heads;source jsonb;snapshot jsonb;config jsonb;periods text[];budget_ids uuid[];role_name text;hash text;next_status text;person uuid;owner_id uuid;reviewer_id uuid;submitted public.atlas_reforecast_revisions;
begin
 if not atlas_private.reforecast_access(p_community_id,'edit') then raise exception 'Reforecast edit access denied';end if;
 if p_scenario_id is null or p_request_id is null or p_expected_revision is null or p_expected_revision<0 or p_action not in ('create','save_draft','reconcile','ready','submit','approve','lock') or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>2097152 then raise exception 'Invalid reforecast save request';end if;
 hash:=encode(sha256(convert_to(jsonb_build_array(p_community_id,p_scenario_id,p_action,p_payload)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('reforecast-scenario:'||p_scenario_id,0));
 select * into rec from public.atlas_reforecast_revisions where request_id=p_request_id;
 if rec.revision_id is not null then
  if rec.community_id<>p_community_id or rec.actor_id<>auth.uid() or rec.request_hash<>hash then raise exception 'Reforecast save request ID reused for different changes';end if;
  select * into head from public.atlas_reforecast_heads where scenario_id=p_scenario_id;return jsonb_build_object('head',to_jsonb(head),'revision',to_jsonb(rec),'source',rec.source,'snapshot',rec.snapshot);
 end if;
 select r.* into prior from public.atlas_reforecast_heads h join public.atlas_reforecast_revisions r using(revision_id) where h.scenario_id=p_scenario_id;
 if prior.revision_id is not null and prior.community_id<>p_community_id then raise exception 'Scenario community is immutable';end if;
 if coalesce(prior.revision,0)<>p_expected_revision then raise exception 'Reforecast changed in another session. Keep your edits and reload before retrying';end if;
 if prior.status='locked' then raise exception 'Locked reforecasts are immutable; create a new working scenario';end if;
 select role into role_name from public.atlas_user_profiles where user_id=auth.uid();
 if p_action in ('create','save_draft','reconcile') then
  if prior.status='approved' then raise exception 'Approved reforecasts require a new working scenario';end if;
  config:=p_payload;
 else
  if prior.revision_id is null then raise exception 'Save a working draft before a workflow transition';end if;
  if (p_payload-'reason') is distinct from (prior.payload-'reason') then raise exception 'Save changed inputs as a working draft before changing review status';end if;
  config:=prior.payload||jsonb_build_object('reason',p_payload->>'reason');
 end if;
 if coalesce(config->>'name','')='' or length(config->>'name')>200 or coalesce(config->>'model','') not in ('conventional','student','lease_up','short_term','owner_specific') or jsonb_typeof(config->'periods') is distinct from 'array' or length(trim(coalesce(config->>'reason','')))<3 then raise exception 'Scenario name, model, reporting periods and adjustment reason are required';end if;
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
 source:=atlas_private.reforecast_source(p_community_id,periods,budget_ids,nullif(config->>'registryVersionId','')::uuid);
 snapshot:=atlas_private.calculate_reforecast(source,config);
 if config->>'uploadId' is not null or jsonb_array_length(coalesce(config->'importHistory','[]'))>0 or exists(select 1 from jsonb_array_elements(coalesce(config->'overrides','[]'))v where v->>'sourceLineId' is not null) then snapshot:=jsonb_set(snapshot,'{diagnostics}',snapshot->'diagnostics'||atlas_private.reforecast_import_issues(source,config));end if;
 if owner_id is null or reviewer_id is null then snapshot:=jsonb_set(snapshot,'{diagnostics}',snapshot->'diagnostics'||jsonb_build_array(jsonb_build_object('code','ownership_required','severity','error','message','Assign an active owner and authorized reviewer.')));end if;
 snapshot:=jsonb_set(snapshot,'{completeness,blockerCount}',to_jsonb((select count(*) from jsonb_array_elements(snapshot->'diagnostics')d where d->>'severity'='error')));
 snapshot:=jsonb_set(snapshot,'{status}',to_jsonb(case when (snapshot->'completeness'->>'blockerCount')::integer>0 then 'action_required'::text else 'ready'::text end));
 rec.revision_id:=gen_random_uuid();
 snapshot:=snapshot||jsonb_build_object('identity',(snapshot->'identity')||jsonb_build_object('scenarioId',p_scenario_id,'scenarioVersion',p_expected_revision+1,'reforecastVersion',rec.revision_id));
 snapshot:=snapshot||jsonb_build_object('fingerprint',encode(sha256(convert_to((snapshot-'fingerprint')::text,'UTF8')),'hex'));
 if p_action in ('ready','submit','approve','lock') then
  if (snapshot->'completeness'->>'blockerCount')::integer>0 then raise exception 'Resolve mapping, missing values and ownership blockers before review or approval';end if;
  if prior.source->>'sourceVersion' is distinct from source->>'sourceVersion' then raise exception 'Canonical actuals, budget or registry evidence changed. Save and reconcile the working draft before review';end if;
 end if;
 case p_action
 when 'create' then next_status:='uploaded';
 when 'save_draft' then next_status:=case when source->'registry'->>'version' is null then 'mapping_required' else 'working_draft' end;
 when 'reconcile' then next_status:=case when (snapshot->'completeness'->>'blockerCount')::integer=0 then 'reconciled' when exists(select 1 from jsonb_array_elements(snapshot->'diagnostics')d where d->>'code' in ('unmapped_account','mapping_required','driver_mapping_required')) then 'mapping_required' else 'working_draft' end;
 when 'ready' then if prior.status not in ('working_draft','reconciled') then raise exception 'Reconcile a working draft before marking ready';end if;next_status:='ready_for_review';
 when 'submit' then if prior.status<>'ready_for_review' then raise exception 'Mark the reforecast ready before submission';end if;next_status:='submitted';
 when 'approve' then
  if prior.status<>'submitted' or not atlas_private.reforecast_access(p_community_id,'approve') then raise exception 'Only an authorized Admin, executive or Regional can approve a submitted reforecast';end if;
  select * into submitted from public.atlas_reforecast_revisions where scenario_id=p_scenario_id and action='submit' order by revision desc limit 1;
  if (owner_id=auth.uid() or submitted.actor_id=auth.uid()) and submitted.actor_role not in ('admin','executive') then raise exception 'Regional preparation requires a separate approver; Admin or executive submissions may self-approve';end if;
  next_status:='approved';
 when 'lock' then if prior.status<>'approved' or not atlas_private.reforecast_access(p_community_id,'approve') then raise exception 'Approve the reforecast before an authorized lock';end if;next_status:='locked';
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
 if rec.revision_id is null or not atlas_private.reforecast_access(rec.community_id,'publish') then raise exception 'Only an authorized Admin may publish an active reforecast';end if;
 if p_request_id is null or length(trim(coalesce(p_reason,'')))<3 then raise exception 'Publication request and reason required';end if;
 hash:=encode(sha256(convert_to(jsonb_build_array(p_scenario_id,p_expected_revision,p_reason)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('reforecast-active:'||rec.community_id,0));
 select * into pub from public.atlas_reforecast_publications where request_id=p_request_id;
 if pub.publication_id is not null then if pub.request_hash<>hash or pub.published_by<>auth.uid() then raise exception 'Publication request ID reused';end if;return pub;end if;
 if rec.status<>'locked' or rec.revision<>p_expected_revision then raise exception 'Only the expected locked reforecast revision may be published';end if;
 select * into pub from public.atlas_reforecast_publications where revision_id=rec.revision_id;
 if pub.publication_id is not null then
  if exists(select 1 from unnest(pub.periods)p where not exists(select 1 from public.atlas_reforecast_active_heads h where h.community_id=pub.community_id and h.period_key=p and h.publication_id=pub.publication_id)) then raise exception 'This publication was superseded; create and approve a new revision rather than reactivating history';end if;return pub;
 end if;
 select array_agg(v order by v) into periods from jsonb_array_elements_text(rec.payload->'periods')v;
 select array_agg(v::uuid) into budget_ids from jsonb_array_elements_text(coalesce(rec.payload->'baselineVersionIds','[]'))v;
 source:=atlas_private.reforecast_source(rec.community_id,periods,budget_ids,nullif(rec.payload->>'registryVersionId','')::uuid);
 if source->>'sourceVersion' is distinct from rec.source->>'sourceVersion' then raise exception 'Closed actual evidence changed after locking. Preserve this locked version and create a revised working scenario';end if;
 if (rec.snapshot->'completeness'->>'blockerCount')::integer<>0 then raise exception 'Locked snapshot has unresolved blockers';end if;
 select coalesce(max(version),0)+1 into next_version from public.atlas_reforecast_publications where community_id=rec.community_id;
 insert into public.atlas_reforecast_publications(community_id,scenario_id,revision_id,version,request_id,request_hash,periods,snapshot,source,reason,published_by,published_role)
 values(rec.community_id,p_scenario_id,rec.revision_id,next_version,p_request_id,hash,periods,rec.snapshot,rec.source,p_reason,auth.uid(),'admin') returning * into pub;
 insert into public.atlas_reforecast_active_heads select rec.community_id,p,pub.publication_id from unnest(periods)p
 on conflict(community_id,period_key) do update set publication_id=excluded.publication_id;
 return pub;
end;$$;

create or replace function public.atlas_read_reforecast_workspace(p_community_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb:='[]';r record;source jsonb;periods text[];budgets uuid[];
begin
 if cardinality(p_community_ids)>100 then raise exception 'Read at most 100 communities at a time';end if;
 for r in select h as head,v as revision from public.atlas_reforecast_heads h join public.atlas_reforecast_revisions v using(revision_id) where h.community_id=any(p_community_ids) and atlas_private.reforecast_access(h.community_id) order by v.created_at desc loop
  select array_agg(v) into periods from jsonb_array_elements_text((r.revision).payload->'periods')v;select array_agg(v::uuid) into budgets from jsonb_array_elements_text(coalesce((r.revision).payload->'baselineVersionIds','[]'))v;
  source:=atlas_private.reforecast_source((r.revision).community_id,periods,budgets,nullif((r.revision).payload->>'registryVersionId','')::uuid);
  result:=result||jsonb_build_array(jsonb_build_object('head',to_jsonb(r.head),'revision',to_jsonb(r.revision),'source',source,'snapshot',(r.revision).snapshot));
 end loop;return result;
end;$$;
create or replace function public.atlas_read_active_reforecast(p_community_ids uuid[],p_periods text[] default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb:='[]';pub public.atlas_reforecast_publications;config jsonb;budgets uuid[];source jsonb;
begin
 if cardinality(p_community_ids)>100 then raise exception 'Read at most 100 communities at a time';end if;
 for pub in select distinct v.* from public.atlas_reforecast_active_heads h join public.atlas_reforecast_publications v using(publication_id) where h.community_id=any(p_community_ids) and (p_periods is null or h.period_key=any(p_periods)) and atlas_private.reforecast_access(h.community_id,'active_read') loop
  select payload into config from public.atlas_reforecast_revisions where revision_id=pub.revision_id;select array_agg(v::uuid) into budgets from jsonb_array_elements_text(coalesce(config->'baselineVersionIds','[]'))v;
  source:=atlas_private.reforecast_source(pub.community_id,pub.periods,budgets,nullif(config->>'registryVersionId','')::uuid);
  result:=result||jsonb_build_array(jsonb_build_object('publicationId',pub.publication_id,'communityId',pub.community_id,'scenarioId',pub.scenario_id,'revisionId',pub.revision_id,'version',pub.version,'periods',pub.periods,'activePeriods',(select jsonb_agg(period_key order by period_key) from public.atlas_reforecast_active_heads where community_id=pub.community_id and publication_id=pub.publication_id),'publishedAt',pub.published_at,'publishedBy',pub.published_by,'snapshot',pub.snapshot,'source',source));
 end loop;return result;
end;$$;



create or replace function public.atlas_save_reforecast_registry(p_community_id uuid,p_expected_version_id uuid,p_request_id uuid,p_payload jsonb)
returns public.atlas_reforecast_registries language plpgsql security definer set search_path='' as $$
declare r public.atlas_reforecast_registries;prior public.atlas_reforecast_registries;hash text;account jsonb;old_account jsonb;codes text[]:='{}';role_name text;
begin
 if not atlas_private.reforecast_access(p_community_id,'approve') then raise exception 'Only an authorized Admin, executive or Regional may govern GL mappings';end if;
 if p_request_id is null or jsonb_typeof(p_payload->'accounts') is distinct from 'array' or jsonb_array_length(p_payload->'accounts')>3000 or jsonb_typeof(p_payload->'driverMappings') is distinct from 'object' or length(trim(coalesce(p_payload->>'reason','')))<3 or coalesce(p_payload->>'effectiveDate','')!~'^20[0-9]{2}-(0[1-9]|1[0-2])-[0-9]{2}$' then raise exception 'Mapping accounts, reason and effective date are required';end if;
 hash:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');perform pg_advisory_xact_lock(hashtextextended('reforecast-registry:'||p_community_id,0));
 select * into r from public.atlas_reforecast_registries where request_id=p_request_id;
 if r.version_id is not null then if r.community_id<>p_community_id or r.created_by<>auth.uid() or r.content_hash<>hash then raise exception 'Mapping request ID reused';end if;return r;end if;
 select v.* into prior from public.atlas_reforecast_registry_heads h join public.atlas_reforecast_registries v using(version_id) where h.community_id=p_community_id;
 if prior.version_id is distinct from p_expected_version_id then raise exception 'GL registry changed in another session; reload before saving';end if;
 for account in select value from jsonb_array_elements(p_payload->'accounts') loop
  if coalesce(account->>'accountCode','')='' or length(account->>'accountCode')>80 or account->>'accountCode'=any(codes) or coalesce(account->>'category','')='' or coalesce(account->>'nature','') not in ('income','contra_income','expense','capital','debt','below_noi') or coalesce(account->>'placement','') not in ('above_noi','below_noi') or coalesce(account->>'effectiveFrom','')!~'^20[0-9]{2}-(0[1-9]|1[0-2])$' then raise exception 'Every unique GL needs a category, nature, statement placement and effective month';end if;
  if account->>'nature' in ('capital','debt','below_noi') and account->>'placement'<>'below_noi' then raise exception 'Capital, debt and below-NOI GLs must remain below the line';end if;
  if account->>'retiredAfter' is not null and (account->>'retiredAfter'!~'^20[0-9]{2}-(0[1-9]|1[0-2])$' or account->>'retiredAfter'<account->>'effectiveFrom') then raise exception 'Invalid prospective GL retirement';end if;
  select value into old_account from jsonb_array_elements(coalesce(prior.payload->'accounts','[]')) where value->>'accountCode'=account->>'accountCode';
  if account->>'retiredAfter' is distinct from old_account->>'retiredAfter' and account->>'retiredAfter'<to_char(current_date,'YYYY-MM') then raise exception 'GL retirement must be prospective';end if;
  codes:=array_append(codes,account->>'accountCode');
 end loop;
 if exists(select 1 from jsonb_array_elements(coalesce(prior.payload->'accounts','[]')) a where not(a->>'accountCode'=any(codes))) then raise exception 'Do not delete historical GLs; retain them with a prospective retirement month';end if;
 if exists(select 1 from jsonb_each(p_payload->'driverMappings') m where jsonb_typeof(m.value)<>'array') then raise exception 'Each driver mapping must be an account-code array';end if;
 if exists(select 1 from jsonb_each(p_payload->'driverMappings') m cross join lateral jsonb_array_elements_text(m.value) code where not(code=any(codes))) then raise exception 'Driver mapping references an unregistered GL';end if;
 select role into role_name from public.atlas_user_profiles where user_id=auth.uid();
 insert into public.atlas_reforecast_registries(community_id,previous_version_id,request_id,effective_date,payload,content_hash,created_by,created_role) values(p_community_id,prior.version_id,p_request_id,(p_payload->>'effectiveDate')::date,p_payload,hash,auth.uid(),role_name) returning * into r;
 insert into public.atlas_reforecast_registry_heads values(p_community_id,r.version_id) on conflict(community_id) do update set version_id=excluded.version_id;return r;
end;$$;

create or replace function atlas_private.reforecast_source(cid uuid,periods text[],budget_ids uuid[] default null,registry_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare baseline jsonb;actuals jsonb;registry jsonb;versions jsonb;closes jsonb;cutoff text;coverage_start text;result jsonb;actual_months jsonb;budget_leasing jsonb;
begin
 if periods is null or cardinality(periods)=0 or cardinality(periods)>24 or exists(select 1 from unnest(periods) p where p!~'^20[0-9]{2}-(0[1-9]|1[0-2])$') or (select count(distinct p) from unnest(periods)p)<>cardinality(periods) then raise exception 'One to 24 distinct reporting months required';end if;
 if budget_ids is not null and exists(select 1 from unnest(budget_ids) id where not exists(select 1 from public.atlas_approved_budget_versions b where b.version_id=id and b.community_id=cid and b.status='locked')) then raise exception 'Original budget version is not authorized for this community';end if;
 if registry_id is not null and not exists(select 1 from public.atlas_reforecast_registries where version_id=registry_id and community_id=cid) then raise exception 'GL registry community mismatch';end if;
 if registry_id is null then select version_id into registry_id from public.atlas_reforecast_registry_heads where community_id=cid;end if;
 select jsonb_build_object('version',version_id,'accounts',payload->'accounts','driverMappings',payload->'driverMappings','effectiveDate',effective_date) into registry from public.atlas_reforecast_registries where version_id=registry_id and community_id=cid;
 select coalesce(jsonb_agg(distinct b.version_id),'[]') into versions from public.atlas_approved_budget_versions b where b.community_id=cid and b.status='locked' and (budget_ids is null or b.version_id=any(budget_ids)) and exists(select 1 from unnest(periods)p where left(p,4)::integer=b.calendar_year);
 select coalesce(jsonb_agg(jsonb_build_object('period',p,'accountCode',line->>'glCode','amount',line->'monthly'->(right(p,2)::integer-1),'accountName',coalesce(nullif(line->>'accountName',''),line->>'name'),'nature',line->'nature','category',coalesce(nullif(line->>'category',''),nullif(line->>'group',''),line->>'section'),'placement',line->'placement','source',jsonb_build_object('versionId',b.version_id,'sourceFile',b.source_file,'sourceHash',b.source_hash)) order by p,line->>'glCode'),'[]') into baseline
 from public.atlas_approved_budget_versions b cross join unnest(periods)p cross join lateral jsonb_array_elements(b.payload->'rows')line
 where b.community_id=cid and b.status='locked' and (budget_ids is null or b.version_id=any(budget_ids)) and left(p,4)::integer=b.calendar_year and right(p,2)::integer-1=any(b.covered_months);
 if exists(select 1 from jsonb_array_elements(baseline) l group by l->>'period',l->>'accountCode' having count(*)>1) then raise exception 'Original budget coverage overlaps; select an unambiguous baseline';end if;
 select coalesce(jsonb_agg(jsonb_build_object('period',p,'units',c.units,'occupiedUnits',case when jsonb_typeof(b.payload->'occupancyPct'->(right(p,2)::integer-1))='number' and (b.payload->'occupancyPct'->>(right(p,2)::integer-1))::numeric between 0 and 100 then c.units*(b.payload->'occupancyPct'->>(right(p,2)::integer-1))::numeric/100 end,'moveIns',null,'moveOuts',null,'marketRent',null,'source',jsonb_build_object('kind','approved_budget_occupancy_with_current_unit_inventory','budgetVersionId',b.version_id,'occupancySource',b.payload->'occupancySource','occupancyPct',b.payload->'occupancyPct'->(right(p,2)::integer-1),'unitInventory',jsonb_build_object('communityId',cid,'units',c.units,'updatedAt',c.updated_at))) order by p),'[]') into budget_leasing
 from public.atlas_approved_budget_versions b join public.atlas_communities c on c.community_id=b.community_id cross join unnest(periods)p
 where b.community_id=cid and b.status='locked' and (budget_ids is null or b.version_id=any(budget_ids)) and left(p,4)::integer=b.calendar_year and right(p,2)::integer-1=any(b.covered_months);
 if exists(select 1 from jsonb_array_elements(budget_leasing) l group by l->>'period' having count(*)>1) then raise exception 'Original budget leasing coverage overlaps; select an unambiguous baseline';end if;

 select max(h.period_key) into cutoff from public.atlas_financial_close_heads h where h.community_id=cid and h.accounting_basis='accrual' and h.period_key<= (select max(p) from unnest(periods)p);
 select coalesce(jsonb_agg(jsonb_build_object('period',h.period_key,'versionId',v.version_id,'sourceHash',v.source_hash,'approvedAt',v.approved_at) order by h.period_key),'[]') into closes from public.atlas_financial_close_heads h join public.atlas_financial_close_versions v using(version_id) where h.community_id=cid and h.accounting_basis='accrual' and h.period_key=any(periods);
 select coalesce(jsonb_agg(jsonb_build_object('period',h.period_key,'accountCode',r.gl_code,'amount',r.actual,'source',r.source_location,'closeVersionId',h.version_id) order by h.period_key,r.gl_code),'[]') into actuals from public.atlas_financial_close_heads h join public.atlas_financial_close_rows r using(version_id) where h.community_id=cid and h.accounting_basis='accrual' and h.period_key=any(periods);
 select coalesce(jsonb_agg(jsonb_build_object('period',h.period_key,'closeVersionId',v.version_id,'revenue',v.metrics->'totalIncome','opex',v.metrics->'operatingExpenses','noi',v.metrics->'netOperatingIncome','margin',case when (v.metrics->>'totalIncome')::numeric<>0 then (v.metrics->>'netOperatingIncome')::numeric/(v.metrics->>'totalIncome')::numeric end,'cashFlow',v.metrics->'sourceControls'->'Net Cash Flow'->'actual','source','governed_close_controls') order by h.period_key),'[]') into actual_months from public.atlas_financial_close_heads h join public.atlas_financial_close_versions v using(version_id) where h.community_id=cid and h.accounting_basis='accrual' and h.period_key=any(periods);
 select first_expected_financial_period into coverage_start from public.atlas_communities where community_id=cid;
 result:=jsonb_build_object('communityId',cid,'periods',to_jsonb(periods),'baseline',jsonb_build_object('versionIds',versions,'lines',baseline,'leasing',budget_leasing),'actuals',jsonb_build_object('cutoffPeriod',cutoff,'closeVersions',closes,'lines',actuals,'monthly',actual_months,'notApplicablePeriods',(select coalesce(jsonb_agg(p),'[]') from unnest(periods)p where p<coverage_start)),'registry',coalesce(registry,jsonb_build_object('version',null,'accounts','[]'::jsonb,'driverMappings','{}'::jsonb)));
 return result||jsonb_build_object('sourceVersion',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
end;$$;
create or replace function public.atlas_read_reforecast_source(p_community_id uuid,p_periods text[],p_baseline_version_ids uuid[] default null,p_registry_version_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin if not atlas_private.reforecast_access(p_community_id) then raise exception 'Reforecast source access denied';end if;return atlas_private.reforecast_source(p_community_id,p_periods,p_baseline_version_ids,p_registry_version_id);end;$$;

create or replace function atlas_private.reforecast_metric(lines jsonb,field text)
returns jsonb language plpgsql immutable set search_path='' as $$
declare revenue numeric;expense numeric;below numeric;noi numeric;cash numeric;missing integer;result jsonb:='{}';metric text;amount numeric;
begin
 if jsonb_array_length(lines)=0 or exists(select 1 from jsonb_array_elements(lines)v where v->>'mappingValid' is distinct from 'true') then return jsonb_build_object('grossIncome',null,'contraRevenue',null,'revenue',null,'opex',null,'expenses',null,'belowNoi',null,'capital',null,'debt',null,'noi',null,'margin',null,'cashFlow',null);end if;
 foreach metric in array array['grossIncome','contraRevenue','opex','belowNoi','capital','debt'] loop
  select coalesce(sum(case when metric='belowNoi' and v->>'nature' in ('income','contra_income') then -(v->>field)::numeric else (v->>field)::numeric end),0),count(*) filter(where v->>field is null) into amount,missing
  from jsonb_array_elements(lines)v where case metric when 'grossIncome' then v->>'nature'='income' and v->>'placement'='above_noi' when 'contraRevenue' then v->>'nature'='contra_income' and v->>'placement'='above_noi' when 'opex' then v->>'nature'='expense' and v->>'placement'='above_noi' when 'belowNoi' then v->>'placement'='below_noi' and v->>'nature' not in ('capital','debt') when 'capital' then v->>'nature'='capital' when 'debt' then v->>'nature'='debt' end;
  result:=result||jsonb_build_object(metric,case when missing=0 then round(amount,2) end);
 end loop;
 revenue:=(result->>'grossIncome')::numeric+(result->>'contraRevenue')::numeric;expense:=(result->>'opex')::numeric;noi:=revenue-expense;cash:=noi-(result->>'belowNoi')::numeric-(result->>'capital')::numeric-(result->>'debt')::numeric;
 return result||jsonb_build_object('revenue',round(revenue,2),'expenses',expense,'noi',round(noi,2),'margin',case when revenue<>0 then noi/revenue end,'cashFlow',round(cash,2));
end;$$;
create or replace function atlas_private.calculate_reforecast(source jsonb,config jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare state jsonb:='{}';lines jsonb:='[]';diagnostics jsonb:='[]';impacts jsonb:='[]';monthly jsonb:='[]';totals jsonb:='{}';categories jsonb:='[]';leasing jsonb:='[]';changes jsonb:='[]';skipped jsonb:='[]';unavailable jsonb:='[]';leasing_row jsonb;leasing_source jsonb;
 p text;code text;k text;phase text;metric text;a jsonb;b jsonb;actual jsonb;line jsonb;driver jsonb;over jsonb;targets jsonb;control jsonb;metric_set jsonb;month_lines jsonb;item jsonb;
 value numeric;before_value numeric;base numeric;original numeric;actual_value numeric;close_id text;closed boolean;applicable boolean;known boolean;changed integer;affected integer;total numeric;missing integer;override_index integer:=0;driver_ids text[]:='{}';cutoff text:=source->'actuals'->>'cutoffPeriod';snapshot jsonb;
begin
 if jsonb_array_length(source->'baseline'->'versionIds')=0 then diagnostics:=diagnostics||jsonb_build_array(jsonb_build_object('code','missing_baseline','severity','error','message','Select a locked original budget baseline.'));end if;
 if jsonb_array_length(coalesce(config->'drivers','[]'))=0 and jsonb_array_length(coalesce(config->'overrides','[]'))=0 then diagnostics:=diagnostics||jsonb_build_array(jsonb_build_object('code','no_driver_changes','severity','warning','message','No accepted drivers or overrides are applied. Open-period amounts equal the original budget.'));end if;
 if source->'registry'->>'version' is null then diagnostics:=diagnostics||jsonb_build_array(jsonb_build_object('code','mapping_required','severity','error','message','Approve a GL category and statement-placement registry.'));end if;
 for p in select jsonb_array_elements_text(source->'periods') loop
  closed:=cutoff is not null and p<=cutoff;applicable:=not coalesce(source->'actuals'->'notApplicablePeriods' ? p,false);
  select v into control from jsonb_array_elements(source->'actuals'->'monthly')v where v->>'period'=p;
  if closed and applicable and control is null then diagnostics:=diagnostics||jsonb_build_array(jsonb_build_object('code','missing_closed_actual','severity','error','period',p,'message','A governed close is missing before the actuals cutoff.'));end if;
  for code in select distinct c from (select v->>'accountCode' c from jsonb_array_elements(source->'baseline'->'lines')v where v->>'period'=p union select v->>'accountCode' from jsonb_array_elements(source->'actuals'->'lines')v where v->>'period'=p union select v->>'accountCode' from jsonb_array_elements(source->'registry'->'accounts')v where v->>'effectiveFrom'<=p and (v->>'retiredAfter' is null or v->>'retiredAfter'>=p)) codes where c is not null order by c loop
   select v into a from jsonb_array_elements(source->'registry'->'accounts')v where v->>'accountCode'=code;
   select v into b from jsonb_array_elements(source->'baseline'->'lines')v where v->>'period'=p and v->>'accountCode'=code;
   select v into actual from jsonb_array_elements(source->'actuals'->'lines')v where v->>'period'=p and v->>'accountCode'=code;
   original:=(b->>'amount')::numeric;actual_value:=(actual->>'amount')::numeric;close_id:=actual->>'closeVersionId';
   if close_id is null then close_id:=control->>'closeVersionId';end if;
   known:=a is not null and (closed or a->>'effectiveFrom'<=p);
   if not known and applicable then diagnostics:=diagnostics||jsonb_build_array(jsonb_build_object('code','unmapped_account','severity','error','period',p,'accountCode',code,'message','GL category, nature or effective statement placement is missing.'));end if;
   value:=case when not applicable then null when closed then actual_value when a->>'retiredAfter'<p then 0 else original end;
   line:=jsonb_build_object('period',p,'accountCode',code,'originalBudget',original,'actual',case when closed and applicable then actual_value end,'forecast',value,'sourceKind',case when not applicable then 'not_applicable' when closed then 'closed_actual' else 'forecast' end,'closeVersionId',close_id,'accountName',coalesce(a->>'name',b->>'accountName',code),'category',a->'category','nature',a->'nature','placement',a->'placement','mappingValid',known,'retired',a->>'retiredAfter' is not null and p>a->>'retiredAfter','applicable',applicable,'driverSources','[]'::jsonb,'driverIds','[]'::jsonb,'source',case when closed then actual->'source' else b->'source' end);
   state:=jsonb_set(state,array[p||'|'||code],line,true);
  end loop;
 end loop;
 for driver in select v from jsonb_array_elements(coalesce(config->'drivers','[]'))v loop
  if coalesce(driver->>'id','')='' or driver->>'id'=any(driver_ids) or coalesce(driver->>'operation','') not in ('percent_change','amount','add','percent_of_account','occupancy_vacancy') or jsonb_typeof(driver->'value') is distinct from 'number' or abs((driver->>'value')::numeric)>1000000000000 then raise exception 'Invalid or duplicate scenario driver';end if;
  driver_ids:=array_append(driver_ids,driver->>'id');
  if driver->>'operation'='occupancy_vacancy' and ((driver->>'value')::numeric<0 or (driver->>'value')::numeric>1) then raise exception 'Occupancy driver must be a fraction between zero and one';end if;
  targets:=coalesce(driver->'accountCodes',source->'registry'->'driverMappings'->(driver->>'type'),'[]');
  if jsonb_typeof(targets)<>'array' or jsonb_array_length(targets)=0 then diagnostics:=diagnostics||jsonb_build_array(jsonb_build_object('code','driver_mapping_required','severity','error','driverId',driver->>'id','message','Driver has no explicitly mapped applicable GLs.'));impacts:=impacts||jsonb_build_array(jsonb_build_object('id',driver->>'id','type',coalesce(driver->>'type',''),'operation',driver->>'operation','value',driver->'value','source',driver->'source','reason',coalesce(driver->>'reason',''),'changed','[]'::jsonb,'skippedClosed','[]'::jsonb,'unavailable','[]'::jsonb,'status','unavailable','explanation','No reviewed applicable account mapping.'));continue;end if;
  changed:=0;affected:=0;changes:='[]';skipped:='[]';unavailable:='[]';
  for p in select v from jsonb_array_elements_text(coalesce(driver->'periods',source->'periods')) with ordinality q(v,ord) group by v order by min(ord) loop
   if not(source->'periods' ? p) then continue;end if;
   for code in select v from jsonb_array_elements_text(targets) with ordinality q(v,ord) group by v order by min(ord) loop
    k:=p||'|'||code;line:=state->k;
    if (cutoff is not null and p<=cutoff) or source->'actuals'->'notApplicablePeriods' ? p then skipped:=skipped||jsonb_build_array(jsonb_build_object('period',p,'accountCode',code));continue;end if;
    if exists(select 1 from jsonb_array_elements(source->'registry'->'accounts')z where z->>'accountCode'=code and z->>'retiredAfter'<p) then skipped:=skipped||jsonb_build_array(jsonb_build_object('period',p,'accountCode',code,'reason','Prospectively retired by reviewed mapping registry'));continue;end if;
    if line is null or line->>'mappingValid' is distinct from 'true' then unavailable:=unavailable||jsonb_build_array(jsonb_build_object('period',p,'accountCode',code,'reason','Missing effective account mapping'));diagnostics:=diagnostics||jsonb_build_array(jsonb_build_object('code','driver_target_unavailable','severity','error','period',p,'accountCode',code,'driverId',driver->>'id','message','Driver target lacks an effective mapped GL.'));continue;end if;
    affected:=affected+1;before_value:=(line->>'forecast')::numeric;
    case driver->>'operation'
    when 'amount' then value:=(driver->>'value')::numeric;
    when 'add' then value:=before_value+(driver->>'value')::numeric;
    when 'percent_change' then value:=before_value*(1+(driver->>'value')::numeric);
    when 'percent_of_account' then value:=(state->(p||'|'||(driver->>'baseAccountCode'))->>'forecast')::numeric*(driver->>'value')::numeric;
    when 'occupancy_vacancy' then value:=-abs((state->(p||'|'||(driver->>'baseAccountCode'))->>'forecast')::numeric)*(1-(driver->>'value')::numeric);
    end case;
    value:=round(value,2);if value is distinct from before_value then changed:=changed+1;changes:=changes||jsonb_build_array(jsonb_build_object('period',p,'accountCode',code,'before',before_value,'after',value,'delta',value-before_value));end if;
    if value is null then unavailable:=unavailable||jsonb_build_array(jsonb_build_object('period',p,'accountCode',code,'reason','Missing required source amount'));diagnostics:=diagnostics||jsonb_build_array(jsonb_build_object('code','driver_input_missing','severity','error','period',p,'accountCode',code,'driverId',driver->>'id','message','Driver input or dependent account is unavailable.'));end if;
    line:=line||jsonb_build_object('forecast',value,'driverIds',(line->'driverIds')||jsonb_build_array(driver->>'id'),'driverSources',(line->'driverSources')||jsonb_build_array(jsonb_build_object('driverId',driver->>'id','operation',driver->>'operation','value',driver->'value','source',driver->'source','reason',coalesce(driver->>'reason',''))));state:=jsonb_set(state,array[k],line,true);
   end loop;
  end loop;
  impacts:=impacts||jsonb_build_array(jsonb_build_object('id',driver->>'id','type',coalesce(driver->>'type',''),'operation',driver->>'operation','value',driver->'value','source',driver->'source','reason',coalesce(driver->>'reason',''),'affectedLines',affected,'changedLines',changed,'changed',changes,'skippedClosed',skipped,'unavailable',unavailable,'status',case when jsonb_array_length(unavailable)>0 then 'unavailable' when changed>0 then 'applied' else 'no_impact' end,'explanation',case when jsonb_array_length(unavailable)>0 then 'One or more applicable periods or account inputs are unavailable.' when changed>0 then 'Changed '||changed||' open-period account amount(s).' when jsonb_array_length(skipped)>0 then 'All applicable changes are in governed closed periods and were not applied.' when not exists(select 1 from jsonb_array_elements_text(coalesce(driver->'periods',source->'periods'))d where source->'periods' ? d) then 'No driver periods overlap the reporting period.' else 'Mapped open-period values already equal this driver result.' end));
 end loop;
 for over in select v from jsonb_array_elements(coalesce(config->'overrides','[]'))v loop
  override_index:=override_index+1;
  p:=over->>'period';code:=over->>'accountCode';k:=p||'|'||code;
  if not(source->'periods' ? p) or coalesce(code,'')='' or jsonb_typeof(over->'amount') not in ('number','null') then raise exception 'Invalid working-cell override';end if;
  if (cutoff is not null and p<=cutoff) or source->'actuals'->'notApplicablePeriods' ? p then continue;end if;
  if exists(select 1 from jsonb_array_elements(source->'registry'->'accounts')z where z->>'accountCode'=code and z->>'retiredAfter'<p) then continue;end if;
  line:=state->k;if line is null then diagnostics:=diagnostics||jsonb_build_array(jsonb_build_object('code','override_mapping_required','severity','error','period',p,'accountCode',code,'message','Map this GL before applying a working-cell override.'));continue;end if;
  if coalesce(over->>'reason','')='' then diagnostics:=diagnostics||jsonb_build_array(jsonb_build_object('code','override_reason','severity','error','period',p,'accountCode',code,'message','Record an adjustment reason for this working-cell override.'));end if;
  line:=line||jsonb_build_object('forecast',round((over->>'amount')::numeric,2),'override',over,'driverIds',(line->'driverIds')||jsonb_build_array('override-'||(override_index-1)),'driverSources',(line->'driverSources')||jsonb_build_array(jsonb_build_object('driverId','override-'||(override_index-1),'operation','amount','value',over->'amount','source',over->'source','reason',coalesce(over->>'reason',''))));state:=jsonb_set(state,array[k],line,true);
 end loop;
 select coalesce(jsonb_agg(v order by v->>'period',v->>'accountCode'),'[]') into lines from jsonb_each(state) x(k,v);
 for line in select v from jsonb_array_elements(lines)v loop
  if line->>'sourceKind'='forecast' and line->>'forecast' is null then diagnostics:=diagnostics||jsonb_build_array(jsonb_build_object('code','open_value_missing','severity','error','period',line->>'period','accountCode',line->>'accountCode','message','Open forecast value is missing; enter an explicit value or documented zero.'));
  elsif line->>'sourceKind'='closed_actual' and line->>'actual' is null then diagnostics:=diagnostics||jsonb_build_array(jsonb_build_object('code','closed_detail_missing','severity','warning','period',line->>'period','accountCode',line->>'accountCode','message','This GL is absent from the closed package. It remains unavailable; canonical closed controls govern monthly totals.'));end if;
 end loop;
 for p in select jsonb_array_elements_text(source->'periods') loop
  select coalesce(jsonb_agg(v),'[]') into month_lines from jsonb_array_elements(lines)v where v->>'period'=p;
  select v into control from jsonb_array_elements(source->'actuals'->'monthly')v where v->>'period'=p;
  metric_set:=jsonb_build_object('period',p,'closed',cutoff is not null and p<=cutoff and not(source->'actuals'->'notApplicablePeriods' ? p),'applicable',not(source->'actuals'->'notApplicablePeriods' ? p),'originalBudget',atlas_private.reforecast_metric(month_lines,'originalBudget'),'reforecast',case when source->'actuals'->'notApplicablePeriods' ? p then atlas_private.reforecast_metric('[]','forecast') when cutoff is not null and p<=cutoff then atlas_private.reforecast_metric(month_lines,'actual')||coalesce(control,'{}')||jsonb_build_object('expenses',control->'opex') else atlas_private.reforecast_metric(month_lines,'forecast') end,'actuals',case when cutoff is not null and p<=cutoff and not(source->'actuals'->'notApplicablePeriods' ? p) then atlas_private.reforecast_metric(month_lines,'actual')||coalesce(control,'{}')||jsonb_build_object('expenses',control->'opex') else atlas_private.reforecast_metric('[]','actual') end,'closeVersionId',control->'closeVersionId','detailCoverage',(select coalesce(jsonb_agg(v->>'accountCode'),'[]') from jsonb_array_elements(month_lines)v where v->>'sourceKind'='closed_actual' and v->>'actual' is null),'controlSource',control->'source');
  monthly:=monthly||jsonb_build_array(metric_set);
 end loop;
 foreach phase in array array['originalBudget','reforecast','actuals','actualsThroughCutoff'] loop
  item:='{}';foreach metric in array array['grossIncome','contraRevenue','revenue','opex','expenses','belowNoi','capital','debt','noi','cashFlow'] loop
   select sum((v->(case when phase='actualsThroughCutoff' then 'actuals' else phase end)->>metric)::numeric),count(*) filter(where v->(case when phase='actualsThroughCutoff' then 'actuals' else phase end)->>metric is null) into total,missing from jsonb_array_elements(monthly)v where (phase='originalBudget' or not(source->'actuals'->'notApplicablePeriods' ? (v->>'period'))) and (phase<>'actualsThroughCutoff' or v->>'closed'='true');
   item:=item||jsonb_build_object(metric,case when missing=0 then round(total,2) end);
  end loop;
  item:=item||jsonb_build_object('margin',case when (item->>'revenue')::numeric<>0 then (item->>'noi')::numeric/(item->>'revenue')::numeric end);totals:=totals||jsonb_build_object(phase,item);
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('category',category,'monthly',(select jsonb_agg(jsonb_build_object('period',pr.period_value,'originalBudget',(select case when count(*) filter(where v->>'originalBudget' is null)=0 then coalesce(sum((v->>'originalBudget')::numeric),0) end from jsonb_array_elements(lines)v where v->>'period'=pr.period_value and v->>'category'=category),'forecast',(select case when count(*) filter(where v->>'forecast' is null)=0 then coalesce(sum((v->>'forecast')::numeric),0) end from jsonb_array_elements(lines)v where v->>'period'=pr.period_value and v->>'category'=category),'actual',case when pr.period_value<=cutoff then (select case when count(*) filter(where v->>'actual' is null)=0 then coalesce(sum((v->>'actual')::numeric),0) end from jsonb_array_elements(lines)v where v->>'period'=pr.period_value and v->>'category'=category) end) order by pr.period_value) from jsonb_array_elements_text(source->'periods') as pr(period_value))) order by category),'[]') into categories from (select distinct v->>'category' category from jsonb_array_elements(lines)v where v->>'category' is not null)c;
 for p in select jsonb_array_elements_text(source->'periods') loop
  closed:=cutoff is not null and p<=cutoff and not(source->'actuals'->'notApplicablePeriods' ? p);
  select v into leasing_source from jsonb_array_elements(case when closed then coalesce(source->'actuals'->'leasing','[]') else coalesce(source->'baseline'->'leasing','[]') end)v where v->>'period'=p;
  leasing_row:=jsonb_build_object('period',p,'sourceKind',case when source->'actuals'->'notApplicablePeriods' ? p then 'not_applicable' when closed then 'closed_actual' else 'forecast' end,'units',leasing_source->'units','occupiedUnits',leasing_source->'occupiedUnits','moveIns',leasing_source->'moveIns','moveOuts',leasing_source->'moveOuts','marketRent',leasing_source->'marketRent','source',leasing_source->'source');
  for driver in select v from jsonb_array_elements(coalesce(config->'drivers','[]'))v loop
   if not closed and not(source->'actuals'->'notApplicablePeriods' ? p) and driver->>'operation'='occupancy_vacancy' and (driver->'periods' is null or driver->'periods' ? p) and leasing_row->>'units' is not null and exists(select 1 from jsonb_array_elements(lines)l where l->>'period'=p and l->>'mappingValid'='true' and l->>'retired' is distinct from 'true' and l->>'forecast' is not null and l->'driverIds' ? (driver->>'id')) then leasing_row:=leasing_row||jsonb_build_object('occupiedUnits',(leasing_row->>'units')::numeric*(driver->>'value')::numeric);end if;
  end loop;
  leasing:=leasing||jsonb_build_array(leasing_row||jsonb_build_object('occupancy',case when (leasing_row->>'units')::numeric>0 then (leasing_row->>'occupiedUnits')::numeric/(leasing_row->>'units')::numeric end));
 end loop;
 snapshot:=jsonb_build_object('schemaVersion',1,'communityId',source->'communityId','periods',source->'periods','identity',jsonb_build_object('engineVersion','atlas-reforecast-v1','communityId',source->'communityId','periods',source->'periods','actualCutoff',cutoff,'actualCloseVersions',source->'actuals'->'closeVersions','mappingRegistryVersion',source->'registry'->'version','baselineVersionIds',source->'baseline'->'versionIds','closeVersions',source->'actuals'->'closeVersions','registryVersion',source->'registry'->'version','sourceVersion',source->'sourceVersion','driverVersion',config->>'driverVersion'),'status',case when exists(select 1 from jsonb_array_elements(diagnostics)d where d->>'severity'='error') then 'action_required' else 'ready' end,'lines',lines,'monthly',monthly,'totals',totals,'categories',categories,'leasing',leasing,'diagnostics',diagnostics,'driverImpacts',impacts,'cutoffPeriod',cutoff,'completeness',jsonb_build_object('blockerCount',(select count(*) from jsonb_array_elements(diagnostics)d where d->>'severity'='error'),'warningCount',(select count(*) from jsonb_array_elements(diagnostics)d where d->>'severity'='warning')));
 return snapshot||jsonb_build_object('fingerprint',encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'));
end;$$;

create or replace function atlas_private.reforecast_import_issues(source jsonb,config jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare upload jsonb;mapping jsonb:=config->'importMapping';issues jsonb:='[]';line jsonb;m jsonb;a jsonb;over jsonb;entry jsonb;subconfig jsonb;id text;matches integer;amount numeric;cutoff text:=source->'actuals'->>'cutoffPeriod';
begin
 if jsonb_typeof(config->'importHistory')='array' and jsonb_array_length(config->'importHistory')>0 then
  if exists(select 1 from jsonb_array_elements(coalesce(config->'overrides','[]'))v where v->>'sourceLineId' is not null and coalesce(v->>'uploadId',config->>'uploadId') is distinct from config->>'uploadId' and not exists(select 1 from jsonb_array_elements(config->'importHistory')e where e->>'uploadId'=v->>'uploadId')) then issues:=issues||jsonb_build_array(jsonb_build_object('code','import_upload_unreviewed','severity','error','message','Every workbook-derived override must retain its upload and reviewed import mapping.'));end if;
  for entry in select distinct on(v->>'uploadId')v from jsonb_array_elements((config->'importHistory')||jsonb_build_array(jsonb_build_object('uploadId',config->>'uploadId','mapping',config->'importMapping','issues',config->'importIssues'))) with ordinality e(v,ord) order by v->>'uploadId',ord desc loop
   if entry->>'uploadId' is null then continue;end if;
   if entry->>'uploadId'<>config->>'uploadId' and not exists(select 1 from jsonb_array_elements(coalesce(config->'overrides','[]'))v where v->>'uploadId'=entry->>'uploadId') then continue;end if;
   subconfig:=(config-'importHistory')||jsonb_build_object('uploadId',entry->>'uploadId','importMapping',entry->'mapping','importIssues',coalesce(entry->'issues','[]'),'overrides',(select coalesce(jsonb_agg(v),'[]') from jsonb_array_elements(coalesce(config->'overrides','[]'))v where coalesce(v->>'uploadId',config->>'uploadId')=entry->>'uploadId'));
   issues:=issues||atlas_private.reforecast_import_issues(source,subconfig);
  end loop;return issues;
 end if;
 if exists(select 1 from jsonb_array_elements(coalesce(config->'overrides','[]'))v where v->>'sourceLineId' is not null and coalesce(v->>'uploadId',config->>'uploadId') is distinct from config->>'uploadId') then issues:=issues||jsonb_build_array(jsonb_build_object('code','import_upload_unreviewed','severity','error','message','Every workbook-derived override must retain its upload and reviewed import mapping.'));end if;
 select payload into upload from public.atlas_reforecast_uploads where upload_id=(config->>'uploadId')::uuid and community_id=(source->>'communityId')::uuid;
 if mapping is null or mapping->>'confirmed' is distinct from 'true' or mapping->>'version' is distinct from source->'registry'->>'version' or mapping->'propertyAssignment'->>'communityId' is distinct from source->>'communityId' or coalesce(mapping->>'sourceScenario','')='' or coalesce(mapping->>'currency','')!~'^[A-Z]{3}$' or coalesce(mapping->>'reason','')='' or jsonb_typeof(mapping->'selectedLineIds') is distinct from 'array' or jsonb_array_length(mapping->'selectedLineIds')=0 then
  return jsonb_build_array(jsonb_build_object('code','import_mapping_required','severity','error','message','Explicitly review source scenario, currency, selected cells, GL/sign mapping and community before using workbook values.'));
 end if;
 if exists(select 1 from jsonb_array_elements_text(coalesce(upload->'metadata'->'entities','[]'))e where not(coalesce(mapping->'propertyAssignment'->'sourceEntities','[]') ? e)) then issues:=issues||jsonb_build_array(jsonb_build_object('code','import_entity_required','severity','error','message','Acknowledge every source entity in the explicit property assignment.'));end if;
 if exists(select 1 from jsonb_array_elements(coalesce(upload->'lines','[]'))l cross join lateral jsonb_array_elements(coalesce(mapping->'accountMappings','[]'))map_entry where mapping->'selectedLineIds' ? (l->>'id') and (cutoff is null or l->>'period'>cutoff) and l->>'scenario'=mapping->>'sourceScenario' and map_entry->>'sourceAccountCode'=l->>'accountCode' and (map_entry->>'sheet' is null or map_entry->>'sheet'=l->>'sheet') and (map_entry->>'department' is null or map_entry->>'department'=l->>'department') group by l->>'period',map_entry->>'accountCode' having count(*)>1) then issues:=issues||jsonb_build_array(jsonb_build_object('code','import_duplicate_gl_period','severity','error','message','Selected workbook cells map more than once to the same GL and period. Review an explicit aggregation before approval.'));end if;
 for id in select jsonb_array_elements_text(mapping->'selectedLineIds') loop
  select v into line from jsonb_array_elements(coalesce(upload->'lines','[]'))v where v->>'id'=id;
  if line is null or line->>'scenario' is distinct from mapping->>'sourceScenario' or (line->>'currency' is not null and line->>'currency' is distinct from mapping->>'currency') or not(source->'periods' ? (line->>'period')) or not(coalesce(mapping->'periods',source->'periods') ? (line->>'period')) then issues:=issues||jsonb_build_array(jsonb_build_object('code','import_selection_mismatch','severity','error','message','A selected workbook cell does not match its reviewed source scope.','sourceLineId',id));continue;end if;
  if line->>'period'<=cutoff or line->>'sourceKind'='workbook_actual_evidence' then continue;end if;
  select count(*) into matches from jsonb_array_elements(mapping->'accountMappings')v where v->>'sourceAccountCode'=line->>'accountCode' and (v->>'sheet' is null or v->>'sheet'=line->>'sheet') and (v->>'department' is null or v->>'department'=line->>'department');
  if matches<>1 then issues:=issues||jsonb_build_array(jsonb_build_object('code','import_gl_mapping','severity','error','message','Every selected open cell needs exactly one reviewed GL mapping.','sourceLineId',id));continue;end if;
  select v into m from jsonb_array_elements(mapping->'accountMappings')v where v->>'sourceAccountCode'=line->>'accountCode' and (v->>'sheet' is null or v->>'sheet'=line->>'sheet') and (v->>'department' is null or v->>'department'=line->>'department');
  select v into a from jsonb_array_elements(source->'registry'->'accounts')v where v->>'accountCode'=m->>'accountCode';
  if a is null or a->>'nature' is distinct from m->>'nature' or a->>'category' is distinct from m->>'category' or a->>'placement' is distinct from m->>'placement' or m->>'signMultiplier' not in ('1','-1') or a->>'effectiveFrom'>line->>'period' or a->>'retiredAfter'<line->>'period' or jsonb_typeof(line->'amount') is distinct from 'number' or line->>'cellType'='e' or line->>'periodBasis'='unconfirmed_period' or (coalesce(line->>'formula','')<>'' and (line->>'cachedValue' is null or line->>'cachedValue'='')) then issues:=issues||jsonb_build_array(jsonb_build_object('code','import_value_invalid','severity','error','message','Review the selected value, sign and effective mapping.','sourceLineId',id));continue;end if;
  if exists(select 1 from jsonb_array_elements(coalesce(upload->'issues','[]'))e where e->>'sheet'=line->>'sheet' and e->>'address'=line->>'address' and e->>'code' in ('excel_error','broken_formula_reference','external_formula_reference','missing_formula_sheet','broken_named_formula_reference')) or exists(select 1 from jsonb_array_elements(coalesce(upload->'reconciliation','[]'))c where c->>'sheet'=line->>'sheet' and c->>'row'=line->>'row' and c->'periods' ? (line->>'period') and c->>'status'='mismatch') then issues:=issues||jsonb_build_array(jsonb_build_object('code','import_source_unreconciled','severity','error','message','Repair the selected formula or monthly reconciliation before approval.','sourceLineId',id));end if;
  amount:=(line->>'amount')::numeric*(m->>'signMultiplier')::numeric;
  if ((a->>'nature'='contra_income' and amount>0) or (a->>'nature' in ('income','expense','capital','debt') and amount<0)) and m->>'allowReversal' is distinct from 'true' then issues:=issues||jsonb_build_array(jsonb_build_object('code','import_sign_review','severity','error','message','The signed source amount requires explicit reversal review.','sourceLineId',id));end if;
  for over in select v from jsonb_array_elements(coalesce(config->'overrides','[]'))v where v->>'sourceLineId'=id loop
   if over->>'period' is distinct from line->>'period' or over->>'accountCode' is distinct from m->>'accountCode' or (over->>'amount')::numeric is distinct from amount then issues:=issues||jsonb_build_array(jsonb_build_object('code','import_override_mismatch','severity','error','message','A workbook-derived override does not match its retained source; record manual changes as a separate audited override.','sourceLineId',id));end if;
  end loop;
 end loop;
 for over in select v from jsonb_array_elements(coalesce(config->'overrides','[]'))v where v->>'sourceLineId' is not null loop
  if not(mapping->'selectedLineIds' ? (over->>'sourceLineId')) then issues:=issues||jsonb_build_array(jsonb_build_object('code','import_override_unselected','severity','error','message','A workbook override references an unselected source cell.'));end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(coalesce(config->'importIssues','[]'))e where e->>'severity'='error') then issues:=issues||jsonb_build_array(jsonb_build_object('code','import_review_blockers','severity','error','message','Resolve the retained workbook review errors before approval.'));end if;
 return issues;
end;$$;
revoke all on function atlas_private.reforecast_import_issues(jsonb,jsonb) from public,anon,authenticated;
drop policy reforecast_read on public.atlas_reforecast_publications;
create policy reforecast_read on public.atlas_reforecast_publications for select to authenticated using(atlas_private.reforecast_access(community_id,'active_read'));
drop policy reforecast_read on public.atlas_reforecast_active_heads;
create policy reforecast_read on public.atlas_reforecast_active_heads for select to authenticated using(atlas_private.reforecast_access(community_id,'active_read'));
revoke all on function atlas_private.reforecast_source(uuid,text[],uuid[],uuid),atlas_private.reforecast_metric(jsonb,text),atlas_private.calculate_reforecast(jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.atlas_save_reforecast_upload(uuid,uuid,jsonb),public.atlas_save_reforecast_registry(uuid,uuid,uuid,jsonb),public.atlas_read_reforecast_source(uuid,text[],uuid[],uuid),public.atlas_save_reforecast_scenario(uuid,uuid,integer,uuid,text,jsonb),public.atlas_publish_reforecast(uuid,integer,uuid,text),public.atlas_read_reforecast_workspace(uuid[]),public.atlas_read_active_reforecast(uuid[],text[]) from public,anon;
grant execute on function public.atlas_save_reforecast_upload(uuid,uuid,jsonb),public.atlas_save_reforecast_registry(uuid,uuid,uuid,jsonb),public.atlas_read_reforecast_source(uuid,text[],uuid[],uuid),public.atlas_save_reforecast_scenario(uuid,uuid,integer,uuid,text,jsonb),public.atlas_publish_reforecast(uuid,integer,uuid,text),public.atlas_read_reforecast_workspace(uuid[]),public.atlas_read_active_reforecast(uuid[],text[]) to authenticated;
commit;
