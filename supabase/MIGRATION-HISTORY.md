# Preserved production migration history

The September 24, 2026 reconciliation restores all 72 recorded production migrations under their actual version IDs and names. Seven existing repository files had identical SQL under different timestamps; they were renamed. The other 65 stored SQL bodies were restored. No production migration record was deleted, changed, marked applied, or replaced with a no-op.

`migration-history.json` records the original byte length, MD5 and SHA-256 read from `supabase_migrations.schema_migrations`. Each historical record contained one complete statement string. File contents preserve those bytes exactly, including whitespace. The manifest records the seven former local filenames for audit purposes.

Run `node tools/migration-history.test.mjs` before deployment. It rejects missing or changed historical bodies, duplicate version IDs and unrecorded files earlier than the captured history cutoff. New migrations with later version IDs remain allowed. Add all future changes in new CLI-generated migrations; never edit an already-applied historical body to make a deployment or fresh replay succeed.

## Sensitive content and historical effects

The restored source contains schema definitions, policies, functions and historical data-maintenance statements. Review found no embedded passwords, API keys, JWTs, private UUID identities, employee rosters, compensation values, or financial statement amounts. An email-like string is a corporate-domain authorization rule, not a recipient address. Historical community alias/coverage configuration contains operational names and reasons already present in tracked centralization SQL; no new private source documents or data exports were added.

These files are not all schema-only. Historical operations include profile-status backfills, metric-registry seeds, source-detail redaction, community alias/coverage updates and a financial projection refresh. They are preserved as executed history, not replayed against production during reconciliation. This is why real version IDs matter: the production deployment must recognize these migrations as already applied.

## Deployment and clean-environment limits

The GitHub integration must use the repository root (`.`) as its working directory and the intended production branch. The reconciled 72 versions have no historic pending work on the inspected production database. Verify the migration list before enabling automatic production deployment; any later migration is a separate reviewed change. Keep automatic preview branching disabled until its environment prerequisites and clean replay have been verified.

This is a Supabase history, not a bootstrap for a bare PostgreSQL server. Its earliest migration expects managed `auth.users`; later migrations expect `auth.uid()`, `auth.jwt()`, `anon`, `authenticated`, `service_role`, pgcrypto and the managed public-schema default grants.

One additional prerequisite predates the recorded history: the legacy `atlas.state_store` table. Production has it, but no recorded migration creates it. Migration `20260824141549_atlas_security_advisor_hardening_phase1.sql` unconditionally revokes access and creates its deny policy. Therefore a fresh Supabase database containing only the platform schemas will fail at that migration unless the legacy table is deliberately provisioned first. No fake historical version has been introduced to hide this gap.

`tools/fixtures/atlas-legacy-state-store-bootstrap.sql` documents its exact empty structure from the read-only production catalog. It is **local/test-only**, outside the migration directory, with no copied payloads. `tools/migration-history-fixture.cjs` provides managed Auth/role/default-grant and SHA-256 compatibility emulation for PGlite, then replays the exact history. `node tools/migration-history-replay.test.cjs` verifies both the expected bare-replay failure and successful 72-migration replay with the explicit prerequisite. This is not a claim that Docker Supabase reset or a hosted fresh branch has passed.

For a future empty environment, provision and review the legacy prerequisite before replay, or design a separately reviewed baseline/adoption procedure. Do not edit history, invent applied entries, or copy production users/financial data merely to make branch creation pass. Seed only explicit synthetic acceptance data after schema replay.

References: [Supabase environment management](https://supabase.com/docs/guides/deployment/managing-environments), [working with branches](https://supabase.com/docs/guides/deployment/branching/working-with-branches).
