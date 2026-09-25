-- Complete evidence remains in the immutable, exact-hash-verified upload
-- streams. This private runtime projection is a distinct, derived artifact.
-- This migration does NOT switch the public upload finalizer.
begin;
create table atlas_private.workbook_audit_projections (
 audit_id uuid primary key references public.atlas_workbook_audits(audit_id),
 upload_id uuid not null unique references atlas_private.workbook_audit_uploads(upload_id),
 schema_version text not null check(schema_version='atlas.workbook-runtime-projection.v1'),
 source_hash text not null check(source_hash~'^[a-f0-9]{64}$'),
 raw_fingerprint text not null check(raw_fingerprint~'^[a-f0-9]{64}$'),
 manifest_hash text not null check(manifest_hash~'^[a-f0-9]{64}$'),
 audit_stream_hash text not null check(audit_stream_hash~'^[a-f0-9]{64}$'),
 projection_hash text not null check(projection_hash~'^[a-f0-9]{64}$'),
 runtime_projection jsonb not null,
 global_validation jsonb not null,
 section_counts jsonb not null,
 validation_state text not null check(validation_state in ('validated','blocked','needs_authority_review'))
);
alter table atlas_private.workbook_audit_projections enable row level security;
revoke all on atlas_private.workbook_audit_projections from public,anon,authenticated;
create trigger workbook_audit_projection_immutable before update or delete on atlas_private.workbook_audit_projections for each row execute function atlas_private.finance_immutable();

