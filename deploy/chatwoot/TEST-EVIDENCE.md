# Resident Communications validation — 2026-10-06

This evidence concerns local source, synthetic residents, disposable database fixtures, and mocked provider responses. No production database migration, provider message, secret configuration, or deployment was performed.

## Focused acceptance

- `tools/resident-communications.test.mjs`: authentication, inactive/expired accounts, role/page locks, scoped conversations, forged routing claims, quiet hours including timezone boundaries and daylight saving, consent and opt-out, exact raw-body HMAC, stale/replayed webhooks, minimal browser responses, body-free persistence, idempotency, read-only gates, early STOP during upstream failure, and actual Worker dispatch/preflight.
- `tools/resident-communications-db.test.cjs`: complete migration-history replay in PGlite; community, market, region, role, and page restrictions; denied browser writes and service-only reads/RPCs; identity foreign keys; atomic receipt deduplication; delivery failure per message; reminder conditions; STOP without prior consent; identifier-only schema.
- `tools/resident-communications-entrata.test.cjs`: monthly source publication preserves explicit person/resident IDs; Application ID never becomes person identity; operator-reviewed current lease and endpoint hashes; expired reviews; upload idempotency; changed/deleted/equal-date-conflicting snapshots; conflicting source keys; browser verification denied. Identity reads are exercised as `service_role`, rather than only as the database owner.
- `tools/resident-communications-browser.test.mjs`: Playwright with synthetic scoped APIs/stream; keyboard/focus, mobile layout, loading/empty/error/expired-session states, escaped history, disabled send explanations, internal notes, live scoped badge changes, and stale-response rejection after session changes.

## Packaging and configuration

The isolated current static package contains 699 files. Release hash: `2a5c45e1d2091aabc08353865dee7fc7d97ebb37678f1e75acf185bc7b8d9606`.

Wrangler dry-run with the isolated static package passed: Worker 1091.27 KiB, gzip 281.76 KiB. All communications activation flags remain false. Browser source/bundle checks must pass without Chatwoot/Twilio/Microsoft/service-role credentials. The Worker bundle is server-only and is not a public asset.

Compose YAML parsed successfully with exactly PostgreSQL, Redis, web, worker, and proxy services. The logging initializer passed Ruby syntax validation. Docker is unavailable in this environment; container startup, pinned-release compatibility, private storage, TLS, and restore drills are unverified.

The normal retained-release packaging path stopped at its existing file-count guard: 20,013 files exceeds the 19,900 safety limit. No retained release was pruned and no capacity guard was weakened. Deployment requires a separately reviewed retention/capacity solution. The isolated package proves current-source packaging only and does not substitute for the production retained-release pipeline.

## Regression result

Final stable-source run: **387 test files discovered; 385 passed; 0 failed; 2 skipped**. The skipped tests require unavailable private fiscal-budget and delinquency workbooks. `sourceChangedDuringRun` is **false**.

Input source fingerprint: `fdad71935ba7839b04faa4ceb473174bfbbd7ee14329f3fb22ca2699f644284b`. Detailed ignored logs are under `output/resident-communications-validation/verified-final-suite/`; the runner records source fingerprints so source changes cannot masquerade as a stable acceptance run.

## External acceptance still required

Validate the first actual monthly Entrata workbook, its stable person/resident keys, current-lease semantics, source-effective date, endpoint evidence, and move-out behavior. Load reviewed identity/routing/consent/agent configuration through protected server operations. No source sample or approved endpoint attestations were supplied.

Microsoft 365 Central@risere.com inbound/outbound threading and Twilio inbound/outbound/STOP/delivery callbacks require a real isolated test environment. Production domain, account/inboxes, secrets, sending numbers, approved routes, each community timezone, explicit morning resume time, reminder thresholds, compliance approval, restore evidence, and security review remain required.

Attachments remain blocked until an approved scanning/quarantine and authenticated streaming path exists. Exports contain scoped metadata only. Browser alert refresh uses a JWT-authenticated Worker stream with scoped reads every two seconds; instantaneous webhook push is not implemented. Monthly email ingestion is a future integration, not an enabled schedule.
