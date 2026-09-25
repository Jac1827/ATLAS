-- Apply after financial-close-source-lineage.sql and financial-admin-publication.sql.
-- Reporting is a transactional projection of immutable authority, never another approval.
begin;
create table public.atlas_financial_metric_registry (
 registry_version text not null, metric_key text not null, label text not null,
 favorable_direction integer check(favorable_direction in (-1,1)),
 source_control text, definition text not null, availability text not null,
 primary key(registry_version,metric_key)
);
insert into public.atlas_financial_metric_registry values
 ('atlas-finance-v1','gpr','Gross potential rent',1,null,'Approved GL 5120','mapped'),
 ('atlas-finance-v1','netRentalIncome','Net rental income',1,'Net Rental Income','Reconciled postings before Net Rental Income control','mapped'),
 ('atlas-finance-v1','revenue','Total income',1,'Total Income','Reconciled income statement control','mapped'),
 ('atlas-finance-v1','expenses','Operating expenses',-1,null,'Total Income minus Net Operating Income','mapped'),
 ('atlas-finance-v1','noi','Net operating income',1,'Net Operating Income','Reconciled income statement control','mapped'),
 ('atlas-finance-v1','cashFlow','Net cash flow',1,'Net Cash Flow','Reconciled final cash flow control; absent control remains unavailable','mapped'),
 ('atlas-finance-v1','capital','Capital expenditures',-1,null,'Requires a reviewed capital GL mapping and matching closed rows','approved_gl_scope'),
 ('atlas-finance-v1','debt','Debt service',-1,null,'Requires a reviewed debt-service GL mapping and matching closed rows','approved_gl_scope'),
 ('atlas-finance-v1','assets','Total assets',null,null,'Requires a reconciled balance sheet close, not an income statement','source_not_supported'),
 ('atlas-finance-v1','liabilities','Total liabilities',null,null,'Requires a reconciled balance sheet close, not an income statement','source_not_supported'),
 ('atlas-finance-v1','equity','Total equity',null,null,'Requires a reconciled balance sheet close, not an income statement','source_not_supported');
insert into public.atlas_financial_metric_registry values
 ('atlas-finance-v1','payroll','Payroll and benefits',-1,null,'Approved metric-specific GL scope','approved_gl_scope'),
 ('atlas-finance-v1','contractLabor','Contract labor',-1,null,'Approved metric-specific GL scope','approved_gl_scope'),
 ('atlas-finance-v1','repairs','Repairs and maintenance',-1,null,'Approved metric-specific GL scope','approved_gl_scope'),
 ('atlas-finance-v1','turnExpense','Turn and make-ready expense',-1,null,'Approved metric-specific GL scope','approved_gl_scope'),
 ('atlas-finance-v1','utilities','Utilities',-1,null,'Approved metric-specific GL scope','approved_gl_scope'),
 ('atlas-finance-v1','marketingExpense','Marketing and advertising',-1,null,'Approved metric-specific GL scope','approved_gl_scope'),
 ('atlas-finance-v1','adminExpense','Administrative expense',-1,null,'Approved metric-specific GL scope','approved_gl_scope'),
 ('atlas-finance-v1','security','Security',-1,null,'Approved metric-specific GL scope','approved_gl_scope'),
 ('atlas-finance-v1','landscaping','Landscaping and contracts',-1,null,'Approved metric-specific GL scope','approved_gl_scope'),
 ('atlas-finance-v1','propertyTaxes','Property taxes',-1,null,'Approved metric-specific GL scope','approved_gl_scope'),
 ('atlas-finance-v1','insurance','Insurance',-1,null,'Approved metric-specific GL scope','approved_gl_scope'),
 ('atlas-finance-v1','managementFees','Management fees',-1,null,'Approved metric-specific GL scope','approved_gl_scope'),
 ('atlas-finance-v1','expensePerUnit','Expense per unit',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','controllableExpensePerUnit','Controllable expense per unit',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','noiMargin','NOI margin',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','noiPerUnit','NOI per unit',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','capexBudget','Approved CapEx budget',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','capexCommitted','Committed CapEx',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','capexRemaining','CapEx budget remaining',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','capexForecast','Forecast CapEx spend',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','projectsUnderway','Projects underway',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','renovationsPlanned','Renovations planned',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','renovationsUnderway','Renovations underway',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','renovationsComplete','Renovations completed',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','renovationCost','Renovation cost per unit',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','renovationDowntime','Renovation downtime days',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','rentPremium','Achieved rent premium',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','yieldOnCost','Yield on cost',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','projectROI','Project ROI',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','paybackMonths','Estimated payback months',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','loanBalance','Loan balance',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','interestRate','Interest rate',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','dscr','DSCR',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','debtYield','Debt yield',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','ltv','Loan-to-value',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','replacementReserve','Replacement reserve',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','operatingReserve','Operating reserve',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','restrictedCash','Restricted cash',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','availableCash','Available cash',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','accountsPayable','Accounts payable',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','fundingRequired','Near-term funding requirements',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','equityInvested','Original equity invested',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','additionalCapital','Additional capital contributed',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','unfundedCommitments','Unfunded capital commitments',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','cashBalance','Cash balance',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','distribution','Current-period distribution',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','cumulativeDistributions','Cumulative distributions',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','returnOfCapital','Return of capital',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','returnOnCapital','Return on capital',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','cashOnCash','Cash-on-cash return',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','prefAccrual','Preferred-return accrual',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','prefPaid','Preferred return paid',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','equityMultiple','Equity multiple / MOIC',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','propertyIRR','Property-level IRR',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','investorIRR','Investor-level IRR',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','estimatedValue','Estimated property value',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','netEquity','Estimated net equity',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','exitCapRate','Exit cap rate assumption',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','exitProceeds','Forecast sale / refinance proceeds',null,null,'Requires an approved source and metric definition beyond the monthly income statement','source_not_supported');
