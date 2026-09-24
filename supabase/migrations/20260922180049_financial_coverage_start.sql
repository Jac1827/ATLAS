-- Coverage dates confirmed by the owner on 2026-09-22. Source values remain immutable.
begin;
alter table public.atlas_communities add column if not exists first_expected_financial_period text check (first_expected_financial_period ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$');
alter table public.atlas_communities add column if not exists financial_coverage_reason text;
update public.atlas_communities set first_expected_financial_period=d.period,financial_coverage_reason=d.reason
from (values ('st augustine','2026-05','Jac confirmed first expected month 2026-05 on 2026-09-22; recently delivered to leasing'),('ivy and elm','2026-07','Jac confirmed first expected month 2026-07 on 2026-09-22; recently delivered'),('sutton house','2027-05','Jac confirmed placeholder until May 2027 delivery on 2026-09-22')) d(name,period,reason)
where canonical_name=d.name and deleted_at is null;
create or replace function atlas_private.finance_envelope(cid uuid,p text) returns jsonb language plpgsql stable set search_path='' as $$
declare v public.atlas_financial_close_versions; b public.atlas_approved_budget_versions;
 y integer:=left(p,4)::integer; m integer:=right(p,2)::integer; start_p text; fp text; fdate date;
 metric record; av numeric; bv numeric; ya numeric; yb numeric; x numeric; z numeric;
 fv public.atlas_financial_close_versions; fb public.atlas_approved_budget_versions;
 s jsonb:='{}'; ym jsonb:='{}'; close_ids jsonb:='{}'; budget_ids jsonb:='{}'; missing jsonb:='[]'; periods jsonb:='[]';
 latest text; complete_a boolean; complete_b boolean; first_expected text; applicable boolean;
begin
 select c.* into v from public.atlas_financial_close_heads h join public.atlas_financial_close_versions c using(version_id) where h.community_id=cid and h.period_key=p and h.accounting_basis='accrual';
 select * into b from public.atlas_approved_budget_versions where community_id=cid and calendar_year=y and m-1=any(covered_months) and effective_date<=current_date;
 start_p:=to_char(make_date(y-case when m<coalesce(b.fiscal_start_month,1) then 1 else 0 end,coalesce(b.fiscal_start_month,1),1),'YYYY-MM');
 select first_expected_financial_period into first_expected from public.atlas_communities where community_id=cid;
 applicable:=first_expected is null or p>=first_expected;
 start_p:=greatest(start_p,coalesce(first_expected,start_p));
 select max(period_key) into latest from public.atlas_financial_close_heads where community_id=cid and accounting_basis='accrual' and period_key between start_p and p;
 for fdate in select generate_series((start_p||'-01')::date,(p||'-01')::date,interval '1 month')::date loop
  fp:=to_char(fdate,'YYYY-MM');periods:=periods||to_jsonb(fp);
  select c.* into fv from public.atlas_financial_close_heads h join public.atlas_financial_close_versions c using(version_id) where h.community_id=cid and h.period_key=fp and h.accounting_basis='accrual';
  if fv.version_id is null then missing:=missing||to_jsonb(fp);else close_ids:=close_ids||jsonb_build_object(fp,fv.version_id);end if;
  select * into fb from public.atlas_approved_budget_versions where community_id=cid and calendar_year=extract(year from fdate) and extract(month from fdate)::integer-1=any(covered_months) and effective_date<=current_date;
  if fb.version_id is not null then budget_ids:=budget_ids||jsonb_build_object(fp,fb.version_id);end if;
 end loop;
 for metric in select * from public.atlas_financial_metric_registry where registry_version='atlas-finance-v1' order by metric_key loop
  av:=atlas_private.finance_actual_metric(v,metric.metric_key,b.payload);
  bv:=case when metric.availability<>'source_not_supported' then atlas_private.finance_budget_metric(b.payload,metric.metric_key,m-1) end;
  s:=s||jsonb_build_object(metric.metric_key,atlas_private.finance_metric(av,bv,metric.favorable_direction,case when metric.availability='source_not_supported' then metric.definition when metric.availability='approved_gl_scope' and coalesce(jsonb_array_length(b.payload->'metricMappings'->metric.metric_key),0)=0 then 'Approved GL mapping unavailable' when metric.metric_key='cashFlow' and av is null then 'Reconciled cash flow control unavailable' end));
  if metric.availability='source_not_supported' then continue;end if;
  if not applicable then s:=s||jsonb_build_object(metric.metric_key,jsonb_build_object('actual',null,'budget',bv,'variance',null,'status','not_applicable','availability','not_applicable','label','Before first expected financial month'));end if;
  ya:=0;yb:=0;complete_a:=applicable;complete_b:=applicable;
  for fp in select jsonb_array_elements_text(periods) loop
   select * into fv from public.atlas_financial_close_versions where version_id=(close_ids->>fp)::uuid;
   select * into fb from public.atlas_approved_budget_versions where version_id=(budget_ids->>fp)::uuid;
   x:=atlas_private.finance_actual_metric(fv,metric.metric_key,fb.payload);
   z:=case when metric.availability<>'source_not_supported' then atlas_private.finance_budget_metric(fb.payload,metric.metric_key,right(fp,2)::integer-1) end;
   if x is null then complete_a:=false;else ya:=ya+x;end if;
   if z is null then complete_b:=false;else yb:=yb+z;end if;
  end loop;
  ym:=ym||jsonb_build_object(metric.metric_key,atlas_private.finance_metric(case when complete_a then ya end,case when complete_b then yb end,metric.favorable_direction));
 end loop;
 return s||jsonb_build_object('schemaVersion',1,'registryVersion','atlas-finance-v1','communityId',cid,'period',p,'periodBasis','calendar_month','accountingBasis','accrual','currency','USD',
 'actualCloseVersion',v.version_id,'budgetVersion',b.version_id,'scenarioId',b.scenario_id,'scenarioVersion',b.scenario_version,'fiscalYear',coalesce(b.fiscal_year,y),
 'sourceTimestamp',v.approved_at,'actualSource',v.source_file,'budgetSource',b.source_file,'budgetEffectiveDate',b.effective_date,'targetApprovalStatus',case when b.version_id is not null then 'approved' else 'missing' end,
 'occupancyPct',b.payload->'occupancyPct'->(m-1),'fiscalStartPeriod',start_p,'fiscalPeriods',periods,'closeVersions',close_ids,'budgetVersions',budget_ids,'latestClosedPeriod',latest,
 'firstExpectedFinancialPeriod',first_expected,'applicable',applicable,'missingPeriods',missing,'completeYtd',applicable and jsonb_array_length(missing)=0,'ytd',ym,'ytdGpr',ym->'gpr','ytdExpenses',ym->'expenses',
 'close',case when v.version_id is not null then to_jsonb(v)||jsonb_build_object('metrics',v.metrics||jsonb_build_object('netCashFlow',atlas_private.finance_actual_metric(v,'cashFlow',null))) end);
end;$$;
select atlas_private.project_finance(community_id) from public.atlas_communities where first_expected_financial_period is not null;
commit;
