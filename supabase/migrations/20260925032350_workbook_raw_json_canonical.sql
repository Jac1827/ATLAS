-- Private helpers only. No upload/finalization, evidence, or public RPC behavior
-- changes until a separately reviewed caller is installed.
begin;

create function atlas_private.workbook_canonical_json_raw_value(p_value json,p_omit_top_key text)
returns text language plpgsql immutable strict set search_path='' as $$
declare kind text; native jsonb; result text;
begin
 kind:=json_typeof(p_value);
 -- PostgreSQL remains authoritative for Unicode, strings, numeric limits and
 -- JSONB's last-duplicate-key rule. Only a scalar or a bounded small container
 -- is expanded; the complete audit never becomes a JSONB parse tree here.
 if kind not in ('object','array') or octet_length(p_value::text)<=65536 then
  native:=p_value::jsonb;
  if p_omit_top_key<>'' and kind='object' then native:=native-p_omit_top_key;end if;
  return atlas_private.workbook_canonical_json(native);
 end if;
 if kind='array' then
  select '['||coalesce(string_agg(atlas_private.workbook_canonical_json_raw_value(e.value,''),',' order by e.ordinality),'')||']'
   into result from json_array_elements(p_value) with ordinality e(value,ordinality);
 else
  -- Validate every original occurrence BEFORE selecting the last occurrence.
  -- For example {"x":"\u0000","x":1} must fail just as a native JSONB cast
  -- does, even though the invalid earlier value does not survive deduplication.
  -- The omitted top-level fingerprint is validated for the same reason.
  with validated as materialized (
   select e.key,e.ordinality,atlas_private.workbook_canonical_json_raw_value(e.value,'') value
    from json_each(p_value) with ordinality e(key,value,ordinality)
  ), last_values as (
   select distinct on (key collate "C") key,value from validated
    order by key collate "C",ordinality desc
  )
  select '{'||coalesce(string_agg(to_jsonb(key)::text||':'||value,',' order by key collate "C") filter(where p_omit_top_key='' or key<>p_omit_top_key),'')||'}'
   into result from last_values;
 end if;
 return result;
end;$$;

create function atlas_private.workbook_canonical_json_raw(p_value json)
returns text language sql immutable strict set search_path='' as $$
 select atlas_private.workbook_canonical_json_raw_value(p_value,'')
$$;

create function atlas_private.workbook_canonical_audit_body_raw(p_audit json)
returns text language plpgsql immutable strict set search_path='' as $$
begin
 if json_typeof(p_audit)<>'object' then raise exception 'Workbook audit must be a JSON object';end if;
 return atlas_private.workbook_canonical_json_raw_value(p_audit,'fingerprint');
end;$$;

create function atlas_private.workbook_audit_fingerprint_raw(p_audit json)
returns text language sql immutable strict set search_path='' as $$
 select encode(sha256(convert_to(atlas_private.workbook_canonical_audit_body_raw(p_audit),'UTF8')),'hex')
$$;

revoke all on function atlas_private.workbook_canonical_json_raw_value(json,text),atlas_private.workbook_canonical_json_raw(json),atlas_private.workbook_canonical_audit_body_raw(json),atlas_private.workbook_audit_fingerprint_raw(json) from public,anon,authenticated;
commit;