insert into public.atlas_financial_metric_registry values
 ('atlas-finance-v1','scheduledRent','Scheduled rent',null,null,'Requires an approved source beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','marketRent','Asking rent',null,null,'Requires an approved source beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','signedRent','Signed rent',null,null,'Requires an approved source beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','nerActual','Effective rent after concessions',null,null,'Requires an approved source beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','rentPerUnitBed','Rent per unit or bed',null,null,'Requires an approved source beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','otherIncome','Other income',1,null,'Approved metric-specific GL scope','approved_gl_scope'),
 ('atlas-finance-v1','utilityReimbursement','Utility reimbursements',1,null,'Approved metric-specific GL scope','approved_gl_scope'),
 ('atlas-finance-v1','parkingIncome','Parking income',1,null,'Approved metric-specific GL scope','approved_gl_scope'),
 ('atlas-finance-v1','storageIncome','Storage income',1,null,'Approved metric-specific GL scope','approved_gl_scope'),
 ('atlas-finance-v1','petIncome','Pet income',1,null,'Approved metric-specific GL scope','approved_gl_scope'),
 ('atlas-finance-v1','amenityIncome','Amenity income',1,null,'Approved metric-specific GL scope','approved_gl_scope'),
 ('atlas-finance-v1','vacancyLoss','Vacancy loss',-1,null,'Approved metric-specific GL scope','approved_gl_scope'),
 ('atlas-finance-v1','lossToLease','Loss-to-lease',-1,null,'Approved metric-specific GL scope','approved_gl_scope'),
 ('atlas-finance-v1','concessions','Concessions',-1,null,'Approved metric-specific GL scope','approved_gl_scope'),
 ('atlas-finance-v1','employeeModelLoss','Employee and model-unit loss',-1,null,'Approved metric-specific GL scope','approved_gl_scope'),
 ('atlas-finance-v1','badDebt','Bad debt',-1,null,'Approved metric-specific GL scope','approved_gl_scope'),
 ('atlas-finance-v1','revenuePerOccupied','Revenue per occupied unit',null,null,'Requires an approved source beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','revenuePerAvailable','Revenue per available unit',null,null,'Requires an approved source beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','rentGrowth','Actual rent growth',null,null,'Requires an approved source beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','newLeaseTradeOut','New-lease trade-out',null,null,'Requires an approved source beyond the monthly income statement','source_not_supported'),
 ('atlas-finance-v1','renewalTradeOut','Renewal trade-out',null,null,'Requires an approved source beyond the monthly income statement','source_not_supported');
alter table public.atlas_financial_metric_registry enable row level security;
revoke all on public.atlas_financial_metric_registry from public,anon,authenticated;
grant select on public.atlas_financial_metric_registry to authenticated;
create policy finance_registry_read on public.atlas_financial_metric_registry for select to authenticated using(auth.uid() is not null);

