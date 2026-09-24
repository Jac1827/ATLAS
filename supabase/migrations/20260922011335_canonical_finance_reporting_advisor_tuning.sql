begin;
create index if not exists atlas_approved_budget_versions_approved_by_idx on public.atlas_approved_budget_versions(approved_by);
alter policy finance_registry_read on public.atlas_financial_metric_registry using ((select auth.uid()) is not null);
commit;