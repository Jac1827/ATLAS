-- Keep the minimum immutable proof needed by reviewed-null report consumers.
-- No stored forecast, publication, approval or public access function changes.
begin;
do $migration$
begin
 if (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='atlas_private.reforecast_report_snapshot(jsonb)'::regprocedure)
   is distinct from '9b4a9fd54de57e41a0d856c96fe17befe368f5658f185d687b42d42a7a2d8cc0' then
  raise exception 'Audited reviewed-blank report projection differs; review this migration before applying';
 end if;
end;$migration$;

create or replace function atlas_private.reforecast_report_snapshot(input jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb;indexed jsonb;lines jsonb;monthly jsonb;
begin
 result:=atlas_private.reforecast_report_snapshot_before_workbook_blanks(input);
 if not(input ? 'workbookCoverage') and not(input ? 'workbookSourceExclusions') and not exists(select 1 from jsonb_array_elements(coalesce(input->'lines','[]'))v where v->>'disposition' in ('workbook_blank','reviewed_forecast_blank','outside_forecast_scope','reviewer_override','source_absent') or v ? 'workbookSourceAmount') then return result;end if;
 -- Do not launder a contradictory absent-source record by stripping workbook
 -- coordinates or an amount while projecting the otherwise valid review.
 if exists(select 1 from jsonb_array_elements(coalesce(input->'lines','[]'))v
  cross join lateral jsonb_each(case when jsonb_typeof(v->'source')='object' then v->'source' else '{}' end)e
  where v->>'disposition'='reviewed_forecast_blank'
   and e.key in ('sourceLineId','sheet','address','sourceCoordinates','sourceAmount') and e.value<>'null'::jsonb) then
  raise exception 'Reviewed forecast blank report source contains contradictory workbook cell evidence';
 end if;
 select coalesce(jsonb_object_agg(jsonb_build_array(v->>'period',v->>'accountCode')::text,
  atlas_private.reforecast_report_fields(v,array['disposition','isBlank','legitimateBlank','reviewedForecastBlankConfirmed','sourceScopeExclusionConfirmed','workbookSourceAmount','workbookSourceDisposition','workbookSource'])
  ||case when v->>'disposition'='reviewed_forecast_blank' and jsonb_typeof(v->'source')='object' then
   jsonb_build_object('source',atlas_private.reforecast_report_fields(v->'source',array['kind','workbookSourceAbsent','uploadId','auditId','sourceHash','mappingVersion','sourceScenario'])
    ||case when v->'source' ? 'review' then jsonb_build_object('review',atlas_private.reforecast_report_fields(v->'source'->'review',array['period','accountCode','confirmed','reviewedBy','reviewedAt','reason'])) else '{}'::jsonb end)
   else '{}'::jsonb end),'{}') into indexed from jsonb_array_elements(input->'lines')v;
 select jsonb_agg(v||coalesce(indexed->jsonb_build_array(v->>'period',v->>'accountCode')::text,'{}') order by ordinal) into lines from jsonb_array_elements(result->'lines') with ordinality q(v,ordinal);
 result:=result||jsonb_build_object('lines',lines);
 -- Only the new numeric-on-null bridge requires source-cell proof. Keep every
 -- cell (including duplicates and malformed entries) so validation cannot be
 -- satisfied by filtering away conflicting evidence. Private cell extras never
 -- enter the report. Explicit numeric zero remains distinct from no cell.
 if exists(select 1 from jsonb_array_elements(coalesce(input->'strBridge','[]'))v
  where v->>'parentDisposition' in ('reviewed_forecast_blank','workbook_blank') and jsonb_typeof(v->'withStr')='number') then
  result:=jsonb_set(result,'{savedStrProgramme,cells}',(select coalesce(jsonb_agg(
   atlas_private.reforecast_report_fields(v,array['period','accountCode','application','parentAmount','parentDisposition','sourceAmount','combinedForecast']) order by ordinal),'[]')
   from jsonb_array_elements(coalesce(input->'savedStrProgramme'->'cells','[]')) with ordinality q(v,ordinal)));
 end if;
 if input ? 'workbookSourceExclusions' then result:=result||jsonb_build_object('workbookSourceExclusions',input->'workbookSourceExclusions');end if;
 if input ? 'workbookCoverage' then
 select coalesce(jsonb_object_agg(v->>'period',atlas_private.reforecast_report_fields(v,array['workbookCoverage','knownValueTotals','workbookSourceTotals'])),'{}') into indexed from jsonb_array_elements(input->'monthly')v;
 select jsonb_agg(v||coalesce(indexed->(v->>'period'),'{}') order by ordinal) into monthly from jsonb_array_elements(result->'monthly') with ordinality q(v,ordinal);
 result:=result||jsonb_build_object('lines',lines,'monthly',monthly,'workbookCoverage',input->'workbookCoverage','knownValueTotals',input->'knownValueTotals','workbookSourceTotals',input->'workbookSourceTotals');
 if input->'identity' ? 'workbookSourcePolicy' then result:=jsonb_set(result,'{identity,workbookSourcePolicy}',input->'identity'->'workbookSourcePolicy');end if;
 end if;
 return result||jsonb_build_object('fingerprint',encode(sha256(convert_to((result-'fingerprint')::text,'UTF8')),'hex'));
end;$$;
revoke all on function atlas_private.reforecast_report_snapshot(jsonb) from public,anon,authenticated;
commit;
