begin;
-- Add presentation only to newly calculated snapshots with a fully reviewed,
-- immutable classification version. Existing publications/actuals are untouched.
alter function public.atlas_save_reforecast_registry(uuid,uuid,uuid,jsonb) set schema atlas_private;
alter function atlas_private.atlas_save_reforecast_registry(uuid,uuid,uuid,jsonb) rename to save_reforecast_registry_before_noncash;
create function public.atlas_save_reforecast_registry(p_community_id uuid,p_expected_version_id uuid,p_request_id uuid,p_payload jsonb)
returns public.atlas_reforecast_registries language plpgsql security definer set search_path='' as $$
declare account jsonb;reviewed boolean:=p_payload->'nonCashClassificationVersion'='1'::jsonb;
begin
 if p_payload ? 'nonCashClassificationVersion' and not coalesce(reviewed,false) then raise exception 'Unsupported noncash classification version';end if;
 for account in select value from jsonb_array_elements(p_payload->'accounts') loop
  if reviewed then
   if jsonb_typeof(account->'nonCash') is distinct from 'boolean' then raise exception 'Review the noncash classification of every account explicitly';end if;
   if account->>'nonCash'='true' and (account->>'nature' is distinct from 'below_noi' or account->>'placement' is distinct from 'below_noi') then raise exception 'Noncash depreciation/amortization must be classified below NOI';end if;
  elsif account ? 'nonCash' then raise exception 'Noncash classifications require an explicit complete versioned review';end if;
 end loop;
 return atlas_private.save_reforecast_registry_before_noncash(p_community_id,p_expected_version_id,p_request_id,p_payload);
