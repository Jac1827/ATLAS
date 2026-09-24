# Isolated hosted Forecast acceptance

This prepares a separate, static Cloudflare Worker for authenticated Forecast/Bonus acceptance against an **explicit isolated Supabase branch or test project**. It never deploys, creates resources, applies migrations, or seeds users/data. The production Worker, workflow, configuration and source assets are unchanged.

The current repository preview workflow uploads a version of the production Worker and retains its configured resources. It is not the isolated host described here. Use the generated configuration explicitly; do not use the repository-root `wrangler.jsonc` for this test.

## Required inputs

Provide these environment values through the local shell or test CI environment:

| Variable | Required value |
| --- | --- |
| `ATLAS_TEST_WORKER_NAME` | A new dedicated name such as `atlas-forecast-test-review1` |
| `ATLAS_TEST_APP_ORIGIN` | Its exact `https://atlas-forecast-test-review1.<account-subdomain>.workers.dev` origin |
| `ATLAS_TEST_API_ORIGIN` | The same origin; server integration endpoints return unavailable |
| `ATLAS_TEST_SUPABASE_URL` | The isolated branch/project's `https://<project-ref>.supabase.co` origin |
| `ATLAS_TEST_SUPABASE_PUBLIC_KEY` | Its browser-safe publishable key or matching `anon` JWT |

No service-role key, database password, user password, or Cloudflare token goes into these inputs or generated files. Cloudflare uses existing CLI authentication at the later deployment step. Opaque public keys cannot be matched to a project locally; verify their origin in the test project's dashboard. Known production project references, production Worker/GitHub hosts, privileged keys, incomplete inputs, and mismatched origins are rejected. Custom domains and local HTTP origins are intentionally unsupported in this bounded hosted helper.

```sh
node tools/prepare-forecast-test-host.mjs --out /tmp/atlas-forecast-test-review1
node node_modules/wrangler/bin/wrangler.js deploy --dry-run --config /tmp/atlas-forecast-test-review1/wrangler.jsonc
```

The output must be a new directory outside the repository. Preparation copies web assets, injects test settings before all HTML scripts, and switches the existing XLSX CDN reference to its repository-local copy. It does not modify source assets or their version references. Once the test environment and any associated cost are resolved, inspect the generated configuration and test project, then deploy using this separate command:

```sh
node node_modules/wrangler/bin/wrangler.js deploy --config /tmp/atlas-forecast-test-review1/wrangler.jsonc
```

Open `/__atlas_test_health` to confirm the test project reference and `/portfolio-operations-dashboard/index.html` for acceptance. The expected Worker origin is enforced; alternate version URLs deliberately fail closed. Use a fresh browser context for each role. The bootstrap replaces stale local configuration and clears credentials once when the configured project changes; reloads and child frames preserve the test login. A visible banner identifies the test environment. If browser storage is unavailable, later application scripts are blocked.

## Included and excluded paths

Password sign-in, token refresh, profile/community scope reads, Forecast/Bonus REST/RPC calls, immutable source uploads, browser document parsing, and local PDF/XLSX/CSV exports use the test database or local assets. Actual RLS/role behavior still requires the hosted acceptance run; local wiring tests mock the network.

This Worker binds only `ASSETS`. It has no email, scheduled jobs, Durable Objects, KV, R2, secrets, production proxy, or production app-server handler. `/api/*` and non-read asset requests return unavailable. Invitations, access activation/diagnostics, account recovery/magic links, report email delivery, shared sync, weather, marketing, maps and unrelated server integrations are excluded. The bootstrap blocks email-triggering Supabase Auth calls. Precreate test password accounts; signup is disabled. The CSP permits connections only to this origin and the selected test database; hardcoded legacy production connections are blocked. Font/icon styles may load from Google Fonts and unpkg; Forecast PDF libraries, parser worker and XLSX are local.

Use two fake communities and separate Admin approver, Regional editor and unrelated-community accounts for the minimum multi-user lifecycle. Full role coverage additionally needs Executive, Centra and Community Manager identities, plus an otherwise signed-in denied role. Canonical test profiles need corresponding community scope and unlocked Budget/Bonus pages. Use synthetic approved original budgets, reviewed GL mappings, eligible full-month closes and future forecast months. Three approved statements and explicit utility sources are needed only for their corresponding recommendation paths.

Bonus positive-payability acceptance additionally needs canonical synthetic employee eligibility, effective-dated assignment and plan/metric rules, a quarter's baseline/close evidence, and synthetic retained calculation receipts. Local default plan IDs do not qualify. No actual salaries, real employees or payroll actions are required. A branch copied from the current deployed schema does not by itself supply the missing canonical People/Bonus eligibility setup. The four forecast migrations do not infer eligibility. Current migration-history differences also require explicit reconciliation; do not blindly replay the entire local migration directory on a schema clone.

## Local checks

```sh
node tools/forecast-test-host.test.mjs
node tools/forecast-test-host-browser.test.mjs
```

The browser test requires Playwright (`ATLAS_PLAYWRIGHT` may point to an installed package). It intercepts every network request, exercises the real central client and local document libraries, and verifies that production requests and email/server effects are blocked. It does **not** prove hosted login, database migration applicability, hosted RLS, real role grants or payment eligibility. Those remain the authenticated isolated acceptance steps after the environment is selected.

References: [Cloudflare static asset bindings](https://developers.cloudflare.com/workers/static-assets/binding/), [Worker-first routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/), [version URLs versus isolated previews](https://developers.cloudflare.com/workers/previews/compare-workflows/), [Supabase branching](https://supabase.com/docs/guides/deployment/branching).
