-- Preserve the exact governed finance response while avoiding a copy of its
-- full immutable baseline/source for every one of its monthly metric fields.
-- No persisted data, timeout, permission or financial calculation changes.
begin;
do $migration$
declare definition text; old text; replacement text;
begin
 if (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='atlas_private.reforecast_finance_month(jsonb,jsonb,jsonb)'::regprocedure)
 is distinct from '63b179b8b65beffa514648a4ad43053e8cf7c34af03421d62f4e8d576aa6e945' then raise exception 'Audited indexed finance reader differs; review before applying';end if;
 definition:=pg_get_functiondef('atlas_private.reforecast_finance_month(jsonb,jsonb,jsonb)'::regprocedure);
 old:=$old$ result:=result||jsonb_build_object('effectiveBaseline',coalesce(baseline,jsonb_build_object('status','unavailable','reason','No verified effective baseline')),'originalBudgetVersion',s->'budgetVersion');$old$;
 replacement:=$new$ -- Carry metric data through the loop without copying the full immutable
 -- baseline/source for every metric. Attach the exact baseline once at the end.
 result:=(result-'effectiveBaseline')||jsonb_build_object('originalBudgetVersion',s->'budgetVersion');$new$;
 if length(definition)-length(replace(definition,old,''))<>length(old) then raise exception 'Exact finance baseline initialization anchor missing';end if;
 definition:=replace(definition,old,replacement);
 old:=$old$ return result;$old$;
 replacement:=$new$ -- Preserve even an unusual caller that supplies effectiveBaseline itself as
 -- a metric object: the old loop replaces that field with the supplied metric.
 if not coalesce(jsonb_typeof(s->'effectiveBaseline')='object' and (s->'effectiveBaseline') ? 'budget',false) then
  result:=result||jsonb_build_object('effectiveBaseline',coalesce(baseline,jsonb_build_object('status','unavailable','reason','No verified effective baseline')));
 end if;
 return result;$new$;
 if length(definition)-length(replace(definition,old,''))<>length(old) then raise exception 'Exact finance return anchor missing';end if;
 execute replace(definition,old,replacement);
end;$migration$;
commit;
