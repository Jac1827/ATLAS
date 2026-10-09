begin;
create view public.atlas_command_plan_summaries with (security_invoker=true) as
select plan_id,community_id,period_key,version,updated_at,payload->>'stage' as stage,payload->>'owner' as owner,
 jsonb_array_length(payload->'tasks') as task_count,
 (select count(*) from jsonb_array_elements(payload->'tasks') t where t->>'status' in ('Completed','Verified')) as completed_count,
 (select count(*) from jsonb_array_elements(payload->'tasks') t where t->>'status'='Verified') as verified_count
from public.atlas_community_plans;
revoke all on public.atlas_command_plan_summaries from anon,authenticated;
grant select on public.atlas_command_plan_summaries to authenticated;
commit;
