drop policy if exists "atlas shared owners manage mapping reviews" on atlas_mapping_review_queue;

drop policy if exists "atlas shared owners insert mapping reviews" on atlas_mapping_review_queue;
create policy "atlas shared owners insert mapping reviews"
on atlas_mapping_review_queue for insert to authenticated
with check (atlas_has_role(array['admin','operations','marketing','people']));

drop policy if exists "atlas shared owners update mapping reviews" on atlas_mapping_review_queue;
create policy "atlas shared owners update mapping reviews"
on atlas_mapping_review_queue for update to authenticated
using (atlas_has_role(array['admin','operations','marketing','people']))
with check (atlas_has_role(array['admin','operations','marketing','people']));