begin;
-- No message bodies, attachments, recipient addresses, or arbitrary webhook JSON belong here.
create schema if not exists atlas_private;
create or replace function atlas_private.communication_access(cid uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(
 select 1 from public.atlas_user_profiles p join public.atlas_communities c on c.community_id=cid
 where p.user_id=auth.uid() and p.status='active' and p.account_status='active'
 and p.role in ('admin','centra','executive','regional','community_manager','people','marketing','maintenance','finance','bonus','viewer')
 and c.deleted_at is null and c.status='active' and public.atlas_can_access_community(cid)
 and (cardinality(p.allowed_community_ids)=0 or cid=any(p.allowed_community_ids))
 and (cardinality(p.allowed_market_values)=0 or lower(c.market)=any(array(select lower(v) from unnest(p.allowed_market_values) v)))
 and (cardinality(p.allowed_region_values)=0 or lower(c.regional_grouping)=any(array(select lower(v) from unnest(p.allowed_region_values) v)))
 and not ('15'=any(p.locked_tab_ids)) and not ('central_services'=any(p.locked_page_keys))
 and not ('resident_communications'=any(p.locked_page_keys)));
$$;
revoke all on function atlas_private.communication_access(uuid) from public,anon;
grant usage on schema atlas_private to authenticated,service_role;
grant execute on function atlas_private.communication_access(uuid) to authenticated;

-- Entrata owns canonical person/resident and lease identity. Application ID is not Person ID.
-- Existing application publication lacks person keys and verified endpoint evidence.
-- Adapter contract, deliberately empty until joined to the verified canonical resident/person
-- and current lease source. Replace the VIEW, never insert identity claims from the browser.
create view public.atlas_resident_communication_identity as
select null::uuid community_id,null::text resident_id,null::text lease_id,
 null::text display_name,null::text lease_context,null::text email,null::text phone_e164,
 false::boolean email_verified,false::boolean phone_verified,false::boolean current_lease
where false;
revoke all on public.atlas_resident_communication_identity from public,anon,authenticated;
grant select on public.atlas_resident_communication_identity to service_role;

create table public.atlas_chatwoot_inbox_routes(
 route_id uuid primary key default gen_random_uuid(),community_id uuid not null references public.atlas_communities,
 channel text not null check(channel in ('email','sms')),account_id bigint not null check(account_id>0),inbox_id bigint not null check(inbox_id>0),
 sending_number text check(sending_number ~ '^\+[1-9][0-9]{7,14}$'),mailbox text,
 timezone text,time_zone_verified_at timestamptz,verified_at timestamptz,active boolean not null default false,
 morning_resume time check(morning_resume<'19:00'),first_response_minutes integer check(first_response_minutes>0),
 follow_up_minutes integer check(follow_up_minutes>0),email_pilot_approved boolean not null default false,sms_pilot_approved boolean not null default false,
 unique(community_id,channel),check(channel<>'email' or lower(mailbox)='central@risere.com'),
 check(channel<>'sms' or sending_number is not null),
 check(not active or (verified_at is not null and timezone is not null and time_zone_verified_at is not null and first_response_minutes is not null and follow_up_minutes is not null)),
 check(not sms_pilot_approved or (channel='sms' and morning_resume is not null)),
 check(not email_pilot_approved or channel='email'));
create or replace function atlas_private.communication_route_check()
returns trigger language plpgsql security invoker set search_path='' as $$begin
 if new.timezone is not null and not exists(select 1 from pg_catalog.pg_timezone_names where name=new.timezone) then raise exception 'Timezone must be a verified IANA zone';end if;
 if new.active and exists(select 1 from public.atlas_chatwoot_inbox_routes r where r.community_id=new.community_id and r.route_id<>new.route_id and r.active and r.timezone is distinct from new.timezone) then raise exception 'Active community routes must use the same verified timezone';end if;
 return new;
end$$;
revoke all on function atlas_private.communication_route_check() from public,anon,authenticated;
create trigger communication_route_check before insert or update on public.atlas_chatwoot_inbox_routes for each row execute function atlas_private.communication_route_check();
create table public.atlas_chatwoot_contact_links(
 link_id uuid primary key default gen_random_uuid(),community_id uuid not null references public.atlas_communities,
 resident_id text not null,account_id bigint not null,contact_id bigint,
 identity_key text not null unique,sms_opted_out boolean not null default false,state text not null default 'pending' check(state in ('pending','linked','review')),
 created_at timestamptz not null default now(),unique(community_id,resident_id,account_id),unique(account_id,contact_id),
 unique(link_id,community_id,resident_id,account_id));
create table public.atlas_chatwoot_conversation_links(
 link_id uuid primary key default gen_random_uuid(),community_id uuid not null references public.atlas_communities,
 resident_id text not null,lease_id text not null,contact_link_id uuid not null,account_id bigint not null,
 conversation_id bigint,inbox_id bigint not null,channel text not null check(channel in ('email','sms')),
 state text not null default 'pending' check(state in ('pending','linked','review')),
 status text not null default 'open' check(status in ('open','pending','resolved','snoozed')),
 assignee_id bigint,unread_count integer not null default 0 check(unread_count>=0),urgent boolean not null default false,
 last_incoming_at timestamptz,last_response_at timestamptz,waiting_since timestamptz,follow_up_at timestamptz,
 delivery_failed boolean not null default false,last_event_at timestamptz,updated_at timestamptz not null default now(),
 foreign key(contact_link_id,community_id,resident_id,account_id) references public.atlas_chatwoot_contact_links(link_id,community_id,resident_id,account_id),
 unique(community_id,resident_id,lease_id,account_id,inbox_id),unique(account_id,conversation_id),
 unique(link_id,community_id));
create table public.atlas_chatwoot_delivery_states(
 community_id uuid not null references public.atlas_communities,conversation_link_id uuid not null,message_id bigint not null,
 status text not null check(status in ('sending','sent','delivered','read','failed')),event_at timestamptz not null,
 foreign key(conversation_link_id,community_id) references public.atlas_chatwoot_conversation_links(link_id,community_id),
 primary key(conversation_link_id,message_id));
create table public.atlas_resident_message_consent(
 consent_id uuid primary key default gen_random_uuid(),community_id uuid not null references public.atlas_communities,
 resident_id text not null,endpoint_fingerprint text not null,
 status text not null check(status in ('granted','revoked','ambiguous','absent')),source text not null,
 captured_at timestamptz,scope text not null check(scope in ('resident_service','none')),revoked_at timestamptz,
 evidence_reference text,updated_at timestamptz not null default now(),unique(community_id,resident_id,endpoint_fingerprint),
 check(status<>'granted' or (captured_at is not null and scope='resident_service' and revoked_at is null and evidence_reference is not null)));
create table public.atlas_chatwoot_webhook_receipts(
 fingerprint text primary key,event_type text not null check(event_type in ('message_created','message_updated','conversation_created','conversation_updated','conversation_status_changed')),
 account_id bigint not null,conversation_id bigint not null,received_at timestamptz not null default now());
create table public.atlas_resident_communication_alerts(
 alert_id uuid primary key default gen_random_uuid(),community_id uuid not null references public.atlas_communities,
 conversation_link_id uuid not null,kind text not null check(kind in ('unread','unassigned','first_response_overdue','follow_up_due','delivery_failed','urgent','consent_conflict')),
 priority integer not null check(priority between 1 and 7),active boolean not null default true,updated_at timestamptz not null default now(),
 foreign key(conversation_link_id,community_id) references public.atlas_chatwoot_conversation_links(link_id,community_id),unique(conversation_link_id,kind));
create table public.atlas_resident_communication_audit(
 audit_id uuid primary key default gen_random_uuid(),community_id uuid not null references public.atlas_communities,
 conversation_link_id uuid,actor_user_id uuid references auth.users,action text not null check(action ~ '^[a-z_]{1,60}$'),
 rule text check(rule ~ '^[a-z_]{1,60}$'),outcome text not null check(outcome in ('allowed','blocked','accepted','review','failed')),
 created_at timestamptz not null default now(),foreign key(conversation_link_id,community_id) references public.atlas_chatwoot_conversation_links(link_id,community_id));
create table public.atlas_chatwoot_operations(
 operation_key text primary key,community_id uuid not null references public.atlas_communities,actor_user_id uuid not null references auth.users,
 action text not null check(action in ('message','note','contact','conversation')),state text not null default 'pending' check(state in ('pending','accepted','review')),
 result_id bigint,created_at timestamptz not null default now());
create table public.atlas_chatwoot_agent_links(
 user_id uuid primary key references public.atlas_user_profiles,account_id bigint not null,agent_id bigint not null,unique(account_id,agent_id));

-- Explicit deny-all writes from browsers, including route/consent/identity administration.
-- Agent administration is mediated by Worker validation; deployment configuration is operator-only.
do $$declare t text;begin
 foreach t in array array['atlas_chatwoot_inbox_routes','atlas_chatwoot_contact_links','atlas_chatwoot_conversation_links','atlas_resident_message_consent','atlas_chatwoot_webhook_receipts','atlas_resident_communication_alerts','atlas_resident_communication_audit','atlas_chatwoot_operations','atlas_chatwoot_agent_links','atlas_chatwoot_delivery_states'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
 foreach t in array array['atlas_chatwoot_contact_links','atlas_chatwoot_conversation_links','atlas_resident_message_consent','atlas_resident_communication_alerts','atlas_resident_communication_audit'] loop
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy communication_scoped_read on public.%I for select to authenticated using(atlas_private.communication_access(community_id))',t);
 end loop;
end$$;
create index on public.atlas_resident_communication_alerts(community_id,active,priority);
create index on public.atlas_chatwoot_conversation_links(community_id,updated_at desc);

create or replace function public.atlas_communication_access(p_community_id uuid)
returns boolean language sql stable security invoker set search_path='' as $$select atlas_private.communication_access(p_community_id)$$;
revoke all on function public.atlas_communication_access(uuid) from public,anon;
grant execute on function public.atlas_communication_access(uuid) to authenticated;

-- Minimum community labels for all communication roles, without broadening base-table RLS.
create or replace function public.atlas_communication_communities()
returns table(community_id uuid,display_name text) language sql stable security definer set search_path='' as $$
 select c.community_id,c.display_name from public.atlas_communities c
 where atlas_private.communication_access(c.community_id) order by c.display_name;
$$;
revoke all on function public.atlas_communication_communities() from public,anon;
grant execute on function public.atlas_communication_communities() to authenticated;

-- Aggregate counts remain scoped through the invoker's SELECT RLS.
create or replace function public.atlas_communication_alert_summary()
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('revision',(select max(updated_at) from public.atlas_chatwoot_conversation_links where state='linked'),'total',(select count(*) from public.atlas_resident_communication_alerts where active),
 'conversation_count',(select count(distinct conversation_link_id) from public.atlas_resident_communication_alerts where active),
 'alerts',coalesce((select jsonb_agg(to_jsonb(a)) from (
 select alert_id,community_id,conversation_link_id,kind,priority,updated_at from public.atlas_resident_communication_alerts
 where active order by priority,updated_at limit 100) a),'[]'::jsonb));
$$;
revoke all on function public.atlas_communication_alert_summary() from public,anon;
grant execute on function public.atlas_communication_alert_summary() to authenticated;

create or replace function public.atlas_communication_refresh_alerts(p_link_id uuid default null,p_touch boolean default false)
returns void language plpgsql security invoker set search_path='' as $$
declare c record;k text;enabled boolean;rank integer;
begin
 for c in select l.*,r.first_response_minutes,r.follow_up_minutes from public.atlas_chatwoot_conversation_links l
 join public.atlas_chatwoot_inbox_routes r on r.community_id=l.community_id and r.channel=l.channel
 where l.state='linked' and (p_link_id is null or l.link_id=p_link_id) loop
 foreach k in array array['urgent','consent_conflict','delivery_failed','first_response_overdue','follow_up_due','unassigned','unread'] loop
 rank:=array_position(array['urgent','consent_conflict','delivery_failed','first_response_overdue','follow_up_due','unassigned','unread'],k);
 enabled:=case k
 when 'urgent' then c.urgent
 when 'consent_conflict' then exists(select 1 from public.atlas_chatwoot_contact_links cl where cl.link_id=c.contact_link_id and cl.sms_opted_out) or exists(select 1 from public.atlas_resident_message_consent s where s.community_id=c.community_id and s.resident_id=c.resident_id and s.status in ('revoked','ambiguous'))
 when 'delivery_failed' then c.delivery_failed
 when 'first_response_overdue' then c.waiting_since is not null and c.first_response_minutes is not null and now()>=c.waiting_since+make_interval(mins=>c.first_response_minutes)
 when 'follow_up_due' then c.follow_up_at is not null and now()>=c.follow_up_at
 when 'unassigned' then c.assignee_id is null
 when 'unread' then c.unread_count>0 else false end;
 enabled:=coalesce(enabled,false) and (c.status<>'resolved' or k in ('consent_conflict','delivery_failed'));
 insert into public.atlas_resident_communication_alerts(community_id,conversation_link_id,kind,priority,active)
 values(c.community_id,c.link_id,k,rank,enabled)
 on conflict(conversation_link_id,kind) do update set active=excluded.active,updated_at=now()
 where atlas_resident_communication_alerts.active is distinct from excluded.active or (p_touch and excluded.active);
 end loop;
 end loop;
end$$;

-- Revoke before any upstream request so a Chatwoot outage cannot delay STOP blocking.
create or replace function public.atlas_communication_record_opt_out(p_link_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare l public.atlas_chatwoot_conversation_links;
begin
 select * into l from public.atlas_chatwoot_conversation_links where link_id=p_link_id and channel='sms' and state='linked' for update;
 if l.link_id is null then raise exception 'Unknown SMS conversation';end if;
 update public.atlas_chatwoot_contact_links set sms_opted_out=true where link_id=l.contact_link_id;
 update public.atlas_resident_message_consent set status='revoked',revoked_at=coalesce(revoked_at,now()),source='chatwoot_provider_opt_out',updated_at=now()
 where community_id=l.community_id and resident_id=l.resident_id;
 perform public.atlas_communication_refresh_alerts(l.link_id,true);
end$$;
revoke all on function public.atlas_communication_record_opt_out(uuid) from public,anon,authenticated;
grant execute on function public.atlas_communication_record_opt_out(uuid) to service_role;

-- Transactional receipt + projection + consent revoke + alerts. No complete payload accepted.
create or replace function public.atlas_communication_apply_event(
 p_fingerprint text,p_event_type text,p_link_id uuid,p_event_at timestamptz,p_status text,
 p_assignee_id bigint,p_unread integer,p_urgent boolean,p_delivery_failed boolean,
 p_incoming boolean,p_outgoing boolean,p_opt_out boolean,p_message_id bigint default null,p_delivery_status text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare l public.atlas_chatwoot_conversation_links;r public.atlas_chatwoot_inbox_routes; inserted integer;
begin
 select * into l from public.atlas_chatwoot_conversation_links where link_id=p_link_id and state='linked' for update;
 if l.link_id is null then raise exception 'Unknown conversation';end if;
 insert into public.atlas_chatwoot_webhook_receipts(fingerprint,event_type,account_id,conversation_id)
 values(p_fingerprint,p_event_type,l.account_id,l.conversation_id) on conflict do nothing;
 get diagnostics inserted=row_count;if inserted=0 then return false;end if;
 -- Opt-out always wins, including out-of-order deliveries.
 if p_opt_out then
 update public.atlas_chatwoot_contact_links set sms_opted_out=true where link_id=l.contact_link_id;
 update public.atlas_resident_message_consent set status='revoked',revoked_at=now(),source='chatwoot_provider_opt_out',updated_at=now()
 where community_id=l.community_id and resident_id=l.resident_id;
 end if;
 if p_message_id is not null and p_delivery_status is not null then
 insert into public.atlas_chatwoot_delivery_states(community_id,conversation_link_id,message_id,status,event_at)
 values(l.community_id,l.link_id,p_message_id,p_delivery_status,p_event_at)
 on conflict(conversation_link_id,message_id) do update set status=excluded.status,event_at=excluded.event_at
 where atlas_chatwoot_delivery_states.event_at<=excluded.event_at;
 end if;
 update public.atlas_chatwoot_conversation_links set delivery_failed=exists(
 select 1 from public.atlas_chatwoot_delivery_states where conversation_link_id=l.link_id and status='failed') where link_id=l.link_id;
 select * into r from public.atlas_chatwoot_inbox_routes where community_id=l.community_id and channel=l.channel;
 -- Message lifecycle clocks are independent of delivery/status events. A delayed
 -- inbound message must still start a response clock after a newer delivery receipt.
 update public.atlas_chatwoot_conversation_links set
 last_incoming_at=case when p_incoming then greatest(last_incoming_at,p_event_at) else last_incoming_at end,
 last_response_at=case when p_outgoing then greatest(last_response_at,p_event_at) else last_response_at end,
 waiting_since=case when p_status='resolved' then null
 when p_incoming and (last_response_at is null or p_event_at>last_response_at) then least(coalesce(waiting_since,p_event_at),p_event_at)
 when p_outgoing and (last_incoming_at is null or p_event_at>=last_incoming_at) then null else waiting_since end,
 follow_up_at=case when p_status='resolved' or (p_incoming and (last_response_at is null or p_event_at>last_response_at)) then null
 when p_outgoing and (last_response_at is null or p_event_at>=last_response_at) and (last_incoming_at is null or p_event_at>=last_incoming_at)
 and r.follow_up_minutes is not null then p_event_at+make_interval(mins=>r.follow_up_minutes) else follow_up_at end
 where link_id=l.link_id;
 if l.last_event_at is null or p_event_at>=l.last_event_at then
 update public.atlas_chatwoot_conversation_links set status=p_status,assignee_id=p_assignee_id,
 unread_count=greatest(0,p_unread),urgent=p_urgent,last_event_at=p_event_at,updated_at=now() where link_id=l.link_id;
 end if;
 perform public.atlas_communication_refresh_alerts(l.link_id,true);
 return true;
end$$;

create or replace function public.atlas_communication_claim_operation(p_key text,p_community_id uuid,p_actor uuid,p_action text)
returns boolean language plpgsql security invoker set search_path='' as $$declare n integer;begin
 insert into public.atlas_chatwoot_operations(operation_key,community_id,actor_user_id,action)
 values(p_key,p_community_id,p_actor,p_action) on conflict do nothing;
 get diagnostics n=row_count;return n=1;
end$$;
revoke all on function public.atlas_communication_refresh_alerts(uuid,boolean),public.atlas_communication_apply_event(text,text,uuid,timestamptz,text,bigint,integer,boolean,boolean,boolean,boolean,boolean,bigint,text),public.atlas_communication_claim_operation(text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.atlas_communication_refresh_alerts(uuid,boolean),public.atlas_communication_apply_event(text,text,uuid,timestamptz,text,bigint,integer,boolean,boolean,boolean,boolean,boolean,bigint,text),public.atlas_communication_claim_operation(text,uuid,uuid,text) to service_role;
-- In managed Supabase, Postgres Changes applies SELECT RLS to each subscriber.
do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
 alter publication supabase_realtime add table public.atlas_resident_communication_alerts;
 end if;
end$$;

-- Monthly Entrata workbook source: reuse the existing scoped, versioned publication.
grant execute on function atlas_private.application_timestamp(text) to service_role;
create or replace function atlas_private.publish_applications(p_upload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ids uuid[]; cid uuid; groups jsonb := '{}'; cleaned jsonb;
 meta jsonb; digest text; existing public.atlas_application_imports; result jsonb := '[]'; g record; community_name text;
 resolved_properties jsonb := '{}'; property_key text;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_upload->>'validationStatus' is distinct from 'valid' or
    jsonb_typeof(p_upload->'records') is distinct from 'array' or
    coalesce(jsonb_array_length(p_upload->'records'),0)=0 or
    coalesce(jsonb_array_length(p_upload->'records'),0)>20000 or
    coalesce(p_upload->>'reportPeriodKey','') !~ '^\d{4}-(0[1-9]|1[0-2])$' or
    nullif(p_upload->>'sourceAsOf','') is null then
   raise exception 'Accepted records, reporting period and source-effective date are required';
 end if;
 perform (p_upload->>'sourceAsOf')::timestamptz;
 meta := jsonb_build_object('schemaVersion',2,'sourceType','application-resident-workbook','sourceReport','Application / Resident Data',
   'sourceFilters',coalesce(p_upload->'sourceFilters','{}'::jsonb),'sourceVersion',p_upload->>'sourceVersion','sourceAsOf',p_upload->>'sourceAsOf','reportPeriodKey',p_upload->>'reportPeriodKey');
 if exists(select 1 from jsonb_array_elements(p_upload->'records') r
   where nullif(trim(r->>'applicationId'),'') is null or nullif(trim(r->>'propertySource'),'') is null
      or r->>'mappingStatus' is distinct from 'mapped' or coalesce((r->>'duplicateReview')::boolean,false)) then
   raise exception 'Unresolved application record';
 end if;
 for property_key in select distinct lower(trim(value->>'propertySource')) from jsonb_array_elements(p_upload->'records') loop
   select array_agg(distinct c.community_id) into ids from public.atlas_communities c
   left join public.atlas_community_aliases a on a.community_id=c.community_id and a.active
   where c.deleted_at is null and (property_key in (lower(c.display_name),lower(c.canonical_name))
     or property_key=lower(a.alias));
   if coalesce(cardinality(ids),0)<>1 then raise exception 'Source community requires an approved unambiguous central mapping'; end if;
   cid:=ids[1];
   if not atlas_private.application_access(cid,true) then raise exception 'Community publication denied' using errcode='42501'; end if;
   select display_name into community_name from public.atlas_communities where community_id=cid;
   resolved_properties := jsonb_set(resolved_properties,array[property_key],jsonb_build_object('id',cid,'name',community_name));
 end loop;
 -- Aggregate once rather than copying the growing portfolio JSON for every row.
 select jsonb_object_agg(community_id,records) into groups from (
   select mapping->>'id' as community_id,
     jsonb_agg(sanitized.fields || jsonb_build_object('canonicalCommunityId',mapping->>'id','communityId',mapping->>'id',
       'communityName',mapping->>'name','atlasName',mapping->>'name','reportPeriodKey',p_upload->>'reportPeriodKey')) as records
   from jsonb_array_elements(p_upload->'records') as source(r)
   cross join lateral (select resolved_properties->lower(trim(r->>'propertySource')) as mapping) resolved
   cross join lateral (
     select coalesce(jsonb_object_agg(key,value),'{}') as fields from jsonb_each(r)
     where key=any(array['applicationId','personId','residentId','propertySource','mappingStatus','sourceSheetName','sourceRowNumber',
       'applicationStartedAt','applicationCompletedAt','sourceColumns','applicationStartedOn','applicationApprovedOn','applicationDeniedOn','applicationCancelledOn','applicationCompletedCancelledOn','applicationApprovedCancelledOn','leaseSignedOn','leaseExecutedOn','denialReason','cancellationReason','reportPeriodKey','reportMonth','residentName','applicationStatus','leasingAgent','leadSource',
       'newLeadCreatedOn','applicationPartiallyCompletedOn','applicationCompletedOn','firstVisitTourDate',
       'occupantType','leaseId','leaseStatus','scheduledRent','buildingUnit','primaryPhone','additionalPhoneNumbers',
       'email','currentLeaseStart','currentLeaseEnd','moveInDate','sourceTimestamps','statusClassification','duplicateReview','notes'])
   ) sanitized
   group by mapping->>'id'
 ) grouped;
 -- Stable order prevents deadlocks; transaction locks also serialize first insertion.
 for g in select key,value from jsonb_each(groups) order by key loop
   cid:=g.key::uuid;
   if exists(select 1 from jsonb_array_elements(g.value) x group by x->>'applicationId' having count(*)>1) then
     raise exception 'Duplicate community/application identity requires review';
   end if;
   select jsonb_agg(value order by value->>'applicationId') into cleaned from jsonb_array_elements(g.value);
   digest:=encode(sha256(convert_to((meta||jsonb_build_object('records',cleaned))::text,'UTF8')),'hex');
   perform pg_advisory_xact_lock(hashtextextended('atlas-applications:'||cid::text,0));
   select * into existing from public.atlas_application_imports where community_id=cid and content_hash=digest;
   if not found then
     insert into public.atlas_application_imports(community_id,content_hash,source_metadata,records,created_by,updated_by)
     values(cid,digest,meta||jsonb_build_object('fileName',p_upload->>'fileName'),cleaned,auth.uid(),auth.uid()) returning * into existing;
     insert into public.atlas_application_import_versions(import_id,version,community_id,action,actor_id)
     values(existing.import_id,1,cid,'publish',auth.uid());
   end if;
   -- Duplicate publication never restores a tombstone.
   result:=result||jsonb_build_array(to_jsonb(existing));
 end loop;
 return jsonb_build_object('imports',result);
end;
$$;
revoke all on function atlas_private.publish_applications(jsonb) from public,anon;
grant execute on function atlas_private.publish_applications(jsonb) to authenticated;
create or replace function public.atlas_publish_application_import(p_upload jsonb)
returns jsonb language sql security invoker set search_path='' as $$
 select atlas_private.publish_applications(p_upload);
$$;
revoke all on function public.atlas_publish_application_import(jsonb) from public,anon;
grant execute on function public.atlas_publish_application_import(jsonb) to authenticated;




-- Reviewed lineage and endpoint attestations contain IDs and hashes only. Browser
-- uploads cannot mark endpoints verified or assert a current lease. Review is an
-- operator/server process until the actual report contract is accepted.
create table public.atlas_entrata_communication_identity_reviews(
 community_id uuid not null references public.atlas_communities,
 resident_id text not null check(length(resident_id)>0),lease_id text not null check(length(lease_id)>0),
 source_import_id uuid not null references public.atlas_application_imports,
 application_id text not null check(length(application_id)>0),
 verified_at timestamptz not null,valid_until timestamptz not null,
 evidence_reference text not null check(length(evidence_reference)>0),
 email_fingerprint text check(email_fingerprint ~ '^[a-f0-9]{64}$'),
 phone_fingerprint text check(phone_fingerprint ~ '^[a-f0-9]{64}$'),
 primary key(community_id,resident_id),check(valid_until>verified_at));
alter table public.atlas_entrata_communication_identity_reviews enable row level security;
revoke all on public.atlas_entrata_communication_identity_reviews from public,anon,authenticated;
grant select,insert,update,delete on public.atlas_entrata_communication_identity_reviews to service_role;
-- Latest source-effective snapshot wins. Equal-date conflicting publications,
-- missing/deleted rows, changed leases, and expired attestations fail closed.
create or replace view public.atlas_resident_communication_identity as
with snapshots as (
 select i.*,rank() over(partition by community_id order by atlas_private.application_timestamp(source_metadata->>'sourceAsOf') desc nulls last) freshness
 from public.atlas_application_imports i
), latest as (
 select * from snapshots s where freshness=1 and deleted_at is null and
 (select count(*) from snapshots other where other.community_id=s.community_id and freshness=1)=1
), rows as (
 select i.import_id,i.community_id,r,
 coalesce(nullif(trim(r->>'personId'),''),nullif(trim(r->>'residentId'),'')) person_key
 from latest i cross join lateral jsonb_array_elements(i.records) r
 where not (nullif(trim(r->>'personId'),'') is not null and nullif(trim(r->>'residentId'),'') is not null and trim(r->>'personId')<>trim(r->>'residentId'))
)
select v.community_id,v.resident_id,v.lease_id,r->>'residentName' display_name,
 r->>'buildingUnit' lease_context,r->>'email' email,
 case when r->>'primaryPhone' ~ '^\+[1-9][0-9]{7,14}$' then r->>'primaryPhone' end phone_e164,
 v.email_fingerprint=encode(sha256(convert_to(coalesce(r->>'email',''),'UTF8')),'hex') email_verified,
 v.phone_fingerprint=encode(sha256(convert_to(coalesce(r->>'primaryPhone',''),'UTF8')),'hex') phone_verified,
 true current_lease
from public.atlas_entrata_communication_identity_reviews v join rows x
 on x.community_id=v.community_id and x.import_id=v.source_import_id and x.person_key=v.resident_id
 and x.r->>'leaseId'=v.lease_id and x.r->>'applicationId'=v.application_id
where v.verified_at<=now() and v.valid_until>now() and
 (select count(*) from rows other where other.community_id=x.community_id and other.person_key=x.person_key)=1;
revoke all on public.atlas_resident_communication_identity from public,anon,authenticated;
grant select on public.atlas_resident_communication_identity to service_role;

commit;
