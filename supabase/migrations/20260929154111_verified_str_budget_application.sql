-- A saved STR Builder revision is applied only after exact shared-budget impact
-- preview. Existing calculation, save, approval and publication remain owners.
begin;
create table public.atlas_str_budget_applications(
 application_id uuid primary key, community_id uuid not null references public.atlas_communities,
 programme_id uuid not null, programme_revision_id uuid not null references public.atlas_str_programme_revisions,
 target_revision_id uuid not null references public.atlas_reforecast_revisions,
 scenario_id uuid not null, request_hash text not null, preview_hash text not null,
 application jsonb not null, request jsonb not null, actor_id uuid not null references auth.users,
 created_at timestamptz not null default now());
create index atlas_str_budget_application_scope on public.atlas_str_budget_applications(community_id,programme_id,created_at desc);
alter table public.atlas_str_budget_applications enable row level security;
revoke all on public.atlas_str_budget_applications from public,anon,authenticated;
grant select on public.atlas_str_budget_applications to authenticated;
create policy str_budget_application_read on public.atlas_str_budget_applications for select to authenticated using(atlas_private.reforecast_access(community_id,'read'));
create trigger str_budget_application_immutable before update or delete on public.atlas_str_budget_applications for each row execute function atlas_private.finance_immutable();

create table public.atlas_str_budget_account_mappings(
 community_id uuid not null references public.atlas_communities, programme_id uuid not null,
 source_line_id text not null, source_gl text not null, source_nature text not null, source_name text not null,
 account_code text not null, mapping jsonb not null, application_id uuid not null references public.atlas_str_budget_applications,
 primary key(community_id,programme_id,source_line_id));
alter table public.atlas_str_budget_account_mappings enable row level security;
revoke all on public.atlas_str_budget_account_mappings from public,anon,authenticated;
grant select on public.atlas_str_budget_account_mappings to authenticated;
create policy str_budget_mapping_read on public.atlas_str_budget_account_mappings for select to authenticated using(atlas_private.reforecast_access(community_id,'read'));

