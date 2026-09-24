create or replace function atlas_hash_payload(payload jsonb)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(digest(coalesce(payload::text, ''), 'sha256'), 'hex');
$$;