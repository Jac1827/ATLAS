-- Extend the canonical Contract Manager records; source bytes remain in immutable upload receipts.
begin;
alter table public.atlas_contracts add column if not exists created_by uuid references auth.users(id);
create table public.atlas_forecast_contract_events(
 event_id uuid primary key default gen_random_uuid(),contract_id uuid not null references public.atlas_contracts(contract_id),community_id uuid not null references public.atlas_communities(community_id),
 version integer not null,request_id uuid not null unique,request_hash text not null,action text not null check(action in ('created','updated')),reason text not null,
 before_record jsonb,after_record jsonb not null,actor_id uuid not null references auth.users(id),actor_role text not null,created_at timestamptz not null default now(),unique(contract_id,version));
alter table public.atlas_forecast_contract_events enable row level security;
revoke all on public.atlas_forecast_contract_events from public,anon,authenticated;
grant select on public.atlas_forecast_contract_events to authenticated;
create policy forecast_contract_history_read on public.atlas_forecast_contract_events for select to authenticated using(atlas_private.reforecast_access(community_id));
create trigger forecast_contract_history_immutable before update or delete on public.atlas_forecast_contract_events for each row execute function atlas_private.finance_immutable();

create function public.atlas_save_forecast_contract(p_community_id uuid,p_contract_id uuid,p_expected_version integer,p_request_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.atlas_contracts;result public.atlas_contracts;event public.atlas_forecast_contract_events;role_name text;hash text;id uuid;vendor text;service text;starts date;ends date;contract_amount numeric;contract_status text;
begin
 if not atlas_private.reforecast_access(p_community_id) then raise exception 'Contract community access denied';end if;
 if p_request_id is null or p_expected_version is null or p_expected_version<0 or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>65536 or length(trim(coalesce(p_payload->>'reason','')))<3 then raise exception 'Contract expected version, request ID and change reason required';end if;
 select role into role_name from public.atlas_user_profiles where user_id=auth.uid() and status='active';
 perform pg_advisory_xact_lock(hashtextextended('forecast-contract:'||p_community_id,0));
 hash:=encode(sha256(convert_to(jsonb_build_array(p_community_id,p_contract_id,p_expected_version,p_payload)::text,'UTF8')),'hex');
 select * into event from public.atlas_forecast_contract_events where request_id=p_request_id;
 if event.event_id is not null then
 if event.actor_id<>auth.uid() or event.community_id<>p_community_id or event.request_hash<>hash then raise exception 'Contract request ID reused for different changes';end if;
 return event.after_record;end if;
 select * into previous from public.atlas_contracts where contract_id=p_contract_id for update;
 if previous.contract_id is not null and (previous.community_id is distinct from p_community_id or previous.deleted_at is not null) then raise exception 'Contract is outside the authorized community or retired';end if;
 if coalesce(previous.version,0)<>p_expected_version then raise exception 'Contract changed in another session. Keep your edits and reload before retrying';end if;
 if role_name not in ('admin','executive','regional','centra') and (previous.created_by is null or previous.created_by<>auth.uid()) then raise exception 'Contract editing requires Admin, executive, Regional, Central Services or the scoped record creator';end if;
 vendor:=trim(coalesce(p_payload->>'vendor',p_payload->>'vendorName',p_payload->>'vendor_name',''));
 if vendor='' or length(vendor)>300 then raise exception 'Enter the explicit contract vendor; unknown vendors are not inferred';end if;
 service:=nullif(trim(coalesce(p_payload->>'service',p_payload->>'contractType',p_payload->>'contract_type','')),'');
 starts:=nullif(coalesce(p_payload->>'effectiveDate',p_payload->>'startDate',p_payload->>'start_date'),'')::date;
 ends:=nullif(coalesce(p_payload->>'endDate',p_payload->>'end_date'),'')::date;
 contract_amount:=nullif(coalesce(p_payload->>'monthlyAmount',p_payload->>'amount'),'')::numeric;
 contract_status:=coalesce(nullif(p_payload->>'status',''),'active');
 if starts is not null and ends is not null and ends<starts then raise exception 'Contract end date precedes its effective date';end if;
 if contract_status not in ('active','draft','expired','terminated') or contract_amount is not null and abs(contract_amount)>1000000000000 then raise exception 'Invalid contract status or amount';end if;
 if previous.contract_id is null then
 id:=coalesce(p_contract_id,gen_random_uuid());
 insert into public.atlas_contracts(contract_id,community_id,vendor_name,contract_type,start_date,end_date,amount,status,source_module,source_identifier,source_hash,version,created_by)
 values(id,p_community_id,vendor,service,starts,ends,contract_amount,contract_status,'budget_builder',nullif(p_payload->>'sourceIdentifier',''),nullif(p_payload->>'sourceHash',''),1,auth.uid()) returning * into result;
 else
 update public.atlas_contracts set vendor_name=vendor,contract_type=service,start_date=starts,end_date=ends,amount=contract_amount,status=contract_status,version=version+1,updated_at=now()
 where contract_id=previous.contract_id returning * into result;
 end if;
 insert into public.atlas_forecast_contract_events(contract_id,community_id,version,request_id,request_hash,action,reason,before_record,after_record,actor_id,actor_role)
 values(result.contract_id,p_community_id,result.version,p_request_id,hash,case when previous.contract_id is null then 'created' else 'updated' end,p_payload->>'reason',case when previous.contract_id is not null then to_jsonb(previous) end,to_jsonb(result),auth.uid(),role_name);
 return to_jsonb(result);
end;$$;
create function public.atlas_read_forecast_contracts(p_community_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not atlas_private.reforecast_access(p_community_id) then raise exception 'Contract community access denied';end if;
 return (select coalesce(jsonb_agg(to_jsonb(c) order by c.vendor_name,c.contract_id),'[]') from public.atlas_contracts c where c.community_id=p_community_id and c.deleted_at is null);
end;$$;
revoke all on function public.atlas_save_forecast_contract(uuid,uuid,integer,uuid,jsonb),public.atlas_read_forecast_contracts(uuid) from public,anon;
grant execute on function public.atlas_save_forecast_contract(uuid,uuid,integer,uuid,jsonb),public.atlas_read_forecast_contracts(uuid) to authenticated;
commit;
