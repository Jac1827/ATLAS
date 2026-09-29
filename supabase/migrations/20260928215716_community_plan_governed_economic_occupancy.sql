-- Retain the governed closed economic occupancy in each immutable report.
-- This is independent of physical occupancy and never reads browser MTD proxies.
begin;
create function atlas_private.economic_close_amount(value jsonb)
returns numeric language plpgsql immutable security invoker set search_path='' as $$
declare text_value text; finite_value double precision;
begin
 if jsonb_typeof(value) not in ('number','string') then return null;end if;
 text_value:=trim(value#>>'{}');
 if text_value is null or text_value='' then return null;end if;
 finite_value:=text_value::double precision;
 if finite_value in ('Infinity'::double precision,'-Infinity'::double precision,'NaN'::double precision) then return null;end if;
 return text_value::numeric;
exception when invalid_text_representation or numeric_value_out_of_range then return null;
end;$$;
revoke all on function atlas_private.economic_close_amount(jsonb) from public,anon,authenticated;

create function atlas_private.community_closed_economic_occupancy(cid uuid,selected_period text,current_period text default to_char(statement_timestamp() at time zone 'UTC','YYYY-MM'))
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare is_open boolean;eligible_through text;periods text[];r record;e jsonb;c jsonb;nri numeric;gpr numeric;result jsonb;revised boolean:=false;
begin
 if auth.uid() is null or not atlas_private.command_access(cid) then raise exception 'Community economic occupancy access denied';end if;
 if selected_period is null or selected_period!~'^20[0-9]{2}-(0[1-9]|1[0-2])$' or current_period is null or current_period!~'^20[0-9]{2}-(0[1-9]|1[0-2])$' then raise exception 'Valid selected and current accounting periods required';end if;
 is_open:=selected_period>=current_period;
 eligible_through:=case when is_open then to_char((current_period||'-01')::date-interval '1 month','YYYY-MM') else selected_period end;
 if is_open then
  select array_agg(to_char((eligible_through||'-01')::date-i*interval '1 month','YYYY-MM') order by i) into periods from generate_series(0,11)i;
 else periods:=array[selected_period];end if;
 result:=jsonb_build_object('selectedPeriod',selected_period,'currentPeriod',current_period,'displayedClosePeriod',null,'state',case when is_open then 'open_month_no_prior_close' else 'missing_historical_close' end,'closedPct',null,'closeVersionId',null,'source',null,'sourceHash',null,'approvedBy',null,'approvedAt',null,'netRentalIncome',null,'grossPotentialRent',null);
 -- The canonical read binds close metrics to the same current publication and
 -- carries reopened state. It also enforces the caller's community access.
 for r in select f.* from public.atlas_read_finance(array[cid],periods)f order by f.period_key desc loop
  e:=r.summary;c:=e->'close';
  if r.community_id is distinct from cid or not(r.period_key=any(periods)) or e->>'period' is distinct from r.period_key or c->>'period_key' is distinct from r.period_key then continue;end if;
  if e->>'periodState' in ('reopened','superseded') or e->>'status' in ('reopened','superseded') or c->>'status' in ('reopened','superseded') or (e ? 'actualCloseVersion' and e->>'actualCloseVersion' is distinct from c->>'version_id') then revised:=true;continue;end if;
  if c->>'community_id' is distinct from cid::text or c->>'status' is distinct from 'closed' or c->>'coverage' is distinct from 'full_month' or nullif(trim(c->>'source_file'),'') is null or nullif(trim(c->>'approved_by'),'') is null or nullif(trim(c->>'approved_at'),'') is null then continue;end if;
  nri:=atlas_private.economic_close_amount(c->'metrics'->'netRentalIncome');gpr:=atlas_private.economic_close_amount(c->'metrics'->'grossPotentialRent');
  if nri is null or gpr is null or gpr<=0 then continue;end if;
  return result||jsonb_build_object('displayedClosePeriod',r.period_key,'state',case when is_open then 'open_month_latest_close' else 'closed_exact' end,'closedPct',nri::double precision/gpr::double precision*100::double precision,'closeVersionId',c->'version_id','source',c->'source_file','sourceHash',c->'source_hash','approvedBy',c->'approved_by','approvedAt',c->'approved_at','netRentalIncome',nri,'grossPotentialRent',gpr);
 end loop;
 if revised then result:=result||jsonb_build_object('state','reopened_or_superseded');end if;
 return result;
end;$$;
revoke all on function atlas_private.community_closed_economic_occupancy(uuid,text,text) from public,anon,authenticated;

create or replace function public.atlas_generate_community_plan_report(p_plan_id uuid,p_expected_version integer,p_note text default '',p_occupancy jsonb default null)
returns public.atlas_community_plan_reports language plpgsql security definer set search_path='' as $$
declare plan public.atlas_community_plans; result public.atlas_community_plan_reports; financial jsonb; occupancy jsonb; occupied numeric; rentable numeric; target numeric; prior public.atlas_community_plan_reports; previous jsonb; review jsonb; approved_goals jsonb; active_reforecast jsonb;closed_economic_occupancy jsonb;
begin
 select * into plan from public.atlas_community_plans where plan_id=p_plan_id for share;
 if auth.uid() is null or plan.plan_id is null or not atlas_private.command_access(plan.community_id,'edit') then raise exception 'Plan report access denied';end if;
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
 closed_economic_occupancy:=atlas_private.community_closed_economic_occupancy(plan.community_id,plan.period_key);
 select value into active_reforecast from jsonb_array_elements(public.atlas_read_active_reforecast(array[plan.community_id],array[plan.period_key])) where value->'activePeriods' ? plan.period_key limit 1;
 approved_goals:=atlas_private.community_goal_for_period(plan.community_id,plan.period_key);
 perform pg_advisory_xact_lock(hashtextextended(p_plan_id::text||':report',0));
 select * into result from public.atlas_community_plan_reports where snapshot->>'reportSchemaVersion'='6' and plan_id=p_plan_id and plan_version=plan.version and executive_note=p_note and (snapshot->'financial') is not distinct from coalesce(financial,'null'::jsonb) and (snapshot->'occupancy') is not distinct from coalesce(occupancy,'null'::jsonb) and (snapshot->'closedEconomicOccupancy') is not distinct from closed_economic_occupancy and (snapshot->'activeReforecast') is not distinct from coalesce(active_reforecast,'null'::jsonb) and (snapshot->'approvedGoals') is not distinct from coalesce(approved_goals,'null'::jsonb) order by created_at limit 1;
 if result.report_id is not null then return result;end if;
 select * into prior from public.atlas_community_plan_reports where community_id=plan.community_id and snapshot->>'period'<=plan.period_key order by created_at desc,report_id desc limit 1;
 if prior.report_id is not null then previous:=jsonb_build_object('reportId',prior.report_id,'period',prior.snapshot->'period','generatedAt',prior.created_at,'financial',prior.snapshot->'financial','occupancy',prior.snapshot->'occupancy','closedEconomicOccupancy',prior.snapshot->'closedEconomicOccupancy','tasks',(select coalesce(jsonb_agg(jsonb_build_object('id',t->'id','status',t->'status')),'[]') from jsonb_array_elements(prior.snapshot->'plan'->'tasks') t));end if;
 insert into public.atlas_community_plan_reports(plan_id,community_id,plan_version,executive_note,snapshot,created_by)
 values(plan.plan_id,plan.community_id,plan.version,p_note,jsonb_build_object('reportSchemaVersion',6,'closedEconomicOccupancy',closed_economic_occupancy,'activeReforecast',active_reforecast,'approvedGoals',approved_goals,'previousReport',previous,'review',review,'plan',plan.payload,'period',plan.period_key,'sourceUpdatedAt',plan.updated_at,'community',(select display_name from public.atlas_communities where community_id=plan.community_id),'financial',financial,'occupancy',occupancy,'coverage',case when occupancy is null then 'Operational occupancy source is unavailable in this snapshot. ' else 'Occupancy uses the retained period-specific source revision. ' end||'Missing or incomplete financial coverage must be resolved in Budget Builder; underspend does not establish true savings.'),auth.uid()) returning * into result;
 return result;
end;$$;
revoke all on function public.atlas_generate_community_plan_report(uuid,integer,text,jsonb) from public,anon;
grant execute on function public.atlas_generate_community_plan_report(uuid,integer,text,jsonb) to authenticated;
commit;
