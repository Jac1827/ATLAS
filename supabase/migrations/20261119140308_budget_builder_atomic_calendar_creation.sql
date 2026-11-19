-- Creation and initial fiscal identity share the Budget VP authorization and transaction.
-- Existing aliases/canonical communities are read only; never infer their calendars.
create or replace function public.atlas_budget_builder_create_community(p_name text,p_units integer,p_property_type text,p_market text,p_development boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare cid uuid; canonical text; settings jsonb; classification text; start_month integer;
begin
 if auth.uid() is null or (not coalesce(atlas_private.is_budget_vp(auth.uid()),false) and not exists(select 1 from public.atlas_user_profiles where user_id=auth.uid() and status='active' and role='admin')) then raise exception 'Only the VP can add a community from Budget Builder';end if;
 if length(trim(coalesce(p_name,'')))<2 then raise exception 'Enter the community name';end if;
 if p_units is null or p_units<1 or p_units>20000 then raise exception 'Enter the number of units';end if;
 canonical:=trim(both '_' from lower(regexp_replace(trim(p_name),'[^a-zA-Z0-9]+','_','g')));
 if canonical='' then raise exception 'Enter the community name';end if;
 select a.community_id into cid from public.atlas_community_aliases a where a.active is true and lower(a.alias)=lower(trim(p_name)) limit 1;
 if cid is null then select c.community_id into cid from public.atlas_communities c where c.canonical_name=canonical;end if;
 if cid is null then
  if p_property_type in ('Student housing — by bed','Student housing — by apartment','Student Housing') then classification:='Student Housing';start_month:=8;
  elsif p_property_type in ('Conventional apartments','Townhomes','Manufactured housing','Military housing','Multifamily') then classification:='Multifamily';start_month:=1;
  else raise exception 'Select a supported asset class before adding a community';end if;
  settings:=jsonb_build_object('classification',classification,'startMonth',start_month,'verified',true,'source','Budget Builder community creation','ownerId',auth.uid(),'effectiveDate',current_date,'version',1,'reason','Initial fiscal calendar for a new Budget Builder community');
  insert into public.atlas_communities(canonical_name,display_name,source_module,source_identifier,source_hash,units,property_type,market,status,budget_calendar)
  values(canonical,trim(p_name),'budget_builder',trim(p_name),public.atlas_hash_payload(jsonb_build_object('community',trim(p_name))),p_units,trim(p_property_type),nullif(trim(p_market),''),case when p_development then 'development' else 'active' end,settings)
  on conflict(canonical_name) do nothing returning community_id into cid;
  if cid is not null then
   insert into public.atlas_community_aliases(community_id,alias,source_module) values(cid,trim(p_name),'budget_builder');
   insert into public.atlas_budget_calendar_events(community_id,before_settings,after_settings,actor_id,action,reason)
   values(cid,null,settings,auth.uid(),'initialized',settings->>'reason');
   return cid;
  end if;
  select c.community_id into cid from public.atlas_communities c where c.canonical_name=canonical;
 end if;
 if cid is null or not atlas_private.reforecast_access(cid,'read') or not exists(select 1 from public.atlas_communities where community_id=cid and deleted_at is null) then raise exception 'Community access denied';end if;
 return cid;
end;$$;
revoke all on function public.atlas_budget_builder_create_community(text,integer,text,text,boolean) from public,anon;
grant execute on function public.atlas_budget_builder_create_community(text,integer,text,text,boolean) to authenticated;
