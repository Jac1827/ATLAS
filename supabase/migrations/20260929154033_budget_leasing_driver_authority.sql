-- Operating schedules remain server calculations. Regenerate conventional
-- amount drivers from their inputs instead of accepting a browser-supplied value.
begin;
create function atlas_private.budget_number(value jsonb) returns numeric language sql immutable set search_path='' as $$select case when jsonb_typeof(value)='number' then (value#>>'{}')::numeric end$$;
create function atlas_private.budget_ratio(a numeric,b numeric) returns numeric language sql immutable set search_path='' as $$select case when b>0 then a/b when a=0 and b=0 then 0 end$$;
create function atlas_private.budget_schedule_sum(rows jsonb,key text) returns numeric language sql immutable set search_path='' as $$select case when count(*) filter(where jsonb_typeof(v->key) is distinct from 'number')=0 then sum((v->>key)::numeric) end from jsonb_array_elements(rows)v$$;
create function atlas_private.budget_leasing_totals(rows jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb:='{}';key text;begin
 foreach key in array array['units','beginningOccupiedUnits','endingOccupiedUnits','occupiedUnits','leasedUnits','availableUnits'] loop result:=result||jsonb_build_object(key,case when key like 'beginning%' then rows->0->key else rows->(jsonb_array_length(rows)-1)->key end);end loop;
 foreach key in array array['moveIns','moveOuts','renewals','grossPotentialRent','rentalIncome','vacancy','concessions','badDebt','netRentalIncome'] loop result:=result||jsonb_build_object(key,atlas_private.budget_schedule_sum(rows,key));end loop;
 return result||jsonb_build_object('averageOccupiedUnits',atlas_private.budget_ratio(atlas_private.budget_schedule_sum(rows,'averageOccupiedUnits'),jsonb_array_length(rows)),'physicalOccupancy',atlas_private.budget_ratio(atlas_private.budget_schedule_sum(rows,'endingOccupiedUnits'),atlas_private.budget_schedule_sum(rows,'units')),'leasedOccupancy',atlas_private.budget_ratio(atlas_private.budget_schedule_sum(rows,'leasedUnits'),atlas_private.budget_schedule_sum(rows,'units')),'budgetedOccupancy',atlas_private.budget_ratio(atlas_private.budget_schedule_sum(rows,'averageOccupiedUnits'),atlas_private.budget_schedule_sum(rows,'units')),'marketRent',atlas_private.budget_ratio(atlas_private.budget_schedule_sum(rows,'grossPotentialRent'),atlas_private.budget_schedule_sum(rows,'units')));
end;$$;
create function atlas_private.budget_leasing_schedule(source jsonb,config jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare rows jsonb:='[]';issues jsonb:='[]';input jsonb;base jsonb;p text;prior numeric:=atlas_private.budget_number(config#>'{leasingSchedule,beginningOccupiedUnits}');units numeric;beginning numeric;mi numeric;mo numeric;ending numeric;reported numeric;avg_units numeric;rent numeric;growth numeric;loss numeric;effective numeric;income numeric;concessions numeric;debt numeric;leased numeric;row jsonb;closed boolean;d jsonb;range_value numeric;key text;
begin
 if jsonb_typeof(coalesce(config#>'{leasingSchedule,monthly}','[]'))<>'array' then raise exception 'Leasing schedule months must be an array';end if;
 if exists(select 1 from jsonb_array_elements(coalesce(config#>'{leasingSchedule,monthly}','[]'))v group by v->>'period' having count(*)>1) then raise exception 'Leasing schedule months must be unique';end if;
 for p in select jsonb_array_elements_text(source->'periods') loop
  closed:=coalesce(source->'lockedPeriods' ? p,false) or coalesce(p<=source#>>'{actuals,cutoffPeriod}',false);
  base:=null;if closed then select v into base from jsonb_array_elements(coalesce(source#>'{actuals,leasing}','[]'))v where v->>'period'=p;end if;
  if base is null then select v into base from jsonb_array_elements(coalesce(source#>'{baseline,leasing}','[]'))v where v->>'period'=p;end if;
  select v into input from jsonb_array_elements(coalesce(config#>'{leasingSchedule,monthly}','[]'))v where v->>'period'=p;
  input:=coalesce(base,'{}')||case when closed then '{}'::jsonb else coalesce(input,'{}') end||jsonb_build_object('period',p);
  for d in select value from jsonb_array_elements(coalesce(config->'drivers','[]')) where value->>'operation'='occupancy_vacancy' loop
   if not closed and (d->'periods' is null or d->'periods' ? p) then input:=input||jsonb_build_object('occupiedUnits',atlas_private.budget_number(input->'units')*atlas_private.budget_number(d->'value'));end if;
  end loop;
  units:=case when input ? 'units' then atlas_private.budget_number(input->'units') else atlas_private.budget_number(config#>'{leasingSchedule,units}') end;
  beginning:=case when input ? 'beginningOccupiedUnits' then atlas_private.budget_number(input->'beginningOccupiedUnits') else prior end;
  mi:=atlas_private.budget_number(input->'moveIns');mo:=atlas_private.budget_number(input->'moveOuts');reported:=atlas_private.budget_number(case when input ? 'endingOccupiedUnits' then input->'endingOccupiedUnits' else input->'occupiedUnits' end);
  ending:=coalesce(beginning+mi-mo,reported);
  if reported is not null and beginning+mi-mo is not null and abs(reported-(beginning+mi-mo))>0.000001 or jsonb_array_length(rows)>0 and beginning is not null and prior is not null and abs(beginning-prior)>0.000001 then issues:=issues||jsonb_build_array(jsonb_build_object('code','leasing_reconciliation','severity','blocking','period',p,'message','Beginning or ending occupied units do not reconcile with the monthly ramp.'));end if;
  avg_units:=case when beginning is not null and ending is not null then (beginning+ending)/2 when input ? 'averageOccupiedUnits' then atlas_private.budget_number(input->'averageOccupiedUnits') else ending end;
  rent:=atlas_private.budget_number(input->'marketRent');growth:=case when input ? 'rentGrowth' then atlas_private.budget_number(input->'rentGrowth') else 0 end;loss:=case when input ? 'lossToLeasePercent' then atlas_private.budget_number(input->'lossToLeasePercent') else 0 end;
  effective:=rent*(1+growth)*(1-loss);income:=round(avg_units*effective,2);concessions:=case when input ? 'concessions' then atlas_private.budget_number(input->'concessions') else round(mi*atlas_private.budget_number(input->'concessionPerMoveIn'),2) end;debt:=round(income*atlas_private.budget_number(input->'badDebtPercent'),2);leased:=atlas_private.budget_number(input->'leasedUnits');
  row:=input||jsonb_build_object('units',units,'beginningOccupiedUnits',beginning,'moveIns',mi,'moveOuts',mo,'endingOccupiedUnits',ending,'occupiedUnits',ending,'physicalOccupancy',atlas_private.budget_ratio(ending,units),'occupancy',atlas_private.budget_ratio(ending,units),'leasedUnits',leased,'leasedOccupancy',atlas_private.budget_ratio(leased,units),'budgetedOccupancy',case when input ? 'budgetedOccupancy' then atlas_private.budget_number(input->'budgetedOccupancy') else atlas_private.budget_ratio(avg_units,units) end,'averageOccupiedUnits',avg_units,'availableUnits',units-ending,'marketRent',rent,'effectiveRent',effective,'lossToLeasePercent',loss,'rentGrowth',growth,'newLeaseRent',atlas_private.budget_number(input->'newLeaseRent'),'renewalRent',atlas_private.budget_number(input->'renewalRent'),'renewals',atlas_private.budget_number(input->'renewals'),'grossPotentialRent',round(units*rent*(1+growth),2),'rentalIncome',income,'vacancy',round((avg_units-units)*rent*(1+growth),2),'concessions',concessions,'badDebt',debt,'netRentalIncome',round(income-abs(concessions)-abs(debt),2));
  foreach key in array array['units','beginningOccupiedUnits','moveIns','moveOuts','endingOccupiedUnits','leasedUnits','averageOccupiedUnits','availableUnits'] loop
   if atlas_private.budget_number(row->key)<0 then issues:=issues||jsonb_build_array(jsonb_build_object('code','leasing_input_range','severity','blocking','period',p,'driver',key,'message','Leasing counts cannot be negative.'));end if;
  end loop;
  foreach key in array array['physicalOccupancy','leasedOccupancy','budgetedOccupancy','lossToLeasePercent','badDebtPercent'] loop range_value:=atlas_private.budget_number(row->key);if range_value<0 or range_value>1 then issues:=issues||jsonb_build_array(jsonb_build_object('code','leasing_input_range','severity','blocking','period',p,'driver',key,'message','Occupancy and allowance rates must be between zero and one.'));end if;end loop;
  if avg_units>units then issues:=issues||jsonb_build_array(jsonb_build_object('code','leasing_inventory','severity','blocking','period',p,'message','Average occupied units exceed inventory.'));end if;
  if units is null or ending is null then issues:=issues||jsonb_build_array(jsonb_build_object('code','missing_leasing_assumptions','severity','blocking','period',p,'message','Inventory and occupied units are required.'));end if;
  if input ? 'budgetedOccupancy' and abs(atlas_private.budget_number(input->'budgetedOccupancy')-atlas_private.budget_ratio(avg_units,units))>0.000001 then issues:=issues||jsonb_build_array(jsonb_build_object('code','leasing_reconciliation','severity','blocking','period',p,'driver','budgetedOccupancy','message','Budgeted occupancy does not reconcile with average occupied units.'));end if;
  rows:=rows||jsonb_build_array(row);prior:=ending;
 end loop;
 return jsonb_build_object('schemaVersion',1,'kind','conventional','periods',source->'periods','monthly',rows,'totals',atlas_private.budget_leasing_totals(rows),'issues',issues);
end;$$;

create function atlas_private.prepare_budget_account_drivers(source jsonb,config jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare leasing jsonb;drivers jsonb;pending jsonb;d jsonb;remaining jsonb;periods jsonb;p text;id text;code text;kind text;metric text;local jsonb;row jsonb;amount numeric;volume numeric;amounts jsonb:='[]';issues jsonb:='[]';state jsonb:='{}';key text;seen text[]:='{}';selected boolean;
begin
 if jsonb_typeof(coalesce(config->'accountDrivers','[]'))<>'array' or jsonb_array_length(coalesce(config->'accountDrivers','[]'))>500 then raise exception 'Account driver settings must be an array of at most 500 links';end if;
 leasing:=atlas_private.budget_leasing_schedule(source,config);
 if config ? 'leasingSchedule' then issues:=leasing->'issues';end if;
 select coalesce(jsonb_agg(v),'[]') into drivers from jsonb_array_elements(coalesce(config->'drivers','[]'))v where v#>>'{source,kind}' is distinct from 'leasing_schedule';
 for row in select value from jsonb_array_elements(coalesce(source#>'{baseline,lines}','[]')) loop state:=jsonb_set(state,array[(row->>'period')||'|'||(row->>'accountCode')],coalesce(row->'amount','null'::jsonb));end loop;
 pending:=coalesce(config->'accountDrivers','[]');
 while jsonb_array_length(pending)>0 loop
  d:=null;select v into d from jsonb_array_elements(pending)v where nullif(v->>'baseAccountCode','') is null or not exists(select 1 from jsonb_array_elements(pending)o where o->>'accountCode'=v->>'baseAccountCode') limit 1;
  if d is null then issues:=issues||jsonb_build_array(jsonb_build_object('code','driver_dependency_cycle','severity','blocking','message','Account driver references contain a cycle.'));exit;end if;
  select coalesce(jsonb_agg(v),'[]') into pending from jsonb_array_elements(pending)v where v is distinct from d;
  code:=d->>'accountCode';id:=coalesce(d->>'id',code);kind:=d->>'type';
  if coalesce(code,'')='' or coalesce(kind,'') not in ('FIXED','VARIABLE','OCCUPANCY-DRIVEN','UNIT-DRIVEN','REVENUE-DRIVEN','MANUAL') then raise exception 'Account drivers need an account and supported type';end if;
  if kind='MANUAL' then continue;end if;
  periods:=coalesce(d->'periods',source->'periods');if jsonb_typeof(periods)<>'array' then raise exception 'Account driver reporting periods must be an array';end if;
  for p in select jsonb_array_elements_text(periods) loop
   if not(source->'periods' ? p) or coalesce(source->'lockedPeriods' ? p,false) or coalesce(p<=source#>>'{actuals,cutoffPeriod}',false) then continue;end if;
   key:=p||'|'||code;if key=any(seen) then issues:=issues||jsonb_build_array(jsonb_build_object('code','duplicate_account_driver','severity','blocking','period',p,'accountCode',code,'message','Only one operating driver may set an account per month.'));continue;end if;seen:=array_append(seen,key);
   select v into local from jsonb_array_elements(coalesce(d->'monthly','[]'))v where v->>'period'=p;local:=d||coalesce(local,'{}');
   select v into row from jsonb_array_elements(leasing->'monthly')v where v->>'period'=p;
   metric:=coalesce(d->>'metric',case kind when 'OCCUPANCY-DRIVEN' then 'averageOccupiedUnits' when 'UNIT-DRIVEN' then 'units' end);
   -- STR streams retain their existing approved calculation and source receipt.
   -- A separate browser schedule cannot manufacture STR authority.
   if nullif(d->>'streamId','') is not null then row:=null;issues:=issues||jsonb_build_array(jsonb_build_object('code','str_driver_authority','severity','blocking','period',p,'accountCode',code,'message','Apply STR economics from the retained STR Builder programme.'));end if;
   volume:=case when kind='REVENUE-DRIVEN' and nullif(d->>'baseAccountCode','') is not null then atlas_private.budget_number(state->(p||'|'||(d->>'baseAccountCode'))) else atlas_private.budget_number(row->metric) end;
   amount:=case when kind='FIXED' then round(atlas_private.budget_number(local->'amount'),2)
    when metric in ('rentalIncome','grossPotentialRent','vacancy','concessions','badDebt','netRentalIncome','grossRentalRevenue','budgetedRevenue','strNoi','strUplift') and not(local ? 'rate') then round(volume,2)
    else round((case when local ? 'baseAmount' then atlas_private.budget_number(local->'baseAmount') else 0 end)+round(volume*atlas_private.budget_number(local->'rate'),2),2) end;
   amounts:=amounts||jsonb_build_array(jsonb_build_object('period',p,'accountCode',code,'amount',amount,'driverId',id,'type',kind,'metric',metric));state:=jsonb_set(state,array[key],coalesce(to_jsonb(amount),'null'::jsonb));
   if amount is null then issues:=issues||jsonb_build_array(jsonb_build_object('code','missing_driver_assumptions','severity','blocking','period',p,'accountCode',code,'driverId',id,'message','The account driver is missing a required leasing or rate assumption.'));continue;end if;
   drivers:=drivers||jsonb_build_array(jsonb_build_object('id','budget-schedule-'||id||'-'||p,'type','leasing_schedule','operation','amount','accountCodes',jsonb_build_array(code),'periods',jsonb_build_array(p),'value',amount,'reason',coalesce(d->>'reason','Calculated from the reviewed leasing schedule'),'ownerId',coalesce(d->'ownerId',config->'ownerId'),'reviewedAt',d->'reviewedAt','source',jsonb_build_object('kind','leasing_schedule','driverId',id,'driverType',kind,'metric',metric,'period',p)));
  end loop;
 end loop;
 return jsonb_build_object('scenario',config||jsonb_build_object('drivers',drivers),'leasingSchedule',leasing,'amounts',amounts,'issues',issues);
end;$$;

alter function atlas_private.calculate_reforecast(jsonb,jsonb) rename to calculate_reforecast_before_budget_drivers;
create function atlas_private.calculate_reforecast(source jsonb,config jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare prepared jsonb;s jsonb;lines jsonb:='[]';line jsonb;a jsonb;over jsonb;checks jsonb:='[]';warnings jsonb:='[]';issues jsonb;overrides jsonb:='[]';rules jsonb;rule jsonb;expected numeric;manual numeric;variance numeric;pct numeric;dollar_check boolean;percent_check boolean;material boolean;accepted boolean;evidence jsonb;check_row jsonb;ids jsonb;
begin
 if auth.uid() is null then raise exception 'Authenticated budget calculation required';end if;
 -- Existing budgets without operating links retain the existing engine byte for byte.
 if not(config ? 'leasingSchedule') and jsonb_array_length(coalesce(config->'accountDrivers','[]'))=0 then return atlas_private.calculate_reforecast_before_budget_drivers(source,config);end if;
 if not atlas_private.reforecast_access((source->>'communityId')::uuid,'read') then raise exception 'Budget driver access denied';end if;
 prepared:=atlas_private.prepare_budget_account_drivers(source,config);config:=prepared->'scenario';s:=atlas_private.calculate_reforecast_before_budget_drivers(source,config);issues:=prepared->'issues';
 rules:=coalesce(source->'driverToleranceSettings',atlas_private.budget_export_tolerances((source->>'communityId')::uuid)->'rules');
 for line in select value from jsonb_array_elements(s->'lines') loop
  select v into a from jsonb_array_elements(prepared->'amounts')v where v->>'period'=line->>'period' and v->>'accountCode'=line->>'accountCode';
  if a is not null then
   expected:=atlas_private.budget_number(a->'amount')+coalesce((select sum((c->>'appliedDelta')::numeric) from jsonb_array_elements(coalesce(config->'strBudgetApplications','[]'))application cross join jsonb_array_elements(coalesce(application->'cells','[]'))c where c->>'period'=line->>'period' and c->>'accountCode'=line->>'accountCode'),0);manual:=atlas_private.budget_number(line->'forecast');ids:=jsonb_build_array(a->>'driverId');line:=line||jsonb_build_object('driverCalculatedAmount',expected,'budgetDriverIds',ids);
   select v into over from jsonb_array_elements(coalesce(config->'overrides','[]'))v where v->>'period'=line->>'period' and v->>'accountCode'=line->>'accountCode';
   evidence:=over->'driverOverride';variance:=round(manual-expected,2);pct:=case when expected<>0 then abs(variance/expected)*100 when variance=0 then 0 end;
   rule:=rules->'default'||coalesce(rules->'categories'->(line->>'category'),'{}')||coalesce(rules->'accounts'->(line->>'accountCode'),'{}');
   dollar_check:=case when atlas_private.budget_number(rule->'dollar') is not null then abs(variance)>atlas_private.budget_number(rule->'dollar') end;
   percent_check:=case when atlas_private.budget_number(rule->'percent') is not null then case when expected=0 then variance<>0 else pct>atlas_private.budget_number(rule->'percent') end end;
   material:=(dollar_check is not null or percent_check is not null) and coalesce(case when rule->>'operator'='and' then coalesce(dollar_check,true) and coalesce(percent_check,true) else coalesce(dollar_check,false) or coalesce(percent_check,false) end,false);
   accepted:=coalesce(evidence->>'reason','') in ('Management Adjustment','Known Contract Change','Market Adjustment','Ownership Direction','One-Time Expense','Known Revenue Change','Accounting Adjustment','Other') and (evidence->>'reason'<>'Other' or length(trim(coalesce(evidence->>'comment','')))>0)
    and atlas_private.budget_number(evidence->'calculatedAmount')=expected and atlas_private.budget_number(evidence->'manualAmount')=manual and evidence->'affectedDrivers'=ids;
   accepted:=coalesce(accepted,false);
   if accepted then overrides:=overrides||jsonb_build_array(evidence||jsonb_build_object('period',line->'period','accountCode',line->'accountCode'));end if;
   check_row:=jsonb_build_object('period',line->'period','accountCode',line->'accountCode','category',line->'category','title','BUDGET DRIVER WARNING','message','This adjustment does not reconcile with the current Leasing Schedule or underlying budget drivers.','currentCalculatedAmount',expected,'manualAmount',manual,'expectedAmount',expected,'varianceAmount',variance,'variancePercent',pct,'affectedDrivers',ids,'tolerance',rule,'material',material,'overrideAccepted',accepted,'missingAssumptions',expected is null,'warning',material and not accepted,'override',case when accepted then evidence end);
   checks:=checks||jsonb_build_array(check_row);
   if material and not accepted then warnings:=warnings||jsonb_build_array(check_row);issues:=issues||jsonb_build_array(check_row||jsonb_build_object('code','budget_driver_mismatch','severity','blocking'));end if;
  end if;
  lines:=lines||jsonb_build_array(line);
 end loop;
 s:=(s-'fingerprint')||jsonb_build_object('lines',lines,'leasingSchedule',prepared->'leasingSchedule','driverValidation',jsonb_build_object('schemaVersion',1,'checks',checks,'warnings',warnings,'issues',issues,'overrides',overrides,'reconciled',jsonb_array_length(issues)=0));
 s:=jsonb_set(s,'{diagnostics}',coalesce(s->'diagnostics','[]')||(select coalesce(jsonb_agg(v||jsonb_build_object('severity','error')),'[]') from jsonb_array_elements(issues)v));
 s:=jsonb_set(s,'{completeness,blockerCount}',to_jsonb((select count(*) from jsonb_array_elements(s->'diagnostics')v where v->>'severity'='error')));
 return s||jsonb_build_object('fingerprint',encode(sha256(convert_to(s::text,'UTF8')),'hex'));
end;$$;

-- Clients can supply reasons; actors and timestamps always come from this write.
-- Current source reads retain the exact administrator tolerance version used
-- for local warnings. Historical source bundles are never changed.
alter function atlas_private.reforecast_source_for_config(uuid,jsonb) rename to reforecast_source_before_budget_tolerances;
create function atlas_private.reforecast_source_for_config(cid uuid,config jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare source jsonb;tolerance jsonb;begin
 if auth.uid() is null or not atlas_private.reforecast_access(cid,'read') then raise exception 'Budget source access denied';end if;
 source:=atlas_private.reforecast_source_before_budget_tolerances(cid,config);tolerance:=atlas_private.budget_export_tolerances(cid);
 source:=source||jsonb_build_object('driverToleranceSettings',tolerance->'rules','driverToleranceVersion',tolerance->'versionId');
 return source||jsonb_build_object('sourceVersion',encode(sha256(convert_to((source-'sourceVersion')::text,'UTF8')),'hex'));
end;$$;
revoke all on function atlas_private.reforecast_source_for_config(uuid,jsonb) from public,anon,authenticated;

create function atlas_private.stamp_budget_driver_overrides() returns trigger language plpgsql security definer set search_path='' as $$
declare overrides jsonb:='[]';prior jsonb;v jsonb;old jsonb;evidence jsonb;rows jsonb;begin
 select payload into prior from public.atlas_reforecast_revisions where scenario_id=new.scenario_id order by revision desc limit 1;
 for v in select value from jsonb_array_elements(coalesce(new.payload->'overrides','[]')) loop
  if jsonb_typeof(v->'driverOverride')='object' then
   select o->'driverOverride' into old from jsonb_array_elements(coalesce(prior->'overrides','[]'))o where o->>'period'=v->>'period' and o->>'accountCode'=v->>'accountCode';
   evidence:=atlas_private.reforecast_report_fields(v->'driverOverride',array['schemaVersion','reason','comment','calculatedAmount','manualAmount','affectedDrivers']);
   if evidence is not distinct from atlas_private.reforecast_report_fields(old,array['schemaVersion','reason','comment','calculatedAmount','manualAmount','affectedDrivers']) and old->>'userId' is not null and old->>'timestamp' is not null then evidence:=evidence||jsonb_build_object('userId',old->'userId','timestamp',old->'timestamp');
   else evidence:=evidence||jsonb_build_object('userId',new.actor_id,'timestamp',new.created_at);end if;
   v:=jsonb_set(v,'{driverOverride}',evidence);
  end if;
  overrides:=overrides||jsonb_build_array(v);
 end loop;
 new.payload:=jsonb_set(new.payload,'{overrides}',overrides);
 if jsonb_typeof(new.snapshot->'driverValidation')='object' then
  select coalesce(jsonb_agg((entry-'userId'-'timestamp')||jsonb_build_object('userId',o#>'{driverOverride,userId}','timestamp',o#>'{driverOverride,timestamp}')), '[]') into rows from jsonb_array_elements(coalesce(new.snapshot#>'{driverValidation,overrides}','[]'))entry join jsonb_array_elements(overrides)o on entry->>'period'=o->>'period' and entry->>'accountCode'=o->>'accountCode';
  new.snapshot:=jsonb_set(new.snapshot,'{driverValidation,overrides}',rows);
  select coalesce(jsonb_agg(case when entry->>'overrideAccepted'='true' then jsonb_set(entry,'{override}',coalesce(o->'driverOverride','null'::jsonb)) else entry end),'[]') into rows from jsonb_array_elements(coalesce(new.snapshot#>'{driverValidation,checks}','[]'))entry left join jsonb_array_elements(overrides)o on entry->>'period'=o->>'period' and entry->>'accountCode'=o->>'accountCode';
  new.snapshot:=jsonb_set(new.snapshot,'{driverValidation,checks}',rows);
  new.snapshot:=new.snapshot||jsonb_build_object('fingerprint',encode(sha256(convert_to((new.snapshot-'fingerprint')::text,'UTF8')),'hex'));
 end if;
 return new;
end;$$;
create trigger budget_driver_override_actor before insert on public.atlas_reforecast_revisions for each row execute function atlas_private.stamp_budget_driver_overrides();
revoke all on function atlas_private.budget_number(jsonb),atlas_private.budget_ratio(numeric,numeric),atlas_private.budget_schedule_sum(jsonb,text),atlas_private.budget_leasing_totals(jsonb),atlas_private.budget_leasing_schedule(jsonb,jsonb),atlas_private.prepare_budget_account_drivers(jsonb,jsonb),atlas_private.calculate_reforecast(jsonb,jsonb),atlas_private.stamp_budget_driver_overrides() from public,anon,authenticated;

-- Explicitly verified fiscal calendars may start in any month. Legacy inferred
-- classifications keep their existing January/August defaults.
create or replace function atlas_private.budget_calendar(cid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c jsonb;s jsonb;kind text;start_month integer;candidates text[];
begin
 select to_jsonb(x) into c from public.atlas_communities x where community_id=cid and deleted_at is null;s:=c->'budget_calendar';
 if s->>'verified'='true' and coalesce(s->>'source','')<>'' then kind:=s->>'classification';if coalesce(s->>'startMonth','')~'^[0-9]{1,2}$' then start_month:=(s->>'startMonth')::integer;end if;
 else
  if c->>'review_status'='review_required' and coalesce((c->'review_flags')::text,'')~*'market|property_type|classification|financial' then return jsonb_build_object('verified',false,'reason','Verify inferred financial classification in Community Settings.');end if;
  select array_agg(distinct x) into candidates from unnest(array[c->>'market',c->>'property_type'])x where x in ('Multifamily','Student Housing');
  if cardinality(candidates)=1 then kind:=candidates[1];end if;start_month:=case kind when 'Multifamily' then 1 when 'Student Housing' then 8 end;
 end if;
 if coalesce(kind,'') not in ('Multifamily','Student Housing') or start_month is null or start_month not between 1 and 12 then return jsonb_build_object('verified',false,'reason','Verify the financial classification and fiscal start month in Community Settings.');end if;
 return jsonb_build_object('verified',true,'classification',kind,'startMonth',start_month,'basis',case start_month when 1 then 'calendar' else 'fiscal' end,'settingsVersion',coalesce(s->'version',c->'version'),'source',coalesce(s->>'source','Community Settings'),'summerTurnMonths',case kind when 'Student Housing' then '[6,7,8]'::jsonb else '[]'::jsonb end);
end;$$;
create function atlas_private.set_budget_fiscal_calendar(cid uuid,expected integer,classification text,start_month integer,reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.atlas_communities;s jsonb;begin
 if auth.uid() is null or not atlas_private.reforecast_access(cid,'read') or not exists(select 1 from public.atlas_user_profiles where user_id=auth.uid() and status='active' and role='admin') then raise exception 'Community Settings administrator required';end if;
 if classification not in ('Multifamily','Student Housing') or start_month is null or start_month not between 1 and 12 or length(trim(coalesce(reason,'')))<3 then raise exception 'Explicit classification, fiscal start month and verification reason required';end if;
 select * into c from public.atlas_communities where community_id=cid for update;
 if c.version is distinct from expected then raise exception 'Community Settings changed; reload before saving';end if;
 s:=jsonb_build_object('classification',classification,'startMonth',start_month,'verified',true,'source','Community Settings review','ownerId',auth.uid(),'effectiveDate',current_date,'version',coalesce((c.budget_calendar->>'version')::integer,0)+1,'reason',reason);
 update public.atlas_communities set budget_calendar=s,version=version+1,updated_at=now() where community_id=cid;
 insert into public.atlas_budget_calendar_events(community_id,before_settings,after_settings,actor_id,action,reason) values(cid,c.budget_calendar,s,auth.uid(),'fiscal_calendar_verified',reason);
 return atlas_private.budget_calendar(cid);
end;$$;
create function public.atlas_set_budget_fiscal_calendar(p_community_id uuid,p_expected_version integer,p_classification text,p_start_month integer,p_reason text) returns jsonb language sql security invoker set search_path='' as $$select atlas_private.set_budget_fiscal_calendar(p_community_id,p_expected_version,p_classification,p_start_month,p_reason)$$;
revoke all on function atlas_private.budget_calendar(uuid) from public,anon,authenticated;
revoke all on function atlas_private.set_budget_fiscal_calendar(uuid,integer,text,integer,text),public.atlas_set_budget_fiscal_calendar(uuid,integer,text,integer,text) from public,anon;
grant execute on function atlas_private.set_budget_fiscal_calendar(uuid,integer,text,integer,text),public.atlas_set_budget_fiscal_calendar(uuid,integer,text,integer,text) to authenticated;

-- Retain aggregate STR Builder supporting schedules through the existing saved
-- JSON authority. Reconstruct from hashed original bytes, then bind the stream
-- to the immutable reviewed receipt. Older documents keep their exact shape.
do $upgrade_saved_str_schedules$
declare definition text;anchor text;replacement text;
begin
 if to_regprocedure('atlas_private.reforecast_saved_str_source(jsonb)') is not null then
  select pg_get_functiondef('atlas_private.reforecast_saved_str_source(jsonb)'::regprocedure) into definition;
  anchor:=$anchor$ result:=result||jsonb_build_object('fingerprint',encode(sha256(convert_to(atlas_private.workbook_canonical_json(result),'UTF8')),'hex'));$anchor$;
  replacement:=$replacement$ if programme ? 'supportingSchedules' and programme->'supportingSchedules'<>'null'::jsonb and jsonb_typeof(programme->'supportingSchedules') is distinct from 'object' then raise exception 'Saved STR supporting schedules must be an object';end if;
 if jsonb_typeof(programme->'supportingSchedules')='object' and programme->'supportingSchedules'<>'{}'::jsonb then result:=result||jsonb_build_object('supportingSchedules',programme->'supportingSchedules');end if;
$replacement$||anchor;
  if strpos(definition,anchor)=0 then raise exception 'Saved STR source authority changed; supporting schedule upgrade requires review';end if;
  execute replace(definition,anchor,replacement);
  select pg_get_functiondef('atlas_private.save_reforecast_str_json_source(uuid,uuid,jsonb,jsonb)'::regprocedure) into definition;
  anchor:=$anchor$ review:=review||jsonb_build_object('fingerprint',encode(sha256(convert_to(atlas_private.workbook_canonical_json(review),'UTF8')),'hex'));$anchor$;
  replacement:=$replacement$ if jsonb_typeof(source->'supportingSchedules')='object' and source->'supportingSchedules'<>'{}'::jsonb then review:=review||jsonb_build_object('supportingSchedules',source->'supportingSchedules');end if;
$replacement$||anchor;
  if strpos(definition,anchor)=0 then raise exception 'Saved STR review authority changed; supporting schedule upgrade requires review';end if;
  execute replace(definition,anchor,replacement);
  select pg_get_functiondef('atlas_private.reforecast_saved_str_receipt(jsonb,jsonb)'::regprocedure) into definition;
  anchor:=$anchor$ if stream is distinct from jsonb_build_object('id','rise_str','type','saved_json_monthly_programme','sourceReceiptId',r.source_receipt_id,'sourceHash',r.source_hash,'sourceFingerprint',r.source_fingerprint,'contentHash',r.content_hash,'mappingVersion',r.mapping_version,'application','add','reviewed',true,'reviewedBy',r.actor_id,'reviewedAt',r.review->'reviewedAt','assumptionReason',r.review->'reason') then$anchor$;
  replacement:=$replacement$ if stream is distinct from (jsonb_build_object('id','rise_str','type','saved_json_monthly_programme','sourceReceiptId',r.source_receipt_id,'sourceHash',r.source_hash,'sourceFingerprint',r.source_fingerprint,'contentHash',r.content_hash,'mappingVersion',r.mapping_version,'application','add','reviewed',true,'reviewedBy',r.actor_id,'reviewedAt',r.review->'reviewedAt','assumptionReason',r.review->'reason')||case when jsonb_typeof(r.review->'supportingSchedules')='object' and r.review->'supportingSchedules'<>'{}'::jsonb then jsonb_build_object('programmeId',r.review->'programmeId','supportingSchedules',r.review->'supportingSchedules') else '{}'::jsonb end) then$replacement$;
  if strpos(definition,anchor)=0 then raise exception 'Saved STR stream authority changed; supporting schedule upgrade requires review';end if;
  execute replace(definition,anchor,replacement);
 end if;
end;$upgrade_saved_str_schedules$;
commit;
