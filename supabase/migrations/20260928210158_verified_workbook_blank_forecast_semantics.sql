-- New, explicitly reviewed workbook imports preserve source blanks. This is
-- additive calculation policy; no historical payload, receipt or publication is
-- updated. Existing request identities, locks, authorization and limits remain.
begin;
create function atlas_private.workbook_blank_required_rewrite(body text,old_text text,new_text text)
returns text language plpgsql immutable set search_path='' as $$begin
 if length(body)-length(replace(body,old_text,''))<>length(old_text) then raise exception 'Workbook blank migration prerequisite differs at %',left(old_text,100);end if;
 return replace(body,old_text,new_text);
end;$$;
revoke all on function atlas_private.workbook_blank_required_rewrite(text,text,text) from public,anon,authenticated;
create function atlas_private.reforecast_workbook_policy(mapping jsonb)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(mapping->'workbookSourcePolicy'->'schemaVersion'='1'::jsonb
 and mapping->'workbookSourcePolicy'->>'mode'='workbook_exact'
 and mapping->'workbookSourcePolicy'->>'blankDisposition'='preserve_null'
 and mapping->'workbookSourcePolicy'->>'confirmed'='true'
 and mapping->'workbookSourcePolicy'->>'reviewedBy'=mapping->>'reviewedBy'
 and length(coalesce(mapping->'workbookSourcePolicy'->>'reviewedAt',''))>0
 and length(trim(coalesce(mapping->'workbookSourcePolicy'->>'reason','')))>2
 and mapping->>'confirmed'='true' and jsonb_typeof(mapping->'periods')='array'
 and jsonb_typeof(mapping->'selectedLineIds')='array',false)
