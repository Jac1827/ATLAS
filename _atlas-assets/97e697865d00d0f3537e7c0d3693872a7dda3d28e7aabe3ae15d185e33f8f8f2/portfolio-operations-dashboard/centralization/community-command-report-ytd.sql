-- Additive fiscal evidence validation and richer immutable report snapshots.
begin;
create index if not exists command_report_previous on public.atlas_community_plan_reports(community_id,created_at desc,report_id desc);
create or replace function atlas_private.validate_command_fiscal_ytd(p jsonb)
returns void language plpgsql immutable set search_path='' as $$
declare start_date date; end_date date; expected jsonb; line jsonb; item jsonb; k text; total numeric; complete boolean;
begin
 -- Legacy publications remain readable; new fiscal-aware publications carry exact month evidence.
 if not (p ? 'fiscalStartPeriod') then return;end if;
 if coalesce(p->>'fiscalStartPeriod','') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' or coalesce(p->>'fiscalStartMonth','') !~ '^(1[0-2]|[1-9])$' then raise exception 'Invalid fiscal period';end if;
 start_date:=(p->>'fiscalStartPeriod'||'-01')::date;end_date:=(p->>'period'||'-01')::date;
 if start_date>end_date or end_date>=start_date+interval '12 months' or extract(month from start_date)::integer<>(p->>'fiscalStartMonth')::integer then raise exception 'Fiscal period scope mismatch';end if;
 select jsonb_agg(to_char(d,'YYYY-MM') order by d) into expected from generate_series(start_date,end_date,interval '1 month') d;
 if p->'fiscalPeriods' is distinct from expected then raise exception 'Incomplete fiscal period coverage';end if;
 for line in select value from jsonb_array_elements(p->'rows') loop
  if jsonb_typeof(line->'fiscalEvidence') is distinct from 'array' or jsonb_array_length(line->'fiscalEvidence')<>jsonb_array_length(expected) then raise exception 'Fiscal line evidence required';end if;
  if (select jsonb_agg(e->'period' order by ord) from jsonb_array_elements(line->'fiscalEvidence') with ordinality x(e,ord)) is distinct from expected then raise exception 'Duplicate or mismatched fiscal evidence';end if;
  foreach k in array array['actual','budget'] loop
   total:=0;complete:=true;
   for item in select value from jsonb_array_elements(line->'fiscalEvidence') loop
    if jsonb_typeof(item->k) is distinct from 'number' then
     if jsonb_typeof(item->k) is distinct from 'null' then raise exception 'Invalid fiscal amount';end if;
     complete:=false;
    else
     if abs((item->>k)::numeric)>1000000000000 or round((item->>k)::numeric,2)<>(item->>k)::numeric then raise exception 'Invalid fiscal amount';end if;
     if k='actual' and (coalesce(item->>'actualSource','')='' or coalesce(item->>'sourceTimestamp','')='') then raise exception 'Fiscal actual source required';end if;
     if k='budget' and (coalesce(item->>'budgetSource','')='' or coalesce(item->>'budgetEffectiveDate','')='') then raise exception 'Fiscal budget source required';end if;
     total:=total+(item->>k)::numeric;
    end if;
   end loop;
   if complete then
    if (line->>(case when k='actual' then 'ytdActual' else 'ytdBudget' end))::numeric is distinct from total then raise exception 'Fiscal YTD does not reconcile';end if;
   elsif coalesce(line->(case when k='actual' then 'ytdActual' else 'ytdBudget' end),'null')<>'null'::jsonb then raise exception 'Incomplete fiscal source must remain missing';end if;
  end loop;
  item:=line->'fiscalEvidence'->(jsonb_array_length(expected)-1);
  if item->'actual' is distinct from line->'actual' or item->'budget' is distinct from line->'budget' then raise exception 'Fiscal and monthly source mismatch';end if;
 end loop;
