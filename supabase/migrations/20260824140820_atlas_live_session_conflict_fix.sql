create or replace function atlas_upsert_live_session(
  p_session_id text,
  p_current_tab text default null,
  p_current_page text default null,
  p_current_community_id uuid default null,
  p_current_community_name text default null,
  p_user_agent text default null
)
returns table(session_id text, user_id uuid, email text, display_name text, role text, current_page text, current_community_name text, last_seen_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile atlas_user_profiles%rowtype;
  v_session_id text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required for Atlas live presence.' using errcode = '28000';
  end if;

  select *
  into v_profile
  from atlas_user_profiles aup
  where aup.user_id = auth.uid()
    and aup.status = 'active';

  if v_profile.user_id is null then
    raise exception 'An active Atlas user profile is required for live presence.' using errcode = '42501';
  end if;

  v_session_id := nullif(trim(coalesce(p_session_id, '')), '');
  if v_session_id is null then
    v_session_id := auth.uid()::text;
  end if;

  insert into atlas_live_sessions(
    session_id, user_id, email, display_name, role, current_tab, current_page,
    current_community_id, current_community_name, user_agent, signed_in_at, last_seen_at
  )
  values (
    v_session_id,
    v_profile.user_id,
    v_profile.email,
    v_profile.display_name,
    v_profile.role,
    p_current_tab,
    p_current_page,
    p_current_community_id,
    p_current_community_name,
    left(coalesce(p_user_agent, ''), 500),
    now(),
    now()
  )
  on conflict on constraint atlas_live_sessions_pkey do update
    set email = excluded.email,
        display_name = excluded.display_name,
        role = excluded.role,
        current_tab = excluded.current_tab,
        current_page = excluded.current_page,
        current_community_id = excluded.current_community_id,
        current_community_name = excluded.current_community_name,
        user_agent = excluded.user_agent,
        last_seen_at = now()
  where atlas_live_sessions.user_id = auth.uid();

  return query
  select s.session_id, s.user_id, s.email, s.display_name, s.role, s.current_page, s.current_community_name, s.last_seen_at
  from atlas_live_sessions s
  where s.session_id = v_session_id;
end;
$$;

create or replace function atlas_end_live_session(p_session_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;
  delete from atlas_live_sessions als
  where als.session_id = p_session_id
    and als.user_id = auth.uid();
  return true;
end;
$$;

revoke execute on function atlas_upsert_live_session(text,text,text,uuid,text,text) from public;
revoke execute on function atlas_upsert_live_session(text,text,text,uuid,text,text) from anon;
revoke execute on function atlas_end_live_session(text) from public;
revoke execute on function atlas_end_live_session(text) from anon;
grant execute on function atlas_upsert_live_session(text,text,text,uuid,text,text) to authenticated;
grant execute on function atlas_end_live_session(text) to authenticated;