$$;
-- Predicate contexts exclude wide row/input reviews. Constructed once per
-- validator; source evidence and selected relationships are still fully checked.
create function atlas_private.reforecast_workbook_predicate_mapping(mapping jsonb)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('confirmed',mapping->'confirmed','version',mapping->'version','reviewedBy',mapping->'reviewedBy','periods',mapping->'periods','selectedLineIds',mapping->'selectedLineIds','sourceScenario',mapping->'sourceScenario','workbookSourcePolicy',(mapping->'workbookSourcePolicy')-'outsideForecastScope')
$$;
create function atlas_private.reforecast_workbook_predicate_audit(audit jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare indexed jsonb;counted bigint;
begin
 select coalesce(jsonb_object_agg(v->>'id',v),'{}'),count(*) into indexed,counted from jsonb_array_elements(coalesce(audit->'authorityScope'->'verifiedBlankCells','[]'))v;
 if counted<>(select count(*) from jsonb_object_keys(indexed)) then raise exception 'Duplicate verified workbook blank coordinates';end if;
 return indexed;
end;$$;
create function atlas_private.reforecast_workbook_binding(config jsonb)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('uploadId',config->'uploadId','importMapping',atlas_private.reforecast_workbook_predicate_mapping(config->'importMapping'))
$$;
revoke all on function atlas_private.reforecast_workbook_predicate_mapping(jsonb),atlas_private.reforecast_workbook_predicate_audit(jsonb),atlas_private.reforecast_workbook_binding(jsonb) from public,anon,authenticated;
create function atlas_private.reforecast_workbook_blank(line jsonb,cell jsonb,mapping jsonb,audit jsonb)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(atlas_private.reforecast_workbook_policy(mapping)
 and line->'amount'='null'::jsonb and line->>'blank'='true'
 and coalesce(line->>'formula','')='' and line->>'cellType' is distinct from 'e'
 and coalesce(line->>'cachedValue','')='' and line->>'sourceKind' is distinct from 'workbook_actual_evidence'
 and audit->(line->>'id')->>'sheet'=line->>'sheet' and audit->(line->>'id')->>'address'=line->>'address' and audit->(line->>'id')->'row'=line->'row' and audit->(line->>'id')->'column'=line->'column'
 and (cell is null or (cell->'value'='null'::jsonb and coalesce(cell->>'formula','')='' and cell->>'type' is distinct from 'e' and cell->>'address'=line->>'address' and cell->'row'=line->'row' and cell->'column'=line->'column'))
 and line->>'id'=(line->>'sheet')||'!'||(line->>'address')
 and mapping->'selectedLineIds' ? (line->>'id') and mapping->'periods' ? (line->>'period')
 and mapping->>'sourceScenario'=line->>'scenario',false)
$$;
create function atlas_private.reforecast_workbook_retained_blank(cell jsonb,mapping jsonb)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(atlas_private.reforecast_workbook_policy(mapping)
 and cell->'amount'='null'::jsonb and cell->>'disposition'='workbook_blank'
 and cell->>'isBlank'='true' and cell->>'legitimateBlank'='true'
 and cell->'sourceAmount'='null'::jsonb and cell->>'mappingVersion'=mapping->>'version'
 and cell->>'sourceScenario'=mapping->>'sourceScenario' and mapping->'periods' ? (cell->>'period')
 and mapping->'selectedLineIds' ? (cell->>'sourceLineId')
 and cell->>'sourceLineId'=(cell->'sourceCoordinates'->>'sheet')||'!'||(cell->'sourceCoordinates'->>'address'),false)
$$;
revoke all on function atlas_private.reforecast_workbook_policy(jsonb),atlas_private.reforecast_workbook_blank(jsonb,jsonb,jsonb,jsonb),atlas_private.reforecast_workbook_retained_blank(jsonb,jsonb) from public,anon,authenticated;

create function atlas_private.reforecast_workbook_bound(cell jsonb,config jsonb)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(atlas_private.reforecast_workbook_policy(config->'importMapping') and cell->>'uploadId'=config->>'uploadId' and cell->>'mappingVersion'=config->'importMapping'->>'version' and cell->>'sourceScenario'=config->'importMapping'->>'sourceScenario' and config->'importMapping'->'selectedLineIds' ? (cell->>'sourceLineId') and length(cell->>'sourceHash')>0 and cell->'source'->>'auditId' is not null and (jsonb_typeof(cell->'amount')='number' or atlas_private.reforecast_workbook_retained_blank(cell,config->'importMapping')),false)
$$;
revoke all on function atlas_private.reforecast_workbook_bound(jsonb,jsonb) from public,anon,authenticated;

-- Compact old mappings remain exact immutable receipt references. They are
-- expanded only for active validation; prior revisions/receipts never change.
create function atlas_private.expand_reforecast_mapping_references(cid uuid,config jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare entry jsonb;ref jsonb;retained public.atlas_reforecast_import_receipts;history jsonb:='[]';
begin
 for entry in select value from jsonb_array_elements(coalesce(config->'importHistory','[]')) loop
  ref:=entry->'mappingReference';
  if ref is not null then
   if auth.uid() is null or not atlas_private.reforecast_access(cid,'read') then raise exception 'Import mapping reference access denied';end if;
   select * into retained from public.atlas_reforecast_import_receipts r where r.community_id=cid and r.request_id::text=ref->>'requestId';
   if ref->>'kind' is distinct from 'immutable_import_receipt' or retained.request_id is null or retained.upload_id::text is distinct from entry->>'uploadId' or retained.mapping_version::text is distinct from ref->>'mappingVersion' or entry->>'mappingVersion' is distinct from ref->>'mappingVersion' or retained.receipt->>'verified' is distinct from 'true' then raise exception 'Immutable import mapping reference does not match its source receipt';end if;
   if entry->'mapping' is not null and entry->'mapping' is distinct from retained.receipt->'mapping' then raise exception 'Retained mapping differs from its immutable receipt';end if;
   entry:=entry||jsonb_build_object('mapping',retained.receipt->'mapping');
  end if;
  history:=history||jsonb_build_array(entry);
 end loop;
 return case when config ? 'importHistory' then jsonb_set(config,'{importHistory}',history) else config end;
end;$$;
revoke all on function atlas_private.expand_reforecast_mapping_references(uuid,jsonb) from public,anon,authenticated;

-- These deterministic attestations are server-local validation results, not
-- capabilities. No public RPC accepts a canonical source object; payload proof
-- fields are ignored. Each independent write rebuilds its canonical context.
create function atlas_private.reforecast_workbook_relationship_proof(source jsonb,config jsonb)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare proof jsonb:=source->'workbookRelationshipProofs'->(config->>'uploadId');cid uuid:=(source->>'communityId')::uuid;source_hash text;audit_id text;
begin
 if jsonb_typeof(proof) is distinct from 'object' or auth.uid() is null or not atlas_private.reforecast_access(cid,'read') or not atlas_private.planning_authorized_reviewer(cid,config->'importMapping'->>'reviewedBy') then return false;end if;
 select u.source_hash,u.payload->'integrity'->>'auditId' into source_hash,audit_id from public.atlas_reforecast_uploads u where u.community_id=cid and u.upload_id::text=config->>'uploadId';
 return coalesce(proof->'schemaVersion'='1'::jsonb and proof->>'communityId'=cid::text and proof->>'uploadId'=config->>'uploadId' and proof->>'sourceHash'=source_hash and length(audit_id)>0 and proof->>'auditId'=audit_id and proof->>'mappingFingerprint'=encode(sha256(convert_to((config->'importMapping')::text,'UTF8')),'hex') and exists(select 1 from jsonb_array_elements(coalesce(source->'workbookBlankCells','[]')||coalesce(source->'workbookOutsideScopeCells','[]'))c where c->'source'->>'uploadId'=proof->>'uploadId' and c->'source'->>'auditId'=proof->>'auditId' and coalesce(c->>'sourceHash',c->'source'->>'sourceHash')=source_hash),false);
end;$$;
create function atlas_private.reforecast_workbook_relationship_proofs(source jsonb,config jsonb,cells jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare proofs jsonb:='{}';entry jsonb;evidence jsonb;cid uuid:=(source->>'communityId')::uuid;
begin
 if auth.uid() is null or not atlas_private.reforecast_access(cid,'read') then raise exception 'Workbook relationship proof access denied';end if;
 config:=atlas_private.expand_reforecast_mapping_references(cid,config);
 for entry in select distinct on(v->>'uploadId')v from jsonb_array_elements(coalesce(config->'importHistory','[]')||jsonb_build_array(jsonb_build_object('uploadId',config->'uploadId','mapping',config->'importMapping'))) with ordinality q(v,n) where v->>'uploadId' is not null order by v->>'uploadId',n desc loop
  select c into evidence from jsonb_array_elements(cells)c where c->'source'->>'uploadId'=entry->>'uploadId' limit 1;
  if evidence is null then continue;end if;
  proofs:=proofs||jsonb_build_object(entry->>'uploadId',jsonb_build_object('schemaVersion',1,'communityId',cid,'uploadId',entry->'uploadId','sourceHash',coalesce(evidence->'sourceHash',evidence->'source'->'sourceHash'),'auditId',evidence->'source'->'auditId','mappingFingerprint',encode(sha256(convert_to((entry->'mapping')::text,'UTF8')),'hex')));
 end loop;
 return proofs;
end;$$;
revoke all on function atlas_private.reforecast_workbook_relationship_proof(jsonb,jsonb),atlas_private.reforecast_workbook_relationship_proofs(jsonb,jsonb,jsonb) from public,anon,authenticated;

-- Resolve compact blank references from immutable uploaded evidence. This is
-- server source construction, never a new stored copy of the original workbook.
create function atlas_private.resolve_reforecast_workbook_blanks(source jsonb,config jsonb)
returns jsonb language plpgsql stable security definer set search_path='' set plan_cache_mode='force_generic_plan' as $$
declare cid uuid:=(source->>'communityId')::uuid;entry jsonb;mapping jsonb;upload jsonb;audit jsonb;source_lines jsonb;cells jsonb;over jsonb;line jsonb;cell jsonb;map_entry jsonb;before_line jsonb;result jsonb:='[]';matches bigint;upload_hash text;blank_ids jsonb;map_index jsonb;baseline_index jsonb;predicate_mapping jsonb;predicate_audit jsonb;
begin
 config:=atlas_private.expand_reforecast_mapping_references(cid,config);
 if not exists(select 1 from jsonb_array_elements(coalesce(config->'overrides','[]'))o where o->>'disposition'='workbook_blank') then return result;end if;
 if auth.uid() is null or not atlas_private.reforecast_access(cid,'read') then raise exception 'Workbook source access denied';end if;
 select coalesce(jsonb_object_agg(jsonb_build_array(v->>'period',v->>'accountCode')::text,v),'{}') into baseline_index from jsonb_array_elements(source->'baseline'->'lines')v;
 for entry in select distinct on(v->>'uploadId')v from jsonb_array_elements(coalesce(config->'importHistory','[]')||jsonb_build_array(jsonb_build_object('uploadId',config->'uploadId','mapping',config->'importMapping'))) with ordinality q(v,ordinal) where v->>'uploadId' is not null order by v->>'uploadId',ordinal desc loop
  if not exists(select 1 from jsonb_array_elements(coalesce(config->'overrides','[]'))o where o->>'uploadId'=entry->>'uploadId' and o->>'disposition'='workbook_blank') then continue;end if;
  select jsonb_object_agg(o->>'sourceLineId',true) into blank_ids from jsonb_array_elements(config->'overrides')o where o->>'uploadId'=entry->>'uploadId' and o->>'disposition'='workbook_blank';
  mapping:=entry->'mapping';
  select coalesce(jsonb_object_agg(code,entries),'{}') into map_index from (select m->>'sourceAccountCode' code,jsonb_agg(m) entries from jsonb_array_elements(mapping->'accountMappings')m group by m->>'sourceAccountCode')q;
  if not atlas_private.reforecast_workbook_policy(mapping) or not atlas_private.planning_authorized_reviewer(cid,mapping->'workbookSourcePolicy'->>'reviewedBy') then raise exception 'Reviewed workbook blank policy and authorized owner required';end if;
  select jsonb_build_object('lines',u.payload->'lines','parserVersion',u.payload->'parserVersion','metadata',u.payload->'metadata','source',jsonb_build_object('sha256',u.source_hash,'fileName',u.payload->'source'->'fileName'),'integrity',u.payload->'integrity'),u.source_hash into upload,upload_hash from public.atlas_reforecast_uploads u where u.community_id=cid and u.upload_id::text=entry->>'uploadId';
  if upload is null then raise exception 'Retained workbook blank upload is unavailable';end if;
  audit:=atlas_private.resolve_workbook_audit(upload->'integrity',upload_hash);
  if audit->'inventory'->>'sourceHash' is distinct from upload_hash then raise exception 'Workbook blank audit hash mismatch';end if;
  perform atlas_private.validate_reforecast_source_relationships(upload,audit,mapping);
  predicate_mapping:=atlas_private.reforecast_workbook_predicate_mapping(mapping);predicate_audit:=atlas_private.reforecast_workbook_predicate_audit(audit);
  select coalesce(jsonb_object_agg(l->>'id',l),'{}') into source_lines from jsonb_array_elements(upload->'lines')l where blank_ids ? (l->>'id');
  select coalesce(jsonb_object_agg((s->>'name')||'!'||(c->>'address'),c),'{}') into cells from jsonb_array_elements(audit->'inventory'->'sheets')s cross join lateral jsonb_array_elements(s->'cells')c where blank_ids ? ((s->>'name')||'!'||(c->>'address'));
  for over in select value from jsonb_array_elements(coalesce(config->'overrides','[]'))o where o->>'uploadId'=entry->>'uploadId' and o->>'disposition'='workbook_blank' loop
   line:=source_lines->(over->>'sourceLineId');cell:=cells->(over->>'sourceLineId');
   if over->'amount' is distinct from 'null'::jsonb or over->>'isBlank' is distinct from 'true' or over->>'legitimateBlank' is distinct from 'true' or over->>'period' is distinct from line->>'period' or not atlas_private.reforecast_workbook_blank(line,cell,predicate_mapping,predicate_audit) then raise exception 'Compact workbook blank reference differs from immutable source';end if;
   select count(*),jsonb_agg(m)->0 into matches,map_entry from jsonb_array_elements(coalesce(map_index->(line->>'accountCode'),'[]'))m where m->>'sourceAccountCode'=line->>'accountCode' and (m->>'sheet' is null or m->>'sheet'=line->>'sheet') and (m->>'department' is null or m->>'department'=line->>'department');
   if matches<>1 or over->>'accountCode' is distinct from map_entry->>'accountCode' then raise exception 'Workbook blank canonical account mapping differs';end if;
   before_line:=baseline_index->jsonb_build_array(over->>'period',over->>'accountCode')::text;
   over:=over||jsonb_build_object('sourceAmount',null,'mappingVersion',mapping->'version','sourceScenario',mapping->'sourceScenario','sourceCoordinates',jsonb_build_object('sheet',line->'sheet','address',line->'address','row',line->'row','column',line->'column'),'sourceHash',upload_hash,'reason',mapping->'workbookSourcePolicy'->'reason','ownerId',mapping->'workbookSourcePolicy'->'reviewedBy','actorId',mapping->'workbookSourcePolicy'->'reviewedBy','reviewedAt',mapping->'workbookSourcePolicy'->'reviewedAt','effectivePeriod',line->'period','before',before_line->'amount','after',null,'confirmed',true,'integrityFingerprint',audit->'fingerprint','source',jsonb_build_object('kind','workbook_import','uploadId',entry->'uploadId','auditId',upload->'integrity'->'auditId','sourceLineId',line->'id','sheet',line->'sheet','address',line->'address','sourceAmount',null,'mappingVersion',mapping->'version'));
   result:=result||jsonb_build_array(over);
  end loop;
 end loop;
 if jsonb_array_length(result)<>(select count(*) from jsonb_array_elements(coalesce(config->'overrides','[]'))o where o->>'disposition'='workbook_blank') then raise exception 'Every retained workbook blank requires reviewed source history';end if;
 return result;
end;$$;
create function atlas_private.expand_reforecast_workbook_blanks(source jsonb,config jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare cells jsonb;indexed jsonb;overrides jsonb;
begin
 config:=atlas_private.expand_reforecast_mapping_references((source->>'communityId')::uuid,config);
 cells:=source->'workbookBlankCells';
 select coalesce(jsonb_object_agg(jsonb_build_array(v->>'uploadId',v->>'sourceLineId',v->>'period',v->>'accountCode')::text,v),'{}') into indexed from jsonb_array_elements(coalesce(cells,'[]'))v;
 if cells is null or jsonb_array_length(cells)<>(select count(*) from jsonb_object_keys(indexed)) or exists(select 1 from jsonb_array_elements(coalesce(config->'overrides','[]'))o where o->>'disposition'='workbook_blank' and not(indexed ? jsonb_build_array(o->>'uploadId',o->>'sourceLineId',o->>'period',o->>'accountCode')::text)) then cells:=atlas_private.resolve_reforecast_workbook_blanks(source,config);end if;
 if jsonb_array_length(cells)=0 then return config;end if;
 select jsonb_object_agg(jsonb_build_array(v->>'uploadId',v->>'sourceLineId',v->>'period',v->>'accountCode')::text,v) into indexed from jsonb_array_elements(cells)v;
 select jsonb_agg(case when v->>'disposition'='workbook_blank' then indexed->jsonb_build_array(v->>'uploadId',v->>'sourceLineId',v->>'period',v->>'accountCode')::text else v end order by ordinal) into overrides from jsonb_array_elements(config->'overrides') with ordinality q(v,ordinal);
 if exists(select 1 from jsonb_array_elements(overrides)o where o='null'::jsonb) or exists(select 1 from jsonb_array_elements(config->'overrides')o where o->>'disposition'='workbook_blank' and (o->'amount' is distinct from 'null'::jsonb or o->>'isBlank' is distinct from 'true' or o->>'legitimateBlank' is distinct from 'true')) then raise exception 'Workbook blank reference differs from verified source';end if;
 return jsonb_set(config,'{overrides}',overrides);
end;$$;
create function atlas_private.resolve_reforecast_workbook_scope(source jsonb,config jsonb)
returns jsonb language plpgsql stable security definer set search_path='' set plan_cache_mode='force_generic_plan' as $$
declare mapping jsonb:=config->'importMapping';review jsonb;upload jsonb;audit jsonb;source_hash text;account jsonb;result jsonb:='[]';cid uuid:=(source->>'communityId')::uuid;map_index jsonb;source_keys jsonb;selected_periods jsonb;account_index jsonb;
begin
 if not coalesce(mapping->'workbookSourcePolicy' ? 'outsideForecastScope',false) then return result;end if;
 if not atlas_private.reforecast_workbook_policy(mapping) or jsonb_typeof(mapping->'workbookSourcePolicy'->'outsideForecastScope') is distinct from 'array' then raise exception 'Review the explicit workbook scope exclusions';end if;
 if jsonb_array_length(mapping->'workbookSourcePolicy'->'outsideForecastScope')=0 then return result;end if;
 if auth.uid() is null or not atlas_private.reforecast_access(cid,'read') or not atlas_private.planning_authorized_reviewer(cid,mapping->'workbookSourcePolicy'->>'reviewedBy') then raise exception 'Workbook source scope access denied';end if;
 select jsonb_build_object('lines',u.payload->'lines','parserVersion',u.payload->'parserVersion','metadata',u.payload->'metadata','source',jsonb_build_object('sha256',u.source_hash,'fileName',u.payload->'source'->'fileName'),'integrity',u.payload->'integrity'),u.source_hash into upload,source_hash from public.atlas_reforecast_uploads u where u.community_id=cid and u.upload_id::text=config->>'uploadId';
 if upload is null then raise exception 'Retained workbook source scope is unavailable';end if;
 audit:=atlas_private.resolve_workbook_audit(upload->'integrity',source_hash);
 if not atlas_private.reforecast_workbook_relationship_proof(source,config) then perform atlas_private.validate_reforecast_source_relationships(upload,audit,mapping);end if;
 if exists(select 1 from jsonb_array_elements(mapping->'workbookSourcePolicy'->'outsideForecastScope')r group by r->>'period',r->>'accountCode' having count(*)<>1) then raise exception 'Duplicate source scope exclusion';end if;
 select coalesce(jsonb_object_agg(code,entries),'{}') into map_index from (select m->>'sourceAccountCode' code,jsonb_agg(m) entries from jsonb_array_elements(mapping->'accountMappings')m group by m->>'sourceAccountCode')q;
 if exists(select 1 from jsonb_array_elements(upload->'lines')l where l->>'scenario'=mapping->>'sourceScenario' and mapping->'periods' ? (l->>'period') and (select count(*) from jsonb_array_elements(coalesce(map_index->(l->>'accountCode'),'[]'))m where (m->>'sheet' is null or m->>'sheet'=l->>'sheet') and (m->>'department' is null or m->>'department'=l->>'department'))>1) then raise exception 'Ambiguous canonical source mapping must be resolved before scope exclusions';end if;
 select coalesce(jsonb_object_agg(jsonb_build_array(l->>'period',target.code)::text,true),'{}') into source_keys from jsonb_array_elements(upload->'lines')l cross join lateral (select coalesce(min(m->>'accountCode'),l->>'accountCode') code from jsonb_array_elements(coalesce(map_index->(l->>'accountCode'),'[]'))m where (m->>'sheet' is null or m->>'sheet'=l->>'sheet') and (m->>'department' is null or m->>'department'=l->>'department'))target where l->>'scenario'=mapping->>'sourceScenario' and mapping->'periods' ? (l->>'period');
 select coalesce(jsonb_object_agg(l->>'period',true),'{}') into selected_periods from jsonb_array_elements(upload->'lines')l where l->>'scenario'=mapping->>'sourceScenario' and mapping->'selectedLineIds' ? (l->>'id');
 select coalesce(jsonb_object_agg(a->>'accountCode',a),'{}') into account_index from jsonb_array_elements(source->'registry'->'accounts')a;
 for review in select value from jsonb_array_elements(mapping->'workbookSourcePolicy'->'outsideForecastScope') loop
  if review->>'confirmed' is distinct from 'true' or review->>'reviewedBy' is distinct from mapping->'workbookSourcePolicy'->>'reviewedBy' or coalesce(review->>'reviewedAt','')='' or length(trim(coalesce(review->>'reason','')))<3 or not coalesce(mapping->'periods' ? (review->>'period'),false) then raise exception 'Every source scope exclusion requires an explicit GL/month and authorized review';end if;
  account:=account_index->(review->>'accountCode');
  if account is null or source->'registry'->>'version' is distinct from mapping->>'version' or account->>'effectiveFrom'>review->>'period' or account->>'retiredAfter'<review->>'period' then raise exception 'Source scope exclusion requires an effective reviewed registry account';end if;
  if not(selected_periods ? (review->>'period')) then raise exception 'Source scope exclusion requires an audited selected month header';end if;
  if source_keys ? jsonb_build_array(review->>'period',review->>'accountCode')::text then raise exception 'A source row exists for the excluded GL/month; review its value or blank instead';end if;
  result:=result||jsonb_build_array(review||jsonb_build_object('disposition','outside_forecast_scope','sourceScopeExclusionConfirmed',true,'source',jsonb_build_object('kind','workbook_scope_exclusion','uploadId',config->'uploadId','sourceHash',source_hash,'auditId',upload->'integrity'->'auditId','mappingVersion',mapping->'version','sourceScenario',mapping->'sourceScenario','review',review)));
 end loop;
 return result;
end;$$;
-- Only overwritten source cells need receipt projection. Exact request/upload/
-- mapping identities retain the original evidence without duplicating its body.
create function atlas_private.reforecast_workbook_imported_cells(cid uuid,config jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare entry jsonb;receipt jsonb;result jsonb:='[]';bound_keys jsonb;cells jsonb;upload_hash text;audit_id text;binding jsonb:=atlas_private.reforecast_workbook_binding(config);
begin
 if config->>'uploadId' is null or jsonb_typeof(config->'importMapping') is distinct from 'object' then return result;end if;
 if auth.uid() is null or not atlas_private.reforecast_access(cid,'read') then raise exception 'Workbook source receipt access denied';end if;
 select coalesce(jsonb_object_agg(jsonb_build_array(o->>'period',o->>'accountCode')::text,true),'{}') into bound_keys from jsonb_array_elements(coalesce(config->'overrides','[]'))o where (o->>'uploadId'=config->>'uploadId' and o->>'mappingVersion'=config->'importMapping'->>'version' and config->'importMapping'->'selectedLineIds' ? (o->>'sourceLineId') and jsonb_typeof(o->'amount')='number') or (o->>'disposition'='workbook_blank' and o->>'uploadId'=config->>'uploadId');
 select u.source_hash,u.payload->'integrity'->>'auditId' into upload_hash,audit_id from public.atlas_reforecast_uploads u where u.community_id=cid and u.upload_id::text=config->>'uploadId';
 for entry in select value from jsonb_array_elements(coalesce(config->'importHistory','[]'))h where h->>'uploadId'=config->>'uploadId' and h->>'mappingVersion'=config->'importMapping'->>'version' loop
  select r.receipt into receipt from public.atlas_reforecast_import_receipts r where r.community_id=cid and r.request_id::text=entry->>'requestId' and r.upload_id::text=config->>'uploadId' and r.mapping_version::text=config->'importMapping'->>'version';
  if receipt is null then continue;end if;
  if receipt->>'verified' is distinct from 'true' then raise exception 'Workbook source receipt is not verified';end if;
  if receipt->'mapping' is distinct from config->'importMapping' then continue;end if;
  select coalesce(jsonb_agg(c||jsonb_build_object('uploadId',config->'uploadId','sourceHash',upload_hash,'source',jsonb_build_object('kind','workbook_import','uploadId',config->'uploadId','auditId',audit_id,'sourceLineId',c->'sourceLineId','receiptRequestId',entry->'requestId'))),'[]') into cells from jsonb_array_elements(receipt->'importedCells')c where not(bound_keys ? jsonb_build_array(c->>'period',c->>'accountCode')::text);
  result:=result||cells;
 end loop;
 if exists(select 1 from jsonb_array_elements(result)c group by c->>'period',c->>'accountCode' having count(*)<>1) then raise exception 'Ambiguous retained workbook source receipt';end if;
 return result;
end;$$;
revoke all on function atlas_private.reforecast_workbook_imported_cells(uuid,jsonb) from public,anon,authenticated;

-- Source-side coverage is independent of generated registry destination rows.
-- Numeric rows cannot disappear through automatic row-disposition annotations.
create function atlas_private.reforecast_workbook_source_coverage(source jsonb,config jsonb)
returns jsonb language plpgsql stable security definer set search_path='' set plan_cache_mode='force_generic_plan' as $$
declare cid uuid:=(source->>'communityId')::uuid;mapping jsonb:=config->'importMapping';upload jsonb;source_hash text;line jsonb;review jsonb;map_entry jsonb;map_index jsonb;review_index jsonb;eligible jsonb;selected jsonb;cells jsonb:='[]';exclusions jsonb:='[]';issues jsonb:='[]';matches bigint;cutoff text:=source->'actuals'->>'cutoffPeriod';
begin
 if config->>'uploadId' is null then return null;end if;
 if auth.uid() is null or not atlas_private.reforecast_access(cid,'read') then raise exception 'Workbook source coverage access denied';end if;
 select jsonb_build_object('lines',u.payload->'lines','integrity',u.payload->'integrity'),u.source_hash into upload,source_hash from public.atlas_reforecast_uploads u where u.community_id=cid and u.upload_id::text=config->>'uploadId';
 if upload is null or jsonb_typeof(mapping) is distinct from 'object' or mapping->>'confirmed' is distinct from 'true' or jsonb_typeof(mapping->'selectedLineIds') is distinct from 'array' or jsonb_typeof(mapping->'periods') is distinct from 'array' or not atlas_private.planning_authorized_reviewer(cid,mapping->>'reviewedBy') then return jsonb_build_object('numericCells','[]'::jsonb,'exclusions','[]'::jsonb,'issues',jsonb_build_array(jsonb_build_object('code','workbook_source_review_required','severity','error','message','Retain and review this workbook source and its exact mapping before publication.')));end if;
 if mapping ? 'sourceRowExclusions' and jsonb_typeof(mapping->'sourceRowExclusions') is distinct from 'array' then raise exception 'Source row exclusions require explicit per-cell reviews';end if;
 select coalesce(jsonb_object_agg(code,entries),'{}') into map_index from (select m->>'sourceAccountCode' code,jsonb_agg(m) entries from jsonb_array_elements(coalesce(mapping->'accountMappings','[]'))m group by m->>'sourceAccountCode')q;
 select coalesce(jsonb_object_agg(q.id,q.entries),'{}') into review_index from (select r->>'sourceLineId' id,jsonb_agg(r) entries from jsonb_array_elements(coalesce(mapping->'sourceRowExclusions','[]'))r group by r->>'sourceLineId')q;
 select coalesce(jsonb_object_agg(v,true),'{}') into selected from jsonb_array_elements_text(mapping->'selectedLineIds')v;
 select coalesce(jsonb_object_agg(l->>'id',l),'{}') into eligible from jsonb_array_elements(upload->'lines')l where jsonb_typeof(l->'amount')='number' and l->>'scenario'=mapping->>'sourceScenario' and mapping->'periods' ? (l->>'period') and (mapping->>'sourceScenario') !~* '^actual(\y|$)';
 for review in select value from jsonb_array_elements(coalesce(mapping->'sourceRowExclusions','[]')) loop
  if review->>'sourceLineId' is null or not(eligible ? (review->>'sourceLineId')) or selected ? (review->>'sourceLineId') then issues:=issues||jsonb_build_array(jsonb_build_object('code','invalid_source_exclusion','severity','error','sourceLineId',review->'sourceLineId','message','A source exclusion must identify an eligible unselected numeric source cell.'));end if;
 end loop;
 for line in select value from jsonb_each(eligible) order by key loop
  if selected ? (line->>'id') then
   select count(*),jsonb_agg(m)->0 into matches,map_entry from jsonb_array_elements(coalesce(map_index->(line->>'accountCode'),'[]'))m where (m->>'sheet' is null or m->>'sheet'=line->>'sheet') and (m->>'department' is null or m->>'department'=line->>'department');
   if matches=1 and (cutoff is null or line->>'period'>cutoff) then cells:=cells||jsonb_build_array(jsonb_build_object('period',line->'period','accountCode',map_entry->'accountCode','sourceLineId',line->'id','sourceAmount',line->'amount'));end if;
  else
   review:=review_index->(line->>'id')->0;
   if review is null and cutoff is not null and line->>'period'<=cutoff then continue;end if;
   if coalesce(jsonb_array_length(review_index->(line->>'id')),0)<>1 or review->>'confirmed' is distinct from 'true' or review->>'reviewedBy' is distinct from mapping->>'reviewedBy' or coalesce(review->>'reviewedAt','')='' or length(trim(coalesce(review->>'reason','')))<3 then issues:=issues||jsonb_build_array(jsonb_build_object('code','numeric_source_exclusion_review_required','severity','error','sourceLineId',line->'id','period',line->'period','message','Map this numeric source cell or explicitly review its exclusion with an authorized owner, date and specific reason.'));
   else exclusions:=exclusions||jsonb_build_array(jsonb_build_object('sourceLineId',line->'id','period',line->'period','sourceAmount',line->'amount','sourceAccountCode',line->'accountCode','reason',review->'reason','reviewedBy',review->'reviewedBy','reviewedAt',review->'reviewedAt','uploadId',config->'uploadId','sourceHash',source_hash,'auditId',upload->'integrity'->'auditId','sourceScenario',mapping->'sourceScenario'));end if;
  end if;
 end loop;
 return jsonb_build_object('numericCells',cells,'exclusions',exclusions,'issues',issues);
end;$$;
revoke all on function atlas_private.reforecast_workbook_source_coverage(jsonb,jsonb) from public,anon,authenticated;

create function atlas_private.reforecast_workbook_source_diagnostics(source jsonb,config jsonb,snapshot jsonb)
returns jsonb language plpgsql stable set search_path='' set plan_cache_mode='force_generic_plan' as $$
declare diagnostics jsonb:=coalesce(snapshot->'diagnostics','[]');coverage jsonb:=source->'workbookSourceCoverage';numeric_index jsonb;override_index jsonb;receipt_index jsonb;line jsonb;cells jsonb;over jsonb;cell jsonb;qualified boolean;mapping jsonb:=atlas_private.reforecast_workbook_predicate_mapping(config->'importMapping');
begin
 if config->>'uploadId' is null then return snapshot;end if;
 diagnostics:=diagnostics||coalesce(coverage->'issues','[]');
 if not atlas_private.reforecast_workbook_policy(mapping) or exists(select 1 from jsonb_array_elements(snapshot->'lines')l where l->>'sourceKind'='forecast' and l->>'immutable' is distinct from 'true' and l->>'retired' is distinct from 'true' and not coalesce(mapping->'periods' ? (l->>'period'),false)) then
  select coalesce(jsonb_object_agg(q.k,q.cells),'{}') into numeric_index from (select jsonb_build_array(v->>'period',v->>'accountCode')::text k,jsonb_agg(v) cells from jsonb_array_elements(coalesce(coverage->'numericCells','[]'))v group by 1)q;
  select coalesce(jsonb_object_agg(jsonb_build_array(v->>'period',v->>'accountCode')::text,v),'{}') into override_index from jsonb_array_elements(coalesce(config->'overrides','[]'))v;
  select coalesce(jsonb_object_agg(jsonb_build_array(v->>'period',v->>'accountCode')::text,v),'{}') into receipt_index from jsonb_array_elements(coalesce(source->'workbookImportedCells','[]'))v;
  for line in select value from jsonb_array_elements(snapshot->'lines') where value->>'sourceKind'='forecast' and value->>'immutable' is distinct from 'true' and value->>'retired' is distinct from 'true' loop
   if atlas_private.reforecast_workbook_policy(mapping) and mapping->'periods' ? (line->>'period') then continue;end if;
   cells:=numeric_index->jsonb_build_array(line->>'period',line->>'accountCode')::text;cell:=cells->0;over:=override_index->jsonb_build_array(line->>'period',line->>'accountCode')::text;
   qualified:=coalesce(jsonb_array_length(cells)=1 and jsonb_typeof(over->'amount')='number' and ((over->>'uploadId'=config->>'uploadId' and over->>'sourceLineId'=cell->>'sourceLineId' and over->>'mappingVersion'=mapping->>'version') or (receipt_index ? jsonb_build_array(line->>'period',line->>'accountCode')::text and atlas_private.planning_review_valid(over,(source->>'communityId')::uuid,line->>'period',over->'amount'))),false);
   if atlas_private.reforecast_workbook_policy(mapping) and over->>'uploadId' is not null and over->>'uploadId'<>config->>'uploadId' and over->>'sourceLineId' is not null and over->>'sourceHash' is not null and over->'source'->>'auditId' is not null and (jsonb_typeof(over->'amount')='number' or over->>'disposition'='workbook_blank' and over->>'legitimateBlank'='true') then qualified:=true;end if;
   if not qualified then diagnostics:=diagnostics||jsonb_build_array(jsonb_build_object('code','workbook_source_policy_required','severity','error','period',line->'period','accountCode',line->'accountCode','message','This workbook does not provide a reviewed numeric source for the open GL/month. Review exact workbook blanks and source scope before publication.'));end if;
  end loop;
 end if;
 if snapshot ? 'workbookCoverage' and jsonb_array_length(coalesce(coverage->'issues','[]'))>0 then
  snapshot:=jsonb_set(snapshot,'{workbookCoverage}',snapshot->'workbookCoverage'||jsonb_build_object('complete',false,'unreviewedSourceCellCount',jsonb_array_length(coverage->'issues'),'monthly',(select jsonb_agg(v||case when n>0 then jsonb_build_object('complete',false,'unreviewedSourceCellCount',n) else '{}'::jsonb end order by ordinal) from jsonb_array_elements(snapshot->'workbookCoverage'->'monthly') with ordinality q(v,ordinal) cross join lateral (select count(*) n from jsonb_array_elements(coverage->'issues')i where i->>'period' is null or i->>'period'=v->>'period')c)));
  snapshot:=jsonb_set(snapshot,'{monthly}',(select jsonb_agg(case when v ? 'workbookCoverage' and n>0 then v||jsonb_build_object('workbookCoverage',v->'workbookCoverage'||jsonb_build_object('complete',false,'unreviewedSourceCellCount',n)) else v end order by ordinal) from jsonb_array_elements(snapshot->'monthly') with ordinality q(v,ordinal) cross join lateral (select count(*) n from jsonb_array_elements(coverage->'issues')i where i->>'period' is null or i->>'period'=v->>'period')c));
 end if;
 snapshot:=snapshot||jsonb_build_object('diagnostics',diagnostics,'workbookSourceExclusions',coalesce(coverage->'exclusions','[]'),'status',case when exists(select 1 from jsonb_array_elements(diagnostics)d where d->>'severity' in ('blocking','error')) then 'action_required' else 'ready' end);
 snapshot:=jsonb_set(snapshot,'{completeness}',coalesce(snapshot->'completeness','{}')||jsonb_build_object('blockerCount',(select count(*) from jsonb_array_elements(diagnostics)d where d->>'severity' in ('blocking','error'))));
 return snapshot||jsonb_build_object('fingerprint',encode(sha256(convert_to((snapshot-'fingerprint')::text,'UTF8')),'hex'));
end;$$;
revoke all on function atlas_private.reforecast_workbook_source_diagnostics(jsonb,jsonb,jsonb) from public,anon,authenticated;

alter function atlas_private.reforecast_source_for_config(uuid,jsonb) rename to reforecast_source_before_workbook_blanks;
create function atlas_private.attach_reforecast_workbook_context(source jsonb,config jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare cid uuid:=(source->>'communityId')::uuid;cells jsonb;excluded jsonb;imported jsonb;coverage jsonb;proofs jsonb;
begin
 if auth.uid() is null or not atlas_private.reforecast_access(cid,'read') then raise exception 'Workbook context access denied';end if;
 config:=atlas_private.expand_reforecast_mapping_references(cid,config);
 source:=source-'workbookRelationshipProofs';
 cells:=atlas_private.resolve_reforecast_workbook_blanks(source,config);
 proofs:=atlas_private.reforecast_workbook_relationship_proofs(source,config,cells);
 source:=source||jsonb_build_object('workbookBlankCells',cells,'workbookRelationshipProofs',proofs);
 excluded:=atlas_private.resolve_reforecast_workbook_scope(source,config);
 proofs:=atlas_private.reforecast_workbook_relationship_proofs(source,config,cells||excluded);
 imported:=atlas_private.reforecast_workbook_imported_cells(cid,config);
 coverage:=atlas_private.reforecast_workbook_source_coverage(source,config);
 if jsonb_array_length(cells)=0 and jsonb_array_length(excluded)=0 and jsonb_array_length(imported)=0 and coverage is null then return source-'workbookBlankCells'-'workbookRelationshipProofs';end if;
 source:=source||jsonb_build_object('workbookBlankCells',cells,'workbookOutsideScopeCells',excluded,'workbookImportedCells',imported,'workbookSourceCoverage',coverage,'workbookRelationshipProofs',proofs);
 return (source-'sourceVersion')||jsonb_build_object('sourceVersion',encode(sha256(convert_to((source-'sourceVersion')::text,'UTF8')),'hex'));
end;$$;
create function atlas_private.reforecast_source_for_config(cid uuid,config jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare source jsonb;
begin
 config:=atlas_private.expand_reforecast_mapping_references(cid,config);
 source:=atlas_private.reforecast_source_before_workbook_blanks(cid,config);
 return atlas_private.attach_reforecast_workbook_context(source,config);
end;$$;
revoke all on function atlas_private.resolve_reforecast_workbook_blanks(jsonb,jsonb),atlas_private.expand_reforecast_workbook_blanks(jsonb,jsonb),atlas_private.resolve_reforecast_workbook_scope(jsonb,jsonb),atlas_private.reforecast_source_before_workbook_blanks(uuid,jsonb),atlas_private.reforecast_source_for_config(uuid,jsonb),atlas_private.attach_reforecast_workbook_context(jsonb,jsonb) from public,anon,authenticated;

do $migration$
declare d text;
begin
 d:=pg_get_functiondef('atlas_private.save_reforecast_builder(uuid,uuid,integer,uuid,text,jsonb)'::regprocedure);
 d:=atlas_private.workbook_blank_required_rewrite(d,$a$ if coalesce(config->>'name','')=''$a$,$b$ if prior.payload->>'uploadId' is not null and (config->>'uploadId' is null or jsonb_typeof(config->'importMapping') is distinct from 'object') then raise exception 'Retain the workbook provenance and reviewed mapping when editing this scenario';end if;
 if (coalesce(config->'importMapping'->'workbookSourcePolicy','null') is distinct from coalesce(prior.payload->'importMapping'->'workbookSourcePolicy','null') or coalesce(config->'importMapping'->'sourceRowExclusions','[]') is distinct from coalesce(prior.payload->'importMapping'->'sourceRowExclusions','[]')) and config->'importMapping'->>'reviewedBy' is distinct from auth.uid()::text then raise exception 'New workbook source reviews must belong to the signed-in authorized reviewer';end if;
 if coalesce(config->>'name','')=''$b$);
 execute d;
 d:=pg_get_functiondef('atlas_private.calculate_reforecast_before_saved_str(jsonb,jsonb)'::regprocedure);
 d:=atlas_private.workbook_blank_required_rewrite(d,'declare state jsonb', 'declare binding jsonb:=atlas_private.reforecast_workbook_binding(config);state jsonb');
 d:=atlas_private.workbook_blank_required_rewrite(d,
 $a$   state:=jsonb_set(state,array[p||'|'||code],line,true);$a$,
 $b$   if b->>'disposition' in ('workbook_blank','outside_forecast_scope') and line->>'forecast' is null then line:=line||jsonb_build_object('disposition',b->'disposition','sourceScopeExclusionConfirmed',coalesce(b->'sourceScopeExclusionConfirmed','false'),'isBlank',coalesce(b->'isBlank','false'));end if;
   if atlas_private.reforecast_workbook_policy(binding->'importMapping') and binding->'importMapping'->'periods' ? p and line->>'sourceKind'='forecast' and line->>'retired' is distinct from 'true' then
    over:=source->'workbookForecastIndex'->jsonb_build_array(p,code)::text;
    line:=line||jsonb_build_object('forecast',over->'amount','legitimateBlank',over->>'disposition'='workbook_blank','disposition',coalesce(over->>'disposition','source_absent'),'sourceScopeExclusionConfirmed',coalesce(over->'sourceScopeExclusionConfirmed','false'));
   end if;
   state:=jsonb_set(state,array[p||'|'||code],line,true);$b$);
 d:=atlas_private.workbook_blank_required_rewrite(d,
 $a$line->>'sourceKind'='forecast' and line->>'forecast' is null and line->>'legitimateBlank' is distinct from 'true' then$a$,
 $b$line->>'sourceKind'='forecast' and line->>'forecast' is null and line->>'legitimateBlank' is distinct from 'true' and not coalesce(line->>'disposition'='outside_forecast_scope' and line->>'sourceScopeExclusionConfirmed'='true',false) then$b$);
 d:=atlas_private.workbook_blank_required_rewrite(d,
 $a$  override_index:=override_index+1;$a$,
 $b$  override_index:=override_index+1;
  if atlas_private.reforecast_workbook_bound(over,binding) then continue;end if;$b$);
 d:=atlas_private.workbook_blank_required_rewrite(d,
 $a$state:=jsonb_set(state,array[k],line,true);
 end loop;
 select coalesce(jsonb_agg(v||$a$,
 $b$if over->>'disposition'='workbook_blank' and over->>'legitimateBlank'='true' and over->'amount'='null'::jsonb then line:=line||jsonb_build_object('legitimateBlank',true,'disposition','workbook_blank','isBlank',true,'source',over->'source');end if;
  state:=jsonb_set(state,array[k],line,true);
 end loop;
 select coalesce(jsonb_agg(v||$b$);
 d:=atlas_private.workbook_blank_required_rewrite(d,
 $a$count(*) filter(where v->>'forecast' is null)=0$a$,
 $b$count(*) filter(where v->>'forecast' is null and not coalesce((v->>'disposition'='workbook_blank' and v->>'legitimateBlank'='true') or (v->>'disposition'='outside_forecast_scope' and v->>'sourceScopeExclusionConfirmed'='true'),false))=0$b$);
 execute d;
 d:=pg_get_functiondef('atlas_private.reforecast_noncash_metrics(jsonb,jsonb,text,boolean)'::regprocedure);
 d:=atlas_private.workbook_blank_required_rewrite(d,
 $a$  elsif row->>'nonCash'='true' then$a$,
 $b$  elsif field in ('forecast','amount') and row->>field is null and ((row->>'disposition'='workbook_blank' and row->>'legitimateBlank'='true') or (row->>'disposition'='outside_forecast_scope' and row->>'sourceScopeExclusionConfirmed'='true')) and (row->>'nonCash'='false' or (row->>'nature'='below_noi' and row->>'placement'='below_noi')) then continue;
  elsif row->>'nonCash'='true' then$b$);
 execute d;
 -- Required exact anchors fail the whole transaction on prerequisite drift.
 d:=pg_get_functiondef('atlas_private.create_reforecast_from_import(uuid,uuid,integer,uuid,uuid,jsonb,jsonb)'::regprocedure);
 d:=atlas_private.workbook_blank_required_rewrite(d,'declare u public.atlas_reforecast_uploads','declare predicate_mapping jsonb;predicate_audit jsonb;verified_blank boolean;u public.atlas_reforecast_uploads');
 d:=atlas_private.workbook_blank_required_rewrite(d,$a$ audit:=atlas_private.resolve_workbook_audit(u.payload->'integrity',u.source_hash);$a$,$b$ audit:=atlas_private.resolve_workbook_audit(u.payload->'integrity',u.source_hash);
 predicate_mapping:=atlas_private.reforecast_workbook_predicate_mapping(p_mapping);predicate_audit:=atlas_private.reforecast_workbook_predicate_audit(audit);$b$);
 d:=atlas_private.workbook_blank_required_rewrite(d,$a$  coordinates:=jsonb_build_object('sheet',line->'sheet'$a$,$b$  verified_blank:=atlas_private.reforecast_workbook_blank(line,source_cells->(line->>'id'),predicate_mapping,predicate_audit);
  coordinates:=jsonb_build_object('sheet',line->'sheet'$b$);
 d:=atlas_private.workbook_blank_required_rewrite(d,
 $a$ registry_id:=nullif(p_mapping->>'version','')::uuid;$a$,
 $b$ if p_mapping ? 'workbookSourcePolicy' and not atlas_private.reforecast_workbook_policy(p_mapping) then raise exception 'Explicit reviewed workbook source policy required';end if;
 registry_id:=nullif(p_mapping->>'version','')::uuid;$b$);
 d:=atlas_private.workbook_blank_required_rewrite(d,
 $a$or jsonb_typeof(line->'amount') is distinct from 'number' then raise exception 'Selected cell requires one reviewed GL mapping and a numeric amount; blank is not zero: %',line->>'id';end if;$a$,
 $b$or (jsonb_typeof(line->'amount') is distinct from 'number' and not verified_blank) then raise exception 'Selected cell requires an exact numeric value or an explicitly reviewed immutable workbook blank: %',line->>'id';end if;$b$);
 d:=atlas_private.workbook_blank_required_rewrite(d,
 $a$  cell:=source_cells->(line->>'id');$a$,
 $b$  cell:=source_cells->(line->>'id');
  if cell is null and verified_blank then cell:=jsonb_build_object('value',null,'formula',null);end if;$b$);
 d:=atlas_private.workbook_blank_required_rewrite(d,
 $a$and not(coalesce(audit->'authorityScope'->'selectedCells','[]') ? (line->>'id')) then raise exception 'Selected cell is outside retained authoritative workbook scope';end if;$a$,
 $b$and not(coalesce(audit->'authorityScope'->'selectedCells','[]') ? (line->>'id')) and not verified_blank then raise exception 'Selected cell is outside retained authoritative workbook scope';end if;$b$);
 d:=atlas_private.workbook_blank_required_rewrite(d,
 $a$if jsonb_typeof(before_line->'amount') is distinct from 'number' and baseline_disposition is null then$a$,
 $b$if jsonb_typeof(before_line->'amount') is distinct from 'number' and baseline_disposition is null and not coalesce(before_line->>'legitimateBlank'='true' or before_line->>'disposition'='outside_forecast_scope' and before_line->>'sourceScopeExclusionConfirmed'='true',false) then$b$);
 d:=atlas_private.workbook_blank_required_rewrite(d,
 $a$'mappingVersion',registry_id,'disposition','included','baselineDisposition'$a$,
 $b$'mappingVersion',registry_id,'disposition',case when verified_blank then 'workbook_blank' else 'included' end,'legitimateBlank',verified_blank,'baselineDisposition'$b$);
 d:=atlas_private.workbook_blank_required_rewrite(d,
 $a$'actorId',auth.uid(),'reviewedAt',reviewed_at,'isBlank',false);$a$,
 $b$'actorId',auth.uid(),'reviewedAt',reviewed_at,'isBlank',verified_blank);$b$);
 d:=atlas_private.workbook_blank_required_rewrite(d,
 $a$  overrides:=overrides||jsonb_build_array(over);$a$,
 $b$  if cell->>'disposition'='workbook_blank' then over:=jsonb_build_object('period',cell->'period','accountCode',cell->'accountCode','amount',null,'uploadId',p_upload_id,'sourceLineId',cell->'sourceLineId','disposition','workbook_blank','isBlank',true,'legitimateBlank',true);end if;
  overrides:=overrides||jsonb_build_array(over);$b$);
 d:=atlas_private.workbook_blank_required_rewrite(d,
 $a$'reconciliation',jsonb_build_object('selectedCellCount',jsonb_array_length(imported),$a$,
 $b$'reconciliation',jsonb_build_object('workbookBlankCellCount',(select count(*) from jsonb_array_elements(imported)c where c->>'disposition'='workbook_blank'),'selectedCellCount',jsonb_array_length(imported),$b$);
 execute d;

 -- Ordinary re-saves validate the same immutable null evidence as atomic import.
 d:=pg_get_functiondef('atlas_private.validate_reforecast_source_relationships(jsonb,jsonb,jsonb)'::regprocedure);
 d:=atlas_private.workbook_blank_required_rewrite(d,'declare cells jsonb','declare predicate_mapping jsonb:=atlas_private.reforecast_workbook_predicate_mapping(mapping);predicate_audit jsonb:=atlas_private.reforecast_workbook_predicate_audit(audit);cells jsonb');
 d:=atlas_private.workbook_blank_required_rewrite(d,
 $a$  if line is null or raw_cell is null or raw_cell->'row'$a$,
 $b$  if raw_cell is null and atlas_private.reforecast_workbook_blank(line,raw_cell,predicate_mapping,predicate_audit) then raw_cell:=jsonb_build_object('value',null,'formula',null,'address',line->'address','row',line->'row','column',line->'column');end if;
  if line is null or raw_cell is null or raw_cell->'row'$b$);

 d:=atlas_private.workbook_blank_required_rewrite(d,
 $a$  if jsonb_typeof(line->'identifiers') is distinct from 'array'$a$,
 $b$  if jsonb_typeof(line->'amount') is distinct from 'number' and not atlas_private.reforecast_workbook_blank(line,raw_cell,predicate_mapping,predicate_audit) then raise exception 'Source blank must match the reviewed immutable null cell: %',id;end if;
  if jsonb_typeof(line->'identifiers') is distinct from 'array'$b$);
 execute d;
 d:=pg_get_functiondef('atlas_private.reforecast_planning_issues(jsonb,jsonb)'::regprocedure);
 d:=atlas_private.workbook_blank_required_rewrite(d,'declare issues jsonb','declare predicate_mapping jsonb;predicate_audit jsonb;issues jsonb');
 d:=atlas_private.workbook_blank_required_rewrite(d,$a$  retained_audit:=atlas_private.resolve_workbook_audit(upload->'integrity',upload->'source'->>'sha256');$a$,$b$  retained_audit:=atlas_private.resolve_workbook_audit(upload->'integrity',upload->'source'->>'sha256');
  predicate_mapping:=atlas_private.reforecast_workbook_predicate_mapping(mapping);predicate_audit:=atlas_private.reforecast_workbook_predicate_audit(retained_audit);$b$);
 d:=atlas_private.workbook_blank_required_rewrite(d,
 $a$ issues:=issues||atlas_private.planning_calendar_issues(config->'calendar'$a$,
 $b$ config:=atlas_private.expand_reforecast_workbook_blanks(source,config);
 issues:=issues||atlas_private.planning_calendar_issues(config->'calendar'$b$);

 d:=atlas_private.workbook_blank_required_rewrite(d,
 $a$   cell:=source_cells->id;$a$,
 $b$   cell:=source_cells->id;
   if cell is null and atlas_private.reforecast_workbook_blank(line,cell,predicate_mapping,predicate_audit) then cell:=jsonb_build_object('value',null,'formula',null);end if;$b$);
 execute d;
 d:=pg_get_functiondef('atlas_private.reforecast_import_issues_before_source_relationships(jsonb,jsonb)'::regprocedure);
 d:=atlas_private.workbook_blank_required_rewrite(d,'declare upload jsonb',$b$declare predicate_mapping jsonb:=atlas_private.reforecast_workbook_predicate_mapping(config->'importMapping');upload jsonb$b$);
 d:=atlas_private.workbook_blank_required_rewrite(d,
 $a$ if jsonb_typeof(config->'importHistory')='array'$a$,
 $b$ config:=atlas_private.expand_reforecast_mapping_references((source->>'communityId')::uuid,config);
 if jsonb_typeof(config->'importHistory')='array'$b$);
 d:=atlas_private.workbook_blank_required_rewrite(d,$a$ select coalesce(jsonb_object_agg(l->>'id',l),'{}') into upload_lines$a$,$b$ config:=atlas_private.expand_reforecast_workbook_blanks(source,config);
 select coalesce(jsonb_object_agg(l->>'id',l),'{}') into upload_lines$b$);

 d:=atlas_private.workbook_blank_required_rewrite(d,
 $a$or jsonb_typeof(line->'amount') is distinct from 'number' or line->>'cellType'='e'$a$,
 $b$or (jsonb_typeof(line->'amount') is distinct from 'number' and not(atlas_private.reforecast_workbook_policy(predicate_mapping) and line->'amount'='null'::jsonb and line->>'blank'='true' and coalesce(line->>'formula','')='' and coalesce(line->>'cachedValue','')='')) or line->>'cellType'='e'$b$);
 d:=atlas_private.workbook_blank_required_rewrite(d,
 $a$or (over->>'amount')::numeric is distinct from amount then issues:=$a$,
 $b$or (over->>'amount')::numeric is distinct from amount or (line->'amount'='null'::jsonb and not atlas_private.reforecast_workbook_retained_blank(over,predicate_mapping)) then issues:=$b$);
 execute d;
 d:=pg_get_functiondef('atlas_private.reforecast_metric(jsonb,text)'::regprocedure);
 d:=atlas_private.workbook_blank_required_rewrite(d,
 $a$count(*) filter(where v->>field is null and (v->>'legitimateBlank' is distinct from 'true' or field='originalBudget'))$a$,
 $b$count(*) filter(where v->>field is null and (v->>'legitimateBlank' is distinct from 'true' or field='originalBudget') and not(field in ('forecast','amount') and coalesce(v->>'disposition'='outside_forecast_scope' and v->>'sourceScopeExclusionConfirmed'='true',false)))$b$);
 execute d;
 d:=pg_get_functiondef('public.atlas_reforecast_effective_baseline(uuid[],text[])'::regprocedure);
 d:=atlas_private.workbook_blank_required_rewrite(d,
 $a$(jsonb_typeof(v->'amount') is distinct from 'number' and v->>'legitimateBlank' is distinct from 'true')$a$,
 $b$(jsonb_typeof(v->'amount') is distinct from 'number' and v->>'legitimateBlank' is distinct from 'true' and not coalesce(v->>'disposition'='outside_forecast_scope' and v->>'sourceScopeExclusionConfirmed'='true',false))$b$);
 execute d;
end;$migration$;

create function atlas_private.reforecast_workbook_coverage(lines jsonb)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('numericCellCount',count(*) filter(where v->>'disposition'='included' and jsonb_typeof(v->'forecast')='number'),
 'reviewerEditedCellCount',count(*) filter(where v->>'disposition'='reviewer_override'),
 'workbookBlankCellCount',count(*) filter(where v->>'disposition'='workbook_blank'),
 'sourceAbsentCellCount',count(*) filter(where v->>'disposition'='source_absent'),'outsideForecastScopeCellCount',count(*) filter(where v->>'disposition'='outside_forecast_scope' and v->>'sourceScopeExclusionConfirmed'='true'),
 'complete',count(*) filter(where v->>'disposition'='source_absent')=0) from jsonb_array_elements(lines)v
$$;
create function atlas_private.reforecast_workbook_metric(lines jsonb,noncash boolean,known_only boolean default false)
returns jsonb language plpgsql immutable set search_path='' as $$
declare input jsonb:=lines;metrics jsonb;row jsonb;charge numeric:=0;missing boolean:=false;
begin
 if known_only then select coalesce(jsonb_agg(case when v->>'forecast' is null then v||'{"legitimateBlank":true,"disposition":"workbook_blank"}'::jsonb else v end),'[]') into input from jsonb_array_elements(lines)v;end if;
 metrics:=atlas_private.reforecast_metric(input,'forecast');
 if not noncash then return metrics;end if;
 for row in select value from jsonb_array_elements(input) loop
  if row->>'nonCashClassificationVersion' is distinct from '1' or jsonb_typeof(row->'nonCash') is distinct from 'boolean' or row->>'mappingValid' is distinct from 'true' then missing:=true;
  elsif row->>'nonCash'='true' then
   if row->>'nature' is distinct from 'below_noi' or row->>'placement' is distinct from 'below_noi' then missing:=true;
   elsif row->>'forecast' is null and ((row->>'legitimateBlank'='true' and row->>'disposition'='workbook_blank') or (row->>'sourceScopeExclusionConfirmed'='true' and row->>'disposition'='outside_forecast_scope')) then continue;
   elsif jsonb_typeof(row->'forecast') is distinct from 'number' then missing:=true;
   else charge:=charge+(row->>'forecast')::numeric;end if;
  end if;
 end loop;
 if missing then charge:=null;else charge:=round(charge,2);end if;
 return metrics||jsonb_build_object('nonCashDepreciationAmortization',charge,'cashFlowBeforeNoncash',round((metrics->>'cashFlow')::numeric+charge,2),'cashFlowAfterNoncash',metrics->'cashFlow');
end;$$;

alter function atlas_private.calculate_reforecast(jsonb,jsonb) rename to calculate_reforecast_before_workbook_blanks;
create function atlas_private.calculate_reforecast(source jsonb,config jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;mapping jsonb:=config->'importMapping';line jsonb;over jsonb;indexed jsonb;lines jsonb;month jsonb;month_lines jsonb;monthly jsonb:='[]';scoped_months jsonb:='[]';coverage jsonb;diagnostics jsonb;known jsonb;totals jsonb;metric text;metric_value numeric;missing bigint;noncash boolean;bound boolean;variance numeric;excluded jsonb;base_index jsonb;base_cell jsonb;manual boolean;driven boolean;source_totals jsonb;source_known jsonb;binding jsonb:=atlas_private.reforecast_workbook_binding(config);predicate_mapping jsonb:=binding->'importMapping';
begin
 config:=atlas_private.expand_reforecast_workbook_blanks(source,config);
 if not coalesce(mapping ? 'workbookSourcePolicy',false) then return atlas_private.reforecast_workbook_source_diagnostics(source,config,atlas_private.calculate_reforecast_before_workbook_blanks(source,config));end if;
 select coalesce(jsonb_object_agg(jsonb_build_array(c->>'period',c->>'accountCode')::text,c),'{}') into base_index from jsonb_array_elements(coalesce(source->'workbookImportedCells','[]')||coalesce(config->'overrides','[]'))c where atlas_private.reforecast_workbook_bound(c,binding);
 select base_index||coalesce(jsonb_object_agg(jsonb_build_array(c->>'period',c->>'accountCode')::text,c||jsonb_build_object('amount',null)),'{}') into base_index from jsonb_array_elements(coalesce(source->'workbookOutsideScopeCells','[]'))c;
 source:=source||jsonb_build_object('workbookForecastIndex',base_index);
 result:=atlas_private.calculate_reforecast_before_workbook_blanks(source,config);
 if not coalesce(mapping ? 'workbookSourcePolicy',false) then return result;end if;
 if not atlas_private.reforecast_workbook_policy(mapping) then raise exception 'Review the exact workbook value and blank policy before calculating';end if;
 if exists(select 1 from jsonb_array_elements(coalesce(config->'overrides','[]'))v group by v->>'period',v->>'accountCode' having count(*)>1) then raise exception 'Exact workbook source has duplicate GL/month overrides';end if;
 select coalesce(jsonb_object_agg(jsonb_build_array(v->>'period',v->>'accountCode')::text,v),'{}') into indexed from jsonb_array_elements(coalesce(config->'overrides','[]'))v;
 lines:='[]';
 for line in select value from jsonb_array_elements(result->'lines') loop
  if mapping->'periods' ? (line->>'period') and line->>'sourceKind'='forecast' and line->>'immutable' is distinct from 'true' and line->>'retired' is distinct from 'true' then
   over:=indexed->jsonb_build_array(line->>'period',line->>'accountCode')::text;
   base_cell:=base_index->jsonb_build_array(line->>'period',line->>'accountCode')::text;
   manual:=not atlas_private.reforecast_workbook_bound(over,binding) and over->>'uploadId' is null and over->>'sourceLineId' is null and jsonb_typeof(over->'amount')='number' and atlas_private.planning_review_valid(over,(source->>'communityId')::uuid,over->>'period',over->'amount');
   driven:=jsonb_typeof(line->'forecast')='number' and exists(select 1 from jsonb_array_elements_text(coalesce(line->'driverIds','[]'))d where d not like 'override-%');
   if base_cell is not null then line:=line||jsonb_build_object('workbookSourceAmount',base_cell->'amount','workbookSourceDisposition',coalesce(base_cell->>'disposition','included'),'workbookSource',base_cell->'source');end if;
   if base_cell is not null and (manual or driven) then
    line:=line||jsonb_build_object('disposition','reviewer_override','isBlank',false,'legitimateBlank',false,'sourceScopeExclusionConfirmed',false);
    if manual then line:=line||jsonb_build_object('source',coalesce(over->'source',jsonb_build_object('kind','reviewed_manual_override','ownerId',over->'ownerId','reviewedAt',over->'reviewedAt','reason',over->'reason')));end if;
   elsif jsonb_typeof(base_cell->'amount')='number' then
    line:=line||jsonb_build_object('forecast',base_cell->'amount','disposition','included','isBlank',false,'legitimateBlank',false,'source',base_cell->'source');
   elsif atlas_private.reforecast_workbook_retained_blank(base_cell,predicate_mapping) then
    line:=line||jsonb_build_object('forecast',null,'disposition','workbook_blank','isBlank',true,'legitimateBlank',true,'source',base_cell->'source');
   elsif base_cell->>'disposition'='outside_forecast_scope' then
    line:=line||jsonb_build_object('forecast',null,'disposition','outside_forecast_scope','isBlank',false,'legitimateBlank',false,'sourceScopeExclusionConfirmed',true,'source',base_cell->'source');
   else
    line:=line||jsonb_build_object('forecast',null,'disposition','source_absent','isBlank',false,'legitimateBlank',false,'source',jsonb_build_object('kind','workbook_missing','uploadId',config->'uploadId','sourceScenario',mapping->'sourceScenario','mappingVersion',mapping->'version'));
   end if;
   variance:=round((line->>'forecast')::numeric-(line->>'selectedBaseline')::numeric,2);
   line:=line||jsonb_build_object('forecastVariance',variance,'forecastFavorability',case when variance is null then 'unavailable' when variance=0 then 'neutral' when (line->>'nature' in ('income','contra_income') and variance>0) or (line->>'nature' not in ('income','contra_income') and variance<0) then 'favorable' else 'unfavorable' end);
  end if;
  lines:=lines||jsonb_build_array(line);
 end loop;
 select coalesce(jsonb_agg(d),'[]') into diagnostics from jsonb_array_elements(result->'diagnostics')d where not(d->>'code' in ('missing_forecast','open_value_missing') and exists(select 1 from jsonb_array_elements(lines)l where l->>'period'=d->>'period' and l->>'accountCode'=d->>'accountCode' and ((l->>'disposition'='workbook_blank' and l->>'legitimateBlank'='true') or (l->>'disposition'='outside_forecast_scope' and l->>'sourceScopeExclusionConfirmed'='true'))));
 select diagnostics||coalesce(jsonb_agg(jsonb_build_object('code','override_review_required','severity','error','message','Every changed workbook forecast value requires an authorized confirmed review.','period',o->'period','accountCode',o->'accountCode')),'[]') into diagnostics from jsonb_array_elements(coalesce(config->'overrides','[]'))o where mapping->'periods' ? (o->>'period') and not atlas_private.reforecast_workbook_bound(o,binding) and not atlas_private.planning_review_valid(o,(source->>'communityId')::uuid,o->>'period',o->'amount');
 select diagnostics||coalesce(jsonb_agg(jsonb_build_object('code','workbook_source_absent','severity','error','message','No reviewed workbook value or verified blank covers this GL and month.','period',l->'period','accountCode',l->'accountCode')),'[]') into diagnostics from jsonb_array_elements(lines)l where mapping->'periods' ? (l->>'period') and l->>'disposition'='source_absent';
 noncash:=result->'identity' ? 'nonCashPresentation';
 for month in select value from jsonb_array_elements(result->'monthly') loop
  if mapping->'periods' ? (month->>'period') and month->>'closed' is distinct from 'true' and month->>'applicable' is distinct from 'false' then
   select coalesce(jsonb_agg(v),'[]') into month_lines from jsonb_array_elements(lines)v where v->>'period'=month->>'period';
   coverage:=atlas_private.reforecast_workbook_coverage(month_lines);known:=atlas_private.reforecast_workbook_metric(month_lines,noncash,true);
   select atlas_private.reforecast_workbook_metric(jsonb_agg(v||jsonb_build_object('forecast',v->'workbookSourceAmount')),noncash,true) into source_known from jsonb_array_elements(month_lines)v;
   month:=month||jsonb_build_object('reforecast',atlas_private.reforecast_workbook_metric(month_lines,noncash),'workbookCoverage',coverage,'knownValueTotals',known,'workbookSourceTotals',source_known);
   scoped_months:=scoped_months||jsonb_build_array(coverage||jsonb_build_object('period',month->'period','knownValueTotals',known,'workbookSourceTotals',source_known));
  end if;
  monthly:=monthly||jsonb_build_array(month);
 end loop;
 totals:='{}';known:='{}';source_totals:='{}';
 for metric in select jsonb_object_keys(result->'totals'->'reforecast') loop
  select sum((v->'reforecast'->>metric)::numeric),count(*) filter(where v->'reforecast'->>metric is null) into metric_value,missing from jsonb_array_elements(monthly)v where v->>'applicable' is distinct from 'false';
  totals:=totals||jsonb_build_object(metric,case when missing=0 then round(metric_value,2) end);
  select sum((v->'knownValueTotals'->>metric)::numeric),count(*) filter(where v->'knownValueTotals'->>metric is null) into metric_value,missing from jsonb_array_elements(scoped_months)v;
  known:=known||jsonb_build_object(metric,case when missing=0 then round(metric_value,2) end);
  select sum((v->'workbookSourceTotals'->>metric)::numeric),count(*) filter(where v->'workbookSourceTotals'->>metric is null) into metric_value,missing from jsonb_array_elements(scoped_months)v;
  source_totals:=source_totals||jsonb_build_object(metric,case when missing=0 then round(metric_value,2) end);
 end loop;
 totals:=totals||jsonb_build_object('margin',case when (totals->>'revenue')::numeric<>0 then (totals->>'noi')::numeric/(totals->>'revenue')::numeric end);
 known:=known||jsonb_build_object('margin',case when (known->>'revenue')::numeric<>0 then (known->>'noi')::numeric/(known->>'revenue')::numeric end);
 source_totals:=source_totals||jsonb_build_object('margin',case when (source_totals->>'revenue')::numeric<>0 then (source_totals->>'noi')::numeric/(source_totals->>'revenue')::numeric end);
 result:=jsonb_set(result,'{totals,reforecast}',totals);
 select coalesce(jsonb_agg(c||jsonb_build_object('monthly',(select jsonb_agg(case when mapping->'periods' ? (m->>'period') then m||jsonb_build_object('forecast',(select case when count(*) filter(where l->>'forecast' is null and not coalesce((l->>'legitimateBlank'='true' and l->>'disposition'='workbook_blank') or (l->>'sourceScopeExclusionConfirmed'='true' and l->>'disposition'='outside_forecast_scope'),false))=0 then coalesce(sum((l->>'forecast')::numeric),0) end from jsonb_array_elements(lines)l where l->>'category'=c->>'category' and l->>'period'=m->>'period')) else m end) from jsonb_array_elements(c->'monthly')m))),'[]') into totals from jsonb_array_elements(result->'categories')c;
 select atlas_private.reforecast_workbook_coverage(coalesce(jsonb_agg(v),'[]')) into coverage from jsonb_array_elements(lines)v where mapping->'periods' ? (v->>'period');
 result:=result||jsonb_build_object('lines',lines,'monthly',monthly,'categories',totals,'diagnostics',diagnostics,'status',case when exists(select 1 from jsonb_array_elements(diagnostics)d where d->>'severity' in ('blocking','error')) then 'action_required' else 'ready' end,'workbookCoverage',coverage||jsonb_build_object('schemaVersion',1,'totalsBasis','known_forecast_values','monthly',scoped_months),'knownValueTotals',known,'workbookSourceTotals',source_totals);
 result:=jsonb_set(result,'{identity,workbookSourcePolicy}',mapping->'workbookSourcePolicy');
 result:=jsonb_set(result,'{completeness}',coalesce(result->'completeness','{}')||jsonb_build_object('blockerCount',(select count(*) from jsonb_array_elements(diagnostics)d where d->>'severity' in ('blocking','error')),'warningCount',(select count(*) from jsonb_array_elements(diagnostics)d where d->>'severity'='warning')));
 return atlas_private.reforecast_workbook_source_diagnostics(source,config,result);
end;$$;
revoke all on function atlas_private.reforecast_workbook_coverage(jsonb),atlas_private.reforecast_workbook_metric(jsonb,boolean,boolean),atlas_private.calculate_reforecast_before_workbook_blanks(jsonb,jsonb),atlas_private.calculate_reforecast(jsonb,jsonb) from public,anon,authenticated;

-- Reports copy the saved policy/coverage. Old immutable reports keep their
-- existing projection and fingerprint byte-for-byte.
alter function atlas_private.reforecast_report_snapshot(jsonb) rename to reforecast_report_snapshot_before_workbook_blanks;
create function atlas_private.reforecast_report_snapshot(input jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb;indexed jsonb;lines jsonb;monthly jsonb;
begin
 result:=atlas_private.reforecast_report_snapshot_before_workbook_blanks(input);
 if not(input ? 'workbookCoverage') and not(input ? 'workbookSourceExclusions') and not exists(select 1 from jsonb_array_elements(coalesce(input->'lines','[]'))v where v->>'disposition' in ('workbook_blank','outside_forecast_scope','reviewer_override','source_absent') or v ? 'workbookSourceAmount') then return result;end if;
 select coalesce(jsonb_object_agg(jsonb_build_array(v->>'period',v->>'accountCode')::text,atlas_private.reforecast_report_fields(v,array['disposition','isBlank','legitimateBlank','sourceScopeExclusionConfirmed','workbookSourceAmount','workbookSourceDisposition','workbookSource'])),'{}') into indexed from jsonb_array_elements(input->'lines')v;
 select jsonb_agg(v||coalesce(indexed->jsonb_build_array(v->>'period',v->>'accountCode')::text,'{}') order by ordinal) into lines from jsonb_array_elements(result->'lines') with ordinality q(v,ordinal);
 result:=result||jsonb_build_object('lines',lines);
 if input ? 'workbookSourceExclusions' then result:=result||jsonb_build_object('workbookSourceExclusions',input->'workbookSourceExclusions');end if;
 if input ? 'workbookCoverage' then
 select coalesce(jsonb_object_agg(v->>'period',atlas_private.reforecast_report_fields(v,array['workbookCoverage','knownValueTotals','workbookSourceTotals'])),'{}') into indexed from jsonb_array_elements(input->'monthly')v;
 select jsonb_agg(v||coalesce(indexed->(v->>'period'),'{}') order by ordinal) into monthly from jsonb_array_elements(result->'monthly') with ordinality q(v,ordinal);
 result:=result||jsonb_build_object('lines',lines,'monthly',monthly,'workbookCoverage',input->'workbookCoverage','knownValueTotals',input->'knownValueTotals','workbookSourceTotals',input->'workbookSourceTotals');
 if input->'identity' ? 'workbookSourcePolicy' then result:=jsonb_set(result,'{identity,workbookSourcePolicy}',input->'identity'->'workbookSourcePolicy');end if;
 end if;
 return result||jsonb_build_object('fingerprint',encode(sha256(convert_to((result-'fingerprint')::text,'UTF8')),'hex'));
end;$$;
revoke all on function atlas_private.reforecast_report_snapshot_before_workbook_blanks(jsonb),atlas_private.reforecast_report_snapshot(jsonb) from public,anon,authenticated;
-- Preserve each existing rejection while replacing repeated wide-array scans
-- with per-invocation exact-key indexes. No timeout or authorization changes.
do $index$
declare d text;
begin
 d:=pg_get_functiondef('atlas_private.create_reforecast_from_import(uuid,uuid,integer,uuid,uuid,jsonb,jsonb)'::regprocedure);
 d:=atlas_private.workbook_blank_required_rewrite(d,'declare predicate_mapping jsonb;',$b$declare atomic_maps jsonb;atomic_accounts jsonb;atomic_baseline jsonb;atomic_import_keys jsonb:='{}';atomic_readback jsonb;predicate_mapping jsonb;$b$);
 d:=atlas_private.workbook_blank_required_rewrite(d,$a$ -- Construct every value from immutable evidence, never from browser prefill.$a$,$b$ select coalesce(jsonb_object_agg(code,entries),'{}') into atomic_maps from (select m->>'sourceAccountCode' code,jsonb_agg(m) entries from jsonb_array_elements(p_mapping->'accountMappings')m group by 1)q;
 select coalesce(jsonb_object_agg(code,v),'{}') into atomic_accounts from (select distinct on(v->>'accountCode')v,v->>'accountCode' code from jsonb_array_elements(source->'registry'->'accounts') with ordinality q(v,n) order by v->>'accountCode',n)q;
 select coalesce(jsonb_object_agg(k,v),'{}') into atomic_baseline from (select distinct on(v->>'period',v->>'accountCode')v,jsonb_build_array(v->>'period',v->>'accountCode')::text k from jsonb_array_elements(source->'baseline'->'lines') with ordinality q(v,n) order by v->>'period',v->>'accountCode',n)q;
 -- Construct every value from immutable evidence, never from browser prefill.$b$);
 d:=atlas_private.workbook_blank_required_rewrite(d,$a$from jsonb_array_elements(p_mapping->'accountMappings')m where m->>'sourceAccountCode'=line->>'accountCode'$a$,$b$from jsonb_array_elements(coalesce(atomic_maps->(line->>'accountCode'),'[]'))m where m->>'sourceAccountCode'=line->>'accountCode'$b$);
 d:=atlas_private.workbook_blank_required_rewrite(d,$a$  select value into account from jsonb_array_elements(source->'registry'->'accounts')a where a->>'accountCode'=map_entry->>'accountCode';$a$,$b$  account:=atomic_accounts->(map_entry->>'accountCode');$b$);
 d:=atlas_private.workbook_blank_required_rewrite(d,$a$  select value into before_line from jsonb_array_elements(source->'baseline'->'lines')b where b->>'period'=line->>'period' and b->>'accountCode'=map_entry->>'accountCode';$a$,$b$  before_line:=atomic_baseline->jsonb_build_array(line->>'period',map_entry->>'accountCode')::text;$b$);
 d:=atlas_private.workbook_blank_required_rewrite(d,$a$  if exists(select 1 from jsonb_array_elements(imported)c where c->>'period'=line->>'period' and c->>'accountCode'=map_entry->>'accountCode') then raise exception 'Multiple workbook cells map to the same GL/month; resolve the source relationship before importing';end if;$a$,$b$  if atomic_import_keys ? jsonb_build_array(line->>'period',map_entry->>'accountCode')::text then raise exception 'Multiple workbook cells map to the same GL/month; resolve the source relationship before importing';end if;
  atomic_import_keys:=atomic_import_keys||jsonb_build_object(jsonb_build_array(line->>'period',map_entry->>'accountCode')::text,true);$b$);
 d:=atlas_private.workbook_blank_required_rewrite(d,$a$from jsonb_array_elements(p_mapping->'accountMappings')m where m->>'sourceAccountCode'=l->>'accountCode'$a$,$b$from jsonb_array_elements(coalesce(atomic_maps->(l->>'accountCode'),'[]'))m where m->>'sourceAccountCode'=l->>'accountCode'$b$);
 d:=atlas_private.workbook_blank_required_rewrite(d,$a$ if exists(select 1 from jsonb_array_elements(imported)c where (select count(*) from jsonb_array_elements(r.snapshot->'lines')l where l->>'period'=c->>'period' and l->>'accountCode'=c->>'accountCode' and l->'forecast'=c->'amount')<>1)$a$,$b$ select coalesce(jsonb_object_agg(k,entries),'{}') into atomic_readback from (select jsonb_build_array(l->>'period',l->>'accountCode')::text k,jsonb_agg(l->'forecast') entries from jsonb_array_elements(r.snapshot->'lines')l group by 1)q;
 if exists(select 1 from jsonb_array_elements(imported)c where (select count(*) from jsonb_array_elements(coalesce(atomic_readback->jsonb_build_array(c->>'period',c->>'accountCode')::text,'[]'))v where v=c->'amount')<>1)$b$);
 d:=atlas_private.workbook_blank_required_rewrite(d,$a$ source:=atlas_private.reforecast_source_for_config(p_community_id,config);$a$,$b$ source:=atlas_private.reforecast_source_before_workbook_blanks(p_community_id,config);$b$);
 d:=atlas_private.workbook_blank_required_rewrite(d,$a$ issues:=atlas_private.reforecast_import_issues(source,config);$a$,$b$ source:=atlas_private.attach_reforecast_workbook_context(source,config);
 issues:=atlas_private.reforecast_import_issues(source,config);$b$);
 execute d;
 d:=pg_get_functiondef('atlas_private.reforecast_import_issues_before_close_scope(jsonb,jsonb)'::regprocedure);
 d:=atlas_private.workbook_blank_required_rewrite(d,$a$perform atlas_private.validate_reforecast_uploaded_relationships(source->>'communityId',config->>'uploadId',config->'importMapping');return result;$a$,$b$if not atlas_private.reforecast_workbook_relationship_proof(source,config) then perform atlas_private.validate_reforecast_uploaded_relationships(source->>'communityId',config->>'uploadId',config->'importMapping');end if;return result;$b$);
 execute d;
 d:=pg_get_functiondef('atlas_private.reforecast_import_issues_before_source_relationships(jsonb,jsonb)'::regprocedure);
 d:=atlas_private.workbook_blank_required_rewrite(d,'declare predicate_mapping jsonb','declare source_map_index jsonb;source_override_index jsonb;predicate_mapping jsonb');
 d:=atlas_private.workbook_blank_required_rewrite(d,$a$ for id in select jsonb_array_elements_text(mapping->'selectedLineIds') loop$a$,$b$ select coalesce(jsonb_object_agg(code,entries),'{}') into source_map_index from (select mapped->>'sourceAccountCode' code,jsonb_agg(mapped) entries from jsonb_array_elements(mapping->'accountMappings')mapped group by 1)q;
 select coalesce(jsonb_object_agg(q.id,q.entries),'{}') into source_override_index from (select o->>'sourceLineId' id,jsonb_agg(o) entries from jsonb_array_elements(coalesce(config->'overrides','[]'))o where o->>'sourceLineId' is not null group by 1)q;
 for id in select jsonb_array_elements_text(mapping->'selectedLineIds') loop$b$);
 -- Both count and exact mapping reads retain their original scoped predicates.
 if (length(d)-length(replace(d,$a$from jsonb_array_elements(mapping->'accountMappings')v where v->>'sourceAccountCode'=line->>'accountCode'$a$,'')))/length($a$from jsonb_array_elements(mapping->'accountMappings')v where v->>'sourceAccountCode'=line->>'accountCode'$a$)<>2 then raise exception 'Workbook mapping validation lookup prerequisite differs';end if;
 d:=replace(d,$a$from jsonb_array_elements(mapping->'accountMappings')v where v->>'sourceAccountCode'=line->>'accountCode'$a$,$b$from jsonb_array_elements(coalesce(source_map_index->(line->>'accountCode'),'[]'))v where v->>'sourceAccountCode'=line->>'accountCode'$b$);
 d:=atlas_private.workbook_blank_required_rewrite(d,$a$  for over in select v from jsonb_array_elements(coalesce(config->'overrides','[]'))v where v->>'sourceLineId'=id loop$a$,$b$  for over in select v from jsonb_array_elements(coalesce(source_override_index->id,'[]'))v where v->>'sourceLineId'=id loop$b$);
 execute d;
end;$index$;
alter function atlas_private.create_reforecast_from_import(uuid,uuid,integer,uuid,uuid,jsonb,jsonb) set plan_cache_mode='force_generic_plan';
alter function atlas_private.reforecast_import_issues_before_source_relationships(jsonb,jsonb) set plan_cache_mode='force_generic_plan';
alter function atlas_private.reforecast_planning_issues(jsonb,jsonb) set plan_cache_mode='force_generic_plan';
alter function atlas_private.validate_reforecast_source_relationships(jsonb,jsonb,jsonb) set plan_cache_mode='force_generic_plan';

drop function atlas_private.workbook_blank_required_rewrite(text,text,text);
commit;