-- Every raw cell/node/edge is inspected, including inactive and excluded rows.
-- Typed relational rows replace a monolithic graph JSONB object. Range coverage
-- uses the COMPLETE cell inventory, never the filtered authority input below.
create function atlas_private.workbook_global_validation_raw(p_audit json) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb; scoped boolean:=coalesce(p_audit->'authorityScope'->>'type'='selected_cells_and_dependencies',false);
begin
 if p_audit->>'schemaVersion' is distinct from 'atlas.workbook-integrity.v1'
 or json_typeof(p_audit->'inventory'->'sheets') is distinct from 'array'
 or json_typeof(p_audit->'graph'->'nodes') is distinct from 'array'
 or json_typeof(p_audit->'graph'->'edges') is distinct from 'array' then
  raise exception 'Complete workbook inventory and dependency graph required';
 end if;
 with sheets as materialized (select s.value->>'name' name,s.value sheet from json_array_elements(p_audit->'inventory'->'sheets') s),
 cells as materialized (select s.name sheet,c.value->>'id' id,c.value->>'address' address,c.value->>'formula' formula,(c.value->>'row')::integer row_number,(c.value->>'column')::integer column_number from sheets s cross join lateral json_array_elements(s.sheet->'cells') c),
 nodes as materialized (select n.value->>'id' id,n.value->>'sheet' sheet,n.value->>'address' address,n.value->>'formula' formula,n.value->>'kind' kind,n.value->>'start' first,n.value->>'end' last from json_array_elements(p_audit->'graph'->'nodes') n),
 edges as materialized (select e.value->>'from' src,e.value->>'to' dst from json_array_elements(p_audit->'graph'->'edges') e),
 required as materialized (select value id from json_array_elements_text(coalesce(p_audit->'authorityScope'->'requiredNodes','[]'::json))),
 selected as materialized (select value id from json_array_elements_text(coalesce(p_audit->'authorityScope'->'selectedCells','[]'::json))),
 names as materialized (select d.value->>'name' name,'@name:'||coalesce(d.value->>'sheet','*')||'!'||(d.value->>'name') id,d.value->>'reference' reference from json_array_elements(coalesce(p_audit->'inventory'->'definedNames','[]'::json)) d),
 ranges as materialized (select n.*,case when first~'^[A-Za-z]{1,3}[1-9][0-9]{0,6}$' then atlas_private.workbook_column_number(regexp_replace(first,'[0-9]','','g')) end c1,case when first~'^[A-Za-z]{1,3}[1-9][0-9]{0,6}$' then regexp_replace(first,'[A-Za-z]','','g')::integer end r1,case when last~'^[A-Za-z]{1,3}[1-9][0-9]{0,6}$' then atlas_private.workbook_column_number(regexp_replace(last,'[0-9]','','g')) end c2,case when last~'^[A-Za-z]{1,3}[1-9][0-9]{0,6}$' then regexp_replace(last,'[A-Za-z]','','g')::integer end r2 from nodes n where kind='range'),
 active_ranges as materialized (select r.* from ranges r join required a on a.id=r.id where scoped),
 range_members as materialized (select r.id src,c.id dst from active_ranges r join cells c on c.sheet=r.sheet and c.row_number between r.r1 and r.r2 and c.column_number between r.c1 and r.c2 where scoped),
 counts as (select (select count(*) from cells) cells,(select count(*) from cells where coalesce(formula,'')<>'') formulas,(select count(*) from nodes) nodes,(select count(*) from edges) edges,(select count(*) from sheets) sheets),
 defects(code,message) as (
 select 'workbook_graph_limit','Workbook graph exceeds complete validation bounds.' from counts where nodes>750000 or edges>500000
 union all select 'workbook_node_binding','A workbook source cell does not match its retained dependency node.' where exists(select 1 from cells c left join nodes n on n.id=c.sheet||'!'||(c.address) where c.id is distinct from c.sheet||'!'||(c.address) or n.id is null or n.sheet is distinct from c.sheet or n.address is distinct from c.address or coalesce(n.formula,'') is distinct from coalesce(c.formula,''))
 union all select 'workbook_inventory_count','Workbook cell/formula counts do not match the complete retained inventory.' from counts where (p_audit->'summary'->>'populatedCells')::integer is distinct from cells or (p_audit->'summary'->>'formulas')::integer is distinct from formulas
 union all select 'workbook_duplicate_node','Dependency node identifiers must be unique.' where exists(select 1 from nodes group by id having count(*)>1) or exists(select 1 from nodes where id is null)
 union all select 'workbook_duplicate_cell','Source cell identifiers must be unique.' where exists(select 1 from cells group by id having count(*)>1)
 union all select 'workbook_name_binding','An inventoried defined name is missing or changed in the dependency graph.' where (select count(*) from names d left join nodes n on n.id=d.id where n.id is null or n.formula is distinct from d.reference)>0
 union all select 'workbook_edge_invalid','Dependency edge references a missing graph node.' where exists(select 1 from edges e left join nodes a on a.id=e.src left join nodes b on b.id=e.dst where a.id is null or b.id is null)
 union all select 'workbook_range_binding','Range bounds do not match their canonical node identifier.' where exists(select 1 from ranges where id is distinct from '@range:'||sheet||'!'||first||':'||last or c1 is null or c2 is null or r1 is null or r2 is null or c1>c2 or r1>r2)
 union all select 'workbook_scope_invalid','Every authoritative source cell must belong to the retained dependency scope.' where scoped and (json_array_length(coalesce(p_audit->'authorityScope'->'selectedCells','[]'::json))=0 or exists(select 1 from selected s left join required r on r.id=s.id left join cells c on c.id=s.id where r.id is null or c.id is null) or exists(select 1 from required r left join nodes n on n.id=r.id where n.id is null))
 union all select 'workbook_scope_incomplete','Authoritative scope omitted a formula dependency.' where scoped and exists(select 1 from edges e join required r on r.id=e.src left join required t on t.id=e.dst where t.id is null)
 union all select 'workbook_range_cell_omitted','An authoritative range omitted a populated source cell.' where scoped and exists(select 1 from range_members r left join edges e on e.src=r.src and e.dst=r.dst where e.src is null)
 )
 select jsonb_build_object('issues',(select coalesce(jsonb_agg(jsonb_build_object('code',code,'severity','error','message',message)),'[]'::jsonb) from defects),'counts',to_jsonb(counts)) into result from counts;
 return result;
end;$$;

-- Keep every cell field and all inventory context. Only layout-only sheet
-- row/column metadata and rowInventory are raw-only, alongside the full graph.
-- The distinct schema intentionally fails a complete-evidence hash validator.
create function atlas_private.workbook_runtime_projection_raw(p_audit json) returns jsonb
language plpgsql immutable set search_path='' as $$
declare inventory jsonb; sheets jsonb; top jsonb;
begin
 select coalesce(jsonb_object_agg(key,value::jsonb),'{}') into inventory from json_each(p_audit->'inventory') where key<>'sheets';
 select coalesce(jsonb_agg(x.sheet order by x.ordinality),'[]') into sheets from (
  select s.ordinality,(select coalesce(jsonb_object_agg(key,value::jsonb),'{}') from json_each(s.value) where key not in ('cells','rowMetadata','columnMetadata','rowInventory'))||jsonb_build_object('cells',(select coalesce(jsonb_agg(c.value::jsonb order by c.ordinality),'[]') from json_array_elements(s.value->'cells') with ordinality c)) sheet
  from json_array_elements(p_audit->'inventory'->'sheets') with ordinality s
 )x;
 select coalesce(jsonb_object_agg(key,value::jsonb),'{}') into top from json_each(p_audit) where key in ('fingerprint','previousFingerprint','findings','summary','authorityScope');
 return top||jsonb_build_object('schemaVersion','atlas.workbook-runtime-projection.v1','evidenceSchemaVersion','atlas.workbook-integrity.v1','inventory',inventory||jsonb_build_object('sheets',sheets),'completeEvidence',false,'rawOnlySections',jsonb_build_array('graph','rowCoverage','inventory.sheets[].rowMetadata','inventory.sheets[].columnMetadata','inventory.sheets[].rowInventory'));
