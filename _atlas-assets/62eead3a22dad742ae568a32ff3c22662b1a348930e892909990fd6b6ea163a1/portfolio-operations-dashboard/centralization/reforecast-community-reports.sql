-- Freeze the active operating benchmark with each newly generated Community Plan report.
begin;
create or replace function public.atlas_generate_community_plan_report(p_plan_id uuid,p_expected_version integer,p_note text default '',p_occupancy jsonb default null)
returns public.atlas_community_plan_reports language plpgsql security definer set search_path='' as $$
declare plan public.atlas_community_plans; result public.atlas_community_plan_reports; financial jsonb; occupancy jsonb; occupied numeric; rentable numeric; target numeric; prior public.atlas_community_plan_reports; previous jsonb; review jsonb; approved_goals jsonb; active_reforecast jsonb;
begin
 select * into plan from public.atlas_community_plans where plan_id=p_plan_id for share;
 if plan.plan_id is null or not atlas_private.command_access(plan.community_id,'edit') then raise exception 'Plan report access denied';end if;
 if plan.version is distinct from p_expected_version then raise exception 'Plan changed in another session; reload before reporting';end if;
 review:=coalesce(plan.payload->'reportReview','{}');
 if length(coalesce(review->>'topCauses',''))>2000 or length(coalesce(review->>'materialRisks',''))>2000 or (coalesce(review->>'expectedResolutionDate','')<>'' and review->>'expectedResolutionDate' !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-[0-9]{2}$') then raise exception 'Invalid report review';end if;
 if p_note is null or length(p_note)>4000 then raise exception 'Invalid executive note';end if;
 select jsonb_build_object('publicationId',publication_id,'summary',summary-'close') into financial from public.atlas_read_finance(array[plan.community_id],array[plan.period_key]);
 if p_occupancy is not null and p_occupancy<>'null'::jsonb then
  if p_occupancy->>'communityId' is distinct from plan.community_id::text or p_occupancy->>'period' is distinct from plan.period_key or jsonb_typeof(p_occupancy->'occupiedUnits') is distinct from 'number' or jsonb_typeof(p_occupancy->'rentableUnits') is distinct from 'number' or coalesce(p_occupancy->>'source','')='' or coalesce(p_occupancy->>'sourceTimestamp','')='' or coalesce(p_occupancy->>'revisionKey','')='' then raise exception 'Verified period-specific occupancy source required';end if;
  occupied:=(p_occupancy->>'occupiedUnits')::numeric;rentable:=(p_occupancy->>'rentableUnits')::numeric;
  if rentable<=0 or occupied<0 or occupied>rentable or trunc(occupied)<>occupied or trunc(rentable)<>rentable then raise exception 'Invalid occupancy source counts';end if;
  target:=ceil((financial->'summary'->>'occupancyPct')::numeric*rentable/100);
  occupancy:=jsonb_build_object('occupiedUnits',occupied,'rentableUnits',rentable,'physicalPct',occupied/rentable*100,'budgetPct',financial->'summary'->'occupancyPct','budgetUnits',target,'variance',occupied-target,'source',p_occupancy->'source','sourceTimestamp',p_occupancy->'sourceTimestamp','revisionKey',p_occupancy->'revisionKey');
 end if;
 select value into active_reforecast from jsonb_array_elements(public.atlas_read_active_reforecast(array[plan.community_id],array[plan.period_key])) where value->'activePeriods' ? plan.period_key limit 1;
 approved_goals:=atlas_private.community_goal_for_period(plan.community_id,plan.period_key);
 perform pg_advisory_xact_lock(hashtextextended(p_plan_id::text||':report',0));
 select * into result from public.atlas_community_plan_reports where snapshot->>'reportSchemaVersion'='5' and plan_id=p_plan_id and plan_version=plan.version and executive_note=p_note and (snapshot->'financial') is not distinct from coalesce(financial,'null'::jsonb) and (snapshot->'occupancy') is not distinct from coalesce(occupancy,'null'::jsonb) and (snapshot->'activeReforecast') is not distinct from coalesce(active_reforecast,'null'::jsonb) and (snapshot->'approvedGoals') is not distinct from coalesce(approved_goals,'null'::jsonb) order by created_at limit 1;
 if result.report_id is not null then return result;end if;
 select * into prior from public.atlas_community_plan_reports where community_id=plan.community_id and snapshot->>'period'<=plan.period_key order by created_at desc,report_id desc limit 1;
 if prior.report_id is not null then previous:=jsonb_build_object('reportId',prior.report_id,'period',prior.snapshot->'period','generatedAt',prior.created_at,'financial',prior.snapshot->'financial','occupancy',prior.snapshot->'occupancy','tasks',(select coalesce(jsonb_agg(jsonb_build_object('id',t->'id','status',t->'status')),'[]') from jsonb_array_elements(prior.snapshot->'plan'->'tasks') t));end if;
 insert into public.atlas_community_plan_reports(plan_id,community_id,plan_version,executive_note,snapshot,created_by)
 values(plan.plan_id,plan.community_id,plan.version,p_note,jsonb_build_object('reportSchemaVersion',5,'activeReforecast',active_reforecast,'approvedGoals',approved_goals,'previousReport',previous,'review',review,'plan',plan.payload,'period',plan.period_key,'sourceUpdatedAt',plan.updated_at,'community',(select display_name from public.atlas_communities where community_id=plan.community_id),'financial',financial,'occupancy',occupancy,'coverage',case when occupancy is null then 'Operational occupancy source is unavailable in this snapshot. ' else 'Occupancy uses the retained period-specific source revision. ' end||'Missing or incomplete financial coverage must be resolved in Budget Builder; underspend does not establish true savings.'),auth.uid()) returning * into result;
 return result;
end;$$;
revoke all on function public.atlas_generate_community_plan_report(uuid,integer,text,jsonb) from public,anon;
grant execute on function public.atlas_generate_community_plan_report(uuid,integer,text,jsonb) to authenticated;
commit;
