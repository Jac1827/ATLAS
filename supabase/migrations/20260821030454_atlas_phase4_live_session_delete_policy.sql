create policy "atlas users delete own live session"
  on public.atlas_live_sessions
  for delete
  to authenticated
  using (user_id = auth.uid());