end;$$;

-- Only this internal, already globally checked input is passed to the existing
-- dependency validator. Its counts describe its own filtered source cells.
-- Supplemental defined names retain exact bindings but remain inactive unless
-- in the original requiredNodes. Every worksheet remains available by name.
create function atlas_private.workbook_authority_input_raw(p_audit json,p_runtime jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare scoped boolean:=coalesce(p_audit->'authorityScope'->>'type'='selected_cells_and_dependencies',false);required jsonb;nodes jsonb;edges jsonb;sheets jsonb;n integer;f integer;result jsonb;
begin
 select coalesce(jsonb_object_agg(value,true),'{}') into required from json_array_elements_text(coalesce(p_audit->'authorityScope'->'requiredNodes','[]'::json));
 select coalesce(jsonb_agg(n.value::jsonb),'[]') into nodes from json_array_elements(p_audit->'graph'->'nodes')n where not scoped or required ? (n.value->>'id') or (n.value->>'id') like '@name:%';
 select coalesce(jsonb_agg(e.value::jsonb),'[]') into edges from json_array_elements(p_audit->'graph'->'edges')e where not scoped or required ? (e.value->>'from');
 select coalesce(jsonb_agg((s.value-'cells')||jsonb_build_object('cells',(select coalesce(jsonb_agg(c.value),'[]') from jsonb_array_elements(s.value->'cells') c where not scoped or required ? (c.value->>'id'))) order by s.ordinality),'[]') into sheets from jsonb_array_elements(p_runtime->'inventory'->'sheets') with ordinality s;
 select count(*),count(*) filter(where coalesce(c.value->>'formula','')<>'') into n,f from jsonb_array_elements(sheets)s cross join lateral jsonb_array_elements(s->'cells')c;
 result:=(p_runtime-'completeEvidence'-'rawOnlySections'-'evidenceSchemaVersion')||jsonb_build_object('schemaVersion','atlas.workbook-integrity.v1','internalValidationInput',true,'inventory',(p_runtime->'inventory')||jsonb_build_object('sheets',sheets),'graph',jsonb_build_object('nodes',nodes,'edges',edges),'summary',jsonb_build_object('populatedCells',n,'formulas',f));
 return result;
end;$$;

create function atlas_private.prepare_workbook_projection_raw(p_audit json,p_verified_fingerprint text) returns jsonb
language plpgsql immutable set search_path='' as $$
declare global_result jsonb;runtime jsonb;issues jsonb;declared jsonb;authority jsonb;state text;scoped boolean:=coalesce(p_audit->'authorityScope'->>'type'='selected_cells_and_dependencies',false);active_nodes integer;
begin
 if coalesce(p_verified_fingerprint,'')!~'^[a-f0-9]{64}$' or p_audit->>'fingerprint' is distinct from p_verified_fingerprint then raise exception 'Independently verified raw workbook fingerprint required';end if;
 global_result:=atlas_private.workbook_global_validation_raw(p_audit);
 runtime:=atlas_private.workbook_runtime_projection_raw(p_audit);
 issues:=global_result->'issues';
 if p_audit->'inventory'->>'packageMetadataAvailable' is distinct from 'true' then issues:=issues||atlas_private.planning_issue('workbook_package_required','Retain original workbook package metadata before approval.');end if;
 select coalesce(jsonb_agg(jsonb_build_object('code','workbook_'||(f.value->>'code'),'severity','error','message',coalesce(f.value->>'reason','Workbook integrity blocker'),'findingId',f.value->>'id')),'[]') into declared from json_array_elements(coalesce(p_audit->'findings','[]'::json))f where f.value->>'severity'='blocking';
 issues:=issues||declared;
 active_nodes:=case when scoped then json_array_length(p_audit->'authorityScope'->'requiredNodes') else (global_result->'counts'->>'nodes')::integer end;
 if jsonb_array_length(issues)>0 then state:='blocked';
 elsif active_nodes>10000 then
  state:='needs_authority_review';issues:=issues||atlas_private.planning_issue('workbook_authority_review_required','Complete evidence is retained. Select and review a bounded authority scope before approval.');
 else
  authority:=atlas_private.workbook_authority_input_raw(p_audit,runtime);
  issues:=atlas_private.workbook_integrity_issues_verified(authority,p_verified_fingerprint);
  state:=case when jsonb_array_length(issues)=0 then 'validated' else 'blocked' end;
 end if;
 runtime:=runtime||jsonb_build_object('validationState',state,'safeToApprove',state='validated');
 return jsonb_build_object('runtime',runtime,'globalValidation',global_result->'issues','counts',global_result->'counts','issues',issues,'state',state,'projectionHash',encode(sha256(convert_to(atlas_private.workbook_canonical_json(runtime),'UTF8')),'hex'));
end;$$;

-- Owner-only candidate: public finalization is still unchanged after this file.
create function atlas_private.finalize_workbook_audit_upload_projected(p_upload_id uuid,p_request_id uuid,p_manifest_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u atlas_private.workbook_audit_uploads;a public.atlas_workbook_audits;data bytea;audit json;prepared jsonb;fp text;result jsonb;s text;spec jsonb;n integer;new_id uuid;
begin
 select * into u from atlas_private.workbook_audit_uploads where upload_id=p_upload_id for update;
 if auth.uid() is null or u.owner_id is distinct from auth.uid() or not atlas_private.workbook_upload_authorized(u.community_id) or u.request_id is distinct from p_request_id or u.manifest_hash is distinct from p_manifest_hash then raise exception 'Workbook upload request, manifest or authorization mismatch';end if;
 if u.canceled_at is not null then raise exception 'Canceled workbook upload cannot finalize';end if;
 if u.audit_id is not null then
  perform atlas_private.authorize_workbook_audit_read(u.audit_id);
  select jsonb_build_object('audit_id',saved.audit_id,'source_hash',saved.source_hash,'fingerprint',saved.fingerprint,'manifest_hash',u.manifest_hash) into result from public.atlas_workbook_audits saved where saved.audit_id=u.audit_id;
  return result;
 end if;
 foreach s in array array['audit','source'] loop
  spec:=u.manifest->s;
  select count(*),string_agg(payload,''::bytea order by chunk_index) into n,data from atlas_private.workbook_audit_chunks where upload_id=p_upload_id and stream=s;
  if n<>(spec->>'chunkCount')::integer or octet_length(data) is distinct from (spec->>'byteLength')::integer or encode(sha256(data),'hex') is distinct from spec->>'sha256' then raise exception 'Workbook stream is incomplete or failed exact hash verification';end if;
  if s='audit' then audit:=convert_from(data,'UTF8')::json;end if;
 end loop;
 data:=null;
 if audit->>'fingerprint' is distinct from u.manifest->>'fingerprint' or audit->'inventory'->>'sourceHash' is distinct from u.manifest->>'sourceHash' then raise exception 'Workbook audit differs from manifest';end if;
 -- The canonical text is local to the helper and released before projection.
 fp:=atlas_private.workbook_audit_fingerprint_raw(audit);
 if fp is distinct from u.manifest->>'fingerprint' then raise exception 'Workbook audit fingerprint does not match retained evidence';end if;
 -- Serialize both duplicate requests and independently equivalent manifests.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||fp,0));
 select * into a from public.atlas_workbook_audits where owner_id=auth.uid() and request_id=p_request_id;
 if found and (a.source_hash is distinct from u.manifest->>'sourceHash' or a.fingerprint is distinct from fp) then raise exception 'Workbook request ID reused with different evidence';end if;
 if a.audit_id is null then select * into a from public.atlas_workbook_audits where owner_id=auth.uid() and source_hash=u.manifest->>'sourceHash' and fingerprint=fp;end if;
 if a.audit_id is null then
  prepared:=atlas_private.prepare_workbook_projection_raw(audit,fp);new_id:=gen_random_uuid();
  insert into public.atlas_workbook_audits(audit_id,source_hash,fingerprint,owner_id,request_id,evidence,server_validation) values(new_id,u.manifest->>'sourceHash',fp,auth.uid(),p_request_id,jsonb_build_object('schemaVersion','atlas.workbook-evidence-manifest.v2','completeEvidence',false,'uploadId',u.upload_id,'manifestHash',u.manifest_hash,'sourceHash',u.manifest->>'sourceHash','fingerprint',fp,'auditStreamHash',u.manifest->'audit'->>'sha256','projectionHash',prepared->>'projectionHash','runtimeProjectionSchemaVersion','atlas.workbook-runtime-projection.v1','validationState',prepared->>'state'),prepared->'issues') returning * into a;
  insert into atlas_private.workbook_audit_projections(audit_id,upload_id,schema_version,source_hash,raw_fingerprint,manifest_hash,audit_stream_hash,projection_hash,runtime_projection,global_validation,section_counts,validation_state) values(a.audit_id,u.upload_id,'atlas.workbook-runtime-projection.v1',a.source_hash,fp,u.manifest_hash,u.manifest->'audit'->>'sha256',prepared->>'projectionHash',prepared->'runtime',prepared->'globalValidation',prepared->'counts',prepared->>'state');
 end if;
 if u.community_id is not null then perform public.atlas_bind_workbook_audit(a.audit_id,u.community_id);end if;
 update atlas_private.workbook_audit_uploads set audit_id=a.audit_id,finalized_at=now() where upload_id=u.upload_id;
 return jsonb_build_object('audit_id',a.audit_id,'source_hash',a.source_hash,'fingerprint',a.fingerprint,'owner_id',a.owner_id,'created_at',a.created_at,'manifest_hash',u.manifest_hash);
