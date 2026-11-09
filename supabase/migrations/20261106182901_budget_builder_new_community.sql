-- Budget Builder: start a budget for a community that is not in ATLAS yet.
-- Budget VPs only. Reuses the canonical community lookup (aliases, canonical name)
-- and records the unit count, property type and market when they are not already set.
create function public.atlas_budget_builder_create_community(p_name text,p_units integer,p_property_type text,p_market text,p_development boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare cid uuid;
begin
 if not atlas_private.is_budget_vp(auth.uid()) and not exists(select 1 from public.atlas_user_profiles where user_id=auth.uid() and status='active' and role='admin') then raise exception 'Only the VP can add a community from Budget Builder';end if;
 if length(trim(coalesce(p_name,'')))<2 then raise exception 'Enter the community name';end if;
 if p_units is null or p_units<1 or p_units>20000 then raise exception 'Enter the number of units';end if;
 cid:=public.atlas_lookup_or_create_community(trim(p_name),'budget_builder',true);
 if cid is null then raise exception 'The community could not be created';end if;
 update public.atlas_communities set units=coalesce(units,p_units),property_type=coalesce(property_type,nullif(trim(p_property_type),'')),market=coalesce(market,nullif(trim(p_market),'')),
  status=case when p_development and coalesce(status,'active')='active' and created_at>now()-interval '1 minute' then 'development' else status end,updated_at=now()
 where community_id=cid;
 return cid;
end;$$;
revoke all on function public.atlas_budget_builder_create_community(text,integer,text,text,boolean) from public,anon;
grant execute on function public.atlas_budget_builder_create_community(text,integer,text,text,boolean) to authenticated;
