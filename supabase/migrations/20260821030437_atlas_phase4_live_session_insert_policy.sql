create policy "atlas users insert own live session"
  on public.atlas_live_sessions
  for insert
  to authenticated
  with check (user_id = auth.uid());