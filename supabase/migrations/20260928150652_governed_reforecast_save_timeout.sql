-- The governed lifecycle replaced the public save wrapper after the original
-- bounded-request migration. Restore its per-RPC budget; do not change role or
-- database defaults, authorization, lock timeouts, or atomic import behavior.
-- PostgREST hoists this function setting before execution after schema reload.
-- https://supabase.com/docs/guides/database/postgres/timeouts#function-level
begin;
alter function public.atlas_save_reforecast_scenario(uuid,uuid,integer,uuid,text,jsonb) set statement_timeout='45s';
notify pgrst, 'reload schema';
commit;
