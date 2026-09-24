create policy "atlas users update own live session"
  on public.atlas_live_sessions
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());