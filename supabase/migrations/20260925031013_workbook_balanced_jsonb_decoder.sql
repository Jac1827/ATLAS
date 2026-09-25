-- Keep this replacement private: the public finalizer is still unchanged.
-- Decode bounded raw JSON sections outside aggregate state, then merge disjoint
-- array runs in a balanced tree. No cumulative result history is retained.
begin;
create or replace function atlas_private.workbook_decode_jsonb(p_value json)
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
 runs jsonb[];
 run_level integer;
 carry jsonb;
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
   from (select json_object_keys(p_value) as key limit 2) k;
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
  runs:='{}';
  -- json_agg retains validated JSON text, not a nested JSONB parse tree. Each
  -- ordinary batch has at most 8,192 elements and about 1 MB of raw content;
  -- a larger individual element is decoded alone outside aggregate state.
  for member in
   with items as (
    select e.value,e.ordinality,octet_length(e.value::text) bytes
    from json_array_elements(p_value) with ordinality e(value,ordinality)
   ), segments as (
    select *,sum(bytes) over(order by ordinality rows unbounded preceding)-bytes bytes_before,
     sum(case when bytes>262144 then 1 else 0 end) over(order by ordinality rows unbounded preceding) large_index
    from items
   )
   select bool_or(bytes>262144) single,
    case when bool_or(bytes>262144) then min(value::text)::json
     else json_agg(value order by ordinality) end value
   from segments
   group by (ordinality-1)/8192,bytes_before/1048576,large_index,(bytes>262144)
   order by min(ordinality)
  loop
   if member.single then
    carry:=jsonb_set('[null]'::jsonb,array['0'],atlas_private.workbook_decode_jsonb(member.value),true);
   else carry:=member.value::jsonb;
   end if;
   run_level:=1;
   while runs[run_level] is not null loop
    -- Earlier input always remains on the left. Every occupied level holds
    -- a disjoint older run; clearing it prevents cumulative-history retention.
    carry:=runs[run_level]||carry;
    runs[run_level]:=null;run_level:=run_level+1;
   end loop;
   runs[run_level]:=carry;
  end loop;
  result:='[]'::jsonb;
  if cardinality(runs)>0 then
   for run_level in reverse cardinality(runs)..1 loop
    if runs[run_level] is not null then result:=result||runs[run_level];end if;
   end loop;
  end if;
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
