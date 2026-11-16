-- Bind every forecast to the eligible governed close manifest, even when its
-- selected forecast months start after the latest close. No ledger writes.
alter function atlas_private.reforecast_source(uuid,text[],uuid[],uuid)
 rename to reforecast_source_before_close_scope;
revoke all on function atlas_private.reforecast_source_before_close_scope(uuid,text[],uuid[],uuid) from public,anon,authenticated;
create function atlas_private.reforecast_source(cid uuid,periods text[],budget_ids uuid[] default null,registry_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;manifest jsonb;eligible_periods jsonb;cutoff text;actuals jsonb;
begin
 result:=atlas_private.reforecast_source_before_close_scope(cid,periods,budget_ids,registry_id);
 select coalesce(jsonb_agg(jsonb_build_object('period',h.period_key,'versionId',v.version_id,'sourceHash',v.source_hash,'approvedAt',v.approved_at) order by h.period_key),'[]'),max(h.period_key)
 into manifest,cutoff
 from public.atlas_financial_close_heads h join public.atlas_financial_close_versions v using(version_id)
 where h.community_id=cid and h.accounting_basis='accrual'
 and h.period_key<=(select max(p) from unnest(periods)p)
 and atlas_private.reforecast_close_eligible(cid,h.period_key,v.source_hash);
 select coalesce(jsonb_agg(c->>'period'),'[]') into eligible_periods from jsonb_array_elements(manifest)c;
 actuals:=(result->'actuals')||jsonb_build_object('cutoffPeriod',cutoff,'closeVersions',manifest,
  'lines',(select coalesce(jsonb_agg(v),'[]') from jsonb_array_elements(result->'actuals'->'lines')v where eligible_periods ? (v->>'period')),
  'monthly',(select coalesce(jsonb_agg(v),'[]') from jsonb_array_elements(result->'actuals'->'monthly')v where eligible_periods ? (v->>'period')));
 result:=jsonb_set(result-'sourceVersion','{actuals}',actuals);
 return result||jsonb_build_object('sourceVersion',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
end;$$;
revoke all on function atlas_private.reforecast_source(uuid,text[],uuid[],uuid) from public,anon,authenticated;

-- The importer may retain closed-month cells as source evidence, but a reviewed
-- forecast authority selection must explicitly exclude them. Revalidate server side.
alter function atlas_private.reforecast_import_issues(jsonb,jsonb)
 rename to reforecast_import_issues_before_close_scope;
revoke all on function atlas_private.reforecast_import_issues_before_close_scope(jsonb,jsonb) from public,anon,authenticated;
create function atlas_private.reforecast_import_issues(source jsonb,config jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare issues jsonb;entry jsonb;upload jsonb;mapping jsonb;line jsonb;
begin
 issues:=atlas_private.reforecast_import_issues_before_close_scope(source,config);
 for entry in select value from jsonb_array_elements(coalesce(config->'importHistory','[]')||jsonb_build_array(jsonb_build_object('uploadId',config->>'uploadId','mapping',config->'importMapping'))) loop
  if entry->>'uploadId' is null then continue;end if;
  select payload into upload from public.atlas_reforecast_uploads where upload_id::text=entry->>'uploadId' and community_id::text=source->>'communityId';
  mapping:=entry->'mapping';
  for line in select value from jsonb_array_elements(coalesce(upload->'lines','[]')) loop
   if coalesce(mapping->'selectedLineIds','[]') ? (line->>'id') and line->>'scenario'=mapping->>'sourceScenario'
    and coalesce(line->>'sourceKind','')<>'workbook_actual_evidence'
    and line->>'period'<=source->'actuals'->>'cutoffPeriod' then
    issues:=issues||jsonb_build_array(jsonb_build_object('code','governed_forecast_overlap','severity','error','message','Exclude the workbook forecast cell from governed actual months.','sourceLineId',line->>'id','period',line->>'period'));
   end if;
  end loop;
 end loop;
 return issues;
end;$$;
revoke all on function atlas_private.reforecast_import_issues(jsonb,jsonb) from public,anon,authenticated;
