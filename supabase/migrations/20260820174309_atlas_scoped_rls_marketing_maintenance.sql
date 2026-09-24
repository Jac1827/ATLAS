create policy "atlas approved marketing metrics scoped read"
on atlas_marketing_metrics for select to authenticated
using (
  deleted_at is null
  and approved is true
  and (
    atlas_has_role(array['admin','executive'])
    or (atlas_has_role(array['marketing','bonus','regional','community_manager']) and atlas_can_access_community(community_id))
  )
);

create policy "atlas marketing writes metrics"
on atlas_marketing_metrics for all to authenticated
using (atlas_has_role(array['admin','marketing']) and atlas_can_access_community(community_id))
with check (atlas_has_role(array['admin','marketing']) and atlas_can_access_community(community_id));

create policy "atlas maintenance metrics scoped read"
on atlas_maintenance_metrics for select to authenticated
using (
  deleted_at is null
  and (
    atlas_has_role(array['admin','executive'])
    or (atlas_has_role(array['maintenance','regional','community_manager']) and atlas_can_access_community(community_id))
  )
);

create policy "atlas maintenance writes metrics"
on atlas_maintenance_metrics for all to authenticated
using (atlas_has_role(array['admin','maintenance']) and atlas_can_access_community(community_id))
with check (atlas_has_role(array['admin','maintenance']) and atlas_can_access_community(community_id));

create policy "atlas moonrise sync admin maintenance read"
on atlas_moonrise_sync_runs for select to authenticated
using (atlas_has_role(array['admin','executive','maintenance']));

create policy "atlas maintenance writes moonrise sync runs"
on atlas_moonrise_sync_runs for all to authenticated
using (atlas_has_role(array['admin','maintenance']))
with check (atlas_has_role(array['admin','maintenance']));

create policy "atlas maintenance inspections scoped read"
on atlas_maintenance_inspections for select to authenticated
using (
  deleted_at is null
  and (
    atlas_has_role(array['admin','executive'])
    or (atlas_has_role(array['maintenance','regional','community_manager','viewer']) and atlas_can_access_community(community_id))
  )
);

create policy "atlas maintenance writes inspections"
on atlas_maintenance_inspections for all to authenticated
using (atlas_has_role(array['admin','maintenance']) and atlas_can_access_community(community_id))
with check (atlas_has_role(array['admin','maintenance']) and atlas_can_access_community(community_id));

create policy "atlas maintenance inspection exceptions scoped read"
on atlas_maintenance_inspection_exceptions for select to authenticated
using (
  atlas_has_role(array['admin','executive'])
  or exists (
    select 1 from atlas_maintenance_inspections i
    where i.maintenance_inspection_id = atlas_maintenance_inspection_exceptions.maintenance_inspection_id
      and i.deleted_at is null
      and atlas_can_access_community(i.community_id)
  )
);

create policy "atlas maintenance writes inspection exceptions"
on atlas_maintenance_inspection_exceptions for all to authenticated
using (atlas_has_role(array['admin','maintenance']))
with check (atlas_has_role(array['admin','maintenance']));

create policy "atlas maintenance inspection snapshots read"
on atlas_maintenance_inspection_snapshots for select to authenticated
using (read_only_locked is true and atlas_has_role(array['admin','executive','maintenance']));

create policy "atlas maintenance writes inspection snapshots"
on atlas_maintenance_inspection_snapshots for all to authenticated
using (atlas_has_role(array['admin','maintenance']))
with check (atlas_has_role(array['admin','maintenance']));
