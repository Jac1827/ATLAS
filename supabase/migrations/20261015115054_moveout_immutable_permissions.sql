-- Supabase default privileges can grant service_role ALL at creation.
-- Reset inherited creation grants before declaring the exact required privileges.
revoke all on public.atlas_moveout_states, public.atlas_moveout_state_revisions, public.atlas_moveout_photos from service_role;
grant select,insert,update on public.atlas_moveout_states to service_role;
grant select,insert on public.atlas_moveout_state_revisions,public.atlas_moveout_photos to service_role;