end;$$;

create function atlas_private.resolve_workbook_audit_projected(r jsonb,source_hash text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a public.atlas_workbook_audits;p atlas_private.workbook_audit_projections;u atlas_private.workbook_audit_uploads;
begin
 if r->>'auditId' is null then if r->'inventory'->>'sourceHash' is distinct from source_hash then raise exception 'Workbook audit source hash mismatch';end if;return r;end if;
 select * into a from public.atlas_workbook_audits where audit_id=(r->>'auditId')::uuid;
 if a.audit_id is null or a.source_hash is distinct from source_hash or a.fingerprint is distinct from r->>'fingerprint' or (auth.uid() is not null and a.owner_id<>auth.uid() and not exists(select 1 from public.atlas_workbook_audit_scopes s where s.audit_id=a.audit_id and (atlas_private.command_access(s.community_id) or atlas_private.reforecast_access(s.community_id,'read')))) then raise exception 'Workbook audit source, fingerprint or authorization mismatch';end if;
 if a.evidence->>'schemaVersion' is distinct from 'atlas.workbook-evidence-manifest.v2' then return a.evidence;end if;
 -- A descriptor must never be consumed as complete legacy inline evidence.
 if coalesce(r->>'manifestHash','')!~'^[a-f0-9]{64}$' or not exists(select 1 from atlas_private.workbook_audit_uploads x where x.audit_id=a.audit_id and x.manifest_hash=r->>'manifestHash') then raise exception 'Complete workbook manifest reference required for raw evidence';end if;
 select * into p from atlas_private.workbook_audit_projections where audit_id=a.audit_id;
 select * into u from atlas_private.workbook_audit_uploads where upload_id=p.upload_id;
 if p.audit_id is null or p.source_hash is distinct from a.source_hash or p.raw_fingerprint is distinct from a.fingerprint or p.projection_hash is distinct from a.evidence->>'projectionHash' or p.manifest_hash is distinct from a.evidence->>'manifestHash' or u.audit_id is distinct from a.audit_id or u.manifest_hash is distinct from p.manifest_hash or u.manifest->'audit'->>'sha256' is distinct from p.audit_stream_hash or u.manifest->>'sourceHash' is distinct from a.source_hash or u.manifest->>'fingerprint' is distinct from a.fingerprint or a.evidence->>'uploadId' is distinct from p.upload_id::text or a.evidence->>'auditStreamHash' is distinct from p.audit_stream_hash or a.evidence->>'runtimeProjectionSchemaVersion' is distinct from p.schema_version or a.evidence->>'validationState' is distinct from p.validation_state or p.runtime_projection->>'validationState' is distinct from p.validation_state or p.runtime_projection->>'fingerprint' is distinct from a.fingerprint or p.runtime_projection->'inventory'->>'sourceHash' is distinct from a.source_hash or p.runtime_projection->>'schemaVersion' is distinct from p.schema_version then raise exception 'Workbook projection binding failed';end if;
 return p.runtime_projection;
end;$$;
revoke all on function atlas_private.workbook_global_validation_raw(json),atlas_private.workbook_runtime_projection_raw(json),atlas_private.workbook_authority_input_raw(json,jsonb),atlas_private.prepare_workbook_projection_raw(json,text),atlas_private.finalize_workbook_audit_upload_projected(uuid,uuid,text),atlas_private.resolve_workbook_audit_projected(jsonb,text) from public,anon,authenticated;
commit;
