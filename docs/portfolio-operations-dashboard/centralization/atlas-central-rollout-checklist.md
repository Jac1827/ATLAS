# Atlas Phase 3 Central Platform Rollout Checklist

## Database Setup

1. Confirm the hosted Supabase/Postgres project named `ATLAS`.
2. Apply `atlas-central-schema.sql` as an additive migration.
3. Confirm row-level security is enabled on every `atlas_*` table.
4. Create the first admin through Atlas > Data Import > Central Platform Control > Activate First Admin after signing in with an approved `riseresidential.com` account.
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
4. Send a login link or sign in with password.
5. If this is the first Atlas user, activate the first admin.
6. Run `Check Central`.
7. Export and upload a read-only migration snapshot.
8. Dry run People, Marketing metrics, and MSOE/SOE promotion.
9. Review reconciliation counts and totals.
10. Test rollback snapshot download.
11. Apply canonical People first, then Marketing metrics, then MSOE/SOE.
12. Save current Atlas state or enable autosave only after the safety gate is complete.

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

Atlas autosave must remain disabled until the read-only snapshot is uploaded, reconciliation is marked reviewed, and rollback snapshot testing is complete.

## Rollback

1. Keep the local rollback snapshot downloaded before every central pull.
2. If a central pull is wrong, use Data Import > Browser Data Migration to import the rollback JSON.
3. Mark the related `atlas_migration_runs` row as `blocked` or `rolled_back`.
4. Do not delete central records. Use correction runs or soft-inactive records.
5. Disable central autosave until reconciliation is repaired.
6. Keep the older whole-dashboard cloud bundle disabled only after central data has passed the safety gate.