create table public.atlas_approved_budget_versions (
 version_id uuid primary key default gen_random_uuid(),
 community_id uuid not null references public.atlas_communities(community_id),
 calendar_year integer not null check(calendar_year between 2000 and 2099),
 fiscal_year integer not null check(fiscal_year between 2000 and 2099),
 fiscal_start_month integer not null check(fiscal_start_month between 1 and 12),
 scenario_id text not null, scenario_version text not null, effective_date date not null,
 record_type text not null default 'budget_original' check(record_type='budget_original'),
 status text not null default 'locked' check(status='locked'),
 source_file text not null, source_hash text not null, content_hash text not null,
 approved_by uuid not null references auth.users(id), approved_at timestamptz not null default now(),
 registry_version text not null default 'atlas-finance-v1', covered_months integer[] not null, payload jsonb not null,
 -- The original baseline is never overwritten by a revision or reforecast.
 unique(community_id,calendar_year,content_hash)
);
alter table public.atlas_approved_budget_versions enable row level security;
revoke all on public.atlas_approved_budget_versions from public,anon,authenticated;
grant select on public.atlas_approved_budget_versions to authenticated;
create policy approved_budget_read on public.atlas_approved_budget_versions for select to authenticated using(atlas_private.command_access(community_id,'finance'));
create function atlas_private.finance_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Approved finance history is immutable; create a separately governed version';end;$$;
revoke all on function atlas_private.finance_immutable() from public,anon,authenticated;
create trigger approved_budget_immutable before update or delete on public.atlas_approved_budget_versions for each row execute function atlas_private.finance_immutable();
create trigger finance_registry_immutable before update or delete on public.atlas_financial_metric_registry for each row execute function atlas_private.finance_immutable();
create trigger finance_close_immutable before update or delete on public.atlas_financial_close_versions for each row execute function atlas_private.finance_immutable();
create trigger finance_close_rows_immutable before update or delete on public.atlas_financial_close_rows for each row execute function atlas_private.finance_immutable();

create function atlas_private.finance_budget_metric(b jsonb,k text,m integer) returns numeric language plpgsql immutable set search_path='' as $$
declare mapping jsonb; part jsonb; amount numeric; total numeric:=0;
begin
 mapping:=b->'metricMappings'->k;
 if jsonb_typeof(mapping) is distinct from 'array' or jsonb_array_length(mapping)=0 then return null;end if;
 for part in select value from jsonb_array_elements(mapping) loop
  select (r->'monthly'->>m)::numeric into amount from jsonb_array_elements(b->'rows') r where r->>'glCode'=part->>'glCode';
  if amount is null then return null;end if;
  total:=total+amount*(part->>'factor')::numeric;
 end loop;
 return total;
end;$$;
create function atlas_private.finance_actual_metric(v public.atlas_financial_close_versions,k text,b jsonb) returns numeric language plpgsql stable set search_path='' as $$
declare amount numeric; total numeric:=0; part jsonb;
begin
 if v.version_id is null then return null;end if;
 case k
 when 'gpr' then return (v.metrics->>'grossPotentialRent')::numeric;
 when 'netRentalIncome' then return (v.metrics->>'netRentalIncome')::numeric;
 when 'revenue' then return (v.metrics->>'totalIncome')::numeric;
 when 'expenses' then return (v.metrics->>'operatingExpenses')::numeric;
 when 'noi' then return (v.metrics->>'netOperatingIncome')::numeric;
 when 'cashFlow' then return (v.metrics->'sourceControls'->'Net Cash Flow'->>'actual')::numeric;
 else
  if not exists(select 1 from public.atlas_financial_metric_registry where registry_version='atlas-finance-v1' and metric_key=k and availability='approved_gl_scope') then return null;end if;
  if jsonb_typeof(b->'metricMappings'->k) is distinct from 'array' or jsonb_array_length(b->'metricMappings'->k)=0 then return null;end if;
  for part in select value from jsonb_array_elements(b->'metricMappings'->k) loop
   select actual into amount from public.atlas_financial_close_rows where version_id=v.version_id and gl_code=part->>'glCode';
   if amount is null then return null;end if;
   total:=total+amount*(part->>'factor')::numeric;
  end loop;return total;
 end case;
