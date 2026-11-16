begin;
create table public.atlas_command_report_deliveries(
 delivery_id uuid primary key default gen_random_uuid(),report_id uuid not null references public.atlas_community_plan_reports(report_id),community_id uuid not null references public.atlas_communities(community_id),
 recipients text[] not null,status text not null default 'claimed' check(status in ('claimed','sent','unknown')),provider_message_id text,requested_by uuid not null references auth.users(id),created_at timestamptz not null default now(),sent_at timestamptz);
create index command_delivery_report on public.atlas_command_report_deliveries(report_id);
alter table public.atlas_command_report_deliveries enable row level security;
create policy command_delivery_read on public.atlas_command_report_deliveries for select to authenticated using(atlas_private.command_access(community_id,'edit'));
revoke all on public.atlas_command_report_deliveries from anon,authenticated;
grant select on public.atlas_command_report_deliveries to authenticated;
grant select,update on public.atlas_command_report_deliveries to service_role;
create function public.atlas_claim_command_report_delivery(p_report_id uuid,p_recipients text[]) returns public.atlas_command_report_deliveries language plpgsql security definer set search_path='' as $$
declare report public.atlas_community_plan_reports; result public.atlas_command_report_deliveries; v_recipients text[];
begin
 select * into report from public.atlas_community_plan_reports where report_id=p_report_id;
 if report.report_id is null or not atlas_private.command_access(report.community_id,'edit') then raise exception 'Report delivery access denied';end if;
 select array_agg(distinct lower(trim(email)) order by lower(trim(email))) into v_recipients from unnest(p_recipients) email;
 if coalesce(cardinality(v_recipients),0)<1 or cardinality(v_recipients)>20 or exists(select 1 from unnest(v_recipients) email where email !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$' or length(email)>254) then raise exception 'Choose 1 to 20 valid recipients';end if;
 if exists(select 1 from unnest(v_recipients) email where email not like '%@risere.com') and not exists(select 1 from public.atlas_user_profiles where user_id=auth.uid() and role in ('admin','executive')) then raise exception 'External investor delivery requires Admin or Executive permission';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_report_id::text||':delivery',0));
 if exists(select 1 from public.atlas_command_report_deliveries d where d.report_id=p_report_id and d.recipients && v_recipients) then raise exception 'A delivery for this report and recipient is already recorded; verify its status before any resend';end if;
 insert into public.atlas_command_report_deliveries(report_id,community_id,recipients,requested_by) values(p_report_id,report.community_id,v_recipients,auth.uid()) returning * into result;
 return result;
end;$$;
revoke all on function public.atlas_claim_command_report_delivery(uuid,text[]) from public,anon;
grant execute on function public.atlas_claim_command_report_delivery(uuid,text[]) to authenticated;
commit;
