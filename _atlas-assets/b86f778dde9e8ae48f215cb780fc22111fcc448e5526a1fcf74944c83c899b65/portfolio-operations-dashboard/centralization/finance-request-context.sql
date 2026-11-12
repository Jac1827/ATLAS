-- Finance request context. Exact live evidence is resolved within one STABLE statement snapshot.
-- No indexes, persisted caches, financial writes, or authority changes.
begin;
create or replace function atlas_private.reforecast_finance_month(s jsonb,baseline jsonb,targets jsonb default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb:=s;metric text;amount numeric;actual numeric;lines jsonb;mapped jsonb;row jsonb;budget public.atlas_approved_budget_versions;part jsonb;total numeric;valid boolean;ytd_periods text[];ytd_baselines jsonb;ym jsonb:='{}';period_baseline jsonb;month_result jsonb;metric_target numeric;
begin
 result:=result||jsonb_build_object('effectiveBaseline',coalesce(baseline,jsonb_build_object('status','unavailable','reason','No verified effective baseline')),'originalBudgetVersion',s->'budgetVersion');
 if targets is null then
 select * into budget from public.atlas_approved_budget_versions where version_id=nullif(s->>'budgetVersion','')::uuid;
 select coalesce(jsonb_agg(v||jsonb_build_object('mappingValid',v->>'nature' in ('income','contra_income','expense','capital','debt','below_noi') and v->>'placement' in ('above_noi','below_noi'))),'[]') into lines from jsonb_array_elements(coalesce(baseline->'lines','[]'))v;
 mapped:=atlas_private.reforecast_metric(lines,'amount');
 end if;
 for metric in select key from jsonb_each(s) where jsonb_typeof(value)='object' and value ? 'budget' loop
 amount:=(targets->>metric)::numeric;
 if targets is null then
 if baseline->>'status'='available' then
 -- Original budgets already carry their approved metric formulas, even before a forecast registry exists.
 if jsonb_typeof(budget.payload->'metricMappings'->metric)='array' and (baseline->>'sourceType'='original_budget' or metric not in ('revenue','expenses','noi','cashFlow','capital','debt','grossIncome','contraRevenue','belowNoi')) then
 total:=0;valid:=jsonb_array_length(budget.payload->'metricMappings'->metric)>0;
 for part in select value from jsonb_array_elements(budget.payload->'metricMappings'->metric) loop
 select value into row from jsonb_array_elements(lines) where value->>'accountCode'=part->>'glCode';
 if row->>'amount' is null or part->>'factor' is null then valid:=false;exit;end if;
 total:=total+(row->>'amount')::numeric*(part->>'factor')::numeric;
 end loop;if valid then amount:=total;end if;
 elsif metric in ('revenue','expenses','noi','cashFlow','capital','debt','grossIncome','contraRevenue','belowNoi') then amount:=(mapped->>metric)::numeric;
 end if;end if;
 end if;
 actual:=(s->metric->>'actual')::numeric;
 result:=jsonb_set(result,array[metric],(s->metric)||jsonb_build_object('originalBudget',s->metric->'budget','activeBaseline',amount,'baselineSourceType',baseline->>'sourceType','baselineVersion',baseline->>'versionId','baselinePublicationId',baseline->>'publicationId','variance',actual-amount,'status',case when actual is null or amount is null then 'missing' when actual=amount then 'neutral' when ((actual>amount)=(metric not in ('expenses','capital','debt','belowNoi'))) then 'favorable' else 'unfavorable' end,'availability',case when amount is null then 'baseline_unavailable' when actual is null then 'actual_unavailable' else 'available' end,'label',case when amount is null then coalesce(baseline->>'reason','Active baseline metric unavailable') when actual is null then 'Missing closed actual' when actual=amount then 'On baseline' when ((actual>amount)=(metric not in ('expenses','capital','debt','belowNoi'))) then 'Favorable' else 'Unfavorable' end));
 end loop;
 return result;
end;$$;

-- Request-local context; no persistent cache or new financial authority.
create or replace function atlas_private.reforecast_finance_context(summaries jsonb,supplied_baselines jsonb default '[]')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare requirements jsonb:='{}';baselines jsonb:='{}';targets jsonb:='{}';metrics jsonb;s jsonb;r jsonb;b jsonb;value jsonb;key text;period text;cid text;periods text[];ytd_periods text[];offset_index integer;month_result jsonb;
begin
 select coalesce(jsonb_object_agg(metric,jsonb_build_object('actual',null,'budget',null)),'{}') into metrics from (
 select distinct v.key metric from jsonb_array_elements(summaries)se(value) cross join lateral jsonb_each(se.value)v where jsonb_typeof(v.value)='object' and v.value ? 'budget'
 union select distinct v.key from jsonb_array_elements(summaries)se(value) cross join lateral jsonb_each(case when jsonb_typeof(se.value->'ytd')='object' then se.value->'ytd' else '{}' end)v
 )names;
 for b in select v from jsonb_array_elements(supplied_baselines)v where v is not null and v<>'null'::jsonb loop
 baselines:=baselines||jsonb_build_object(jsonb_build_array(b->>'communityId',b->>'period')::text,b);
 end loop;
 for s in select v from jsonb_array_elements(summaries)v loop
 r:=jsonb_build_object('communityId',s->'communityId','period',s->'period','budgetVersion',s->'budgetVersion');
 requirements:=requirements||jsonb_build_object(jsonb_build_array(r->>'communityId',r->>'period',r->>'budgetVersion')::text,r);
 if jsonb_typeof(s->'ytd')='object' then
 select array_agg(v order by v) into ytd_periods from jsonb_array_elements_text(coalesce(s->'fiscalPeriods','[]'))v;
 if cardinality(ytd_periods) between 1 and 24 then
 foreach period in array ytd_periods loop
 r:=jsonb_build_object('communityId',s->'communityId','period',period,'budgetVersion',s->'budgetVersions'->period);
 requirements:=requirements||jsonb_build_object(jsonb_build_array(r->>'communityId',period,r->>'budgetVersion')::text,r);
 end loop;end if;end if;
 end loop;
 for cid in select distinct v->>'communityId' from jsonb_each(requirements)e(k,v) loop
 select array_agg(p order by p) into periods from (select distinct v->>'period' p from jsonb_each(requirements)e(k,v) where (v->>'communityId') is not distinct from cid and not(baselines ? jsonb_build_array(cid,v->>'period')::text))needed;
 if cardinality(periods)>0 then
 for offset_index in 0..((cardinality(periods)-1)/24) loop
 for b in select v from jsonb_array_elements(public.atlas_reforecast_effective_baseline(array[cid::uuid],periods[(offset_index*24+1):(offset_index*24+24)]))v loop
 baselines:=baselines||jsonb_build_object(jsonb_build_array(b->>'communityId',b->>'period')::text,b);
 end loop;end loop;end if;
 end loop;
 for key,r in select k,v from jsonb_each(requirements)e(k,v) loop
 b:=baselines->jsonb_build_array(r->>'communityId',r->>'period')::text;
 month_result:=atlas_private.reforecast_finance_month(r||metrics,b);
 select coalesce(jsonb_object_agg(k,month_result->k->'activeBaseline'),'{}') into value from jsonb_object_keys(metrics)k;
 targets:=targets||jsonb_build_object(key,value);
 end loop;
 return jsonb_build_object('baselines',baselines,'targets',targets);
end;$$;

create or replace function atlas_private.reforecast_finance_summary_context(s jsonb,baseline jsonb,context jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;metric text;amount numeric;actual numeric;total numeric;valid boolean;ytd_periods text[];ytd_baselines jsonb;ym jsonb:='{}';period_baseline jsonb;metric_target numeric;period text;
begin
 result:=atlas_private.reforecast_finance_month(s,baseline,context->'targets'->jsonb_build_array(s->>'communityId',s->>'period',s->>'budgetVersion')::text);
 if jsonb_typeof(s->'ytd')='object' then
 select array_agg(value order by value) into ytd_periods from jsonb_array_elements_text(coalesce(s->'fiscalPeriods','[]'));
 ytd_baselines:='[]';
 if cardinality(ytd_periods) between 1 and 24 then
 foreach period in array ytd_periods loop
 period_baseline:=context->'baselines'->jsonb_build_array(s->>'communityId',period)::text;
 if period_baseline is not null then ytd_baselines:=ytd_baselines||jsonb_build_array(period_baseline);end if;
 end loop;end if;
 for metric in select key from jsonb_each(s->'ytd') loop
 total:=0;valid:=cardinality(ytd_periods)>0 and jsonb_array_length(ytd_baselines)=cardinality(ytd_periods);
 for period_baseline in select value from jsonb_array_elements(ytd_baselines) loop
 metric_target:=(context->'targets'->jsonb_build_array(s->>'communityId',period_baseline->>'period',s->'budgetVersions'->>(period_baseline->>'period'))::text->>metric)::numeric;
 if metric_target is null then valid:=false;else total:=total+metric_target;end if;
 end loop;
 amount:=case when valid then total end;actual:=(s->'ytd'->metric->>'actual')::numeric;
 ym:=ym||jsonb_build_object(metric,(s->'ytd'->metric)||jsonb_build_object('originalBudget',s->'ytd'->metric->'budget','activeBaseline',amount,'variance',actual-amount,'status',case when actual is null or amount is null then 'missing' when actual=amount then 'neutral' when ((actual>amount)=(metric not in ('expenses','capital','debt','belowNoi'))) then 'favorable' else 'unfavorable' end,'availability',case when amount is null then 'baseline_unavailable' when actual is null then 'actual_unavailable' else 'available' end,'label',case when amount is null then 'A verified monthly effective baseline is missing from fiscal YTD' when actual is null then 'Missing closed actual' when actual=amount then 'On baseline' when ((actual>amount)=(metric not in ('expenses','capital','debt','belowNoi'))) then 'Favorable' else 'Unfavorable' end));
 end loop;
 result:=result||jsonb_build_object('ytd',ym,'ytdGpr',ym->'gpr','ytdExpenses',ym->'expenses','ytdBaselinePeriods',(select coalesce(jsonb_agg(jsonb_build_object('period',v->'period','sourceType',v->'sourceType','versionId',v->'versionId','publicationId',v->'publicationId','contentHash',v->'contentHash','status',v->'status','reason',v->'reason')),'[]') from jsonb_array_elements(ytd_baselines)v));
 end if;return result;
end;$$;

create or replace function atlas_private.reforecast_finance_summary(s jsonb,baseline jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 return atlas_private.reforecast_finance_summary_context(s,baseline,atlas_private.reforecast_finance_context(jsonb_build_array(s),jsonb_build_array(baseline)));
end;$$;

create or replace function public.atlas_read_finance(p_community_ids uuid[],p_periods text[])
returns table(community_id uuid,period_key text,fiscal_year integer,publication_id uuid,summary jsonb)
language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;summaries jsonb;context jsonb;r jsonb;b jsonb;
begin
 -- Preserve validation even when the authorized stored result is empty.
 if cardinality(p_community_ids)>100 or p_periods is null or cardinality(p_periods)=0 or cardinality(p_periods)>24 or exists(select 1 from unnest(p_periods)v where v is null or v!~'^20[0-9]{2}-(0[1-9]|1[0-2])$') then raise exception 'Distinct full calendar months and at most 100 communities required';end if;
 select coalesce(jsonb_agg(to_jsonb(v)),'[]') into rows from atlas_private.read_finance_pre_forecast_builder(p_community_ids,p_periods)v;
 select coalesce(jsonb_agg(v->'summary'),'[]') into summaries from jsonb_array_elements(rows)v;
 context:=atlas_private.reforecast_finance_context(summaries);
 for r in select v from jsonb_array_elements(rows)v loop
 b:=context->'baselines'->jsonb_build_array(r->>'community_id',r->>'period_key')::text;
 return query select (r->>'community_id')::uuid,r->>'period_key',(r->>'fiscal_year')::integer,(r->>'publication_id')::uuid,atlas_private.reforecast_finance_summary_context(r->'summary',b,context)
 from generate_series(1,case when b is null then 1 else (select count(*)::int from unnest(p_community_ids)c where c=(r->>'community_id')::uuid)*(select count(*)::int from unnest(p_periods)p where p=r->>'period_key') end);
 end loop;
end;$$;

revoke all on function atlas_private.reforecast_finance_month(jsonb,jsonb,jsonb),atlas_private.reforecast_finance_context(jsonb,jsonb),atlas_private.reforecast_finance_summary_context(jsonb,jsonb,jsonb),atlas_private.reforecast_finance_summary(jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.atlas_read_finance(uuid[],text[]) from public,anon;
grant execute on function public.atlas_read_finance(uuid[],text[]) to authenticated;
commit;
