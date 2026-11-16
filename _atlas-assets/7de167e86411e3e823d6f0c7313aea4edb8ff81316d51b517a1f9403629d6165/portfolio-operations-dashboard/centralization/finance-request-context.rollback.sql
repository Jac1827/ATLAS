-- Forward rollback template: restore read function bodies only. No financial data or history changes.
begin;
create or replace function atlas_private.reforecast_finance_summary(s jsonb,baseline jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb:=s;metric text;amount numeric;actual numeric;lines jsonb;mapped jsonb;row jsonb;budget public.atlas_approved_budget_versions;part jsonb;total numeric;valid boolean;ytd_periods text[];ytd_baselines jsonb;ym jsonb:='{}';period_baseline jsonb;month_result jsonb;metric_target numeric;
begin
 result:=result||jsonb_build_object('effectiveBaseline',coalesce(baseline,jsonb_build_object('status','unavailable','reason','No verified effective baseline')),'originalBudgetVersion',s->'budgetVersion');
 select * into budget from public.atlas_approved_budget_versions where version_id=nullif(s->>'budgetVersion','')::uuid;
 select coalesce(jsonb_agg(v||jsonb_build_object('mappingValid',v->>'nature' in ('income','contra_income','expense','capital','debt','below_noi') and v->>'placement' in ('above_noi','below_noi'))),'[]') into lines from jsonb_array_elements(coalesce(baseline->'lines','[]'))v;
 mapped:=atlas_private.reforecast_metric(lines,'amount');
 for metric in select key from jsonb_each(s) where jsonb_typeof(value)='object' and value ? 'budget' loop
 amount:=null;
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
 actual:=(s->metric->>'actual')::numeric;
 result:=jsonb_set(result,array[metric],(s->metric)||jsonb_build_object('originalBudget',s->metric->'budget','activeBaseline',amount,'baselineSourceType',baseline->>'sourceType','baselineVersion',baseline->>'versionId','baselinePublicationId',baseline->>'publicationId','variance',actual-amount,'status',case when actual is null or amount is null then 'missing' when actual=amount then 'neutral' when ((actual>amount)=(metric not in ('expenses','capital','debt','belowNoi'))) then 'favorable' else 'unfavorable' end,'availability',case when amount is null then 'baseline_unavailable' when actual is null then 'actual_unavailable' else 'available' end,'label',case when amount is null then coalesce(baseline->>'reason','Active baseline metric unavailable') when actual is null then 'Missing closed actual' when actual=amount then 'On baseline' when ((actual>amount)=(metric not in ('expenses','capital','debt','belowNoi'))) then 'Favorable' else 'Unfavorable' end));
 end loop;
 if jsonb_typeof(s->'ytd')='object' then
 select array_agg(value order by value) into ytd_periods from jsonb_array_elements_text(coalesce(s->'fiscalPeriods','[]'));
 ytd_baselines:='[]';if cardinality(ytd_periods) between 1 and 24 then ytd_baselines:=public.atlas_reforecast_effective_baseline(array[(s->>'communityId')::uuid],ytd_periods);end if;
 for metric in select key from jsonb_each(s->'ytd') loop
 total:=0;valid:=cardinality(ytd_periods)>0 and jsonb_array_length(ytd_baselines)=cardinality(ytd_periods);
 for period_baseline in select value from jsonb_array_elements(ytd_baselines) loop
 month_result:=atlas_private.reforecast_finance_summary(jsonb_build_object('communityId',s->'communityId','period',period_baseline->'period','budgetVersion',s->'budgetVersions'->(period_baseline->>'period'),metric,jsonb_build_object('actual',null,'budget',null)),period_baseline);
 metric_target:=(month_result->metric->>'activeBaseline')::numeric;
 if metric_target is null then valid:=false;else total:=total+metric_target;end if;
 end loop;
 amount:=case when valid then total end;actual:=(s->'ytd'->metric->>'actual')::numeric;
 ym:=ym||jsonb_build_object(metric,(s->'ytd'->metric)||jsonb_build_object('originalBudget',s->'ytd'->metric->'budget','activeBaseline',amount,'variance',actual-amount,'status',case when actual is null or amount is null then 'missing' when actual=amount then 'neutral' when ((actual>amount)=(metric not in ('expenses','capital','debt','belowNoi'))) then 'favorable' else 'unfavorable' end,'availability',case when amount is null then 'baseline_unavailable' when actual is null then 'actual_unavailable' else 'available' end,'label',case when amount is null then 'A verified monthly effective baseline is missing from fiscal YTD' when actual is null then 'Missing closed actual' when actual=amount then 'On baseline' when ((actual>amount)=(metric not in ('expenses','capital','debt','belowNoi'))) then 'Favorable' else 'Unfavorable' end));
 end loop;
 result:=result||jsonb_build_object('ytd',ym,'ytdGpr',ym->'gpr','ytdExpenses',ym->'expenses','ytdBaselinePeriods',(select coalesce(jsonb_agg(jsonb_build_object('period',v->'period','sourceType',v->'sourceType','versionId',v->'versionId','publicationId',v->'publicationId','contentHash',v->'contentHash','status',v->'status','reason',v->'reason')),'[]') from jsonb_array_elements(ytd_baselines)v));
 end if;return result;
end;$$;

create or replace function public.atlas_read_finance(p_community_ids uuid[],p_periods text[]) returns table(community_id uuid,period_key text,fiscal_year integer,publication_id uuid,summary jsonb)
 language plpgsql stable security definer set search_path='' as $$
 declare baselines jsonb;
 begin
 baselines:=public.atlas_reforecast_effective_baseline(p_community_ids,p_periods);
 return query select r.community_id,r.period_key,r.fiscal_year,r.publication_id,atlas_private.reforecast_finance_summary(r.summary,b.value)
 from atlas_private.read_finance_pre_forecast_builder(p_community_ids,p_periods)r left join lateral (select value from jsonb_array_elements(baselines) where value->>'communityId'=r.community_id::text and value->>'period'=r.period_key)b on true;
 end;$$;
revoke all on function atlas_private.reforecast_finance_summary(jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.atlas_read_finance(uuid[],text[]) from public,anon;
grant execute on function public.atlas_read_finance(uuid[],text[]) to authenticated;
commit;