end;$$;
create function atlas_private.finance_metric(a numeric,b numeric,d integer,reason text default null) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('actual',a,'budget',b,'variance',case when a is not null and b is not null then (a-b)*d end,
 'status',case when a is null or b is null or d is null then 'missing' when (a-b)*d<0 then 'unfavorable' else 'favorable' end,
 'availability',case when a is null then 'actual_unavailable' when b is null then 'budget_unavailable' else 'available' end,
 'label',coalesce(reason,case when a is null then 'Missing closed actual' when b is null then 'Missing approved budget' when d is null then 'No favorability definition' when (a-b)*d<0 then 'Behind' else 'On Track' end));
$$;
-- One read contract for summaries, exports, Home and Bonus evidence. All arithmetic
-- uses database numerics and exact calendar periods; source cumulative YTD is not
-- mistaken for complete closed-month coverage.
create function atlas_private.finance_envelope(cid uuid,p text) returns jsonb language plpgsql stable set search_path='' as $$
declare v public.atlas_financial_close_versions; b public.atlas_approved_budget_versions;
 y integer:=left(p,4)::integer; m integer:=right(p,2)::integer; start_p text; fp text; fdate date;
 metric record; av numeric; bv numeric; ya numeric; yb numeric; x numeric; z numeric;
 fv public.atlas_financial_close_versions; fb public.atlas_approved_budget_versions;
 s jsonb:='{}'; ym jsonb:='{}'; close_ids jsonb:='{}'; budget_ids jsonb:='{}'; missing jsonb:='[]'; periods jsonb:='[]';
 latest text; complete_a boolean; complete_b boolean;
begin
 select c.* into v from public.atlas_financial_close_heads h join public.atlas_financial_close_versions c using(version_id) where h.community_id=cid and h.period_key=p and h.accounting_basis='accrual';
 select * into b from public.atlas_approved_budget_versions where community_id=cid and calendar_year=y and m-1=any(covered_months) and effective_date<=current_date;
 start_p:=to_char(make_date(y-case when m<coalesce(b.fiscal_start_month,1) then 1 else 0 end,coalesce(b.fiscal_start_month,1),1),'YYYY-MM');
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
  ya:=0;yb:=0;complete_a:=true;complete_b:=true;
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
 'missingPeriods',missing,'completeYtd',jsonb_array_length(missing)=0,'ytd',ym,'ytdGpr',ym->'gpr','ytdExpenses',ym->'expenses',
 'close',case when v.version_id is not null then to_jsonb(v)||jsonb_build_object('metrics',v.metrics||jsonb_build_object('netCashFlow',atlas_private.finance_actual_metric(v,'cashFlow',null))) end);
end;$$;

-- A community lock covers all dependent YTD periods, including a correction to
-- an earlier month. Failure rolls back the approval instead of losing a job.
create function atlas_private.project_finance(cid uuid) returns void language plpgsql security definer set search_path='' as $$
declare p text; s jsonb; payload jsonb; fp text; prior public.atlas_command_financial_summaries; pub public.atlas_command_financial_publications; actor uuid; k text;
begin
 perform pg_advisory_xact_lock(hashtextextended('finance:'||cid::text,0));
 for p in select period_key from public.atlas_financial_close_heads where community_id=cid and accounting_basis='accrual'
  union select b.calendar_year::text||'-'||lpad((m+1)::text,2,'0') from public.atlas_approved_budget_versions b cross join lateral unnest(b.covered_months) m where b.community_id=cid and b.effective_date<=current_date
  order by 1 loop
  s:=atlas_private.finance_envelope(cid,p);
  fp:=encode(sha256(convert_to(s::text,'UTF8')),'hex');
  select * into prior from public.atlas_command_financial_summaries where community_id=cid and period_key=p;
  select * into pub from public.atlas_command_financial_publications where community_id=cid and period_key=p and fingerprint=fp;
  if pub.publication_id is not null and pub.publication_id=prior.publication_id then continue;end if;
  actor:=coalesce(auth.uid(),(s->'close'->>'approved_by')::uuid,(select approved_by from public.atlas_approved_budget_versions where version_id=(s->>'budgetVersion')::uuid));
  payload:=jsonb_build_object('schemaVersion',1,'communityId',cid,'period',p,'canonical',true,'summary',s,'actualCloseVersion',s->'actualCloseVersion','budgetVersion',s->'budgetVersion');
  if pub.publication_id is null then
   insert into public.atlas_command_financial_publications(community_id,period_key,fiscal_year,version,fingerprint,payload,published_by)
   values(cid,p,(s->>'fiscalYear')::integer,coalesce(prior.version,0)+1,fp,payload,actor) returning * into pub;
  end if;
  -- Close detail remains in the protected immutable version table, not the roster.
  s:=(s-'close')||jsonb_build_object('publishedAt',pub.published_at,'publicationId',pub.publication_id);
  insert into public.atlas_command_financial_summaries values(cid,p,pub.publication_id,pub.fiscal_year,pub.version,s)
  on conflict(community_id,period_key) do update set publication_id=excluded.publication_id,fiscal_year=excluded.fiscal_year,version=excluded.version,summary=excluded.summary;
  foreach k in array array['gpr','expenses','noi','cashFlow'] loop
   if s->k->>'status' in ('missing','unfavorable') then
    insert into public.atlas_command_findings(community_id,period_key,publication_id,metric,payload) values(cid,p,pub.publication_id,k,
    jsonb_build_object('category',case when s->k->>'status'='missing' then 'Data Readiness' else 'Financial' end,'status','Open','severity','Watch','actual',s->k->'actual','target',s->k->'budget','variance',s->k->'variance','label',s->k->'label','source',s->'actualSource','sourceTimestamp',s->'sourceTimestamp','recommendedResponse','Review '||k||' for '||p||': '||(s->k->>'label'))) on conflict do nothing;
   end if;
  end loop;
 end loop;
