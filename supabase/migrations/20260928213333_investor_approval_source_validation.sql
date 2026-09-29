-- Final investor approval must satisfy current source rules even when the
-- published snapshot predates them. Validate against its frozen financial
-- source plus immutable workbook evidence; never rebase or rewrite history.
begin;
create function atlas_private.validate_reforecast_investor_source(cid uuid,sid uuid,prior_revision integer,source jsonb,config jsonb)
returns void language plpgsql security invoker set search_path='' set plan_cache_mode='force_generic_plan' as $$
declare checked_source jsonb;checked_snapshot jsonb;issues jsonb;
begin
 if source->>'communityId' is distinct from cid::text then raise exception 'Investor approval source community mismatch';end if;
 if (nullif(trim(config->>'uploadId'),'') is null or jsonb_typeof(config->'importMapping') is distinct from 'object') and (exists(
  select 1 from public.atlas_reforecast_import_receipts receipt
  join public.atlas_reforecast_revisions revision on revision.revision_id=receipt.revision_id and revision.community_id=receipt.community_id and revision.scenario_id=receipt.scenario_id
  where receipt.community_id=cid and receipt.scenario_id=sid and revision.revision<=prior_revision
 ) or exists(
  select 1 from public.atlas_reforecast_revisions revision
  where revision.community_id=cid and revision.scenario_id=sid and revision.revision<=prior_revision and (
   nullif(trim(revision.payload->>'uploadId'),'') is not null
   or (jsonb_typeof(revision.payload->'importMapping')='object' and revision.payload->'importMapping'<>'{}'::jsonb)
   or jsonb_array_length(case when jsonb_typeof(revision.payload->'importHistory')='array' then revision.payload->'importHistory' else '[]'::jsonb end)>0
   or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(revision.payload->'overrides')='array' then revision.payload->'overrides' else '[]'::jsonb end)o where nullif(trim(o->>'sourceLineId'),'') is not null or nullif(trim(o->>'uploadId'),'') is not null)
  )
 )) then
  raise exception 'Published workbook provenance is missing despite retained scenario import history. Preserve this publication; restore and review its workbook mapping in a corrected VP-published revision before investor approval';
 end if;
 config:=atlas_private.expand_reforecast_mapping_references(cid,config);
 checked_source:=atlas_private.attach_reforecast_workbook_context(source,config);
 checked_snapshot:=atlas_private.calculate_reforecast(checked_source,config);
 issues:=coalesce(checked_snapshot->'diagnostics','[]');
 if config->>'uploadId' is not null or jsonb_array_length(coalesce(config->'importHistory','[]'))>0 or exists(select 1 from jsonb_array_elements(coalesce(config->'overrides','[]'))v where v->>'sourceLineId' is not null) then
  issues:=issues||atlas_private.reforecast_import_issues(checked_source,config);
 end if;
 if (checked_snapshot->'completeness'->>'blockerCount')::integer is distinct from 0 or exists(select 1 from jsonb_array_elements(issues)d where d->>'severity' in ('blocking','error')) then
  raise exception 'Published source evidence does not satisfy current validation. Preserve this publication; save, reconcile and VP-publish a corrected revision before investor approval';
 end if;
end;$$;
revoke all on function atlas_private.validate_reforecast_investor_source(uuid,uuid,integer,jsonb,jsonb) from public,anon,authenticated;

do $migration$
declare definition text;anchor text:=$anchor$  next_status:='investor_approved';config:=config||jsonb_build_object($anchor$;
begin
 select pg_get_functiondef(oid) into definition from pg_proc where oid='atlas_private.save_reforecast_builder(uuid,uuid,integer,uuid,text,jsonb)'::regprocedure
 and encode(sha256(convert_to(prosrc,'UTF8')),'hex')='9e63b31e5f406427ce916dc1a67e66ae0d52e619fdef5c36fcac1073f8c6fb94';
 if definition is null or (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
  raise exception 'Investor approval validation prerequisite differs; review the installed lifecycle before applying';
 end if;
 definition:=replace(definition,anchor,$replacement$  perform atlas_private.validate_reforecast_investor_source(prior.community_id,prior.scenario_id,prior.revision,prior.source,prior.payload);
  next_status:='investor_approved';config:=config||jsonb_build_object($replacement$);
 execute definition;
end;$migration$;
commit;
