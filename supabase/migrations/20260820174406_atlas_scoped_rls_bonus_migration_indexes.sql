create policy "atlas bonus periods role read"
on atlas_bonus_periods for select to authenticated
using (atlas_has_role(array['admin','executive','regional','community_manager','bonus','finance']));

create policy "atlas bonus writes periods"
on atlas_bonus_periods for all to authenticated
using (atlas_has_role(array['admin','bonus']))
with check (atlas_has_role(array['admin','bonus']));

create policy "atlas incentive plans role read"
on atlas_incentive_plans for select to authenticated
using (deleted_at is null and atlas_has_role(array['admin','executive','regional','community_manager','bonus','finance']));

create policy "atlas bonus writes incentive plans"
on atlas_incentive_plans for all to authenticated
using (atlas_has_role(array['admin','bonus']))
with check (atlas_has_role(array['admin','bonus']));

create policy "atlas bonus runs scoped read"
on atlas_bonus_calculation_runs for select to authenticated
using (
  deleted_at is null
  and (
    atlas_has_role(array['admin','executive','bonus','finance'])
    or atlas_can_access_community(community_id)
  )
);

create policy "atlas bonus writes runs"
on atlas_bonus_calculation_runs for all to authenticated
using (atlas_has_role(array['admin','bonus','finance']))
with check (atlas_has_role(array['admin','bonus','finance']));

create policy "atlas bonus lines scoped read"
on atlas_bonus_calculation_lines for select to authenticated
using (
  deleted_at is null
  and (
    atlas_has_role(array['admin','executive','bonus','finance'])
    or exists (
      select 1 from atlas_bonus_calculation_runs r
      where r.bonus_calculation_run_id = atlas_bonus_calculation_lines.bonus_calculation_run_id
        and r.deleted_at is null
        and atlas_can_access_community(r.community_id)
    )
    or exists (
      select 1 from atlas_employee_assignments a
      where a.assignment_id = atlas_bonus_calculation_lines.assignment_id
        and a.deleted_at is null
        and atlas_can_access_community(a.community_id)
    )
  )
);

create policy "atlas bonus writes lines"
on atlas_bonus_calculation_lines for all to authenticated
using (atlas_has_role(array['admin','bonus','finance']))
with check (atlas_has_role(array['admin','bonus','finance']));

create policy "atlas migration runs admin executive read"
on atlas_migration_runs for select to authenticated
using (atlas_has_role(array['admin','executive']));

create policy "atlas admin manages migration runs"
on atlas_migration_runs for all to authenticated
using (atlas_has_role(array['admin']))
with check (atlas_has_role(array['admin']));

create policy "atlas snapshots admin executive read"
on atlas_legacy_snapshots for select to authenticated
using (atlas_has_role(array['admin','executive']));

create policy "atlas admin manages immutable legacy snapshots"
on atlas_legacy_snapshots for all to authenticated
using (atlas_has_role(array['admin']))
with check (atlas_has_role(array['admin']));

create policy "atlas mapping logs admin executive read"
on atlas_mapping_log for select to authenticated
using (atlas_has_role(array['admin','executive']));

create policy "atlas admin manages mapping logs"
on atlas_mapping_log for all to authenticated
using (atlas_has_role(array['admin']))
with check (atlas_has_role(array['admin']));

create unique index if not exists idx_atlas_community_aliases_source_alias
on atlas_community_aliases(source_module, lower(alias));

create index if not exists idx_atlas_app_documents_key
on atlas_app_documents(document_key, deleted_at);

create index if not exists idx_atlas_app_document_versions_key
on atlas_app_document_versions(document_key, version desc);

create index if not exists idx_atlas_employee_assignments_effective
on atlas_employee_assignments(employee_id, community_id, effective_start, effective_end);

create index if not exists idx_atlas_marketing_metrics_period
on atlas_marketing_metrics(community_id, period_key, metric_key, approved);

create index if not exists idx_atlas_budget_lines_period
on atlas_budget_lines(community_id, period_key, account_code);

create index if not exists idx_atlas_actual_lines_period
on atlas_actual_lines(community_id, period_key, account_code);

create index if not exists idx_atlas_mapping_log_source
on atlas_mapping_log(source_module, source_entity, source_identifier);
