-- Additive, immutable export receipts. Financial revisions and publications are
-- read, never rewritten. All mutation authority stays in guarded private RPCs.
begin;
create table public.atlas_budget_export_tolerances (
 version_id uuid primary key default gen_random_uuid(),community_id uuid not null references public.atlas_communities(community_id),
 version integer not null check(version>0),request_id uuid not null unique,request_hash text not null,
 rules jsonb not null,reason text not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 unique(community_id,version)
);
create table public.atlas_budget_exports (
 export_id uuid primary key default gen_random_uuid(),community_id uuid not null references public.atlas_communities(community_id),
 revision_id uuid references public.atlas_reforecast_revisions(revision_id),publication_id uuid references public.atlas_reforecast_publications(publication_id),
 original_budget_version_id uuid references public.atlas_approved_budget_versions(version_id),
 request_id uuid not null unique,request_hash text not null,budget_status text not null,budget_version text not null,
 options jsonb not null,validation jsonb not null,override jsonb,
 snapshot jsonb not null,content_hash text not null,source_fingerprint text not null,
 generated_by uuid not null references auth.users(id),generated_at timestamptz not null default now(),
 check((revision_id is not null and original_budget_version_id is null) or (revision_id is null and publication_id is null and original_budget_version_id is not null))
);
create table public.atlas_budget_export_files (
 file_record_id uuid primary key default gen_random_uuid(),export_id uuid not null references public.atlas_budget_exports(export_id),
 community_id uuid not null references public.atlas_communities(community_id),request_id uuid not null unique,request_hash text not null,
 files jsonb not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),unique(export_id)
);
create index atlas_budget_export_history on public.atlas_budget_exports(community_id,generated_at desc,export_id);
create index atlas_budget_export_revision on public.atlas_budget_exports(revision_id) where revision_id is not null;
create index atlas_budget_export_publication on public.atlas_budget_exports(publication_id) where publication_id is not null;
create index atlas_budget_export_original on public.atlas_budget_exports(original_budget_version_id) where original_budget_version_id is not null;
create index atlas_budget_export_actor on public.atlas_budget_exports(generated_by);
create index atlas_budget_export_files_scope on public.atlas_budget_export_files(community_id);
create index atlas_budget_export_files_actor on public.atlas_budget_export_files(created_by);
create index atlas_budget_export_tolerance_actor on public.atlas_budget_export_tolerances(created_by);
do $$declare t text;begin foreach t in array array['atlas_budget_export_tolerances','atlas_budget_exports','atlas_budget_export_files'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy budget_export_read on public.%I for select to authenticated using(atlas_private.reforecast_access(community_id,''read''))',t);
 execute format('create trigger budget_export_immutable before update or delete on public.%I for each row execute function atlas_private.finance_immutable()',t);
end loop;end;$$;

create function atlas_private.budget_export_tolerances(cid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.atlas_budget_export_tolerances;begin
 if auth.uid() is null or not atlas_private.reforecast_access(cid,'read') then raise exception 'Budget export access denied';end if;
 select * into r from public.atlas_budget_export_tolerances where community_id=cid order by version desc limit 1;
 return jsonb_build_object('communityId',cid,'version',coalesce(r.version,0),'versionId',r.version_id,'rules',coalesce(r.rules,'{"default":{"dollar":100,"percent":5,"operator":"or"},"accounts":{},"categories":{}}'::jsonb),'createdBy',r.created_by,'createdAt',r.created_at,
 'canAdminister',exists(select 1 from public.atlas_user_profiles p where p.user_id=auth.uid() and p.status='active' and p.role='admin'),
 'canOverrideFinal',atlas_private.reforecast_access(cid,'review'));
end;$$;
create function atlas_private.save_budget_export_tolerances(cid uuid,expected integer,rid uuid,rules jsonb,reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.atlas_budget_export_tolerances;hash text;current_version integer;rule jsonb;begin
 if auth.uid() is null or not atlas_private.reforecast_access(cid,'read') or not exists(select 1 from public.atlas_user_profiles where user_id=auth.uid() and status='active' and role='admin') then raise exception 'Budget tolerance administrator required';end if;
 if rid is null or expected is null or expected<0 or length(trim(coalesce(reason,'')))<3 or jsonb_typeof(rules) is distinct from 'object' or octet_length(rules::text)>65536
 or jsonb_typeof(rules->'default') is distinct from 'object' or jsonb_typeof(rules->'accounts') is distinct from 'object' or jsonb_typeof(rules->'categories') is distinct from 'object' then raise exception 'Provide a reason and default, account and category tolerances';end if;
 for rule in select rules->'default' union all select value from jsonb_each(rules->'accounts') union all select value from jsonb_each(rules->'categories') loop
  if jsonb_typeof(rule) is distinct from 'object' or coalesce(rule->>'operator','') not in ('or','and')
   or coalesce(jsonb_typeof(rule->'dollar'),'null') not in ('number','null') or coalesce(jsonb_typeof(rule->'percent'),'null') not in ('number','null')
   or coalesce((rule->>'dollar')::numeric,0)<0 or coalesce((rule->>'percent')::numeric,0)<0
   or (rule->>'dollar' is null and rule->>'percent' is null) then raise exception 'Each tolerance requires a nonnegative dollar or percentage threshold and or/and operator';end if;
 end loop;
 hash:=encode(sha256(convert_to(jsonb_build_array(cid,expected,rules,reason)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('budget-export-tolerances:'||cid,0));
 select * into r from public.atlas_budget_export_tolerances where request_id=rid;
 if r.version_id is not null then
  if r.community_id<>cid or r.created_by<>auth.uid() or r.request_hash<>hash then raise exception 'Tolerance request ID reused';end if;
  return jsonb_build_object('communityId',cid,'version',r.version,'versionId',r.version_id,'rules',r.rules,'createdBy',r.created_by,'createdAt',r.created_at);
 end if;
 select coalesce(max(version),0) into current_version from public.atlas_budget_export_tolerances where community_id=cid;
 if current_version<>expected then raise exception 'Tolerance settings changed; reload before saving';end if;
 insert into public.atlas_budget_export_tolerances(community_id,version,request_id,request_hash,rules,reason,created_by) values(cid,current_version+1,rid,hash,rules,reason,auth.uid()) returning * into r;
 return jsonb_build_object('communityId',cid,'version',r.version,'versionId',r.version_id,'rules',r.rules,'createdBy',r.created_by,'createdAt',r.created_at);
end;$$;

-- Amounts originate in the retained ATLAS snapshot. This only verifies existing
-- control totals and driver evidence; it does not create a spreadsheet model.
create function atlas_private.budget_export_integrity(s jsonb,config jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare issues jsonb:='[]';checks jsonb:='[]';row jsonb;computed jsonb;month_lines jsonb;metric text;kind text;expected numeric;actual numeric;periods text[];p text;prior text;start_month integer;has_issue boolean;
begin
 if jsonb_typeof(s->'lines') is distinct from 'array' or jsonb_typeof(s->'monthly') is distinct from 'array' or jsonb_typeof(s->'totals') is distinct from 'object' then
  issues:=issues||jsonb_build_array(jsonb_build_object('code','missing_financial_snapshot','severity','error','material',true,'message','Retained monthly financial values and totals are required.'));
 end if;
 select array_agg(v order by v) into periods from jsonb_array_elements_text(coalesce(s->'periods',config->'periods','[]'))v;
 if periods is null or cardinality(periods) not between 1 and 24 or exists(select 1 from unnest(periods)v where v!~'^20[0-9]{2}-(0[1-9]|1[0-2])$') or (select count(distinct v) from unnest(periods)v)<>cardinality(periods) then
  issues:=issues||jsonb_build_array(jsonb_build_object('code','fiscal_calendar','severity','error','material',true,'message','Distinct fiscal reporting months are required.'));
 else
  foreach p in array periods loop
   if prior is not null and to_char((prior||'-01')::date+interval '1 month','YYYY-MM')<>p then issues:=issues||jsonb_build_array(jsonb_build_object('code','fiscal_calendar','severity','error','material',true,'period',p,'message','Fiscal months must be consecutive.'));end if;prior:=p;
  end loop;
  if jsonb_typeof(config#>'{calendar,startMonth}')='number' then
   start_month:=(config#>>'{calendar,startMonth}')::integer;
   if start_month not between 1 and 12 or (cardinality(periods)=12 and right(periods[1],2)::integer<>start_month) then issues:=issues||jsonb_build_array(jsonb_build_object('code','fiscal_calendar','severity','error','material',true,'message','Fiscal start month does not match the retained reporting periods.'));end if;
  else issues:=issues||jsonb_build_array(jsonb_build_object('code','fiscal_calendar','severity','error','material',true,'message','The selected budget has no retained fiscal start month.'));end if;
 end if;
 for row in select value from jsonb_array_elements(coalesce(s->'diagnostics','[]')) where value->>'severity' in ('error','blocking','warning') loop
  issues:=issues||jsonb_build_array(row||jsonb_build_object('material',row->>'severity' in ('error','blocking')));
 end loop;
 for row in select value from jsonb_array_elements(coalesce(s#>'{driverValidation,issues}','[]')) where value->>'overrideAccepted' is distinct from 'true' union all select value from jsonb_array_elements(coalesce(s#>'{driverValidation,warnings}','[]')) where value->>'overrideAccepted' is distinct from 'true' loop
  issues:=issues||jsonb_build_array(row||jsonb_build_object('material',coalesce((row->>'material')::boolean,true)));
 end loop;
 -- Reuse the ATLAS financial metric function for open-month detail checks.
 -- Closed actual control totals can legitimately exceed incomplete GL detail.
 for row in select value from jsonb_array_elements(coalesce(s->'monthly','[]')) loop
  select coalesce(jsonb_agg(v),'[]') into month_lines from jsonb_array_elements(coalesce(s->'lines','[]'))v where v->>'period'=row->>'period';
  if row->>'closed' is distinct from 'true' and exists(select 1 from jsonb_array_elements(month_lines)v where v->>'sourceKind'='forecast') then
   computed:=atlas_private.reforecast_metric(month_lines,'forecast');
   foreach metric in array array['grossIncome','contraRevenue','revenue','opex','expenses','belowNoi','capital','debt','noi','cashFlow'] loop
    if jsonb_typeof(row->'reforecast'->metric)='number' and (jsonb_typeof(computed->metric) is distinct from 'number' or abs((row->'reforecast'->>metric)::numeric-(computed->>metric)::numeric)>0.005) then
     issues:=issues||jsonb_build_array(jsonb_build_object('code','monthly_account_totals','severity','error','material',true,'section',case when metric in ('grossIncome','contraRevenue','revenue') then 'revenue' else 'expenses' end,'period',row->'period','metric',metric,'expectedAmount',computed->metric,'manualAmount',row->'reforecast'->metric,'message','Monthly total differs from the retained ATLAS account values.'));
    end if;
   end loop;
  end if;
 end loop;
 foreach kind in array array['originalBudget','reforecast','actuals'] loop
  foreach metric in array array['grossIncome','contraRevenue','revenue','opex','expenses','belowNoi','capital','debt','noi','cashFlow'] loop
   if jsonb_typeof(s->'totals'->kind->metric)='number' then
    select sum((v->kind->>metric)::numeric) into expected from jsonb_array_elements(coalesce(s->'monthly','[]'))v;
    actual:=(s->'totals'->kind->>metric)::numeric;
    if expected is null or abs(actual-expected)>0.005 then issues:=issues||jsonb_build_array(jsonb_build_object('code','annual_totals','severity','error','material',true,'metric',kind||'.'||metric,'expectedAmount',expected,'manualAmount',actual,'message','Annual total differs from retained monthly amounts.'));end if;
   end if;
  end loop;
 end loop;
 if exists(select 1 from jsonb_array_elements(coalesce(s->'lines','[]'))v group by v->>'period',v->>'accountCode' having count(*)>1) then issues:=issues||jsonb_build_array(jsonb_build_object('code','duplicate_financial_cell','severity','error','material',true,'message','Duplicate account/month values are present.'));end if;
 for kind in select unnest(array['leasing','revenue','expenses','utilities','str','fiscal_calendar','annual_totals']) loop
  select exists(select 1 from jsonb_array_elements(issues)v where v->>'code'=kind or v->>'section'=kind
   or kind='leasing' and (v->>'code' like '%leasing%' or v->>'code' in ('budget_driver_mismatch','missing_driver_assumptions','driver_dependency_cycle','duplicate_account_driver'))
   or kind='str' and v->>'code' like 'str_%'
   or kind in ('revenue','expenses','utilities') and exists(select 1 from jsonb_array_elements(coalesce(s->'lines','[]'))l where l->>'accountCode'=v->>'accountCode' and case kind when 'revenue' then l->>'nature' in ('income','contra_income') when 'expenses' then l->>'nature'='expense' else coalesce(l->>'category','')~*'utilit' end)) into has_issue;
  checks:=checks||jsonb_build_array(jsonb_build_object('key',kind,'status',case when has_issue then 'warning' when kind='str' and jsonb_array_length(coalesce(s->'strSchedules','[]'))=0 and jsonb_array_length(coalesce(s->'strLeasingSchedules','[]'))=0 and s->'savedStrProgramme' is null then 'not_applicable' when kind='leasing' and jsonb_array_length(coalesce(s#>'{leasingSchedule,monthly}',s->'leasing','[]'))=0 then 'unavailable' else 'passed' end));
 end loop;
 return jsonb_build_object('checks',checks,'issues',issues,'materialIssueCount',(select count(*) from jsonb_array_elements(issues)v where v->>'material'='true'),'status',case when exists(select 1 from jsonb_array_elements(issues)v where v->>'material'='true') then 'action_required' when jsonb_array_length(issues)>0 then 'warnings' else 'passed' end);
end;$$;

create function atlas_private.read_budget_export(cid uuid,eid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.atlas_budget_exports;begin
 if auth.uid() is null or not atlas_private.reforecast_access(cid,'read') then raise exception 'Budget export access denied';end if;
 select * into r from public.atlas_budget_exports where export_id=eid and community_id=cid;
 if r.export_id is null then raise exception 'Budget export not found for selected community';end if;
 if r.content_hash is distinct from encode(sha256(convert_to(r.snapshot::text,'UTF8')),'hex') then raise exception 'Budget export immutable snapshot verification failed';end if;
 return r.snapshot||jsonb_build_object('exportId',r.export_id,'communityId',r.community_id,'revisionId',r.revision_id,'publicationId',r.publication_id,'originalBudgetVersionId',r.original_budget_version_id,'budgetVersion',r.budget_version,'budgetStatus',r.budget_status,'options',r.options,'validation',r.validation,'override',r.override,'generatedBy',r.generated_by,'generatedAt',r.generated_at,'contentHash',r.content_hash,'sourceFingerprint',r.source_fingerprint,'verified',true);
end;$$;

-- Allowlisted report evidence deliberately excludes attachments, reservations,
-- rosters and source file contents while retaining useful operating assumptions.
create function atlas_private.budget_export_evidence(value jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb;entry record;allowed text[]:=array['schemaVersion','id','name','label','kind','type','period','periods','monthly','months','totals','values','amount','annual','note','units','unitCount','unitsEntering','unitsLeaving','beginningAvailableUnits','endingUnits','availableUnits','availableNights','blockedNights','blockedPercent','permitCappedNights','rentableNights','budgetedOccupancy','occupancyPercent','bookedNights','occupiedNights','occupiedUnitNights','availableUnitNights','adr','revpar','grossPerOccupiedNight','grossRentalRevenue','grossIncome','netIncome','budgetedRevenue','revenue','expenses','operatingExpenses','strNoi','strUplift','stays','checkouts','averageLengthOfStay','conventionalUnitsDisplaced','conventionalRentDisplaced','conventionalRentPerUnit','conventionalNoi','otherRevenue','revenueDeductions','taxableRevenue','daysInMonth','streamId','programmeId','programmeRevisionId','revisionId','contentHash','sourceHash','sourceFingerprint','sourceReceiptId','supportingSchedules','leasingSchedule','channels','utilities','assumptions','sensitivities','sourceKind','accountCode','accountName','accountCodes','category','operation','value','rate','baseAmount','baseAccountCode','metric','reason','comment','userId','actorId','timestamp','createdAt','reviewedAt','ownerId','originalValue','originalCalculatedValue','overrideValue','driverOverride','calculatedAmount','manualAmount','affectedDrivers','status','beginningOccupiedUnits','endingOccupiedUnits','occupiedUnits','moveIns','moveOuts','leasedUnits','averageOccupiedUnits','physicalOccupancy','leasedOccupancy','occupancy','marketRent','effectiveRent','lossToLeasePercent','concessions','concessionPerMoveIn','badDebtPercent','badDebt','rentGrowth','newLeaseRent','renewalRent','renewals','grossPotentialRent','rentalIncome','vacancy','netRentalIncome','feePercent','revenueShare','channel','utility','fixedAmount','variableAmount','expenseAccount','incomeAccount','accountMapping','appliedAt','appliedBy','applicationId','key','share','feePct','direct','gl','present','cost','rates','fixedCharges','totalUsage','unitOfUsage','total','byGl','parts','annualTotal','lostRecovery','group','unit','baseValue','noiUp','noiDn','upliftUp','upliftDn','swing','upliftSwing','decisionSwing','elasticity','flipsDecision','direction','rank','checks','warnings','issues','overrides','reconciled','code','severity','message','material','title','currentCalculatedAmount','expectedAmount','varianceAmount','variancePercent','tolerance','dollar','percent','operator','overrideAccepted','missingAssumptions','warning','override','actual','expected','driver','driverId','driverType','budgetDriverIds','driverValidation','strLeasingSchedule','strLeasingSchedules','accountDrivers','version','communityId','targetRevisionId','calendar','basis','startMonth','fiscalYear','verified','mappings','cells','sourceLineId','sourceGL','confirmed','parentAbsent','beforeAmount','conventionalAmount','previousStrAmount','strAmount','combinedAmount','appliedDelta','nature'];
begin
 if jsonb_typeof(value)='array' then select coalesce(jsonb_agg(atlas_private.budget_export_evidence(v)),'[]') into result from jsonb_array_elements(value)v;return result;end if;
 if jsonb_typeof(value)<>'object' then return value;end if;
 result:='{}';for entry in select key,v from jsonb_each(value)e(key,v) loop
  if entry.key=any(allowed) or entry.key~'^20[0-9]{2}(-[0-9]{2})?$' then
   if entry.key='assumptions' and jsonb_typeof(entry.v)='object' then result:=result||jsonb_build_object(entry.key,(select coalesce(jsonb_object_agg(k,v),'{}') from jsonb_each(entry.v)a(k,v) where jsonb_typeof(v) in ('string','number','boolean','null')));
   else result:=result||jsonb_build_object(entry.key,atlas_private.budget_export_evidence(entry.v));end if;
  end if;
 end loop;return result;
end;$$;

create function atlas_private.resolve_budget_export_source(cid uuid,selection jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.atlas_budget_exports;rev public.atlas_reforecast_revisions;pub public.atlas_reforecast_publications;original public.atlas_approved_budget_versions;
 source_snapshot jsonb;projected jsonb;config jsonb;source jsonb;data jsonb;validation jsonb;override_record jsonb;hash text;source_hash text;status text;version text;tolerances jsonb;is_final boolean;community jsonb;periods jsonb;lines jsonb;row jsonb;monthly jsonb:='[]';totals jsonb;metric text;total numeric;selected_period text;kind text;
begin
 if auth.uid() is null or not atlas_private.reforecast_access(cid,'read') then raise exception 'Budget export access denied';end if;
 if jsonb_typeof(selection) is distinct from 'object' or (selection->>'originalBudgetVersionId' is not null) = (selection->>'revisionId' is not null or selection->>'publicationId' is not null) then raise exception 'Select one exact saved budget version';end if;
 if selection->>'originalBudgetVersionId' is not null then
  select * into original from public.atlas_approved_budget_versions where version_id=(selection->>'originalBudgetVersionId')::uuid and community_id=cid;
  if original.version_id is null or original.status<>'locked' then raise exception 'An exact locked original budget is required';end if;
  if original.content_hash is distinct from encode(sha256(convert_to(original.payload::text,'UTF8')),'hex') then raise exception 'Original budget content hash does not match its retained source';end if;
  select jsonb_agg(original.calendar_year::text||'-'||lpad((m+1)::text,2,'0') order by m) into periods from unnest(original.covered_months)m;
  select coalesce(jsonb_agg(jsonb_build_object('period',original.calendar_year::text||'-'||lpad((m+1)::text,2,'0'),'accountCode',v->'glCode','accountName',coalesce(v->'accountName',v->'name',v->'glCode'),'nature',v->'nature','category',v->'category','placement',v->'placement','forecast',v->'monthly'->m,'originalBudget',v->'monthly'->m,'selectedBaseline',v->'monthly'->m,'mappingValid',true) order by m,v->>'glCode'),'[]') into lines from jsonb_array_elements(original.payload->'rows')v cross join unnest(original.covered_months)m;
  -- Original approvals retain their approved metric mapping; never infer a GL's classification.
  for selected_period in select jsonb_array_elements_text(periods) loop
   totals:='{}';for metric in select jsonb_object_keys(coalesce(original.payload->'metricMappings','{}')) loop
    select sum((v->'monthly'->>(right(selected_period,2)::integer-1))::numeric*(mapping->>'factor')::numeric) into total from jsonb_array_elements(original.payload->'metricMappings'->metric)mapping join jsonb_array_elements(original.payload->'rows')v on v->>'glCode'=mapping->>'glCode';
    kind:=case metric when 'expenses' then 'opex' else metric end;totals:=totals||jsonb_build_object(kind,total);
   end loop;
   totals:=totals||jsonb_build_object('expenses',totals->'opex');monthly:=monthly||jsonb_build_array(jsonb_build_object('period',selected_period,'reforecast',totals,'originalBudget',totals));
  end loop;
  totals:='{}';foreach metric in array array['gpr','revenue','expenses','opex','noi','cashFlow','capital','debt'] loop select sum((v->'reforecast'->>metric)::numeric) into total from jsonb_array_elements(monthly)v;totals:=totals||jsonb_build_object(metric,total);end loop;
  config:=jsonb_build_object('name','Approved original budget','model',coalesce(original.payload->>'model','conventional'),'periods',periods,'calendar',jsonb_build_object('startMonth',original.fiscal_start_month,'fiscalYear',original.fiscal_year));
  source_snapshot:=jsonb_build_object('communityId',cid,'periods',periods,'identity',jsonb_build_object('communityId',cid,'periods',periods,'originalBudgetVersionId',original.version_id),'lines',lines,'monthly',monthly,'totals',jsonb_build_object('reforecast',totals,'originalBudget',totals),'diagnostics','[]'::jsonb,'leasing','[]'::jsonb,'fingerprint',original.content_hash);
  source:=jsonb_build_object('originalBudgetVersionId',original.version_id,'metricMappings',original.payload->'metricMappings');source_hash:=original.content_hash;status:='approved';version:=coalesce(original.scenario_version,original.calendar_year::text);is_final:=true;
 else
  if selection->>'publicationId' is not null then
   select * into pub from public.atlas_reforecast_publications where publication_id=(selection->>'publicationId')::uuid and community_id=cid;
   if pub.publication_id is null or selection->>'revisionId' is not null and (selection->>'revisionId')::uuid<>pub.revision_id then raise exception 'Publication does not match selected revision';end if;
   select * into rev from public.atlas_reforecast_revisions where revision_id=pub.revision_id and community_id=cid;
   if pub.snapshot is distinct from rev.snapshot or pub.source is distinct from rev.source then raise exception 'Publication differs from its immutable revision';end if;
  else select * into rev from public.atlas_reforecast_revisions where revision_id=(selection->>'revisionId')::uuid and community_id=cid;end if;
  if rev.revision_id is null or rev.status='deleted' then raise exception 'Saved budget revision is unavailable';end if;
  source_snapshot:=coalesce(pub.snapshot,rev.snapshot);config:=rev.payload;source:=rev.source;source_hash:=source_snapshot->>'fingerprint';
  if source_hash is distinct from encode(sha256(convert_to((source_snapshot-'fingerprint')::text,'UTF8')),'hex') then raise exception 'Budget snapshot fingerprint verification failed';end if;
  status:=case when pub.publication_id is not null and exists(select 1 from public.atlas_reforecast_active_heads where publication_id=pub.publication_id) then 'active' when pub.publication_id is not null then 'approved' else rev.status end;
  version:=coalesce(pub.version,rev.revision)::text;is_final:=pub.publication_id is not null or rev.status in ('approved','locked','investor_approved','pending_investor_approval');
 end if;
 -- Keep the raw authoritative inputs private for server integrity checks.
 validation:=jsonb_build_object('sourceSnapshot',source_snapshot,'sourceConfig',config);
 projected:=atlas_private.reforecast_report_snapshot(source_snapshot);
 -- These fields contain aggregate schedule/driver values, not unit identities or attachments.
 projected:=(projected-'fingerprint')||atlas_private.budget_export_evidence(atlas_private.reforecast_report_fields(source_snapshot,array['leasingSchedule','driverValidation','strLeasingSchedule','strLeasingSchedules']));
 projected:=projected||jsonb_build_object('fingerprint',encode(sha256(convert_to(projected::text,'UTF8')),'hex'));
 select to_jsonb(c) into community from public.atlas_communities c where community_id=cid;
 config:=atlas_private.reforecast_report_fields(config,array['name','model','periods','calendar','recordType','scenarioPurpose'])||atlas_private.budget_export_evidence(atlas_private.reforecast_report_fields(config,array['leasingSchedule','accountDrivers']))||jsonb_build_object('overrides',atlas_private.budget_export_evidence(coalesce(config->'overrides','[]')),'drivers',atlas_private.budget_export_evidence(coalesce(config->'drivers','[]')),'utilityDrivers',atlas_private.budget_export_evidence(coalesce(config->'utilityDrivers','[]')),'assumptions',atlas_private.budget_export_evidence(jsonb_build_object('assumptions',coalesce(config->'assumptions','{}')))->'assumptions','channels',atlas_private.budget_export_evidence(coalesce(config->'channels','[]')),'sensitivities',atlas_private.budget_export_evidence(coalesce(config->'sensitivities','[]')),'strBudgetApplications',atlas_private.budget_export_evidence(coalesce(config->'strBudgetApplications','[]')),'strStreams',atlas_private.budget_export_evidence(coalesce(config->'strStreams','[]')));
 data:=jsonb_build_object('schemaVersion','atlas.budget-export.v1','snapshot',projected,'config',config,
 'source',jsonb_build_object('communityId',cid,'sourceVersion',source->'sourceVersion','registryVersion',source#>'{registry,version}','metricMappings',source->'metricMappings','driverToleranceSettings',source->'driverToleranceSettings','driverToleranceVersion',source->'driverToleranceVersion'),
 'communityName',coalesce(community->>'display_name',community->>'canonical_name',cid::text),'portfolio',community->>'portfolio','region',community->>'region');
 return validation||jsonb_build_object('data',data,'revisionId',rev.revision_id,'publicationId',pub.publication_id,'originalBudgetVersionId',original.version_id,'communityId',cid,'budgetStatus',status,'budgetVersion',version,'sourceFingerprint',source_hash,'isFinal',is_final);
end;$$;
create function atlas_private.preview_budget_export(cid uuid,selection jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare resolved jsonb;data jsonb;validation jsonb;begin
 resolved:=atlas_private.resolve_budget_export_source(cid,selection);data:=resolved->'data';validation:=atlas_private.budget_export_integrity(resolved->'sourceSnapshot',resolved->'sourceConfig');
 return data||(resolved-'data'-'sourceSnapshot'-'sourceConfig')||jsonb_build_object('verified',true,'contentHash',encode(sha256(convert_to(data::text,'UTF8')),'hex'),'validation',validation||jsonb_build_object('tolerances',jsonb_build_object('rules',data#>'{source,driverToleranceSettings}','versionId',data#>'{source,driverToleranceVersion}','basis','retained_budget_source')));
end;$$;

create function atlas_private.capture_budget_export(cid uuid,selection jsonb,rid uuid,options jsonb,client_validation jsonb,requested_override jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare resolved jsonb;r public.atlas_budget_exports;rev public.atlas_reforecast_revisions;pub public.atlas_reforecast_publications;original public.atlas_approved_budget_versions;
 source_snapshot jsonb;projected jsonb;config jsonb;source jsonb;data jsonb;validation jsonb;override_record jsonb;hash text;source_hash text;status text;version text;tolerances jsonb;is_final boolean;community jsonb;periods jsonb;lines jsonb;row jsonb;monthly jsonb:='[]';totals jsonb;metric text;total numeric;selected_period text;kind text;
begin
 if auth.uid() is null or not atlas_private.reforecast_access(cid,'read') then raise exception 'Budget export access denied';end if;
 if rid is null or jsonb_typeof(selection) is distinct from 'object' or jsonb_typeof(options) is distinct from 'object' or octet_length(options::text)>32768
  or jsonb_typeof(options->'formats') is distinct from 'array' or jsonb_array_length(options->'formats') not between 1 and 2
  or exists(select 1 from jsonb_array_elements_text(options->'formats')v where v not in ('xlsx','pdf'))
  or (select count(distinct v) from jsonb_array_elements_text(options->'formats')v)<>jsonb_array_length(options->'formats')
  or coalesce(options->>'preset','') not in ('detailed','executive','custom')
  or jsonb_typeof(options->'sections') is distinct from 'array' or jsonb_array_length(options->'sections') not between 1 and 11
  or exists(select 1 from jsonb_array_elements_text(options->'sections')v where v not in ('summary','leasing','revenue','expenses','drivers','utilities','channels','str','sensitivities','assumptions','validation'))
  or (select count(distinct v) from jsonb_array_elements_text(options->'sections')v)<>jsonb_array_length(options->'sections')
  or jsonb_typeof(options->'includeCharts') is distinct from 'boolean' or jsonb_typeof(options->'charts') is distinct from 'array'
  or jsonb_typeof(coalesce(client_validation,'{}')) is distinct from 'object' or octet_length(coalesce(client_validation,'{}')::text)>1048576 then raise exception 'Choose valid export formats, sections, preset and chart options';end if;
 if (selection->>'originalBudgetVersionId' is not null) = (selection->>'revisionId' is not null or selection->>'publicationId' is not null) then raise exception 'Select one exact saved budget version';end if;
 hash:=encode(sha256(convert_to(jsonb_build_array(cid,selection,options,client_validation,requested_override)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('budget-export-request:'||rid,0));
 select * into r from public.atlas_budget_exports where request_id=rid;
 if r.export_id is not null then
  if r.community_id<>cid or r.generated_by<>auth.uid() or r.request_hash<>hash then raise exception 'Export request ID reused for different content or actor';end if;
  return atlas_private.read_budget_export(cid,r.export_id);
 end if;
 resolved:=atlas_private.resolve_budget_export_source(cid,selection);source_snapshot:=resolved->'sourceSnapshot';config:=resolved->'sourceConfig';data:=resolved->'data';
 rev.revision_id:=(resolved->>'revisionId')::uuid;pub.publication_id:=(resolved->>'publicationId')::uuid;original.version_id:=(resolved->>'originalBudgetVersionId')::uuid;
 source_hash:=resolved->>'sourceFingerprint';status:=resolved->>'budgetStatus';version:=resolved->>'budgetVersion';is_final:=(resolved->>'isFinal')::boolean;
 tolerances:=jsonb_build_object('rules',data#>'{source,driverToleranceSettings}','versionId',data#>'{source,driverToleranceVersion}','basis','retained_budget_source');validation:=atlas_private.budget_export_integrity(source_snapshot,config);
 -- Client findings may add review notes, but never remove server findings.
 validation:=validation||jsonb_build_object('clientValidation',coalesce(client_validation,'{}'),'tolerances',tolerances);
 if is_final and ((validation->>'materialIssueCount')::integer>0 or exists(select 1 from jsonb_array_elements(coalesce(client_validation->'issues','[]'))v where v->>'severity' in ('error','blocking') or v->>'material'='true')) then
  if not atlas_private.reforecast_access(cid,'review') then raise exception 'Resolve material integrity issues or ask an authorized budget reviewer to record an export override';end if;
  if jsonb_typeof(requested_override) is distinct from 'object' or requested_override->>'confirmed' is distinct from 'true' or coalesce(requested_override->>'reason','') not in ('Management Adjustment','Known Contract Change','Market Adjustment','Ownership Direction','One-Time Expense','Known Revenue Change','Accounting Adjustment','Other') or (requested_override->>'reason'='Other' and length(trim(coalesce(requested_override->>'comment','')))<3) then raise exception 'Approved exports with material issues require an authorized override reason; Other requires an explanation';end if;
  override_record:=jsonb_build_object('reason',requested_override->>'reason','comment',requested_override->>'comment','userId',auth.uid(),'timestamp',now());
  validation:=validation||jsonb_build_object('status','authorized_override');
 end if;
 insert into public.atlas_budget_exports(community_id,revision_id,publication_id,original_budget_version_id,request_id,request_hash,budget_status,budget_version,options,validation,override,snapshot,content_hash,source_fingerprint,generated_by)
 values(cid,rev.revision_id,pub.publication_id,original.version_id,rid,hash,status,version,options,validation,override_record,data,encode(sha256(convert_to(data::text,'UTF8')),'hex'),source_hash,auth.uid()) returning * into r;
 return atlas_private.read_budget_export(cid,r.export_id);
end;$$;

create function atlas_private.complete_budget_export(cid uuid,eid uuid,rid uuid,files jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.atlas_budget_exports;r public.atlas_budget_export_files;f jsonb;hash text;begin
 if auth.uid() is null or not atlas_private.reforecast_access(cid,'read') then raise exception 'Budget export access denied';end if;
 select * into e from public.atlas_budget_exports where export_id=eid and community_id=cid;
 if e.export_id is null or e.generated_by<>auth.uid() then raise exception 'Only the generating user can confirm this export';end if;
 if rid is null or jsonb_typeof(files) is distinct from 'array' or jsonb_array_length(files)<>jsonb_array_length(e.options->'formats') or octet_length(files::text)>65536 then raise exception 'Confirm exactly the generated export files';end if;
 for f in select value from jsonb_array_elements(files) loop
  if not(e.options->'formats' ? coalesce(f->>'format','')) or coalesce(f->>'sha256','')!~'^[a-f0-9]{64}$' or length(trim(coalesce(f->>'name','')))=0 or length(f->>'name')>240 or jsonb_typeof(f->'size') is distinct from 'number' or (f->>'size')::numeric<=0 or (f->>'size')::numeric<>trunc((f->>'size')::numeric) then raise exception 'Each export file requires its format, name, size and SHA-256';end if;
 end loop;
 if (select count(distinct v->>'format') from jsonb_array_elements(files)v)<>jsonb_array_length(files) then raise exception 'Export file formats must be unique';end if;
 hash:=encode(sha256(convert_to(jsonb_build_array(cid,eid,files)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('budget-export-files:'||eid,0));
 select * into r from public.atlas_budget_export_files where export_id=eid or request_id=rid;
 if r.file_record_id is not null then
  if r.export_id<>eid or r.community_id<>cid or r.created_by<>auth.uid() or r.request_id<>rid or r.request_hash<>hash then raise exception 'Export completion request reused or files already confirmed';end if;
 else insert into public.atlas_budget_export_files(export_id,community_id,request_id,request_hash,files,created_by) values(eid,cid,rid,hash,files,auth.uid()) returning * into r;end if;
 return jsonb_build_object('exportId',eid,'communityId',cid,'fileRecordId',r.file_record_id,'files',r.files,'createdBy',r.created_by,'createdAt',r.created_at,'verified',true);
end;$$;

create function public.atlas_preview_budget_export(p_community_id uuid,p_selection jsonb) returns jsonb language sql security invoker set search_path='' as $$select atlas_private.preview_budget_export(p_community_id,p_selection)$$;
create function public.atlas_read_budget_export_tolerances(p_community_id uuid) returns jsonb language sql security invoker set search_path='' as $$select atlas_private.budget_export_tolerances(p_community_id)$$;
create function public.atlas_save_budget_export_tolerances(p_community_id uuid,p_expected_version integer,p_request_id uuid,p_rules jsonb,p_reason text) returns jsonb language sql security invoker set search_path='' as $$select atlas_private.save_budget_export_tolerances(p_community_id,p_expected_version,p_request_id,p_rules,p_reason)$$;
create function public.atlas_capture_budget_export(p_community_id uuid,p_selection jsonb,p_request_id uuid,p_options jsonb,p_validation jsonb default '{}',p_override jsonb default null) returns jsonb language sql security invoker set search_path='' as $$select atlas_private.capture_budget_export(p_community_id,p_selection,p_request_id,p_options,p_validation,p_override)$$;
create function public.atlas_read_budget_export(p_community_id uuid,p_export_id uuid) returns jsonb language sql security invoker set search_path='' as $$select atlas_private.read_budget_export(p_community_id,p_export_id)$$;
create function public.atlas_complete_budget_export(p_community_id uuid,p_export_id uuid,p_request_id uuid,p_files jsonb) returns jsonb language sql security invoker set search_path='' as $$select atlas_private.complete_budget_export(p_community_id,p_export_id,p_request_id,p_files)$$;
revoke all on function atlas_private.resolve_budget_export_source(uuid,jsonb),atlas_private.budget_export_integrity(jsonb,jsonb),atlas_private.budget_export_evidence(jsonb) from public,anon,authenticated;
revoke all on function atlas_private.preview_budget_export(uuid,jsonb),public.atlas_preview_budget_export(uuid,jsonb),atlas_private.budget_export_tolerances(uuid),atlas_private.save_budget_export_tolerances(uuid,integer,uuid,jsonb,text),atlas_private.capture_budget_export(uuid,jsonb,uuid,jsonb,jsonb,jsonb),atlas_private.read_budget_export(uuid,uuid),atlas_private.complete_budget_export(uuid,uuid,uuid,jsonb),public.atlas_read_budget_export_tolerances(uuid),public.atlas_save_budget_export_tolerances(uuid,integer,uuid,jsonb,text),public.atlas_capture_budget_export(uuid,jsonb,uuid,jsonb,jsonb,jsonb),public.atlas_read_budget_export(uuid,uuid),public.atlas_complete_budget_export(uuid,uuid,uuid,jsonb) from public,anon;
grant execute on function atlas_private.preview_budget_export(uuid,jsonb),public.atlas_preview_budget_export(uuid,jsonb),atlas_private.budget_export_tolerances(uuid),atlas_private.save_budget_export_tolerances(uuid,integer,uuid,jsonb,text),atlas_private.capture_budget_export(uuid,jsonb,uuid,jsonb,jsonb,jsonb),atlas_private.read_budget_export(uuid,uuid),atlas_private.complete_budget_export(uuid,uuid,uuid,jsonb),public.atlas_read_budget_export_tolerances(uuid),public.atlas_save_budget_export_tolerances(uuid,integer,uuid,jsonb,text),public.atlas_capture_budget_export(uuid,jsonb,uuid,jsonb,jsonb,jsonb),public.atlas_read_budget_export(uuid,uuid),public.atlas_complete_budget_export(uuid,uuid,uuid,jsonb) to authenticated;
commit;