end;$$;
revoke all on function atlas_private.validate_command_fiscal_ytd(jsonb) from public,anon,authenticated;
create or replace function public.atlas_publish_command_financials(p_community_id uuid,p_period text,p_expected_version integer,p_payload jsonb)
returns public.atlas_command_financial_summaries language plpgsql security definer set search_path='' as $$
declare previous public.atlas_command_financial_summaries;result public.atlas_command_financial_summaries; pub public.atlas_command_financial_publications;fp text;r jsonb;k text;ids text[]:='{}';summary jsonb;stamp timestamptz:=now();
begin
 if not atlas_private.command_access(p_community_id,'finance') or not exists(select 1 from public.atlas_user_profiles where user_id=auth.uid() and role in ('admin','executive','finance')) then raise exception 'Financial publication access denied';end if;
 if p_payload is null or p_payload->>'communityId' is distinct from p_community_id::text or p_payload->>'period' is distinct from p_period or p_payload->>'periodBasis' is distinct from 'calendar_month' or p_payload->>'approvedLocked' is distinct from 'true' or p_payload->>'reviewConfirmed' is distinct from 'true' or coalesce(p_payload->>'scenarioId','')='' or coalesce(p_payload->>'scenarioVersion','')='' or coalesce(p_payload->>'builderPropertyId','')='' or coalesce(p_payload->>'actualSource','')='' or coalesce(p_payload->>'budgetSource','')='' or coalesce(p_payload->>'sourceTimestamp','')='' or jsonb_typeof(p_payload->'rows') is distinct from 'array' or jsonb_array_length(p_payload->'rows')>2000 or octet_length(p_payload::text)>2097152 then raise exception 'Incomplete reviewed financial publication';end if;
 if p_payload->>'fiscalYear' !~ '^20[0-9]{2}$' or p_payload->>'year' is distinct from left(p_period,4) then raise exception 'Financial year or period mismatch';end if;
 for r in select value from jsonb_array_elements(p_payload->'rows') loop
  k:=r->>'glCode';
  if coalesce(k,'')='' or k=any(ids) or coalesce(r->>'metric','') not in ('gpr','expenses') or (r->>'metric'='gpr' and k<>'5120') or (r->>'metric'='expenses' and (r->>'nature' is distinct from 'expense' or r->>'operatingApproved' is distinct from 'true' or k='5120')) then raise exception 'Invalid or duplicate approved GL mapping';end if;
  ids:=array_append(ids,k);
  foreach k in array array['actual','budget','ytdActual','ytdBudget'] loop
   if jsonb_typeof(r->k) not in ('number','null') or (jsonb_typeof(r->k)='number' and (abs((r->>k)::numeric)>1000000000000 or round((r->>k)::numeric,2)<>(r->>k)::numeric)) then raise exception 'Invalid financial amount';end if;
  end loop;
 end loop;
 perform atlas_private.validate_command_fiscal_ytd(p_payload);
 if not ('5120'=any(ids)) or not exists(select 1 from jsonb_array_elements(p_payload->'rows') item where item->>'metric'='expenses') then raise exception 'GPR and operating expense coverage are required';end if;
 if jsonb_typeof(p_payload->'occupancyPct') not in ('number','null') then raise exception 'Invalid occupancy budget';end if;
 if jsonb_typeof(p_payload->'occupancyPct')='number' and ((p_payload->>'occupancyPct')::numeric<0 or (p_payload->>'occupancyPct')::numeric>100) then raise exception 'Invalid occupancy budget';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_community_id::text||p_period||':finance',0));
 select * into previous from public.atlas_command_financial_summaries where community_id=p_community_id and period_key=p_period for update;
 fp:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
 select * into pub from public.atlas_command_financial_publications where community_id=p_community_id and period_key=p_period and fingerprint=fp;
 if pub.publication_id is not null then
  if previous.publication_id=pub.publication_id then return previous;end if;
  raise exception 'This source version was superseded; review the current publication';
 end if;
 if coalesce(previous.version,0) is distinct from p_expected_version then raise exception 'Financial publication changed in another session; reload before publishing';end if;
 insert into public.atlas_command_financial_publications(community_id,period_key,fiscal_year,version,fingerprint,payload,published_by,published_at) values(p_community_id,p_period,(p_payload->>'fiscalYear')::integer,coalesce(previous.version,0)+1,fp,p_payload,auth.uid(),stamp) returning * into pub;
 summary:=jsonb_build_object('gpr',atlas_private.command_financial_metric(p_payload->'rows','gpr'),'expenses',atlas_private.command_financial_metric(p_payload->'rows','expenses'),'ytdGpr',atlas_private.command_financial_metric(p_payload->'rows','gpr','ytd'),'ytdExpenses',atlas_private.command_financial_metric(p_payload->'rows','expenses','ytd'),'occupancyPct',p_payload->'occupancyPct','scenarioId',p_payload->'scenarioId','scenarioVersion',p_payload->'scenarioVersion','sourceTimestamp',p_payload->'sourceTimestamp','publishedAt',stamp,'mappingVersion',p_payload->'mappingVersion','periodBasis',p_payload->'periodBasis','fiscalStartPeriod',p_payload->'fiscalStartPeriod','fiscalPeriods',p_payload->'fiscalPeriods');
 insert into public.atlas_command_financial_summaries(community_id,period_key,publication_id,fiscal_year,version,summary) values(p_community_id,p_period,pub.publication_id,pub.fiscal_year,pub.version,summary) on conflict(community_id,period_key) do update set publication_id=excluded.publication_id,fiscal_year=excluded.fiscal_year,version=excluded.version,summary=excluded.summary returning * into result;
 for k in select unnest(array['gpr','expenses']) loop
  if summary->k->>'status' in ('unfavorable','missing') then
   insert into public.atlas_command_findings(community_id,period_key,publication_id,metric,payload)
   values(p_community_id,p_period,pub.publication_id,k,jsonb_build_object('category',case when summary->k->>'status'='missing' then 'Data Readiness' when k='gpr' then 'GPR' else 'Expenses' end,'status','Open','severity',case when summary->k->>'status'='missing' then 'Data Readiness' else 'Watch' end,'actual',summary->k->'actual','target',summary->k->'budget','variance',summary->k->'variance','label',summary->k->'label','source',p_payload->'actualSource','sourceTimestamp',p_payload->'sourceTimestamp','approvedScenario',p_payload->'scenarioId','recommendedResponse',case when summary->k->>'status'='missing' then 'Resolve incomplete '||k||' source coverage for '||p_period when k='gpr' then 'Review GPR shortfall of $'||abs((summary->k->>'variance')::numeric)||' and validate occupancy, pricing and timing causes for '||p_period else 'Review operating expense overrun of $'||abs((summary->k->>'variance')::numeric)||' and validate timing before assigning corrective ownership for '||p_period end));
  end if;
 end loop;
 return result;
