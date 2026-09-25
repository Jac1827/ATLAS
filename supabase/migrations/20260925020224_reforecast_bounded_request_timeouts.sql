-- A complete reviewed workbook is one atomic transaction. PostgREST hoists
-- these function settings for the named RPC only; ordinary role/database
-- limits, lock timeouts, authorization and receipt-first retry rules remain.
-- The actual-file local volume proof exceeds the default authenticated 8s
-- limit. Keep a finite budget below the REST API's 60s ceiling.
-- https://supabase.com/docs/guides/database/postgres/timeouts#function-level
begin;
alter function public.atlas_create_reforecast_from_import(uuid,uuid,integer,uuid,uuid,jsonb,jsonb) set statement_timeout='45s';
alter function public.atlas_save_reforecast_scenario(uuid,uuid,integer,uuid,text,jsonb) set statement_timeout='45s';
alter function public.atlas_stage_reforecast_payload(uuid,uuid,text,jsonb,text,integer,text,text) set statement_timeout='45s';
alter function public.atlas_finalize_workbook_audit_upload(uuid,uuid,text) set statement_timeout='45s';
alter function public.atlas_save_workbook_audit(uuid,text,jsonb,uuid) set statement_timeout='45s';
notify pgrst, 'reload schema';
commit;
