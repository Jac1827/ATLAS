-- Activate only after the independent raw fingerprint/global-validation proof.
-- Existing public entrypoints, privileges and function-level timeout stay intact.
begin;
create or replace function atlas_private.finalize_workbook_audit_upload(p_upload_id uuid,p_request_id uuid,p_manifest_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 return atlas_private.finalize_workbook_audit_upload_projected(p_upload_id,p_request_id,p_manifest_hash);
end;$$;
create or replace function atlas_private.resolve_workbook_audit(r jsonb,source_hash text) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 return atlas_private.resolve_workbook_audit_projected(r,source_hash);
end;$$;
-- Preserve the legacy direct-save implementation and all of its validation.
-- Only extend its returned receipt when canonical dedupe finds a descriptor.
do $$
declare definition text;
begin
 definition:=pg_get_functiondef('public.atlas_save_workbook_audit(uuid,text,jsonb,uuid)'::regprocedure);
 definition:=replace(definition,'CREATE OR REPLACE FUNCTION public.atlas_save_workbook_audit(', 'CREATE OR REPLACE FUNCTION atlas_private.save_workbook_audit_before_projection(');
 if position('FUNCTION atlas_private.save_workbook_audit_before_projection(' in definition)=0 then raise exception 'Legacy workbook save definition not found';end if;
 execute definition;
end;$$;
revoke all on function atlas_private.save_workbook_audit_before_projection(uuid,text,jsonb,uuid) from public,anon,authenticated;
create or replace function public.atlas_save_workbook_audit(p_community_id uuid,p_source_hash text,p_audit jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' set statement_timeout='45s' as $$
declare receipt jsonb;descriptor jsonb;
begin
 receipt:=atlas_private.save_workbook_audit_before_projection(p_community_id,p_source_hash,p_audit,p_request_id);
 select evidence into descriptor from public.atlas_workbook_audits where audit_id=(receipt->>'audit_id')::uuid;
 if descriptor->>'schemaVersion'='atlas.workbook-evidence-manifest.v2' then receipt:=receipt||jsonb_build_object('manifest_hash',descriptor->>'manifestHash');end if;
 return receipt;
end;$$;
notify pgrst,'reload schema';
commit;