end;$$;
create function atlas_private.finance_projection_trigger() returns trigger language plpgsql security definer set search_path='' as $$
begin perform atlas_private.project_finance(new.community_id);return new;end;$$;
create trigger close_projects_reporting after insert or update on public.atlas_financial_close_heads for each row execute function atlas_private.finance_projection_trigger();
create trigger budget_projects_reporting after insert on public.atlas_approved_budget_versions for each row execute function atlas_private.finance_projection_trigger();

create function atlas_private.close_metric_contract() returns trigger language plpgsql set search_path='' as $$
begin
 new.metrics:=new.metrics||jsonb_build_object('netCashFlow',new.metrics->'sourceControls'->'Net Cash Flow'->'actual','registryVersion','atlas-finance-v1');
 return new;
end;$$;
revoke all on function atlas_private.close_metric_contract() from public,anon,authenticated;
create trigger close_metric_contract before insert on public.atlas_financial_close_versions for each row execute function atlas_private.close_metric_contract();

-- Serialize before the existing close locks, including retries and replacements.
alter function public.atlas_close_financial_review(uuid,uuid,text,boolean) set schema atlas_private;
create function public.atlas_close_financial_review(p_review_id uuid,p_expected_version_id uuid,p_reason text,p_accounting_approved boolean)
returns public.atlas_financial_close_versions language plpgsql security definer set search_path='' as $$
declare cid uuid; result public.atlas_financial_close_versions;
begin
 if auth.uid() is null or not exists(select 1 from public.atlas_user_profiles where user_id=auth.uid() and role='admin' and status='active') then raise exception 'Only an active Admin may close financial actuals';end if;
 select community_id into cid from public.atlas_financial_package_reviews where review_id=p_review_id;
 if cid is null or not atlas_private.financial_review_access(cid,true) then raise exception 'Financial close access denied';end if;
 perform pg_advisory_xact_lock(hashtextextended('finance:'||cid::text,0));
 result:=atlas_private.atlas_close_financial_review(p_review_id,p_expected_version_id,p_reason,p_accounting_approved);
 perform atlas_private.project_finance(cid); -- also repairs/replays an existing close idempotently
 return result;
end;$$;

