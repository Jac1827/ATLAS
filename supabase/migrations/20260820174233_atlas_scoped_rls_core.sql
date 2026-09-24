alter table atlas_user_profiles enable row level security;
alter table atlas_audit_log enable row level security;
alter table atlas_app_documents enable row level security;
alter table atlas_app_document_versions enable row level security;
alter table atlas_edit_locks enable row level security;
alter table atlas_migration_runs enable row level security;
alter table atlas_legacy_snapshots enable row level security;
alter table atlas_mapping_log enable row level security;
alter table atlas_communities enable row level security;
alter table atlas_community_aliases enable row level security;
alter table atlas_roles enable row level security;
alter table atlas_employees enable row level security;
alter table atlas_employee_assignments enable row level security;
alter table atlas_budget_lines enable row level security;
alter table atlas_actual_lines enable row level security;
alter table atlas_contracts enable row level security;
alter table atlas_marketing_metrics enable row level security;
alter table atlas_maintenance_metrics enable row level security;
alter table atlas_moonrise_sync_runs enable row level security;
alter table atlas_maintenance_inspections enable row level security;
alter table atlas_maintenance_inspection_exceptions enable row level security;
alter table atlas_maintenance_inspection_snapshots enable row level security;
alter table atlas_bonus_periods enable row level security;
alter table atlas_incentive_plans enable row level security;
alter table atlas_bonus_calculation_runs enable row level security;
alter table atlas_bonus_calculation_lines enable row level security;

create policy "atlas profile self or admin read"
on atlas_user_profiles for select to authenticated
using (user_id = auth.uid() or atlas_has_role(array['admin']));

create policy "atlas admin manages profiles"
on atlas_user_profiles for all to authenticated
using (atlas_has_role(array['admin']))
with check (atlas_has_role(array['admin']));

create policy "atlas users append own audit"
on atlas_audit_log for insert to authenticated
with check (actor_user_id = auth.uid() or actor_user_id is null);

create policy "atlas audit admin executive read"
on atlas_audit_log for select to authenticated
using (atlas_has_role(array['admin','executive']));

create policy "atlas app documents admin executive read"
on atlas_app_documents for select to authenticated
using (deleted_at is null and atlas_has_role(array['admin','executive']));

create policy "atlas admin manages app documents"
on atlas_app_documents for all to authenticated
using (atlas_has_role(array['admin']))
with check (atlas_has_role(array['admin']));

create policy "atlas app document versions admin executive read"
on atlas_app_document_versions for select to authenticated
using (atlas_has_role(array['admin','executive']));

create policy "atlas admin manages app document versions"
on atlas_app_document_versions for all to authenticated
using (atlas_has_role(array['admin']))
with check (atlas_has_role(array['admin']));

create policy "atlas active users read active edit locks"
on atlas_edit_locks for select to authenticated
using (released_at is null and atlas_current_role() <> 'anonymous');

create policy "atlas users manage own edit locks"
on atlas_edit_locks for all to authenticated
using (lock_owner = auth.uid() or atlas_has_role(array['admin']))
with check (lock_owner = auth.uid() or atlas_has_role(array['admin']));
