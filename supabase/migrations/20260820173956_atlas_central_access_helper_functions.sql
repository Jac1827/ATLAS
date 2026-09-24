create or replace function atlas_has_role(required_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select atlas_current_role() = any(required_roles);
$$;

create or replace function atlas_current_allowed_community_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select allowed_community_ids
    from atlas_user_profiles
    where user_id = auth.uid()
      and status = 'active'
  ), '{}'::uuid[]);
$$;

create or replace function atlas_can_access_community(p_community_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    atlas_has_role(array['admin','executive'])
    or (
      p_community_id is not null
      and p_community_id = any(atlas_current_allowed_community_ids())
    );
$$;
