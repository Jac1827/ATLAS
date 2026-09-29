-- Frozen projection-only SQL fixture captured read-only before this repair.
-- No production data, writes, authorization stubs, or financial acceptance.
-- Bodies match installed reviewed-blank projection dependencies.

CREATE OR REPLACE FUNCTION atlas_private.reforecast_report_fields(value jsonb, allowed text[])
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_object_agg(key,v),'{}') from jsonb_each(case when jsonb_typeof(value)='object' then value else '{}' end) as e(key,v) where key=any(allowed);
$function$;

-- Prior installed body SHA-256: aaf94770a37445bcecdfec06e8e3f0143692343217e0799de81dcb1cdae65497
CREATE OR REPLACE FUNCTION atlas_private.reforecast_report_snapshot_before_saved_str(input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare result jsonb;lines jsonb;drivers jsonb;schedules jsonb;item jsonb;monthly jsonb:='[]';metric_keys text[]:=array['grossIncome','contraRevenue','revenue','opex','expenses','belowNoi','capital','debt','noi','cashFlow','margin'];
begin
 result:=atlas_private.reforecast_report_fields(input,array['schemaVersion','communityId','periods','status','cutoffPeriod','completeness']);
 result:=result||jsonb_build_object('originalPublicationFingerprint',input->'fingerprint','identity',atlas_private.reforecast_report_fields(input->'identity',array['engineVersion','communityId','periods','actualCutoff','actualCloseVersions','mappingRegistryVersion','baselineVersionIds','baselineVersionId','baselineSourceType','baselinePeriodVersions','closeVersions','registryVersion','sourceVersion','driverVersion','scenarioId','scenarioVersion','reforecastVersion','scenarioPurpose','parentPublication','sourceHashes']));
 result:=jsonb_set(result,'{identity,baselinePeriodVersions}',(select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(v,array['period','sourceType','versionId','publicationId','revisionId','contentHash','sourceHash','closeVersionId','verified','status'])),'[]') from jsonb_array_elements(coalesce(input->'identity'->'baselinePeriodVersions','[]'))v));
 select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(v,array['period','accountCode','accountName','department','category','nature','identifier','placement','originalBudget','selectedBaseline','actual','forecast','sourceKind','closeVersionId','mappingValid','immutable','retired','applicable','forecastVariance','actualVariance','forecastFavorability','actualFavorability'])||jsonb_build_object('baselineDisposition',atlas_private.reforecast_report_fields(v->'baselineDisposition',array['kind','confirmed','reviewedBy','reviewedAt','reason','originalBudgetVersionIds']),'baselineLineage',atlas_private.reforecast_report_fields(v->'baselineLineage',array['sourceType','versionId','publicationId','revisionId','contentHash','sourceHash'])) order by v->>'period',v->>'accountCode'),'[]') into lines from jsonb_array_elements(coalesce(input->'lines','[]'))v;
 for item in select value from jsonb_array_elements(coalesce(input->'monthly','[]')) loop
  monthly:=monthly||jsonb_build_array(atlas_private.reforecast_report_fields(item,array['period','closed','applicable','closeVersionId','detailCoverage','controlSource'])||jsonb_build_object('originalBudget',atlas_private.reforecast_report_fields(item->'originalBudget',metric_keys),'reforecast',atlas_private.reforecast_report_fields(item->'reforecast',metric_keys),'actuals',atlas_private.reforecast_report_fields(item->'actuals',metric_keys)));
 end loop;
 select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(v,array['id','type','operation','value','reason','status'])||jsonb_build_object('changed',(select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(c,array['period','accountCode','before','after','delta'])),'[]') from jsonb_array_elements(coalesce(v->'changed','[]'))c))),'[]') into drivers from jsonb_array_elements(coalesce(input->'driverImpacts','[]'))v;
 select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(v,array['streamId','id','period','availableUnits','availableUnitCount','occupancyPercent','availableUnitNights','occupiedUnitNights','grossPotentialIncome','grossIncome','estimatedGrossIncome','netIncome','estimatedNetIncome','vacancyLoss','fees','netMethod','incomeBasis','application','feesIncludedInNet','status']) order by v->>'streamId',v->>'period'),'[]') into schedules from jsonb_array_elements(coalesce(input->'strSchedules',input->'strLeasing','[]'))v;
 result:=result||jsonb_build_object('lines',lines,'monthly',monthly,'driverImpacts',drivers,'strSchedules',schedules,
 'totals',jsonb_build_object('originalBudget',atlas_private.reforecast_report_fields(input->'totals'->'originalBudget',metric_keys),'reforecast',atlas_private.reforecast_report_fields(input->'totals'->'reforecast',metric_keys),'actuals',atlas_private.reforecast_report_fields(input->'totals'->'actuals',metric_keys),'actualsThroughCutoff',atlas_private.reforecast_report_fields(input->'totals'->'actualsThroughCutoff',metric_keys)),
 'diagnostics',(select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(v,array['code','severity','period','accountCode','message'])),'[]') from jsonb_array_elements(coalesce(input->'diagnostics','[]'))v),
 'leasing',(select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(v,array['period','sourceKind','units','occupiedUnits','moveIns','moveOuts','marketRent','occupancy'])),'[]') from jsonb_array_elements(coalesce(input->'leasing','[]'))v));
 result:=result||jsonb_build_object('strBridge',(select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(v,array['period','accountCode','conventional','strContribution','withStr']) order by v->>'period',v->>'accountCode'),'[]') from jsonb_array_elements(coalesce(input->'strBridge','[]'))v));
 return result||jsonb_build_object('fingerprint',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
end;$function$;

-- Prior installed body SHA-256: 1185c9e56c4c713c0c1649db64d4bfb5e09b705251eb6c8f870a59563e07a41e
CREATE OR REPLACE FUNCTION atlas_private.reforecast_report_snapshot_before_noncash(input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare result jsonb;programme jsonb;monthly jsonb;
begin
 result:=atlas_private.reforecast_report_snapshot_before_saved_str(input);programme:=input->'savedStrProgramme';
 if programme is null then return result;end if;
 result:=(result-'fingerprint')||jsonb_build_object('savedStrProgramme',atlas_private.reforecast_report_fields(programme,array['sourceReceiptId','sourceHash','sourceFingerprint','contentHash','programmeId'])||jsonb_build_object('registryExtension',atlas_private.reforecast_report_fields(programme->'registryExtension',array['kind','parentRegistryVersion','parentRegistryHash','registryVersion','registryHash','addedAccountCodes']))||jsonb_build_object('sourceRollupDifferences',(select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(d,array['year','metric','savedProgrammeTotal','savedMonthlyGLTotal','difference','authority'])),'[]') from jsonb_array_elements(coalesce(programme->'sourceRollupDifferences','[]'))d),'rollupReview',atlas_private.reforecast_report_fields(programme->'rollupReview',array['confirmed','sourceHash','authority','reason']),'unitRamp',(select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(v,array['period','units'])),'[]') from jsonb_array_elements(coalesce(programme->'unitRamp','[]'))v),'groupAllocationCount',jsonb_array_length(coalesce(programme->'groupAllocations','[]')),'allocatedUnits',(select sum((v->>'units')::numeric) from jsonb_array_elements(coalesce(programme->'groupAllocations','[]'))v)));
 result:=result||jsonb_build_object('strBridge',(select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(v,array['period','accountCode','conventional','strContribution','withStr','parentDisposition']) order by v->>'period',v->>'accountCode'),'[]') from jsonb_array_elements(coalesce(input->'strBridge','[]'))v),'strSchedules',(select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(v,array['streamId','period','availableUnits','sourceKind','sourceReceiptId','sourceHash','incomeBasis','application','grossIncome','netIncome','capital','status']) order by v->>'period'),'[]') from jsonb_array_elements(coalesce(input->'strSchedules','[]'))v));
 result:=jsonb_set(result,'{lines}',(select jsonb_agg(case when original->'baselineDisposition' is not null then line||jsonb_build_object('baselineDisposition',line->'baselineDisposition'||atlas_private.reforecast_report_fields(original->'baselineDisposition',array['parentDisposition','sourceReceiptId'])) else line end order by ordinal) from jsonb_array_elements(result->'lines') with ordinality q(line,ordinal) join lateral (select value original from jsonb_array_elements(input->'lines') where value->>'period'=line->>'period' and value->>'accountCode'=line->>'accountCode') v on true));
 return result||jsonb_build_object('fingerprint',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
end;$function$;

-- Prior installed body SHA-256: eb60238eb8684878f8b35411f6f11fd1ac2f16926a35ab7e14617dceeccbb863
CREATE OR REPLACE FUNCTION atlas_private.reforecast_report_snapshot_before_workbook_blanks(input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare result jsonb;line jsonb;original jsonb;lines jsonb:='[]';month jsonb;monthly jsonb:='[]';phase text;metrics jsonb;metric_keys text[]:=array['nonCashDepreciationAmortization','cashFlowBeforeNoncash','cashFlowAfterNoncash'];
begin
 result:=atlas_private.reforecast_report_snapshot_before_noncash(input);
 if input->'identity'->'nonCashPresentation'->'schemaVersion' is distinct from '1'::jsonb then return result;end if;
 result:=jsonb_set(result,'{identity,nonCashPresentation}',atlas_private.reforecast_report_fields(input->'identity'->'nonCashPresentation',array['schemaVersion','classificationVersion','cashFlowBasis']));
 -- SELECT INTO used the first array occurrence; null identities never matched.
 with first_rows as materialized (
  select distinct on (e.value->>'period',e.value->>'accountCode')
   e.value->>'period' period,e.value->>'accountCode' account_code,
   atlas_private.reforecast_report_fields(e.value,array['nonCash','nonCashClassificationVersion']) fields
  from jsonb_array_elements(input->'lines') with ordinality e(value,ordinal)
  where e.value->>'period' is not null and e.value->>'accountCode' is not null
  order by e.value->>'period',e.value->>'accountCode',e.ordinal
 ), by_key as (
  select coalesce(jsonb_object_agg(jsonb_build_array(f.period,f.account_code)::text,f.fields),'{}') value from first_rows f
 )
 select coalesce(jsonb_agg(q.value||coalesce(k.value->jsonb_build_array(q.value->>'period',q.value->>'accountCode')::text,'{}') order by q.ordinal),'[]')
 into lines from jsonb_array_elements(result->'lines') with ordinality q(value,ordinal) cross join by_key k;
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
end;$function$;

-- Prior installed body SHA-256: 9b4a9fd54de57e41a0d856c96fe17befe368f5658f185d687b42d42a7a2d8cc0
CREATE OR REPLACE FUNCTION atlas_private.reforecast_report_snapshot(input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare result jsonb;indexed jsonb;lines jsonb;monthly jsonb;
begin
 result:=atlas_private.reforecast_report_snapshot_before_workbook_blanks(input);
 if not(input ? 'workbookCoverage') and not(input ? 'workbookSourceExclusions') and not exists(select 1 from jsonb_array_elements(coalesce(input->'lines','[]'))v where v->>'disposition' in ('workbook_blank','outside_forecast_scope','reviewer_override','source_absent') or v ? 'workbookSourceAmount') then return result;end if;
 select coalesce(jsonb_object_agg(jsonb_build_array(v->>'period',v->>'accountCode')::text,atlas_private.reforecast_report_fields(v,array['disposition','isBlank','legitimateBlank','reviewedForecastBlankConfirmed','sourceScopeExclusionConfirmed','workbookSourceAmount','workbookSourceDisposition','workbookSource'])),'{}') into indexed from jsonb_array_elements(input->'lines')v;
 select jsonb_agg(v||coalesce(indexed->jsonb_build_array(v->>'period',v->>'accountCode')::text,'{}') order by ordinal) into lines from jsonb_array_elements(result->'lines') with ordinality q(v,ordinal);
 result:=result||jsonb_build_object('lines',lines);
 if input ? 'workbookSourceExclusions' then result:=result||jsonb_build_object('workbookSourceExclusions',input->'workbookSourceExclusions');end if;
 if input ? 'workbookCoverage' then
 select coalesce(jsonb_object_agg(v->>'period',atlas_private.reforecast_report_fields(v,array['workbookCoverage','knownValueTotals','workbookSourceTotals'])),'{}') into indexed from jsonb_array_elements(input->'monthly')v;
 select jsonb_agg(v||coalesce(indexed->(v->>'period'),'{}') order by ordinal) into monthly from jsonb_array_elements(result->'monthly') with ordinality q(v,ordinal);
 result:=result||jsonb_build_object('lines',lines,'monthly',monthly,'workbookCoverage',input->'workbookCoverage','knownValueTotals',input->'knownValueTotals','workbookSourceTotals',input->'workbookSourceTotals');
 if input->'identity' ? 'workbookSourcePolicy' then result:=jsonb_set(result,'{identity,workbookSourcePolicy}',input->'identity'->'workbookSourcePolicy');end if;
 end if;
 return result||jsonb_build_object('fingerprint',encode(sha256(convert_to((result-'fingerprint')::text,'UTF8')),'hex'));
end;$function$;

revoke all on function atlas_private.reforecast_report_fields(jsonb,text[]),atlas_private.reforecast_report_snapshot_before_saved_str(jsonb),atlas_private.reforecast_report_snapshot_before_noncash(jsonb),atlas_private.reforecast_report_snapshot_before_workbook_blanks(jsonb),atlas_private.reforecast_report_snapshot(jsonb) from public,anon,authenticated;