end;$$;
revoke all on function public.atlas_publish_command_financials(uuid,text,integer,jsonb) from public,anon;
grant execute on function public.atlas_publish_command_financials(uuid,text,integer,jsonb) to authenticated;
create or replace function public.atlas_generate_community_plan_report(p_plan_id uuid,p_expected_version integer,p_note text default '',p_occupancy jsonb default null)
returns public.atlas_community_plan_reports language plpgsql security definer set search_path='' as $$
declare plan public.atlas_community_plans; result public.atlas_community_plan_reports; financial jsonb; occupancy jsonb; occupied numeric; rentable numeric; target numeric; prior public.atlas_community_plan_reports; previous jsonb; review jsonb;
begin
 select * into plan from public.atlas_community_plans where plan_id=p_plan_id for share;
 if plan.plan_id is null or not atlas_private.command_access(plan.community_id,'edit') then raise exception 'Plan report access denied';end if;
 if plan.version is distinct from p_expected_version then raise exception 'Plan changed in another session; reload before reporting';end if;
 review:=coalesce(plan.payload->'reportReview','{}');
 if length(coalesce(review->>'topCauses',''))>2000 or length(coalesce(review->>'materialRisks',''))>2000 or (coalesce(review->>'expectedResolutionDate','')<>'' and review->>'expectedResolutionDate' !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-[0-9]{2}$') then raise exception 'Invalid report review';end if;
 if p_note is null or length(p_note)>4000 then raise exception 'Invalid executive note';end if;
 select jsonb_build_object('publicationId',publication_id,'summary',summary) into financial from public.atlas_command_financial_summaries where community_id=plan.community_id and period_key=plan.period_key;
 if p_occupancy is not null and p_occupancy<>'null'::jsonb then
  if p_occupancy->>'communityId' is distinct from plan.community_id::text or p_occupancy->>'period' is distinct from plan.period_key or jsonb_typeof(p_occupancy->'occupiedUnits') is distinct from 'number' or jsonb_typeof(p_occupancy->'rentableUnits') is distinct from 'number' or coalesce(p_occupancy->>'source','')='' or coalesce(p_occupancy->>'sourceTimestamp','')='' or coalesce(p_occupancy->>'revisionKey','')='' then raise exception 'Verified period-specific occupancy source required';end if;
  occupied:=(p_occupancy->>'occupiedUnits')::numeric;rentable:=(p_occupancy->>'rentableUnits')::numeric;
  if rentable<=0 or occupied<0 or occupied>rentable or trunc(occupied)<>occupied or trunc(rentable)<>rentable then raise exception 'Invalid occupancy source counts';end if;
  target:=ceil((financial->'summary'->>'occupancyPct')::numeric*rentable/100);
  occupancy:=jsonb_build_object('occupiedUnits',occupied,'rentableUnits',rentable,'physicalPct',occupied/rentable*100,'budgetPct',financial->'summary'->'occupancyPct','budgetUnits',target,'variance',occupied-target,'source',p_occupancy->'source','sourceTimestamp',p_occupancy->'sourceTimestamp','revisionKey',p_occupancy->'revisionKey');
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_plan_id::text||':report',0));
 select * into result from public.atlas_community_plan_reports where snapshot->>'reportSchemaVersion'='2' and plan_id=p_plan_id and plan_version=plan.version and executive_note=p_note and (snapshot->'financial') is not distinct from coalesce(financial,'null'::jsonb) and (snapshot->'occupancy') is not distinct from coalesce(occupancy,'null'::jsonb) order by created_at limit 1;
 if result.report_id is not null then return result;end if;
 select * into prior from public.atlas_community_plan_reports where community_id=plan.community_id and snapshot->>'period'<=plan.period_key order by created_at desc,report_id desc limit 1;
 if prior.report_id is not null then previous:=jsonb_build_object('reportId',prior.report_id,'period',prior.snapshot->'period','generatedAt',prior.created_at,'financial',prior.snapshot->'financial','occupancy',prior.snapshot->'occupancy','tasks',(select coalesce(jsonb_agg(jsonb_build_object('id',t->'id','status',t->'status')),'[]') from jsonb_array_elements(prior.snapshot->'plan'->'tasks') t));end if;
 insert into public.atlas_community_plan_reports(plan_id,community_id,plan_version,executive_note,snapshot,created_by)
 values(plan.plan_id,plan.community_id,plan.version,p_note,jsonb_build_object('reportSchemaVersion',2,'previousReport',previous,'review',review,'plan',plan.payload,'period',plan.period_key,'sourceUpdatedAt',plan.updated_at,'community',(select display_name from public.atlas_communities where community_id=plan.community_id),'financial',financial,'occupancy',occupancy,'coverage',case when occupancy is null then 'Operational occupancy source is unavailable in this snapshot. ' else 'Occupancy uses the retained period-specific source revision. ' end||'Missing or incomplete financial coverage must be resolved in Budget Builder; underspend does not establish true savings.'),auth.uid()) returning * into result;
 return result;
end;$$;
revoke all on function public.atlas_generate_community_plan_report(uuid,integer,text,jsonb) from public,anon;
grant execute on function public.atlas_generate_community_plan_report(uuid,integer,text,jsonb) to authenticated;
commit;
