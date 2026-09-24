-- A read-only, scoped operational projection. Raw archive/document policies stay unchanged.
begin;

create function atlas_private.workspace_pick(value jsonb, fields text[]) returns jsonb
language sql immutable set search_path='' as $$
 select coalesce(jsonb_object_agg(key,item),'{}') from jsonb_each(case when jsonb_typeof(value)='object' then value else '{}' end)e(key,item)
 where key=any(fields) and jsonb_typeof(item) in ('string','number','boolean','null');
$$;

create function atlas_private.workspace_provenance(value jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select atlas_private.workspace_pick(value,array['community','communityName','communityId','period','periodKey','source','sourceSystem','sourceFile','sourceFileName','fileName','sourceSheet','sourceRow','field','destinationField','transformation','dataAsOf','generatedAt','importedAt','sourceRank','revisionKey','fileHash','sourceHash','mappingVersion','sourceVersion','versionId','closeVersionId','publicationId','status','measurementBasis']);
$$;

create function atlas_private.workspace_month(value jsonb, include_history boolean default true) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb; item record; details jsonb:='{}'; history jsonb:='{}';
begin
 result:=atlas_private.workspace_pick(value,array['month','period','periodKey','year','reportYear','moveOuts','moveIns','budgetOcc','guestCards','tours','applications','applicationsApproved','leasesSignedActual','denied','cancelled','pendingDecision','walkIn','offSiteEvent','phoneCalls','emailsOnline','textChatOther','grossLeaseGoalManual','appGoalManual','marketRent','concessions','nerActual','proformaRent','proformaNER','rentRollTotal','renewalExpirations','renewalSigned','renewalNTV','renewalTransfers','renewalUndecided','renewalEarlyTermination','occupiedSnapshot','leasedSnapshot','snapshotVerified','leasedSnapshotVerified','rentableUnits','excludedUnits','exposureUnits','sourceTotalUnits','sourceLeasedUnits','physicalOccupancyPct','leasedOccupancyPct','exposureAdjustedOccupancyPct','legacyPhysicalOccupancyPct','trendingOccupancyForecast','trendingOccupancyActual','trendingOccupancyClosedActual','measurementBasis','dataAsOf','updatedAt','sourceVersion','sourceHash']);
 if jsonb_typeof(value->'metricProvenance')='object' then
  for item in select * from jsonb_each(value->'metricProvenance') loop
   if result ? item.key then details:=details||jsonb_build_object(item.key,atlas_private.workspace_provenance(item.value));end if;
  end loop;
  result:=result||jsonb_build_object('metricProvenance',details);
 end if;
 if include_history and jsonb_typeof(value->'physicalSnapshotHistory')='object' then
  for item in select * from jsonb_each(value->'physicalSnapshotHistory') loop
   if item.key ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then history:=history||jsonb_build_object(item.key,atlas_private.workspace_month(item.value,false));end if;
  end loop;
  result:=result||jsonb_build_object('physicalSnapshotHistory',history);
 end if;
 if jsonb_typeof(value->'trendSource')='object' then
  result:=result||jsonb_build_object('trendSource',atlas_private.workspace_pick(value->'trendSource',array['start','end','asOf','beginningUnits','endingUnits','base','moveIns','moveOuts'])||jsonb_build_object('provenance',atlas_private.workspace_provenance(value#>'{trendSource,provenance}')));
 end if;
 return result;
end;$$;

create function atlas_private.workspace_community(value jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb; item record; history jsonb:='{}'; rows jsonb;
begin
 result:=atlas_private.workspace_pick(value,array['propertyName','communityId','atlasCommunityId','reportYear','currentMonth','currentOccupied','currentLeased','occupancyGoal','leasedGoal','conversionRate','customUnits','corporateLeaseUnits','communityStatus','communityMarket','communityRegionalGrouping','communityPropertyType','communityAddress','communityWebsiteUrl','floorPlanRatesPageUrl','sharedSyncUpdatedAt','sharedSyncSource','sourceVersion','sourceHash']);
 if jsonb_typeof(value->'sourceIds')='object' then result:=result||jsonb_build_object('sourceIds',atlas_private.workspace_pick(value->'sourceIds',array['atlasCommunityId']));end if;
 if jsonb_typeof(value->'monthlyData')='array' then
  select coalesce(jsonb_agg(atlas_private.workspace_month(v) order by ord),'[]') into rows from jsonb_array_elements(value->'monthlyData') with ordinality e(v,ord);
  result:=result||jsonb_build_object('monthlyData',rows);
 end if;
 if jsonb_typeof(value->'monthlyHistoryByPeriod')='object' then
  for item in select * from jsonb_each(value->'monthlyHistoryByPeriod') loop
   if item.key ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then history:=history||jsonb_build_object(item.key,atlas_private.workspace_month(item.value));end if;
  end loop;
  result:=result||jsonb_build_object('monthlyHistoryByPeriod',history);
 end if;
 for item in select * from jsonb_each(value) where key in ('seasonal','savedBudgetTargets') loop
  if jsonb_typeof(item.value)='array' and not exists(select 1 from jsonb_array_elements(item.value)v where jsonb_typeof(v) not in ('number','null')) then result:=result||jsonb_build_object(item.key,item.value);end if;
 end loop;
 return result;
end;$$;

-- Mirror the existing dashboard role/tab matrix. Settings is self-service even
-- when every operational tab is locked; it receives no operational payload.
create function atlas_private.workspace_tab_allowed(profile jsonb, tab integer) returns boolean
language sql immutable set search_path='' as $$
 select (tab=14 or (not(coalesce(profile->'locked_tab_ids','[]') ? tab::text)
 and not(coalesce(profile->'locked_page_keys','[]') ? (array['portfolio_home','communities','portfolio_overview','traffic','comp_calculator','renewals','reputation','data_import','reports','bonus','maintenance','marketing','budget','people','atlas_settings','central_services','application_performance'])[tab+1])
 and not(tab=8 and coalesce(profile->'locked_page_keys','[]') ? 'reporting')))
 and tab=any(case profile->>'role'
 when 'admin' then array[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]
 when 'centra' then array[0,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]
 when 'executive' then array[0,2,3,4,5,6,8,9,10,11,12,13,14,15]
 when 'regional' then array[0,2,3,4,5,6,8,9,10,11,12,13,14,15]
 when 'community_manager' then array[0,2,3,4,5,6,8,9,10,11,14,15]
 when 'people' then array[0,8,9,13,14]
 when 'marketing' then array[0,8,9,11,14]
 when 'maintenance' then array[0,8,10,14]
 when 'finance' then array[0,2,4,8,9,12,14,15]
 when 'bonus' then array[0,8,9,14]
 when 'viewer' then array[0,2,8,9,14] else '{}'::integer[] end);
$$;

create function atlas_private.workspace_month_fields(value jsonb, fields text[]) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb; item record; provenance jsonb:='{}'; history jsonb:='{}';
begin
 result:=atlas_private.workspace_pick(value,fields);
 if jsonb_typeof(value->'metricProvenance')='object' then
  for item in select * from jsonb_each(value->'metricProvenance') loop
   if item.key=any(fields) then provenance:=provenance||jsonb_build_object(item.key,atlas_private.workspace_provenance(item.value));end if;
  end loop;result:=result||jsonb_build_object('metricProvenance',provenance);
 end if;
 if jsonb_typeof(value->'physicalSnapshotHistory')='object' then
  for item in select * from jsonb_each(value->'physicalSnapshotHistory') loop
   history:=history||jsonb_build_object(item.key,atlas_private.workspace_month_fields(item.value-'physicalSnapshotHistory',fields));
  end loop;result:=result||jsonb_build_object('physicalSnapshotHistory',history);
 end if;
 if jsonb_typeof(value->'trendSource')='object' then result:=result||jsonb_build_object('trendSource',atlas_private.workspace_pick(value->'trendSource',array['start','end','asOf','beginningUnits','endingUnits','base']||case when 'moveIns'=any(fields) then array['moveIns','moveOuts'] else '{}'::text[] end)||jsonb_build_object('provenance',atlas_private.workspace_provenance(value#>'{trendSource,provenance}')));end if;
 return result;
end;$$;

create function atlas_private.workspace_community_fields(value jsonb, fields text[]) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb; item record; rows jsonb; history jsonb:='{}';
begin
 result:=atlas_private.workspace_pick(value,array['propertyName','communityId','atlasCommunityId','reportYear','currentMonth','customUnits','corporateLeaseUnits','communityStatus','communityMarket','communityRegionalGrouping','communityPropertyType','communityAddress','communityWebsiteUrl','floorPlanRatesPageUrl','sharedSyncUpdatedAt','sharedSyncSource','sourceVersion','sourceHash']);
 if value ? 'sourceIds' then result:=result||jsonb_build_object('sourceIds',value->'sourceIds');end if;
 if cardinality(fields)=0 then return result;end if;
 result:=result||atlas_private.workspace_pick(value,array['currentOccupied','currentLeased','occupancyGoal','leasedGoal','conversionRate']);
 for item in select * from jsonb_each(value) where key in ('seasonal','savedBudgetTargets') loop result:=result||jsonb_build_object(item.key,item.value);end loop;
 if jsonb_typeof(value->'monthlyData')='array' then
  select coalesce(jsonb_agg(atlas_private.workspace_month_fields(v,fields) order by ord),'[]') into rows from jsonb_array_elements(value->'monthlyData') with ordinality e(v,ord);
  result:=result||jsonb_build_object('monthlyData',rows);
 end if;
 if jsonb_typeof(value->'monthlyHistoryByPeriod')='object' then
  for item in select * from jsonb_each(value->'monthlyHistoryByPeriod') loop history:=history||jsonb_build_object(item.key,atlas_private.workspace_month_fields(item.value,fields));end loop;
  result:=result||jsonb_build_object('monthlyHistoryByPeriod',history);
 end if;
 return result;
end;$$;

create function public.atlas_read_workspace_projection() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
 profile public.atlas_user_profiles; parent public.atlas_app_documents; projection public.atlas_app_documents;
 source jsonb; value jsonb; item record; child record; candidates uuid[]; cid uuid; names text[]:='{}'; ids uuid[]:='{}';
 communities jsonb:='{}'; scope_map jsonb:='{}'; imports jsonb; lineage jsonb:='[]'; canonical jsonb:='[]'; row_value jsonb; filtered jsonb;
 fingerprint text; hash text; full_access boolean; tabs integer[]; mode text; month_fields text[]:='{}'; fields text[]:=array['occupied_units','total_units','rentable_units','excluded_units','measurement_basis','physical_occupancy','source_leased_units','leased_units','leased_occupancy','move_ins','move_outs','applications','approvals','denied_applications','cancelled_applications','renewal_expirations','renewals_signed','guest_cards','new_leads','tours','leases_signed','leases_completed'];
begin
 select * into profile from public.atlas_user_profiles p where p.user_id=auth.uid() and p.status='active' and coalesce(p.account_status,'active')='active';
 if profile.user_id is null or profile.role not in ('admin','centra','executive','regional','community_manager','people','marketing','maintenance','finance','bonus','viewer') then
  raise exception 'Workspace access denied' using errcode='42501';
 end if;
 select array_agg(tab order by tab) into tabs from generate_series(0,16)tab where atlas_private.workspace_tab_allowed(to_jsonb(profile),tab);
 mode:=case when tabs&&array[0,2,8] then 'operational' when tabs&&array[3,5] then 'category' when exists(select 1 from unnest(tabs)t where t<>14) then 'identity' else 'settings' end;
 full_access:=profile.role in ('admin','executive') and mode<>'settings';
 if mode='category' then
  month_fields:=array['month','period','periodKey','year','reportYear','budgetOcc','occupiedSnapshot','leasedSnapshot','snapshotVerified','leasedSnapshotVerified','rentableUnits','excludedUnits','exposureUnits','sourceTotalUnits','sourceLeasedUnits','physicalOccupancyPct','leasedOccupancyPct','exposureAdjustedOccupancyPct','legacyPhysicalOccupancyPct','trendingOccupancyForecast','trendingOccupancyActual','trendingOccupancyClosedActual','measurementBasis','dataAsOf','updatedAt','sourceVersion','sourceHash'];
  fields:=array['occupied_units','total_units','rentable_units','excluded_units','measurement_basis','physical_occupancy','source_leased_units','leased_units','leased_occupancy'];
  if 3=any(tabs) then month_fields:=month_fields||array['moveOuts','moveIns','guestCards','tours','applications','applicationsApproved','leasesSignedActual','denied','cancelled','pendingDecision','walkIn','offSiteEvent','phoneCalls','emailsOnline','textChatOther','grossLeaseGoalManual','appGoalManual'];fields:=fields||array['move_ins','move_outs','applications','approvals','denied_applications','cancelled_applications','guest_cards','new_leads','tours','leases_signed','leases_completed'];end if;
  if 5=any(tabs) then month_fields:=month_fields||array['renewalExpirations','renewalSigned','renewalNTV','renewalTransfers','renewalUndecided','renewalEarlyTermination'];fields:=fields||array['renewal_expirations','renewals_signed'];end if;
 elsif mode in ('identity','settings') then fields:='{}';end if;
 select * into parent from public.atlas_app_documents d where d.document_key='atlas_dashboard_state_v1' and d.module_key='dashboard' and d.deleted_at is null;
 if parent.document_id is null or parent.payload#>>'{bundle,bundleType}' is distinct from 'atlas_migration_archive_v1' or coalesce(parent.payload#>>'{bundle,sha256}','') !~ '^[a-f0-9]{64}$' then return jsonb_build_object('status','unavailable','reason','workspace_source_unavailable');end if;
 source:=jsonb_build_object('documentKey',parent.document_key,'version',parent.version,'archiveHash',parent.payload#>>'{bundle,sha256}','effectiveAt',parent.updated_at);
 select * into projection from public.atlas_app_documents d where d.document_key='atlas_workspace_projection_v1:'||(source->>'archiveHash')||':'||parent.version::text and d.module_key='dashboard' and d.source_module='workspace_projection' and d.deleted_at is null;
 value:=projection.payload;
 if projection.document_id is null then return jsonb_build_object('status','unavailable','reason','workspace_projection_unavailable','source',source);end if;
 if value->'format' is distinct from '1'::jsonb or jsonb_typeof(value->'communityData') is distinct from 'object' or jsonb_typeof(value->'opsGlobalData') is distinct from 'object' or jsonb_typeof(value->'importState') is distinct from 'object'
 or value#>>'{source,documentKey}' is distinct from parent.document_key or value#>'{source,version}' is distinct from to_jsonb(parent.version) or value#>>'{source,archiveHash}' is distinct from source->>'archiveHash'
 or coalesce(value->>'contentHash','') !~ '^[a-f0-9]{64}$' then return jsonb_build_object('status','unavailable','reason','workspace_projection_source_mismatch','source',source);end if;
 begin
  if (value#>>'{source,effectiveAt}')::timestamptz is distinct from parent.updated_at then return jsonb_build_object('status','unavailable','reason','workspace_projection_source_mismatch','source',source);end if;
 exception when invalid_datetime_format or datetime_field_overflow then return jsonb_build_object('status','unavailable','reason','workspace_projection_source_mismatch','source',source);end;
 -- Return the original equivalent timestamp spelling so the stored full-body client hash remains verifiable.
 source:=value->'source';
 for item in select * from jsonb_each(value->'communityData') loop
  select array_agg(distinct c.community_id order by c.community_id) into candidates from public.atlas_communities c
  where c.deleted_at is null and (lower(trim(c.display_name))=lower(trim(item.key)) or lower(trim(c.canonical_name))=lower(trim(item.key))
   or exists(select 1 from public.atlas_community_aliases a where a.community_id=c.community_id and a.active and lower(trim(a.alias))=lower(trim(item.key))));
  if coalesce(cardinality(candidates),0)<>1 then continue;end if;
  cid:=candidates[1];
  if not public.atlas_can_access_community(cid) or not exists(select 1 from public.atlas_communities c where c.community_id=cid and (c.status='active' or full_access or cid=any(profile.allowed_community_ids))) then continue;end if;
  if jsonb_typeof(item.value) is distinct from 'object' then continue;end if;
  if coalesce(item.value#>>'{sourceIds,atlasCommunityId}','')<>'' and item.value#>>'{sourceIds,atlasCommunityId}'<>cid::text then continue;end if;
  if coalesce(item.value->>'atlasCommunityId','')<>'' and item.value->>'atlasCommunityId'<>cid::text then continue;end if;
  if coalesce(item.value->>'communityId','') ~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' and item.value->>'communityId'<>cid::text then continue;end if;
  names:=array_append(names,item.key);ids:=array_append(ids,cid);
  if mode<>'settings' then communities:=communities||jsonb_build_object(item.key,case when mode='operational' or full_access then atlas_private.workspace_community(item.value) else atlas_private.workspace_community_fields(atlas_private.workspace_community(item.value),month_fields) end);end if;
 end loop;
 fingerprint:=public.atlas_hash_payload(jsonb_build_object('actor',profile.user_id,'role',profile.role,'status',profile.status,'accountStatus',profile.account_status,'communities',profile.allowed_community_ids,'markets',profile.allowed_market_values,'regions',profile.allowed_region_values,'lockedTabs',profile.locked_tab_ids,'lockedPages',profile.locked_page_keys,'bonusPermissions',profile.bonus_permissions,'resolvedCommunities',to_jsonb(ids),'resolvedNames',to_jsonb(names),'profileVersion',profile.updated_at,'allowedTabs',tabs,'mode',mode));
 if full_access then filtered:=value;
 else
  if mode in ('operational','category') and jsonb_typeof(value#>'{opsGlobalData,portfolioMonthScopeByPeriod}')='object' then
   for item in select * from jsonb_each(value#>'{opsGlobalData,portfolioMonthScopeByPeriod}') loop
    if item.key ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' and jsonb_typeof(item.value)='array' then
     select coalesce(jsonb_agg(v order by ord),'[]') into row_value from jsonb_array_elements(item.value) with ordinality e(v,ord) where jsonb_typeof(v)='string' and (v#>>'{}')=any(names);
     scope_map:=scope_map||jsonb_build_object(item.key,row_value);
    end if;
   end loop;
  end if;
  imports:=value->'importState';
  if jsonb_typeof(imports->'lineage')='array' then
   for item in select v from jsonb_array_elements(imports->'lineage')v loop
    if item.v->>'communityName'=any(names) and item.v->>'atlasField'=any(fields) and item.v->'currentState'='true'::jsonb and (not(item.v ? 'communities') or item.v->'communities' <@ to_jsonb(names)) then
     row_value:=atlas_private.workspace_provenance(item.v)||atlas_private.workspace_pick(item.v,array['id','key','batchId','communityName','periodKey','atlasField','originalField','sourceArchiveId','value','importedValue','currentState','reportType','mappingId','mappingVersion','sourceHash','fileHash','sourceFile','sourceSheet','sourceRow','sourceValue','sourceColumn','section','sectionPeriod']);
     if jsonb_typeof(item.v->'sectionPeriod')='object' then row_value:=row_value||jsonb_build_object('sectionPeriod',atlas_private.workspace_pick(item.v->'sectionPeriod',array['asOf','start','end','monthIdx','year','periodKey','basis']));end if;
     lineage:=lineage||jsonb_build_array(row_value);
    end if;
   end loop;
  end if;
  if cardinality(fields)>0 and jsonb_typeof(imports->'canonicalRecords')='array' then
   for item in select v from jsonb_array_elements(imports->'canonicalRecords')v loop
    if item.v->>'communityName'=any(names) and item.v->>'reportType'='box_score' and (not(item.v ? 'communities') or item.v->'communities' <@ to_jsonb(names)) then
     row_value:=atlas_private.workspace_provenance(item.v)||atlas_private.workspace_pick(item.v,array['key','batchId','sourceArchiveId','communityName','periodKey','reportType','fileHash','dataAsOf','generatedAt','importedAt','sourceFile','sourceSheet','sourceRow','section','sectionPeriod','mappingVersion']);
     if jsonb_typeof(item.v->'sectionPeriod')='object' then row_value:=row_value||jsonb_build_object('sectionPeriod',atlas_private.workspace_pick(item.v->'sectionPeriod',array['asOf','start','end','monthIdx','year','periodKey','basis']));end if;
     canonical:=canonical||jsonb_build_array(row_value||jsonb_build_object('values',atlas_private.workspace_pick(item.v->'values',fields)));
    end if;
   end loop;
  end if;
  -- Mixed-community archives, upload summaries, private exceptions and arbitrary global keys are never projected.
  imports:=jsonb_build_object('pendingBatch',null,'batches','[]'::jsonb,'sourceArchive','[]'::jsonb,'exceptions','[]'::jsonb,'reconciliationLog','[]'::jsonb,'canonicalRecords',canonical,'lineage',lineage,
   'historyStorage',jsonb_build_object('format',2,'view','remote','revision',null,'archiveHash',source->>'archiveHash','parentDocument',parent.document_key,'version',parent.version,'scopeFingerprint',fingerprint,'counts',jsonb_build_object('batches',0,'sourceArchive',0,'exceptions',0,'reconciliationLog',0,'canonicalRecords',jsonb_array_length(canonical),'lineage',jsonb_array_length(lineage))));
  filtered:=jsonb_build_object('format',1,'source',source,'communityData',communities,'opsGlobalData',jsonb_build_object('portfolioMonthScopeByPeriod',scope_map),'importState',imports);
 end if;
 return jsonb_build_object('status','available','source',source,'projection',filtered,'scopeFingerprint',fingerprint,'projectionVersion',projection.version,'projectionContentHash',public.atlas_hash_payload(filtered),'projectionHashFormat','postgres-jsonb-sha256','fullProjection',full_access,'operationalMode',mode);
end;$$;

revoke all on function atlas_private.workspace_tab_allowed(jsonb,integer),atlas_private.workspace_month_fields(jsonb,text[]),atlas_private.workspace_community_fields(jsonb,text[]),atlas_private.workspace_pick(jsonb,text[]),atlas_private.workspace_provenance(jsonb),atlas_private.workspace_month(jsonb,boolean),atlas_private.workspace_community(jsonb),public.atlas_read_workspace_projection() from public,anon,authenticated;
grant execute on function public.atlas_read_workspace_projection() to authenticated;
commit;
