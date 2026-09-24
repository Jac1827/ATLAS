drop policy if exists "atlas dlr snapshot writers" on atlas_dlr_snapshots;
drop policy if exists "atlas dlr subscription writers" on atlas_dlr_delivery_subscriptions;
drop policy if exists "atlas dlr delivery history writers" on atlas_dlr_delivery_history;

create policy "atlas dlr snapshot inserts"
on atlas_dlr_snapshots for insert to authenticated
with check (
  atlas_has_role(array['admin','centra','executive','finance','regional'])
  or atlas_can_access_community(community_id)
);

create policy "atlas dlr snapshot updates"
on atlas_dlr_snapshots for update to authenticated
using (
  atlas_has_role(array['admin','centra','executive','finance','regional'])
  or atlas_can_access_community(community_id)
)
with check (
  atlas_has_role(array['admin','centra','executive','finance','regional'])
  or atlas_can_access_community(community_id)
);

create policy "atlas dlr subscription inserts"
on atlas_dlr_delivery_subscriptions for insert to authenticated
with check (
  atlas_has_role(array['admin','centra','executive','finance','regional'])
  or atlas_can_access_community(community_id)
);

create policy "atlas dlr subscription updates"
on atlas_dlr_delivery_subscriptions for update to authenticated
using (
  atlas_has_role(array['admin','centra','executive','finance','regional'])
  or atlas_can_access_community(community_id)
)
with check (
  atlas_has_role(array['admin','centra','executive','finance','regional'])
  or atlas_can_access_community(community_id)
);

create policy "atlas dlr delivery history inserts"
on atlas_dlr_delivery_history for insert to authenticated
with check (atlas_has_role(array['admin','centra','executive','finance']));

create policy "atlas dlr delivery history updates"
on atlas_dlr_delivery_history for update to authenticated
using (atlas_has_role(array['admin','centra','executive','finance']))
with check (atlas_has_role(array['admin','centra','executive','finance']));

create index if not exists idx_atlas_dlr_snapshots_community_id
on atlas_dlr_snapshots(community_id);

create index if not exists idx_atlas_dlr_snapshots_prepared_by
on atlas_dlr_snapshots(prepared_by);

create index if not exists idx_atlas_dlr_snapshots_approved_by
on atlas_dlr_snapshots(approved_by);

create index if not exists idx_atlas_dlr_delivery_subscriptions_community_id
on atlas_dlr_delivery_subscriptions(community_id);

create index if not exists idx_atlas_dlr_delivery_subscriptions_last_snapshot_id
on atlas_dlr_delivery_subscriptions(last_snapshot_id);

create index if not exists idx_atlas_dlr_delivery_subscriptions_created_by
on atlas_dlr_delivery_subscriptions(created_by);

create index if not exists idx_atlas_dlr_delivery_subscriptions_updated_by
on atlas_dlr_delivery_subscriptions(updated_by);

create index if not exists idx_atlas_dlr_delivery_history_subscription_id
on atlas_dlr_delivery_history(dlr_subscription_id);

create index if not exists idx_atlas_dlr_delivery_history_community_id
on atlas_dlr_delivery_history(community_id);