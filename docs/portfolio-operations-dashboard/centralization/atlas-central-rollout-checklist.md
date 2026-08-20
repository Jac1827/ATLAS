# Atlas Phase 3 Central Platform Rollout Checklist

## Database Setup

1. Create or select the hosted Supabase/Postgres project for Atlas.
2. Apply `atlas-central-schema.sql`.
3. Confirm row-level security is enabled on every `atlas_*` table.
4. Create the first admin row in `atlas_user_profiles` for the Atlas owner.
5. Confirm no service-role key is present in any public website file.

## Auth Setup

1. Enable email/password or magic-link login.
2. Restrict approved email domains in Supabase Auth settings where possible.
3. Add required users to `atlas_user_profiles` with one role:
   `admin`, `executive`, `regional`, `community_manager`, `people`, `marketing`, `maintenance`, `finance`, `bonus`, or `viewer`.
4. Test an anonymous browser: shared tables must not be readable.
5. Test each role for read/write access before production cutover.

## App Setup

1. Use `atlas-central-config.example.js` as the hosted config template.
2. Set only the public Supabase URL and public anon key.
3. Open Atlas > Data Import > Central Platform Control.
4. Sign in as an admin.
5. Run `Check Central`.
6. Export a read-only migration snapshot.
7. Upload the read-only snapshot to central Atlas.
8. Save the current Atlas state to central only after reconciliation is complete.

## Reconciliation Gate

Before enabling autosave, confirm:

- Community counts match.
- Active/inactive community counts match.
- Employee counts by status match.
- Current assignment counts by community and role match.
- Budget totals by period/community/account match.
- Actual totals by period/community/account match.
- Contract counts and amounts match.
- Marketing record counts and approved metric counts match.
- Maintenance inspection counts and exceptions match.
- Bonus eligible employee counts and payout totals match.

## Rollback

1. Keep the local rollback snapshot downloaded before every central pull.
2. If a central pull is wrong, use Data Import > Browser Data Migration to import the rollback JSON.
3. Mark the related `atlas_migration_runs` row as `blocked` or `rolled_back`.
4. Do not delete central records. Use correction runs or soft-inactive records.
5. Disable central autosave until reconciliation is repaired.
