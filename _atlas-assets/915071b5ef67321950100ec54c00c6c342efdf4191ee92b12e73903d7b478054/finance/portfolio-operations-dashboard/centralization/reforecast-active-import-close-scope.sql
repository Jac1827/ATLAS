-- Retained imports are audit history, not perpetual forecast authority. Resolve
-- the current mapping and only historical uploads still referenced by overrides.
-- The previously applied governed-close migration remains unchanged.
create or replace function atlas_private.reforecast_import_issues(source jsonb,config jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare issues jsonb:='[]';entry jsonb;upload jsonb;mapping jsonb;line jsonb;subconfig jsonb;
begin
 if jsonb_typeof(config->'importHistory')='array' and jsonb_array_length(config->'importHistory')>0 then
  if exists(select 1 from jsonb_array_elements(coalesce(config->'overrides','[]'))v
   where v->>'sourceLineId' is not null and (coalesce(v->>'uploadId',config->>'uploadId') is null
    or (coalesce(v->>'uploadId',config->>'uploadId') is distinct from config->>'uploadId'
     and not exists(select 1 from jsonb_array_elements(config->'importHistory')e where e->>'uploadId'=v->>'uploadId')))) then
   issues:=issues||jsonb_build_array(jsonb_build_object('code','import_upload_unreviewed','severity','error','message','Every workbook-derived override must retain its upload and reviewed import mapping.'));
  end if;
  for entry in select distinct on(v->>'uploadId')v
   from jsonb_array_elements((config->'importHistory')||jsonb_build_array(jsonb_build_object('uploadId',config->>'uploadId','mapping',config->'importMapping','issues',config->'importIssues'))) with ordinality e(v,ord)
   order by v->>'uploadId',ord desc loop
   if entry->>'uploadId' is null then continue;end if;
   if entry->>'uploadId' is distinct from config->>'uploadId' and not exists(select 1 from jsonb_array_elements(coalesce(config->'overrides','[]'))v where v->>'uploadId'=entry->>'uploadId') then continue;end if;
   subconfig:=(config-'importHistory')||jsonb_build_object('uploadId',entry->>'uploadId','importMapping',entry->'mapping','importIssues',coalesce(nullif(entry->'issues','null'::jsonb),'[]'),
    'overrides',(select coalesce(jsonb_agg(v),'[]') from jsonb_array_elements(coalesce(config->'overrides','[]'))v where coalesce(v->>'uploadId',config->>'uploadId')=entry->>'uploadId'));
   issues:=issues||atlas_private.reforecast_import_issues(source,subconfig);
  end loop;
  return issues;
 end if;
 issues:=atlas_private.reforecast_import_issues_before_close_scope(source,config);
 select payload into upload from public.atlas_reforecast_uploads where upload_id::text=config->>'uploadId' and community_id::text=source->>'communityId';
 mapping:=config->'importMapping';
 for line in select value from jsonb_array_elements(coalesce(upload->'lines','[]')) loop
  if coalesce(mapping->'selectedLineIds','[]') ? (line->>'id') and line->>'scenario'=mapping->>'sourceScenario'
   and coalesce(line->>'sourceKind','')<>'workbook_actual_evidence'
   and line->>'period'<=source->'actuals'->>'cutoffPeriod' then
   issues:=issues||jsonb_build_array(jsonb_build_object('code','governed_forecast_overlap','severity','error','message','Exclude the workbook forecast cell from governed actual months.','sourceLineId',line->>'id','period',line->>'period'));
  end if;
 end loop;
 return issues;
end;$$;
revoke all on function atlas_private.reforecast_import_issues(jsonb,jsonb) from public,anon,authenticated;