end;$$;
revoke all on function atlas_private.save_reforecast_registry_before_noncash(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.atlas_save_reforecast_registry(uuid,uuid,uuid,jsonb) from public,anon;
grant execute on function public.atlas_save_reforecast_registry(uuid,uuid,uuid,jsonb) to authenticated;

alter function atlas_private.reforecast_source(uuid,text[],uuid[],uuid) rename to reforecast_source_before_noncash;
create function atlas_private.reforecast_source(cid uuid,periods text[],budget_ids uuid[] default null,registry_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;payload jsonb;
begin
 result:=atlas_private.reforecast_source_before_noncash(cid,periods,budget_ids,registry_id);
 select r.payload into payload from public.atlas_reforecast_registries r where r.community_id=cid and r.version_id::text=result->'registry'->>'version';
 if payload->'nonCashClassificationVersion'='1'::jsonb then
  result:=jsonb_set(result,'{registry,nonCashClassificationVersion}','1');
  result:=result||jsonb_build_object('sourceVersion',encode(sha256(convert_to((result-'sourceVersion')::text,'UTF8')),'hex'));
 end if;
 return result;
end;$$;

create function atlas_private.reforecast_noncash_metrics(metrics jsonb,lines jsonb,field text,unavailable boolean default false)
returns jsonb language plpgsql immutable set search_path='' as $$
declare row jsonb;charge numeric:=0;missing boolean:=false;after_value numeric;
begin
 if unavailable then return metrics||jsonb_build_object('nonCashDepreciationAmortization',null,'cashFlowBeforeNoncash',null,'cashFlowAfterNoncash',null);end if;
 if field in ('originalBudget','selectedBaseline') and jsonb_array_length(lines)>0 and not exists(select 1 from jsonb_array_elements(lines)v where v->>field is not null or v->'baselineDisposition'->>'kind' is distinct from 'no_original_budget_row') then
  return metrics||jsonb_build_object('nonCashDepreciationAmortization',null,'cashFlowBeforeNoncash',null,'cashFlowAfterNoncash',null);
 end if;
 for row in select value from jsonb_array_elements(lines) loop
  if field in ('originalBudget','selectedBaseline') and row->>field is null and row->'baselineDisposition'->>'kind'='no_original_budget_row' then continue;end if;
  if row->'nonCashClassificationVersion' is distinct from '1'::jsonb or jsonb_typeof(row->'nonCash') is distinct from 'boolean' or row->>'mappingValid' is distinct from 'true' then missing:=true;
  elsif row->>'nonCash'='true' then
   if row->>'nature' is distinct from 'below_noi' or row->>'placement' is distinct from 'below_noi' or jsonb_typeof(row->field) is distinct from 'number' then missing:=true;
   else charge:=charge+(row->>field)::numeric;end if;
  end if;
 end loop;
 if missing then charge:=null;else charge:=round(charge,2);end if;
 after_value:=(metrics->>'cashFlow')::numeric;
 return metrics||jsonb_build_object('nonCashDepreciationAmortization',charge,'cashFlowBeforeNoncash',round(after_value+charge,2),'cashFlowAfterNoncash',after_value);
end;$$;

-- Keep the saved-STR/core calculator chain intact, including all prior guards.
alter function atlas_private.calculate_reforecast(jsonb,jsonb) rename to calculate_reforecast_before_noncash;
create function atlas_private.calculate_reforecast(source jsonb,config jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;line jsonb;account jsonb;lines jsonb:='[]';monthly jsonb:='[]';month jsonb;month_lines jsonb;phase text;field text;metrics jsonb;totals jsonb;metric text;total numeric;missing bigint;selected_count bigint;reviewed boolean;
begin
 result:=atlas_private.calculate_reforecast_before_noncash(source,config);
 if source->'registry'->'nonCashClassificationVersion' is distinct from '1'::jsonb then return result;end if;
 for line in select value from jsonb_array_elements(result->'lines') loop
  if line->>'immutable'='true' then account:=line->'inheritedDetail';reviewed:=account->'nonCashClassificationVersion'='1'::jsonb;
  else select a into account from jsonb_array_elements(source->'registry'->'accounts') a where a->>'accountCode'=line->>'accountCode';reviewed:=true;end if;
  line:=line||jsonb_build_object('nonCash',case when reviewed and jsonb_typeof(account->'nonCash')='boolean' then account->'nonCash' else 'null'::jsonb end,'nonCashClassificationVersion',case when reviewed and jsonb_typeof(account->'nonCash')='boolean' then 1 end);
  lines:=lines||jsonb_build_array(line);
 end loop;
 result:=jsonb_set(result,'{lines}',lines);
 result:=jsonb_set(result,'{identity,nonCashPresentation}','{"schemaVersion":1,"classificationVersion":1,"cashFlowBasis":"after_noncash_depreciation_amortization"}');
 for month in select value from jsonb_array_elements(result->'monthly') loop
  select coalesce(jsonb_agg(v),'[]') into month_lines from jsonb_array_elements(lines) v where v->>'period'=month->>'period';
  foreach phase in array array['originalBudget','selectedBaseline','reforecast','actuals'] loop
   if not(month ? phase) then continue;end if;
   field:=case when phase='reforecast' then case when month->>'closed'='true' and not exists(select 1 from jsonb_array_elements(month_lines)v where v->>'immutable'='true') then 'actual' else 'forecast' end when phase='actuals' then 'actual' else phase end;
   metrics:=atlas_private.reforecast_noncash_metrics(month->phase,month_lines,field,coalesce(phase='actuals' and month->>'closed' is distinct from 'true' or phase='reforecast' and month->>'applicable'='false',false));
   month:=jsonb_set(month,array[phase],metrics);
  end loop;
  monthly:=monthly||jsonb_build_array(month);
 end loop;
 result:=jsonb_set(result,'{monthly}',monthly);totals:=result->'totals';
 for phase in select jsonb_object_keys(totals) loop
  metrics:=totals->phase;field:=case when phase='actualsThroughCutoff' then 'actuals' else phase end;
  foreach metric in array array['nonCashDepreciationAmortization','cashFlowBeforeNoncash','cashFlowAfterNoncash'] loop
   select count(*),sum((v->field->>metric)::numeric),count(*) filter(where v->field->>metric is null) into selected_count,total,missing from jsonb_array_elements(monthly)v where (phase='originalBudget' or v->>'applicable' is distinct from 'false') and (phase<>'actualsThroughCutoff' or v->>'closed'='true');
   metrics:=metrics||jsonb_build_object(metric,case when selected_count>0 and missing=0 then round(total,2) end);
  end loop;
  metrics:=metrics||jsonb_build_object('cashFlowBeforeNoncash',round((metrics->>'cashFlowAfterNoncash')::numeric+(metrics->>'nonCashDepreciationAmortization')::numeric,2));
  totals:=jsonb_set(totals,array[phase],metrics);
 end loop;
 result:=jsonb_set(result,'{totals}',totals);
 return result||jsonb_build_object('fingerprint',encode(sha256(convert_to((result-'fingerprint')::text,'UTF8')),'hex'));
end;$$;

-- Project only the new allowlisted fields from the same immutable publication.
-- Legacy projections return byte-identical results and fingerprints.
alter function atlas_private.reforecast_report_snapshot(jsonb) rename to reforecast_report_snapshot_before_noncash;
create function atlas_private.reforecast_report_snapshot(input jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb;line jsonb;original jsonb;lines jsonb:='[]';month jsonb;monthly jsonb:='[]';phase text;metrics jsonb;metric_keys text[]:=array['nonCashDepreciationAmortization','cashFlowBeforeNoncash','cashFlowAfterNoncash'];
begin
 result:=atlas_private.reforecast_report_snapshot_before_noncash(input);
 if input->'identity'->'nonCashPresentation'->'schemaVersion' is distinct from '1'::jsonb then return result;end if;
 result:=jsonb_set(result,'{identity,nonCashPresentation}',atlas_private.reforecast_report_fields(input->'identity'->'nonCashPresentation',array['schemaVersion','classificationVersion','cashFlowBasis']));
 for line in select value from jsonb_array_elements(result->'lines') loop
  select v into original from jsonb_array_elements(input->'lines')v where v->>'period'=line->>'period' and v->>'accountCode'=line->>'accountCode';
  lines:=lines||jsonb_build_array(line||atlas_private.reforecast_report_fields(original,array['nonCash','nonCashClassificationVersion']));
 end loop;
 result:=jsonb_set(result,'{lines}',lines);
 for month in select value from jsonb_array_elements(result->'monthly') loop
  select v into original from jsonb_array_elements(input->'monthly')v where v->>'period'=month->>'period';
  foreach phase in array array['originalBudget','selectedBaseline','reforecast','actuals'] loop
   if original ? phase then month:=jsonb_set(month,array[phase],coalesce(month->phase,'{}')||atlas_private.reforecast_report_fields(original->phase,metric_keys));end if;
  end loop;monthly:=monthly||jsonb_build_array(month);
 end loop;result:=jsonb_set(result,'{monthly}',monthly);
 for phase in select jsonb_object_keys(input->'totals') loop
  result:=jsonb_set(result,array['totals',phase],coalesce(result->'totals'->phase,'{}')||atlas_private.reforecast_report_fields(input->'totals'->phase,metric_keys));
 end loop;
 return result||jsonb_build_object('fingerprint',encode(sha256(convert_to((result-'fingerprint')::text,'UTF8')),'hex'));
end;$$;
revoke all on function atlas_private.reforecast_source_before_noncash(uuid,text[],uuid[],uuid),atlas_private.reforecast_source(uuid,text[],uuid[],uuid),atlas_private.reforecast_noncash_metrics(jsonb,jsonb,text,boolean),atlas_private.calculate_reforecast_before_noncash(jsonb,jsonb),atlas_private.calculate_reforecast(jsonb,jsonb),atlas_private.reforecast_report_snapshot_before_noncash(jsonb),atlas_private.reforecast_report_snapshot(jsonb) from public,anon,authenticated;
commit;
