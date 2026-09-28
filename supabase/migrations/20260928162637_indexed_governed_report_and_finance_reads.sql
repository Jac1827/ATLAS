-- Remove repeated JSON-array scans from immutable report and finance readers.
-- The reviewed bodies, output order, first matching row, null semantics, access
-- checks, security metadata and timeouts are preserved. No stored row changes.
begin;
do $migration$
declare definition text; before_text text; after_text text;
begin
 if (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='atlas_private.reforecast_report_snapshot(jsonb)'::regprocedure)
   is distinct from 'd3f3256e277908d75aa124f0ffdc31096ca787f2a24bd4c0860875a67c2b0292' then
  raise exception 'Audited report snapshot reader differs; review this migration before applying';
 end if;
 if (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='atlas_private.reforecast_finance_month(jsonb,jsonb,jsonb)'::regprocedure)
   is distinct from '851fc75abbf5a2439692fd5227fb89fb8da82b3e22e34b82d840cfd9112822be' then
  raise exception 'Audited monthly finance reader differs; review this migration before applying';
 end if;
 definition:=pg_get_functiondef('atlas_private.reforecast_report_snapshot(jsonb)'::regprocedure);
 before_text:=$old$ for line in select value from jsonb_array_elements(result->'lines') loop
  select v into original from jsonb_array_elements(input->'lines')v where v->>'period'=line->>'period' and v->>'accountCode'=line->>'accountCode';
  lines:=lines||jsonb_build_array(line||atlas_private.reforecast_report_fields(original,array['nonCash','nonCashClassificationVersion']));
 end loop;$old$;
 after_text:=$new$ -- SELECT INTO used the first array occurrence; null identities never matched.
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
 into lines from jsonb_array_elements(result->'lines') with ordinality q(value,ordinal) cross join by_key k;$new$;
 if length(definition)-length(replace(definition,before_text,''))<>length(before_text) then raise exception 'Exact report lookup rewrite anchor missing';end if;
 execute replace(definition,before_text,after_text);
 definition:=pg_get_functiondef('atlas_private.reforecast_finance_month(jsonb,jsonb,jsonb)'::regprocedure);
 before_text:='lines jsonb;mapped jsonb;';
 if length(definition)-length(replace(definition,before_text,''))<>length(before_text) then raise exception 'Exact finance declaration rewrite anchor missing';end if;
 definition:=replace(definition,before_text,'lines jsonb;lines_by_account jsonb;mapped jsonb;');
 before_text:=$old$ mapped:=atlas_private.reforecast_metric(lines,'amount');$old$;
 after_text:=$new$ mapped:=atlas_private.reforecast_metric(lines,'amount');
 -- Index only the first occurrence, matching the prior non-STRICT SELECT INTO.
 select coalesce(jsonb_object_agg(f.account_code,f.value),'{}') into lines_by_account
 from (
  select distinct on (e.value->>'accountCode') e.value->>'accountCode' account_code,jsonb_build_object('amount',e.value->'amount') value
  from jsonb_array_elements(lines) with ordinality e(value,ordinal)
  where e.value->>'accountCode' is not null
  order by e.value->>'accountCode',e.ordinal
 ) f;$new$;
 if length(definition)-length(replace(definition,before_text,''))<>length(before_text) then raise exception 'Exact finance index rewrite anchor missing';end if;
 definition:=replace(definition,before_text,after_text);
 before_text:=$old$ select value into row from jsonb_array_elements(lines) where value->>'accountCode'=part->>'glCode';$old$;
 after_text:=$new$ row:=lines_by_account->(part->>'glCode');$new$;
 if length(definition)-length(replace(definition,before_text,''))<>length(before_text) then raise exception 'Exact finance lookup rewrite anchor missing';end if;
 execute replace(definition,before_text,after_text);
end;
$migration$;
commit;
