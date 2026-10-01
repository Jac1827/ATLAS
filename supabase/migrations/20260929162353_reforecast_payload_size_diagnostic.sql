-- Distinguish an expanded save payload over the existing 2 MiB limit from a
-- malformed request. Retained evidence, financial data and access are unchanged.
begin;
do $migration$
declare
 signature regprocedure:='atlas_private.save_reforecast_builder(uuid,uuid,integer,uuid,text,jsonb)'::regprocedure;
 definition text;body text;expected_body text;
 old_guard text:=$old$ if p_scenario_id is null or p_request_id is null or p_expected_revision is null or p_expected_revision<0 or p_action not in ('create','save_draft','edit','reconcile','ready','submit','approve','withdraw','reject','reopen','investor_approve','delete') or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>2097152 then raise exception 'Invalid reforecast save request';end if;$old$;
 new_guard text:=$new$ if p_scenario_id is null or p_request_id is null or p_expected_revision is null or p_expected_revision<0 or p_action not in ('create','save_draft','edit','reconcile','ready','submit','approve','withdraw','reject','reopen','investor_approve','delete') or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid reforecast save request';end if;
 if octet_length(p_payload::text)>2097152 then
  raise exception 'Forecast save payload exceeds the 2 MiB limit.'
   using detail=jsonb_build_object('code','reforecast_payload_too_large','payloadBytes',octet_length(p_payload::text),'limitBytes',2097152,'measurement','postgres_jsonb_text_utf8','stage','save_reforecast_builder','retainedReviewHistory','preserve')::text,
    hint='Preserve all retained reviews and history. Repair the expanded save payload before retrying; sending the same payload again will exceed the same limit.';
 end if;$new$;
begin
 select pg_get_functiondef(signature),prosrc into definition,body from pg_proc where oid=signature;
 if encode(sha256(convert_to(body,'UTF8')),'hex') is distinct from 'bf900f53b0cee1c2475876245958c20a79d254874717ebe3503c6c84b42ab87a' then
  raise exception 'Audited reforecast save payload guard differs; review this migration before applying';
 end if;
 if (length(definition)-length(replace(definition,old_guard,'')))/length(old_guard)<>1 then
  raise exception 'Expected exactly one audited reforecast save payload guard';
 end if;
 expected_body:=replace(body,old_guard,new_guard);
 execute replace(definition,old_guard,new_guard);
 if (select prosrc from pg_proc where oid=signature) is distinct from expected_body then
  raise exception 'Reforecast save payload diagnostic changed unaudited function content';
 end if;
end;$migration$;
commit;