create function public.atlas_approve_original_budget(p_community_id uuid,p_payload jsonb)
returns public.atlas_approved_budget_versions language plpgsql security definer set search_path='' as $$
declare r jsonb; part jsonb; k text; codes text[]:='{}'; seen text[]; a jsonb; fp text; prior public.atlas_approved_budget_versions; result public.atlas_approved_budget_versions; y integer; months integer[]; month_idx integer;
begin
 if auth.uid() is null or not exists(select 1 from public.atlas_user_profiles where user_id=auth.uid() and role='admin' and status='active') or not atlas_private.command_access(p_community_id,'finance') then raise exception 'Only an active scoped Admin may approve the original budget';end if;
 if p_payload is null or p_payload->>'communityId' is distinct from p_community_id::text or p_payload->>'reviewConfirmed' is distinct from 'true' or p_payload->>'approvedLocked' is distinct from 'true' or p_payload->>'registryVersion' is distinct from 'atlas-finance-v1' or coalesce(p_payload->>'sourceHash','') !~ '^[0-9a-f]{64}$' or coalesce(p_payload->>'sourceFile','')='' or coalesce(p_payload->>'scenarioId','')='' or coalesce(p_payload->>'scenarioVersion','')='' or coalesce(p_payload->>'year','') !~ '^20[0-9]{2}$' or coalesce(p_payload->>'fiscalYear','') !~ '^20[0-9]{2}$' or coalesce(p_payload->>'fiscalStartMonth','') !~ '^(1[0-2]|[1-9])$' or coalesce(p_payload->>'effectiveDate','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' or jsonb_typeof(p_payload->'rows') is distinct from 'array' or jsonb_array_length(p_payload->'rows') not between 1 and 2000 or octet_length(p_payload::text)>2097152 then raise exception 'Incomplete approved budget and source evidence';end if;
 -- Future approval can be added without changing this original-baseline contract;
 -- it must not become active merely because a browser posts it today.
 if (p_payload->>'effectiveDate')::date>current_date then raise exception 'Future-effective budgets cannot activate before their effective date';end if;
 y:=(p_payload->>'year')::integer;
 if p_payload ? 'coverage' and (jsonb_typeof(p_payload->'coverage') is distinct from 'array' or jsonb_array_length(p_payload->'coverage') not between 1 and 12) then raise exception 'Explicit budget month coverage required';end if;
 select array_agg(value::integer order by value::integer) into months from jsonb_array_elements_text(coalesce(p_payload->'coverage','[0,1,2,3,4,5,6,7,8,9,10,11]'));
 if exists(select 1 from unnest(months) n where n is null or n<0 or n>11) or cardinality(months)<>(select count(distinct n) from unnest(months) n) then raise exception 'Invalid budget month coverage';end if;
 for r in select value from jsonb_array_elements(p_payload->'rows') loop
  k:=r->>'glCode';
  if coalesce(k,'')='' or k=any(codes) or jsonb_typeof(r->'monthly') is distinct from 'array' or jsonb_array_length(r->'monthly')<>12 then raise exception 'Duplicate GL or incomplete twelve-month approved budget';end if;
  codes:=array_append(codes,k);
  for month_idx in 0..11 loop
   a:=r->'monthly'->month_idx;
   if month_idx=any(months) then
    if jsonb_typeof(a) is distinct from 'number' or abs(a::text::numeric)>1000000000000 or round(a::text::numeric,2)<>a::text::numeric then raise exception 'Approved amounts require explicit numeric values; missing is not zero';end if;
   elsif a is distinct from 'null'::jsonb then raise exception 'Amounts outside approved coverage must remain missing';end if;
  end loop;
 end loop;
 if jsonb_typeof(p_payload->'metricMappings') is distinct from 'object' then raise exception 'Reviewed metric GL mappings required';end if;
 for k in select jsonb_object_keys(p_payload->'metricMappings') loop
  if not exists(select 1 from public.atlas_financial_metric_registry where registry_version='atlas-finance-v1' and metric_key=k and availability<>'source_not_supported') then raise exception 'Unsupported metric mapping';end if;
  if jsonb_typeof(p_payload->'metricMappings'->k) is distinct from 'array' then raise exception 'Invalid metric mapping';end if;
  seen:='{}';
  for part in select value from jsonb_array_elements(p_payload->'metricMappings'->k) loop
   if not coalesce(part->>'glCode','')=any(codes) or (part->>'glCode')=any(seen) or coalesce(part->>'factor','') not in ('1','-1') then raise exception 'Invalid or duplicate metric GL mapping';end if;
   seen:=array_append(seen,part->>'glCode');
  end loop;
 end loop;
 if p_payload->'metricMappings'->'gpr' is distinct from '[{"glCode":"5120","factor":1}]'::jsonb then raise exception 'GPR requires approved GL 5120';end if;
 if jsonb_typeof(p_payload->'occupancyPct') is distinct from 'array' or jsonb_array_length(p_payload->'occupancyPct')<>12 then raise exception 'Twelve occupancy coverage entries required';end if;
 for a in select value from jsonb_array_elements(p_payload->'occupancyPct') loop
  if a<>'null'::jsonb and (jsonb_typeof(a)<>'number' or a::text::numeric<0 or a::text::numeric>100) then raise exception 'Invalid approved occupancy';end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('finance:'||p_community_id::text,0));
 fp:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
 select * into prior from public.atlas_approved_budget_versions where community_id=p_community_id and calendar_year=y and content_hash=fp;
 if prior.version_id is not null then
  if prior.content_hash=fp then perform atlas_private.project_finance(p_community_id);return prior;end if;
 end if;
 if exists(select 1 from public.atlas_approved_budget_versions where community_id=p_community_id and calendar_year=y and covered_months && months) then raise exception 'Original approved budget is immutable; revisions and reforecasts cannot overwrite it';end if;
 insert into public.atlas_approved_budget_versions(community_id,calendar_year,fiscal_year,fiscal_start_month,scenario_id,scenario_version,effective_date,source_file,source_hash,content_hash,approved_by,covered_months,payload)
 values(p_community_id,y,(p_payload->>'fiscalYear')::integer,(p_payload->>'fiscalStartMonth')::integer,p_payload->>'scenarioId',p_payload->>'scenarioVersion',(p_payload->>'effectiveDate')::date,p_payload->>'sourceFile',p_payload->>'sourceHash',fp,auth.uid(),months,p_payload) returning * into result;
 return result;
