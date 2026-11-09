-- Cover publication attempt foreign keys and authorized community lookups.
create index atlas_budget_builder_attempt_community on public.atlas_budget_builder_publication_attempts(community_id);
create index atlas_budget_builder_attempt_actor on public.atlas_budget_builder_publication_attempts(created_by);
