-- Index immutable source errors and statement checks once per validation call.
-- Preserve both atomic-import validation gates and every existing rejection.
begin;
do $migration$
declare definition text;before_guard text;after_guard text;index_statement text;
begin
 definition:=pg_get_functiondef('atlas_private.reforecast_import_issues_before_source_relationships(jsonb,jsonb)'::regprocedure);
 if position('registry_accounts jsonb;mapping jsonb' in definition)=0 then raise exception 'Import validator declaration differs; review installed prerequisite';end if;
 definition:=replace(definition,'registry_accounts jsonb;mapping jsonb','source_issue_cells jsonb;source_reconciliation_periods jsonb;registry_accounts jsonb;mapping jsonb');
 index_statement:=$index$
 select coalesce(jsonb_object_agg(jsonb_build_array(e->>'sheet',e->>'address')::text,true),'{}') into source_issue_cells
 from jsonb_array_elements(coalesce(upload->'issues','[]'))e
 where e->>'sheet' is not null and e->>'address' is not null and e->>'code' in ('excel_error','broken_formula_reference','external_formula_reference','missing_formula_sheet','broken_named_formula_reference');
 select coalesce(jsonb_object_agg(k,periods),'{}') into source_reconciliation_periods from (
  select jsonb_build_array(c->>'sheet',c->>'row')::text k,jsonb_agg(c->'periods') periods
  from jsonb_array_elements(coalesce(upload->'reconciliation','[]'))c
  where c->>'sheet' is not null and c->>'row' is not null and c->>'status'='mismatch'
  group by c->>'sheet',c->>'row'
 ) grouped;
$index$;
 if position($anchor$ for id in select jsonb_array_elements_text(mapping->'selectedLineIds') loop$anchor$ in definition)=0 then raise exception 'Import selection loop differs; review installed prerequisite';end if;
 definition:=replace(definition,$before$ for id in select jsonb_array_elements_text(mapping->'selectedLineIds') loop$before$,index_statement||$after$ for id in select jsonb_array_elements_text(mapping->'selectedLineIds') loop$after$);
 before_guard:=$before$if exists(select 1 from jsonb_array_elements(coalesce(upload->'issues','[]'))e where e->>'sheet'=line->>'sheet' and e->>'address'=line->>'address' and e->>'code' in ('excel_error','broken_formula_reference','external_formula_reference','missing_formula_sheet','broken_named_formula_reference')) or exists(select 1 from jsonb_array_elements(coalesce(upload->'reconciliation','[]'))c where c->>'sheet'=line->>'sheet' and c->>'row'=line->>'row' and c->'periods' ? (line->>'period') and c->>'status'='mismatch') then$before$;
 after_guard:=$after$if source_issue_cells ? (jsonb_build_array(line->>'sheet',line->>'address')::text) or exists(select 1 from jsonb_array_elements(coalesce(source_reconciliation_periods->(jsonb_build_array(line->>'sheet',line->>'row')::text),'[]')) checked_periods where checked_periods ? (line->>'period')) then$after$;
 if position(before_guard in definition)=0 then raise exception 'Import evidence rejection differs; review installed prerequisite';end if;
 definition:=replace(definition,before_guard,after_guard);
 execute definition;
end;$migration$;
-- CREATE OR REPLACE preserves the existing owner, search path and grants.
revoke all on function atlas_private.reforecast_import_issues_before_source_relationships(jsonb,jsonb) from public,anon,authenticated;
commit;