end;$$;
-- The former browser summary route cannot overwrite canonical reporting anymore.
create or replace function public.atlas_publish_command_financials(p_community_id uuid,p_period text,p_expected_version integer,p_payload jsonb)
returns public.atlas_command_financial_summaries language plpgsql security definer set search_path='' as $$
declare result public.atlas_command_financial_summaries;
begin
 if auth.uid() is null or not exists(select 1 from public.atlas_user_profiles where user_id=auth.uid() and status='active' and role='admin') or not atlas_private.command_access(p_community_id,'finance') then raise exception 'Only an active Admin may publish financial data';end if;
 if not exists(select 1 from public.atlas_financial_close_heads where community_id=p_community_id and period_key=p_period and accounting_basis='accrual') then raise exception 'Close the completed accounting period before publishing actuals';end if;
 perform atlas_private.project_finance(p_community_id);
 select * into result from public.atlas_command_financial_summaries where community_id=p_community_id and period_key=p_period;
 return result;
end;$$;
-- Reads derive from authority in one database snapshot. Reports retain the same
-- envelope in their immutable publication; no local browser budget is consulted.
create function public.atlas_read_finance(p_community_ids uuid[],p_periods text[])
returns table(community_id uuid,period_key text,fiscal_year integer,publication_id uuid,summary jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(cardinality(p_community_ids),0) not between 1 and 100 or coalesce(cardinality(p_periods),0) not between 1 and 24 or cardinality(p_community_ids)*cardinality(p_periods)>1200
 or exists(select 1 from unnest(p_periods) p where p is null or p !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$') then raise exception 'Invalid finance read scope';end if;
 return query select f.community_id,f.period_key,f.fiscal_year,f.publication_id,
 f.summary||jsonb_build_object('close',case when v.version_id is not null then
 jsonb_build_object('version_id',v.version_id,'comparison_version_id',v.comparison_version_id,'community_id',v.community_id,'period_key',v.period_key,'status',v.status,'coverage',v.coverage,'accounting_basis',v.accounting_basis,'source_file',v.source_file,'source_hash',v.source_hash,'approved_by',v.approved_by,'approved_at',v.approved_at,'revision',v.revision,'row_count',v.row_count,
 'metrics',jsonb_build_object('grossPotentialRent',f.summary->'gpr'->'actual','netRentalIncome',f.summary->'netRentalIncome'->'actual','totalIncome',f.summary->'revenue'->'actual','operatingExpenses',f.summary->'expenses'->'actual','netOperatingIncome',f.summary->'noi'->'actual','netCashFlow',f.summary->'cashFlow'->'actual')) end)
 from public.atlas_command_financial_summaries f
 left join public.atlas_financial_close_versions v on v.version_id=(f.summary->>'actualCloseVersion')::uuid
 where f.community_id=any(p_community_ids) and f.period_key=any(p_periods)
 and f.summary->>'registryVersion'='atlas-finance-v1' and atlas_private.command_access(f.community_id);
end;$$;
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
 select jsonb_build_object('publicationId',publication_id,'summary',summary-'close') into financial from public.atlas_read_finance(array[plan.community_id],array[plan.period_key]);
 if p_occupancy is not null and p_occupancy<>'null'::jsonb then
  if p_occupancy->>'communityId' is distinct from plan.community_id::text or p_occupancy->>'period' is distinct from plan.period_key or jsonb_typeof(p_occupancy->'occupiedUnits') is distinct from 'number' or jsonb_typeof(p_occupancy->'rentableUnits') is distinct from 'number' or coalesce(p_occupancy->>'source','')='' or coalesce(p_occupancy->>'sourceTimestamp','')='' or coalesce(p_occupancy->>'revisionKey','')='' then raise exception 'Verified period-specific occupancy source required';end if;
  occupied:=(p_occupancy->>'occupiedUnits')::numeric;rentable:=(p_occupancy->>'rentableUnits')::numeric;
  if rentable<=0 or occupied<0 or occupied>rentable or trunc(occupied)<>occupied or trunc(rentable)<>rentable then raise exception 'Invalid occupancy source counts';end if;
  target:=ceil((financial->'summary'->>'occupancyPct')::numeric*rentable/100);
  occupancy:=jsonb_build_object('occupiedUnits',occupied,'rentableUnits',rentable,'physicalPct',occupied/rentable*100,'budgetPct',financial->'summary'->'occupancyPct','budgetUnits',target,'variance',occupied-target,'source',p_occupancy->'source','sourceTimestamp',p_occupancy->'sourceTimestamp','revisionKey',p_occupancy->'revisionKey');
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_plan_id::text||':report',0));
 select * into result from public.atlas_community_plan_reports where snapshot->>'reportSchemaVersion'='3' and plan_id=p_plan_id and plan_version=plan.version and executive_note=p_note and (snapshot->'financial') is not distinct from coalesce(financial,'null'::jsonb) and (snapshot->'occupancy') is not distinct from coalesce(occupancy,'null'::jsonb) order by created_at limit 1;
 if result.report_id is not null then return result;end if;
 select * into prior from public.atlas_community_plan_reports where community_id=plan.community_id and snapshot->>'period'<=plan.period_key order by created_at desc,report_id desc limit 1;
 if prior.report_id is not null then previous:=jsonb_build_object('reportId',prior.report_id,'period',prior.snapshot->'period','generatedAt',prior.created_at,'financial',prior.snapshot->'financial','occupancy',prior.snapshot->'occupancy','tasks',(select coalesce(jsonb_agg(jsonb_build_object('id',t->'id','status',t->'status')),'[]') from jsonb_array_elements(prior.snapshot->'plan'->'tasks') t));end if;
 insert into public.atlas_community_plan_reports(plan_id,community_id,plan_version,executive_note,snapshot,created_by)
 values(plan.plan_id,plan.community_id,plan.version,p_note,jsonb_build_object('reportSchemaVersion',3,'previousReport',previous,'review',review,'plan',plan.payload,'period',plan.period_key,'sourceUpdatedAt',plan.updated_at,'community',(select display_name from public.atlas_communities where community_id=plan.community_id),'financial',financial,'occupancy',occupancy,'coverage',case when occupancy is null then 'Operational occupancy source is unavailable in this snapshot. ' else 'Occupancy uses the retained period-specific source revision. ' end||'Missing or incomplete financial coverage must be resolved in Budget Builder; underspend does not establish true savings.'),auth.uid()) returning * into result;
 return result;
