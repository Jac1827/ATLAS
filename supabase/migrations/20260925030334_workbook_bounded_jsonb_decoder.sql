-- Helper-only rollout. No public request path changes until the separate
-- finalizer migration is applied after exact retained-byte parity is verified.
-- Large JSONB input parsing retains a parse tree for every nested object. Keep
-- the validated JSON text and construct one bounded array batch at a time.
begin;
create function atlas_private.workbook_decode_jsonb(p_value json)
returns jsonb language plpgsql immutable strict set search_path='' as $$
declare
 kind text;
 result jsonb;
 member record;
 batch jsonb;
 wrappers text[]:='{}';
 wrapper_index integer;
 member_count integer;
 member_key text;
 member_bytes integer;
 batch_bytes integer;
 batch_members integer;
begin
 -- Peel chains of single-member containers without recursive SQL calls. A
 -- large scalar nested deeply in otherwise tiny containers does not need one
 -- SQL executor/aggregate stack frame per wrapper.
 loop
  exit when octet_length(p_value::text)<=262144;
  kind:=json_typeof(p_value);
  if kind='array' and json_array_length(p_value)=1 then
   wrappers:=array_append(wrappers,null::text);p_value:=p_value->0;
  elsif kind='object' then
   select count(*),min(k.key) into member_count,member_key
   from (select key from json_each(p_value) limit 2) k;
   exit when member_count<>1;
   wrappers:=array_append(wrappers,member_key);p_value:=p_value->member_key;
  else exit;
  end if;
 end loop;
 kind:=json_typeof(p_value);
 -- The ordinary PostgreSQL cast is authoritative for scalar/numeric/Unicode
 -- semantics and for small containers. SQL NULL is handled by STRICT.
 if kind not in ('object','array') or octet_length(p_value::text)<=262144 then
  result:=p_value::jsonb;
 elsif kind='object' then
  result:='{}'::jsonb;
  batch:='{}'::jsonb;batch_bytes:=0;batch_members:=0;
  -- json_each preserves input order and duplicate keys. Setting each decoded
  -- member in that order retains native jsonb's last-duplicate-key behavior;
  -- every earlier value is still validated before it can be superseded.
  for member in select key,value from json_each(p_value) loop
   member_bytes:=octet_length(member.value::text)+octet_length(member.key);
   if member_bytes>262144 then
    if batch_members>0 then result:=result||batch;batch:='{}'::jsonb;batch_bytes:=0;batch_members:=0;end if;
    result:=jsonb_set(result,array[member.key],atlas_private.workbook_decode_jsonb(member.value),true);
   else
    batch:=jsonb_set(batch,array[member.key],member.value::jsonb,true);
    batch_bytes:=batch_bytes+member_bytes;batch_members:=batch_members+1;
    if batch_members>=128 or batch_bytes>=262144 then
     result:=result||batch;batch:='{}'::jsonb;batch_bytes:=0;batch_members:=0;
    end if;
   end if;
  end loop;
  if batch_members>0 then result:=result||batch;end if;
 else
  result:='[]'::jsonb;
 -- GroupAggregate releases each batch's parse state. PL/pgSQL retains only
 -- the current result and the current batch, unlike a recursive SQL CTE that
 -- materializes every cumulative version of the large array.
  for batch in
  select jsonb_agg(case when octet_length(e.value::text)>262144
    then atlas_private.workbook_decode_jsonb(e.value) else e.value::jsonb end order by e.ordinality)
  from json_array_elements(p_value) with ordinality e(value,ordinality)
  group by (e.ordinality-1)/8192
  order by (e.ordinality-1)/8192
  loop
   result:=result||batch;
  end loop;
 end if;
 if cardinality(wrappers)>0 then
  for wrapper_index in reverse cardinality(wrappers)..1 loop
   if wrappers[wrapper_index] is null then result:=jsonb_set('[null]'::jsonb,array['0'],result,true);
   else result:=jsonb_set('{}'::jsonb,array[wrappers[wrapper_index]],result,true);
   end if;
  end loop;
 end if;
 return result;
end;$$;
revoke all on function atlas_private.workbook_decode_jsonb(json) from public,anon,authenticated;
commit;
