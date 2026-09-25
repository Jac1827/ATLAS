-- Owner decision: only Admin may publish financial data. Preserve the existing
-- checked publication implementation, including fiscal reconciliation and readback.
begin;
alter function public.atlas_publish_command_financials(uuid,text,integer,jsonb) set schema atlas_private;
revoke all on function atlas_private.atlas_publish_command_financials(uuid,text,integer,jsonb) from public,anon,authenticated;
create function public.atlas_publish_command_financials(p_community_id uuid,p_period text,p_expected_version integer,p_payload jsonb)
returns public.atlas_command_financial_summaries language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.atlas_user_profiles where user_id=auth.uid() and status='active' and role='admin') then
  raise exception 'Only an active Admin may publish financial data';
 end if;
 return atlas_private.atlas_publish_command_financials(p_community_id,p_period,p_expected_version,p_payload);
end;$$;
revoke all on function public.atlas_publish_command_financials(uuid,text,integer,jsonb) from public,anon;
grant execute on function public.atlas_publish_command_financials(uuid,text,integer,jsonb) to authenticated;
commit;