end;$$;
revoke all on function public.atlas_generate_community_plan_report(uuid,integer,text,jsonb) from public,anon;
grant execute on function public.atlas_generate_community_plan_report(uuid,integer,text,jsonb) to authenticated;

-- No private definer/helper function is a public API.
revoke all on function atlas_private.finance_budget_metric(jsonb,text,integer),atlas_private.finance_actual_metric(public.atlas_financial_close_versions,text,jsonb),atlas_private.finance_metric(numeric,numeric,integer,text),atlas_private.finance_envelope(uuid,text),atlas_private.project_finance(uuid),atlas_private.finance_projection_trigger(),atlas_private.atlas_close_financial_review(uuid,uuid,text,boolean) from public,anon,authenticated;
revoke all on function public.atlas_close_financial_review(uuid,uuid,text,boolean),public.atlas_approve_original_budget(uuid,jsonb),public.atlas_read_finance(uuid[],text[]) from public,anon;
grant execute on function public.atlas_close_financial_review(uuid,uuid,text,boolean),public.atlas_approve_original_budget(uuid,jsonb),public.atlas_read_finance(uuid[],text[]) to authenticated;
-- Existing closes are projected without changing their immutable rows or approval.
do $$ declare cid uuid;begin for cid in select distinct community_id from public.atlas_financial_close_heads loop perform atlas_private.project_finance(cid);end loop;end $$;
commit;
