grant execute on function public.atlas_current_role() to authenticated;
grant execute on function public.atlas_has_role(text[]) to authenticated;
grant execute on function public.atlas_can_write(text[]) to authenticated;
grant execute on function public.atlas_current_allowed_community_ids() to authenticated;
grant execute on function public.atlas_can_access_community(uuid) to authenticated;