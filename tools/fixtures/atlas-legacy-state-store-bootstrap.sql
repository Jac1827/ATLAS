-- Local/test prerequisite only. Do not run against production or record as a historical migration.
-- Production catalog confirms this legacy table predates its first recorded reference:
-- 20260824141549_atlas_security_advisor_hardening_phase1.sql.
-- No state payloads are copied. The historical migration subsequently denies client access.
create schema atlas;
create table atlas.state_store (
  scope text not null,
  state_key text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (scope, state_key)
);
