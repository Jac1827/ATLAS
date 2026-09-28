-- Activate complete immutable raw evidence with its separately validated runtime
-- projection. Keep the public finalize RPC and its existing ACL/45-second budget.
-- Preserve the legacy direct-save implementation exactly once; a replay must
-- never copy the new wrapper into its own delegate.
-- After any descriptor audit commits, retain the projected resolver and the
-- manifest-aware save wrapper during rollback. Pause new finalization instead
-- of restoring a resolver that cannot read committed descriptors. Raw streams
-- and projection rows remain immutable and must not be removed or rewritten.
begin;
do $activation$
declare
 definition text;
 active_source text;
 legacy_source text;
 wrapper_source constant text := $wrapper$
declare receipt jsonb;descriptor jsonb;
begin
 receipt:=atlas_private.save_workbook_audit_before_projection(p_community_id,p_source_hash,p_audit,p_request_id);
 select evidence into descriptor from public.atlas_workbook_audits where audit_id=(receipt->>'audit_id')::uuid;
 if descriptor->>'schemaVersion'='atlas.workbook-evidence-manifest.v2' then receipt:=receipt||jsonb_build_object('manifest_hash',descriptor->>'manifestHash');end if;
 return receipt;
end;$wrapper$;
begin
 -- Serialize deployments before inspecting the clone: otherwise a concurrent
 -- installer could replace the public body between our existence check/copy.
 perform pg_advisory_xact_lock(hashtextextended('atlas.activate_workbook_raw_evidence_projection',0));
 if to_regprocedure('atlas_private.finalize_workbook_audit_upload_projected(uuid,uuid,text)') is null
 or to_regprocedure('atlas_private.resolve_workbook_audit_projected(jsonb,text)') is null
 or to_regprocedure('atlas_private.workbook_global_validation_raw_before_typed(json)') is null then
  raise exception 'Verified raw workbook projection helpers must be installed before activation';
 end if;
 select prosrc into strict active_source from pg_proc where oid='public.atlas_save_workbook_audit(uuid,text,jsonb,uuid)'::regprocedure;
 if to_regprocedure('atlas_private.save_workbook_audit_before_projection(uuid,text,jsonb,uuid)') is null then
  if position('atlas_private.save_workbook_audit_before_projection' in active_source)>0 then
   raise exception 'Projection save wrapper exists without its preserved legacy implementation';
  end if;
  if position('public.atlas_save_workbook_audit' in active_source)>0 then raise exception 'Legacy workbook save implementation is recursive';end if;
  definition:=pg_get_functiondef('public.atlas_save_workbook_audit(uuid,text,jsonb,uuid)'::regprocedure);
  definition:=replace(definition,'CREATE OR REPLACE FUNCTION public.atlas_save_workbook_audit(', 'CREATE OR REPLACE FUNCTION atlas_private.save_workbook_audit_before_projection(');
  if position('FUNCTION atlas_private.save_workbook_audit_before_projection(' in definition)=0 then raise exception 'Legacy workbook save definition not found';end if;
  execute definition;
 else
  select prosrc into strict legacy_source from pg_proc where oid='atlas_private.save_workbook_audit_before_projection(uuid,text,jsonb,uuid)'::regprocedure;
  if position('atlas_private.save_workbook_audit_before_projection' in legacy_source)>0 or position('public.atlas_save_workbook_audit' in legacy_source)>0 then
   raise exception 'Preserved legacy workbook save implementation is recursive';
  end if;
  if btrim(active_source) is distinct from btrim(legacy_source) and btrim(active_source) is distinct from btrim(wrapper_source) then
   raise exception 'Workbook save changed since its legacy implementation was preserved';
  end if;
 end if;
 -- CREATE OR REPLACE retains the public function OID, owner and ACL. The
 -- explicit function budget matches the already deployed bounded save route.
 execute 'create or replace function public.atlas_save_workbook_audit(p_community_id uuid,p_source_hash text,p_audit jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='''' set statement_timeout=''45s'' as '||quote_literal(wrapper_source);
end;$activation$;
revoke all on function atlas_private.save_workbook_audit_before_projection(uuid,text,jsonb,uuid) from public,anon,authenticated;

create or replace function atlas_private.finalize_workbook_audit_upload(p_upload_id uuid,p_request_id uuid,p_manifest_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 return atlas_private.finalize_workbook_audit_upload_projected(p_upload_id,p_request_id,p_manifest_hash);
end;$$;
create or replace function atlas_private.resolve_workbook_audit(r jsonb,source_hash text) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 return atlas_private.resolve_workbook_audit_projected(r,source_hash);
end;$$;
notify pgrst,'reload schema';
commit;