-- Keep the original Builder schedules in the authoritative snapshot. This is a
-- projection and reconciliation of retained results, never a second STR model.
create function atlas_private.shared_str_schedules(config jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare app jsonb;row jsonb;rows jsonb;totals jsonb;issues jsonb;all_issues jsonb:='[]';schedules jsonb:='[]';p text;k text;n integer;expected numeric;retained numeric;days integer;
begin
 for app in select value from jsonb_array_elements(coalesce(config->'strBudgetApplications','[]')) loop
  rows:='[]';issues:='[]';totals:='{}';
  for p in select jsonb_array_elements_text(config->'periods') loop
   select count(*),jsonb_agg(v)->0 into n,row from jsonb_each(coalesce(app->'supportingSchedules','{}'))y cross join lateral jsonb_array_elements(coalesce(y.value->'leasingSchedule'->'monthly','[]'))v where v->>'period'=p;
   if n<>1 then issues:=issues||jsonb_build_array(jsonb_build_object('code','str_missing_leasing_schedule','severity','error','period',p,'programmeId',app->'programmeId','message','Recalculate and save this STR Builder programme to retain one leasing schedule row for every selected fiscal month.'));continue;end if;
   rows:=rows||jsonb_build_array(row);days:=extract(day from (p||'-01')::date+interval '1 month'-interval '1 day');
   if exists(select 1 from unnest(array['beginningAvailableUnits','unitsEntering','unitsLeaving','endingUnits','availableNights','blockedNights','rentableNights','budgetedOccupancy','bookedNights','adr','revpar','stays','averageLengthOfStay','grossRentalRevenue','budgetedRevenue','operatingExpenses','strNoi','conventionalIncomeDisplaced'])key where atlas_private.budget_number(row->key) is null)
    then issues:=issues||jsonb_build_array(jsonb_build_object('code','str_missing_assumptions','severity','error','period',p,'programmeId',app->'programmeId','message','The saved STR leasing schedule has missing required assumptions.'));
   elsif abs((row->>'endingUnits')::numeric-((row->>'beginningAvailableUnits')::numeric+(row->>'unitsEntering')::numeric-(row->>'unitsLeaving')::numeric))>0.000001
    or abs((row->>'availableNights')::numeric-(row->>'endingUnits')::numeric*days)>0.000001
    or abs((row->>'rentableNights')::numeric-((row->>'availableNights')::numeric-(row->>'blockedNights')::numeric-coalesce((row->>'permitCappedNights')::numeric,0)))>0.000001
    or abs((row->>'bookedNights')::numeric-(row->>'rentableNights')::numeric*(row->>'budgetedOccupancy')::numeric)>0.000001
    or abs((row->>'grossRentalRevenue')::numeric-(row->>'bookedNights')::numeric*(row->>'adr')::numeric)>0.011
    or abs((row->>'revpar')::numeric-coalesce((row->>'grossRentalRevenue')::numeric/nullif((row->>'availableNights')::numeric,0),0))>0.011
    or abs((row->>'stays')::numeric-coalesce((row->>'bookedNights')::numeric/nullif((row->>'averageLengthOfStay')::numeric,0),0))>0.000001
    or abs((row->>'strNoi')::numeric-((row->>'budgetedRevenue')::numeric-(row->>'operatingExpenses')::numeric))>0.011
    or (row->>'budgetedOccupancy')::numeric not between 0 and 1
    or exists(select 1 from unnest(array['endingUnits','availableNights','blockedNights','rentableNights','bookedNights','adr'])key where (row->>key)::numeric<0)
    then issues:=issues||jsonb_build_array(jsonb_build_object('code','str_leasing_reconciliation','severity','error','period',p,'programmeId',app->'programmeId','message','Saved STR units, nights, occupancy, rates or revenue do not reconcile. Repair the programme in STR Builder.'));
   end if;
   select round(sum((v->>'amount')::numeric),2) into retained from jsonb_array_elements(coalesce(app->'reportSnapshot'->'rows','[]'))v where v->>'period'=p and v->>'nature' in ('income','contra_income');
   expected:=round(atlas_private.budget_number(row->'budgetedRevenue')-atlas_private.budget_number(row->'conventionalIncomeDisplaced'),2);
   if retained is null or expected is null or abs(retained-expected)>0.01 then issues:=issues||jsonb_build_array(jsonb_build_object('code','str_revenue_reconciliation','severity','error','period',p,'programmeId',app->'programmeId','message','Retained STR revenue does not reconcile to its leasing schedule and displaced conventional income.'));end if;
   select round(sum((v->>'amount')::numeric),2) into retained from jsonb_array_elements(coalesce(app->'reportSnapshot'->'rows','[]'))v where v->>'period'=p and v->>'nature'='expense';
   if retained is null or abs(retained-atlas_private.budget_number(row->'operatingExpenses'))>0.01 then issues:=issues||jsonb_build_array(jsonb_build_object('code','str_expense_reconciliation','severity','error','period',p,'programmeId',app->'programmeId','message','Retained STR expenses do not reconcile to the saved operating schedule.'));end if;
  end loop;
  foreach k in array array['unitsEntering','unitsLeaving','availableNights','blockedNights','permitCappedNights','rentableNights','bookedNights','occupiedNights','stays','checkouts','grossRentalRevenue','budgetedRevenue','operatingExpenses','strNoi','conventionalRentDisplaced','conventionalIncomeDisplaced','strUplift','taxableRevenue'] loop totals:=totals||jsonb_build_object(k,atlas_private.budget_schedule_sum(rows,k));end loop;
  totals:=totals||jsonb_build_object('beginningAvailableUnits',rows->0->'beginningAvailableUnits','endingUnits',rows->-1->'endingUnits','availableUnits',rows->-1->'availableUnits','conventionalUnitsDisplaced',rows->-1->'conventionalUnitsDisplaced','adr',atlas_private.budget_ratio(atlas_private.budget_number(totals->'grossRentalRevenue'),atlas_private.budget_number(totals->'bookedNights')),'revpar',atlas_private.budget_ratio(atlas_private.budget_number(totals->'grossRentalRevenue'),atlas_private.budget_number(totals->'availableNights')),'budgetedOccupancy',atlas_private.budget_ratio(atlas_private.budget_number(totals->'bookedNights'),atlas_private.budget_number(totals->'rentableNights')),'averageLengthOfStay',atlas_private.budget_ratio(atlas_private.budget_number(totals->'bookedNights'),atlas_private.budget_number(totals->'stays')));
  schedules:=schedules||jsonb_build_array(jsonb_build_object('schemaVersion',1,'kind','str','streamId',app->'programmeId','programmeId',app->'programmeId','revisionId',app->'revisionId','contentHash',app->'contentHash','sourceKind','str_builder','periods',config->'periods','monthly',rows,'totals',totals,'issues',issues,'supportingSchedules',app->'supportingSchedules'));all_issues:=all_issues||issues;
 end loop;
 return jsonb_build_object('schedules',schedules,'issues',all_issues);
end;$$;
alter function atlas_private.calculate_reforecast(jsonb,jsonb) rename to calculate_reforecast_before_shared_str;
create function atlas_private.calculate_reforecast(source jsonb,config jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;projected jsonb;line jsonb;cell jsonb;app jsonb;lines jsonb:='[]';validation jsonb;check_row jsonb;over jsonb;evidence jsonb;ids jsonb;rules jsonb;rule jsonb;expected numeric;manual numeric;variance numeric;pct numeric;dc boolean;pc boolean;material boolean;accepted boolean;begin
 result:=atlas_private.calculate_reforecast_before_shared_str(source,config);
 if jsonb_array_length(coalesce(config->'strBudgetApplications','[]'))=0 then return result;end if;
 rules:=coalesce(source->'driverToleranceSettings',atlas_private.budget_export_tolerances((source->>'communityId')::uuid)->'rules');
 validation:=coalesce(result->'driverValidation',jsonb_build_object('schemaVersion',1,'checks','[]'::jsonb,'warnings','[]'::jsonb,'issues','[]'::jsonb,'overrides','[]'::jsonb));
 for line in select value from jsonb_array_elements(result->'lines') loop
  -- The final contribution touching an account holds its exact combined value;
  -- a conventional linked account already has expected amount plus all STR deltas.
  select a.value,c.value into app,cell from jsonb_array_elements(coalesce(config->'strBudgetApplications','[]')) with ordinality a(value,ord) cross join lateral jsonb_array_elements(a.value->'cells')c(value) where c.value->>'accountCode'=line->>'accountCode' and c.value->>'period'=line->>'period' order by a.ord desc limit 1;
  if cell is not null and not(line ? 'driverCalculatedAmount') and line->>'sourceKind'='forecast' and coalesce(line->>'immutable','false')<>'true' then
   expected:=atlas_private.budget_number(cell->'combinedAmount');manual:=atlas_private.budget_number(line->'forecast');ids:=jsonb_build_array('str-programme-'||(app->>'programmeId'));line:=line||jsonb_build_object('driverCalculatedAmount',expected,'expectedDriverAmount',expected,'budgetDriverIds',ids);
   select value into over from jsonb_array_elements(coalesce(config->'overrides','[]'))v where v->>'accountCode'=line->>'accountCode' and v->>'period'=line->>'period';evidence:=over->'driverOverride';
   variance:=round(manual-expected,2);pct:=case when expected<>0 then abs(variance/expected)*100 when variance=0 then 0 end;rule:=rules->'default'||coalesce(rules->'categories'->(line->>'category'),'{}')||coalesce(rules->'accounts'->(line->>'accountCode'),'{}');
   dc:=case when atlas_private.budget_number(rule->'dollar') is not null then abs(variance)>atlas_private.budget_number(rule->'dollar') end;pc:=case when atlas_private.budget_number(rule->'percent') is not null then case when expected=0 then variance<>0 else pct>atlas_private.budget_number(rule->'percent') end end;
   material:=(dc is not null or pc is not null) and coalesce(case when rule->>'operator'='and' then coalesce(dc,true) and coalesce(pc,true) else coalesce(dc,false) or coalesce(pc,false) end,false);
   accepted:=coalesce(coalesce(evidence->>'reason','') in ('Management Adjustment','Known Contract Change','Market Adjustment','Ownership Direction','One-Time Expense','Known Revenue Change','Accounting Adjustment','Other') and (evidence->>'reason'<>'Other' or length(trim(coalesce(evidence->>'comment','')))>0) and atlas_private.budget_number(evidence->'calculatedAmount')=expected and atlas_private.budget_number(evidence->'manualAmount')=manual and evidence->'affectedDrivers'=ids,false);
   check_row:=jsonb_build_object('period',line->'period','accountCode',line->'accountCode','category',line->'category','title','BUDGET DRIVER WARNING','message','This adjustment does not reconcile with the current Leasing Schedule or underlying budget drivers.','currentCalculatedAmount',expected,'manualAmount',manual,'expectedAmount',expected,'varianceAmount',variance,'variancePercent',pct,'affectedDrivers',ids,'tolerance',rule,'material',material,'overrideAccepted',accepted,'missingAssumptions',expected is null,'warning',material and not accepted,'override',case when accepted then evidence end);
   validation:=jsonb_set(validation,'{checks}',(validation->'checks')||jsonb_build_array(check_row));
   if accepted then validation:=jsonb_set(validation,'{overrides}',(validation->'overrides')||jsonb_build_array(evidence||jsonb_build_object('period',line->'period','accountCode',line->'accountCode')));end if;
   if material and not accepted then validation:=jsonb_set(validation,'{warnings}',(validation->'warnings')||jsonb_build_array(check_row));validation:=jsonb_set(validation,'{issues}',(validation->'issues')||jsonb_build_array(check_row||jsonb_build_object('code','str_mapped_driver_mismatch','severity','error')));result:=jsonb_set(result,'{diagnostics}',coalesce(result->'diagnostics','[]')||jsonb_build_array(check_row||jsonb_build_object('code','str_mapped_driver_mismatch','severity','error')));end if;
  end if;lines:=lines||jsonb_build_array(line);
 end loop;
 validation:=validation||jsonb_build_object('reconciled',jsonb_array_length(validation->'issues')=0);result:=result||jsonb_build_object('lines',lines,'driverValidation',validation);
 projected:=atlas_private.shared_str_schedules(config);
 result:=(result-'fingerprint')||jsonb_build_object('strLeasingSchedules',coalesce(result->'strLeasingSchedules','[]')||(projected->'schedules'),'diagnostics',coalesce(result->'diagnostics','[]')||(projected->'issues'));
 result:=jsonb_set(result,'{completeness,blockerCount}',to_jsonb((select count(*) from jsonb_array_elements(result->'diagnostics')v where v->>'severity'='error')));
 if jsonb_array_length(projected->'issues')>0 then result:=jsonb_set(result,'{status}','"action_required"');end if;
 return result||jsonb_build_object('fingerprint',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
end;$$;
revoke all on function atlas_private.calculate_reforecast(jsonb,jsonb),atlas_private.calculate_reforecast_before_shared_str(jsonb,jsonb),atlas_private.shared_str_schedules(jsonb) from public,anon,authenticated;

create function atlas_private.preview_str_budget_application(request jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare cid uuid:=(request->>'communityId')::uuid;rid uuid:=(request->>'requestId')::uuid;sid uuid:=(request->>'scenarioId')::uuid;
 programme public.atlas_str_programme_revisions;target public.atlas_reforecast_revisions;current_id uuid;
 config jsonb;source jsonb;result jsonb;entry jsonb;old_entry jsonb;mapping jsonb;account jsonb;line jsonb;base jsonb;previous jsonb;cell jsonb;
 contributions jsonb:='[]';cells jsonb:='[]';retained jsonb;overrides jsonb;application jsonb;proposed jsonb;calendar jsonb;excluded jsonb:='[]';
 p text;code text;n integer;amount numeric;old_amount numeric;before_amount numeric;after_amount numeric;reason text:=trim(coalesce(request->>'reason',''));destination text:=request->>'destination';hash text;
begin
 if auth.uid() is null or not atlas_private.reforecast_access(cid,'edit') then raise exception 'STR budget application access denied';end if;
 if rid is null or sid is null or coalesce(destination,'') not in ('existing_draft','new_draft','active_revision') or length(reason)<3 or coalesce(request->>'reviewedAt','')!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}T' or jsonb_typeof(request->'mappings') is distinct from 'array' then raise exception 'Choose the exact saved programme, destination, reviewed mapping and reason';end if;
 select * into programme from public.atlas_str_programme_revisions where revision_id=(request->>'programmeRevisionId')::uuid and community_id=cid;
 if programme.revision_id is null or programme.payload->>'configurationChangedSinceApplied'='true' or jsonb_typeof(programme.payload->'reportSnapshot') is distinct from 'object' then raise exception 'Recalculate and save a complete STR Builder programme before applying';end if;
 if programme.content_hash<>encode(sha256(convert_to(programme.payload::text,'UTF8')),'hex') then raise exception 'The saved STR programme integrity check failed';end if;
 perform atlas_private.validate_str_programme_payload(programme.payload);
 select * into target from public.atlas_reforecast_revisions where revision_id=(request->>'targetRevisionId')::uuid and community_id=cid;
 select revision_id into current_id from public.atlas_reforecast_heads where scenario_id=target.scenario_id;
 if target.revision_id is null or current_id is distinct from target.revision_id then raise exception 'The destination budget changed. Refresh its current version and preview again';end if;
 if target.payload->>'scenarioPurpose'='str_overlay' or jsonb_array_length(coalesce(target.payload->'strStreams','[]'))>0 then raise exception 'Select the property operating budget. Existing standalone STR overlays use their retained reviewed application workflow';end if;
 if destination='existing_draft' and (sid<>target.scenario_id or target.status not in ('uploaded','mapping_required','working_draft','reconciled','ready_for_review','withdrawn','rejected','reopened')) then raise exception 'Select an editable existing draft';end if;
 if destination<>'existing_draft' and exists(select 1 from public.atlas_reforecast_heads where scenario_id=sid) then raise exception 'The new draft identifier is already used';end if;
 if destination='active_revision' and (not atlas_private.reforecast_access(cid,'publish') or not exists(select 1 from public.atlas_reforecast_publications active_pub join public.atlas_reforecast_active_heads h on h.publication_id=active_pub.publication_id where active_pub.scenario_id=target.scenario_id and active_pub.community_id=cid and atlas_private.reforecast_publication_valid(active_pub) and (active_pub.revision_id=target.revision_id or (target.status='investor_approved' and target.payload->>'investorPublicationId'=active_pub.publication_id::text and target.snapshot=active_pub.snapshot and target.source=active_pub.source)))) then raise exception 'Only an authorized VP may prepare a new revision of the active budget';end if;
 if destination='new_draft' and length(trim(coalesce(request->>'name','')))<1 then raise exception 'Name the new draft budget';end if;
 calendar:=atlas_private.budget_calendar(cid);
 if calendar->>'verified' is distinct from 'true' or target.payload->'calendar'->>'basis' is distinct from calendar->>'basis' or target.payload->'calendar'->>'startMonth' is distinct from calendar->>'startMonth' then raise exception 'Verify the community fiscal calendar and reconcile the target budget before applying STR';end if;
 config:=target.payload;source:=atlas_private.reforecast_source_for_config(cid,config);
 if destination<>'active_revision' and source->>'sourceVersion' is distinct from target.source->>'sourceVersion' then raise exception 'The destination source data changed. Reconcile its working revision and preview again';end if;
 if jsonb_array_length(request->'mappings')<>jsonb_array_length(programme.payload->'lines') or (select count(distinct v->>'sourceLineId') from jsonb_array_elements(request->'mappings')v)<>jsonb_array_length(request->'mappings') then raise exception 'Confirm exactly one mapping per saved STR source line';end if;
 for line in select value from jsonb_array_elements(programme.payload->'lines') loop
  select value into mapping from jsonb_array_elements(request->'mappings')m where m->>'sourceLineId'=line->>'id';
  select count(*),jsonb_agg(a)->0 into n,account from jsonb_array_elements(source->'registry'->'accounts')a where a->>'accountCode'=mapping->>'accountCode';
  if mapping->>'confirmed' is distinct from 'true' or mapping->>'sourceGL' is distinct from line->>'gl' or n<>1 or length(trim(coalesce(mapping->>'reason','')))<3 then raise exception 'Every STR line needs a confirmed canonical account mapping and reason';end if;
  if line->>'nature'='contra_income' then if account->>'nature' not in ('income','contra_income') then raise exception 'STR mapping changes the source financial nature';end if;
  elsif line->>'nature' is distinct from account->>'nature' then raise exception 'STR mapping changes the source financial nature';end if;
  for p in select jsonb_array_elements_text(config->'periods') loop
   if jsonb_typeof(line->'yearData'->left(p,4)->(right(p,2)::int-1)) is distinct from 'number' then raise exception 'STR programme is missing a numeric assumption for selected fiscal period %',p;end if;
   if account->>'effectiveFrom'>p or account->>'retiredAfter'<p then raise exception 'STR account mapping is outside its effective fiscal period';end if;
   if source->'lockedPeriods' ? p or source->'actuals'->'notApplicablePeriods' ? p or p<=source->'actuals'->>'cutoffPeriod' then if not(excluded ? p)then excluded:=excluded||to_jsonb(p);end if;continue;end if;
   contributions:=contributions||jsonb_build_array(jsonb_build_object('sourceLineId',line->>'id','sourceGL',line->>'gl','accountCode',mapping->>'accountCode','period',p,'nature',line->>'nature','amount',line->'yearData'->left(p,4)->(right(p,2)::int-1),'parentAbsent',mapping->'parentAbsent'));
  end loop;
 end loop;
 if jsonb_array_length(contributions)=0 then raise exception 'The target budget has no eligible open months for STR application';end if;
 select value into old_entry from jsonb_array_elements(coalesce(config->'strBudgetApplications','[]'))a where a->>'programmeId'=programme.programme_id::text;
 -- Include old mapping targets too, so remapping or removing a programme line
 -- removes its earlier contribution rather than leaving it behind.
 for cell in select jsonb_build_object('accountCode',keys.code,'period',keys.period) from (
  select v->>'accountCode' code,v->>'period' period from jsonb_array_elements(contributions)v
  union select v->>'accountCode',v->>'period' from jsonb_array_elements(coalesce(old_entry->'cells','[]'))v where config->'periods' ? (v->>'period'))keys order by keys.period,keys.code loop
  code:=cell->>'accountCode';p:=cell->>'period';
  if source->'lockedPeriods' ? p or source->'actuals'->'notApplicablePeriods' ? p or p<=source->'actuals'->>'cutoffPeriod' then continue;end if;
  select count(*),jsonb_agg(b)->0 into n,base from jsonb_array_elements(target.snapshot->'lines')b where b->>'accountCode'=code and b->>'period'=p;
  if n>1 then raise exception 'The target budget contains duplicate account periods';end if;
  if jsonb_typeof(base->'forecast') is distinct from 'number' and not exists(select 1 from jsonb_array_elements(contributions)c where c->>'accountCode'=code and c->>'period'=p and c->>'parentAbsent'='true') then raise exception 'Review the absent or unavailable conventional amount for account % / %',code,p;end if;
  if exists(select 1 from jsonb_array_elements(coalesce(target.snapshot->'driverValidation'->'warnings','[]'))w where w->>'accountCode'=code and w->>'period'=p and w->>'warning'='true') then raise exception 'Review or authorize the existing manual driver adjustment for % / % before applying STR',code,p;end if;
  before_amount:=coalesce((base->>'forecast')::numeric,0);
  select coalesce(sum((c->>'amount')::numeric),0) into amount from jsonb_array_elements(contributions)c where c->>'accountCode'=code and c->>'period'=p;
  select coalesce(sum((c->>'appliedDelta')::numeric),0) into old_amount from jsonb_array_elements(coalesce(old_entry->'cells','[]'))c where c->>'accountCode'=code and c->>'period'=p;
  after_amount:=round(before_amount-old_amount+amount,2);
  cells:=cells||jsonb_build_array(cell||jsonb_build_object('beforeAmount',base->'forecast','conventionalAmount',before_amount-old_amount,'previousStrAmount',old_amount,'strAmount',amount,'combinedAmount',after_amount,'appliedDelta',after_amount-(before_amount-old_amount),'nature',coalesce(base->>'nature',(select a->>'nature' from jsonb_array_elements(source->'registry'->'accounts')a where a->>'accountCode'=code))));
 end loop;
 select coalesce(jsonb_agg(v),'[]') into overrides from jsonb_array_elements(coalesce(config->'overrides','[]'))v where not exists(select 1 from jsonb_array_elements(cells)c where c->>'accountCode'=v->>'accountCode' and c->>'period'=v->>'period');
 for cell in select value from jsonb_array_elements(cells) loop
  overrides:=overrides||jsonb_build_array(jsonb_build_object('accountCode',cell->'accountCode','period',cell->'period','effectivePeriod',cell->'period','amount',cell->'combinedAmount','before',coalesce(cell->'beforeAmount','null'::jsonb),'after',cell->'combinedAmount','reason',reason,'confirmed',true,'ownerId',auth.uid(),'reviewedAt',request->>'reviewedAt','source',jsonb_build_object('kind','shared_str_programme','applicationId',rid,'programmeRevisionId',programme.revision_id,'contentHash',programme.content_hash,'sourceAmount',cell->'strAmount','application','add','conventionalAmount',cell->'conventionalAmount')));
 end loop;
 application:=jsonb_build_object('applicationId',rid,'programmeId',programme.programme_id,'revisionId',programme.revision_id,'version',programme.revision,'contentHash',programme.content_hash,'name',programme.payload->>'name','communityId',cid,'targetRevisionId',target.revision_id,'periods',config->'periods','calendar',config->'calendar','mappings',request->'mappings','cells',cells,'supportingSchedules',coalesce(programme.payload->'programme'->'supportingSchedules','{}'),'sourceLines',programme.payload->'lines','config',programme.payload->'config','programme',programme.payload->'programme','reportSnapshot',programme.payload->'reportSnapshot','actorId',auth.uid(),'reviewedAt',request->>'reviewedAt','reason',reason);
 select coalesce(jsonb_agg(v),'[]') into retained from jsonb_array_elements(coalesce(config->'strBudgetApplications','[]'))v where v->>'programmeId'<>programme.programme_id::text;
 config:=config||jsonb_build_object('overrides',overrides,'strBudgetApplications',retained||jsonb_build_array(application),'reason',reason,'model',case when config->>'model'='student' then 'student' else 'mixed' end);
 if destination<>'existing_draft' then config:=config||jsonb_build_object('name',coalesce(nullif(trim(request->>'name'),''),(target.payload->>'name')||' - STR revision'),'forkedFromRevisionId',target.revision_id,'ownerId',auth.uid());config:=jsonb_set(config,'{calendar}',(config->'calendar')||jsonb_build_object('scenario',config->'name','reviewedBy',auth.uid(),'reviewedAt',request->>'reviewedAt'));config:=config-'investorApprovalDate'-'investorApprovedBy'-'investorApprovedAt'-'investorPublicationId';end if;
 proposed:=atlas_private.calculate_reforecast(source,config);
 if exists(select 1 from jsonb_array_elements(cells)c where not exists(select 1 from jsonb_array_elements(proposed->'lines')l where l->>'accountCode'=c->>'accountCode' and l->>'period'=c->>'period' and l->'forecast'=c->'combinedAmount')) then raise exception 'The mapped STR contribution does not reconcile to the budget calculator';end if;
 if exists(select 1 from jsonb_array_elements(target.snapshot->'lines')b where not exists(select 1 from jsonb_array_elements(cells)c where c->>'accountCode'=b->>'accountCode' and c->>'period'=b->>'period') and not exists(select 1 from jsonb_array_elements(proposed->'lines')l where l->>'accountCode'=b->>'accountCode' and l->>'period'=b->>'period' and l->'forecast' is not distinct from b->'forecast')) then raise exception 'Unrelated conventional values changed. Reconcile the destination before applying STR';end if;
 result:=jsonb_build_object('schemaVersion',1,'verified',true,'request',request,'communityId',cid,'programmeId',programme.programme_id,'programmeRevisionId',programme.revision_id,'programmeVersion',programme.revision,'programmeHash',programme.content_hash,'targetRevisionId',target.revision_id,'targetVersion',target.revision,'targetName',target.payload->>'name','periods',config->'periods','calendar',config->'calendar','destination',destination,'payload',config,'application',application,'cells',cells,'excludedClosedPeriods',excluded,'beforeMonthly',target.snapshot->'monthly','afterMonthly',proposed->'monthly','snapshot',proposed);
 hash:=encode(sha256(convert_to(result::text,'UTF8')),'hex');return result||jsonb_build_object('previewHash',hash);
end;$$;

create function atlas_private.read_str_budget_application(cid uuid,rid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare event public.atlas_str_budget_applications;rec public.atlas_reforecast_revisions;begin
 if auth.uid() is null or not atlas_private.reforecast_access(cid,'read') then raise exception 'STR application receipt access denied';end if;
 select * into event from public.atlas_str_budget_applications where application_id=rid and community_id=cid;if event.application_id is null then return null;end if;
 select * into rec from public.atlas_reforecast_revisions where request_id=rid and scenario_id=event.scenario_id;
 if rec.revision_id is null then raise exception 'STR application revision readback is unavailable';end if;
 return jsonb_build_object('verified',true,'applicationId',rid,'request',event.request,'previewHash',event.preview_hash,'application',event.application,'head',jsonb_build_object('community_id',cid,'scenario_id',rec.scenario_id,'revision_id',rec.revision_id,'revision',rec.revision,'status',rec.status),'revision',to_jsonb(rec),'source',rec.source,'snapshot',rec.snapshot,'published',false,'appliedAt',event.created_at);
end;$$;

create function atlas_private.apply_str_budget_programme(request jsonb,preview_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare cid uuid:=(request->>'communityId')::uuid;rid uuid:=(request->>'requestId')::uuid;preview jsonb;prior public.atlas_str_budget_applications;result jsonb;mapping jsonb;line jsonb;request_hash text;
begin
 if auth.uid() is null or not atlas_private.reforecast_access(cid,'edit') then raise exception 'STR budget application access denied';end if;
 request_hash:=encode(sha256(convert_to(request::text,'UTF8')),'hex');perform pg_advisory_xact_lock(hashtextextended('str-budget-application:'||rid,0));
 select * into prior from public.atlas_str_budget_applications where application_id=rid;
 if prior.application_id is not null then if prior.actor_id<>auth.uid() or prior.request_hash<>request_hash or prior.preview_hash<>preview_hash then raise exception 'STR application request ID reused';end if;return atlas_private.read_str_budget_application(cid,rid);end if;
 perform pg_advisory_xact_lock(hashtextextended('reforecast-active:'||cid,0));
 preview:=atlas_private.preview_str_budget_application(request);
 if preview->>'previewHash' is distinct from preview_hash then raise exception 'The reviewed STR impact changed. Preview again before confirming';end if;
 insert into public.atlas_str_budget_applications values(rid,cid,(preview->>'programmeId')::uuid,(preview->>'programmeRevisionId')::uuid,(preview->>'targetRevisionId')::uuid,(request->>'scenarioId')::uuid,request_hash,preview_hash,preview->'application',request,auth.uid(),now());
 result:=public.atlas_save_reforecast_scenario(cid,(request->>'scenarioId')::uuid,case when request->>'destination'='existing_draft' then (preview->>'targetVersion')::int else 0 end,rid,'save_draft',preview->'payload');
 if exists(select 1 from jsonb_array_elements(preview->'cells')c where not exists(select 1 from jsonb_array_elements(result->'snapshot'->'lines')l where l->>'accountCode'=c->>'accountCode' and l->>'period'=c->>'period' and l->'forecast'=c->'combinedAmount')) then raise exception 'Saved budget does not match confirmed STR impact';end if;
 for mapping in select value from jsonb_array_elements(request->'mappings') loop
  select value into line from jsonb_array_elements(preview->'application'->'sourceLines')l where l->>'id'=mapping->>'sourceLineId';
  insert into public.atlas_str_budget_account_mappings values(cid,(preview->>'programmeId')::uuid,mapping->>'sourceLineId',line->>'gl',line->>'nature',line->>'name',mapping->>'accountCode',mapping,rid)
  on conflict(community_id,programme_id,source_line_id) do update set source_gl=excluded.source_gl,source_nature=excluded.source_nature,source_name=excluded.source_name,account_code=excluded.account_code,mapping=excluded.mapping,application_id=excluded.application_id;
 end loop;
 return atlas_private.read_str_budget_application(cid,rid);
end;$$;

create function atlas_private.guard_str_budget_origin() returns trigger language plpgsql security definer set search_path='' as $$
declare app jsonb;event public.atlas_str_budget_applications;over jsonb;stream jsonb;prior public.atlas_reforecast_revisions;begin
 select * into prior from public.atlas_reforecast_revisions where scenario_id=new.scenario_id order by revision desc limit 1;
 if prior.revision_id is null and new.payload->>'forkedFromRevisionId' is not null then select * into prior from public.atlas_reforecast_revisions where revision_id=(new.payload->>'forkedFromRevisionId')::uuid and community_id=new.community_id;end if;
 for stream in select value from jsonb_array_elements(coalesce(new.payload->'strStreams','[]')) loop
  if stream->>'type'='saved_json_monthly_programme' then perform atlas_private.reforecast_saved_str_receipt(new.source,new.payload);
  elsif not exists(select 1 from jsonb_array_elements(coalesce(prior.payload->'strStreams','[]'))s where s->>'id'=stream->>'id' and s->>'type' is not distinct from stream->>'type') then raise exception 'New STR programmes must originate in STR Builder and its verified application workflow';end if;
 end loop;
 if new.payload->>'model'='short_term' and jsonb_array_length(coalesce(new.payload->'strBudgetApplications','[]'))=0 and jsonb_array_length(coalesce(new.payload->'strStreams','[]'))=0 and prior.payload->>'model' is distinct from 'short_term' then raise exception 'Create the STR programme in STR Builder before creating its property budget';end if;
 for app in select value from jsonb_array_elements(coalesce(new.payload->'strBudgetApplications','[]')) loop
  select * into event from public.atlas_str_budget_applications where application_id=(app->>'applicationId')::uuid and community_id=new.community_id;
  if event.application_id is null or event.application is distinct from app then raise exception 'STR supporting schedules must originate in the verified STR Builder application workflow';end if;
 end loop;
 for over in select value from jsonb_array_elements(coalesce(new.payload->'overrides','[]')) where value->'source'->>'kind'='shared_str_programme' loop
  select * into event from public.atlas_str_budget_applications where application_id=(over->'source'->>'applicationId')::uuid and community_id=new.community_id;
  if event.application_id is null or not exists(select 1 from jsonb_array_elements(event.application->'cells')c where c->>'period'=over->>'period' and c->>'accountCode'=over->>'accountCode' and c->'combinedAmount'=over->'amount') then raise exception 'STR mapped amount differs from its confirmed Builder source';end if;
 end loop;return new;
end;$$;
create trigger reforecast_shared_str_origin before insert on public.atlas_reforecast_revisions for each row execute function atlas_private.guard_str_budget_origin();

create function public.atlas_preview_str_budget_application(p_request jsonb) returns jsonb language sql security invoker set search_path='' as $$select atlas_private.preview_str_budget_application(p_request)$$;
create function public.atlas_apply_str_budget_programme(p_request jsonb,p_preview_hash text) returns jsonb language sql security invoker set search_path='' as $$select atlas_private.apply_str_budget_programme(p_request,p_preview_hash)$$;
create function public.atlas_read_str_budget_application(p_community_id uuid,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select atlas_private.read_str_budget_application(p_community_id,p_request_id)$$;
revoke all on function atlas_private.preview_str_budget_application(jsonb),atlas_private.apply_str_budget_programme(jsonb,text),atlas_private.read_str_budget_application(uuid,uuid),atlas_private.guard_str_budget_origin(),public.atlas_preview_str_budget_application(jsonb),public.atlas_apply_str_budget_programme(jsonb,text),public.atlas_read_str_budget_application(uuid,uuid) from public,anon,authenticated;
grant execute on function atlas_private.preview_str_budget_application(jsonb),atlas_private.apply_str_budget_programme(jsonb,text),atlas_private.read_str_budget_application(uuid,uuid),public.atlas_preview_str_budget_application(jsonb),public.atlas_apply_str_budget_programme(jsonb,text),public.atlas_read_str_budget_application(uuid,uuid) to authenticated;
commit;
