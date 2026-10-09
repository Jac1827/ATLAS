# ATLAS Resident Communications deployment and operations

Resident Communications uses a dedicated self-hosted Chatwoot environment as the conversation and message system of record. ATLAS authenticates each request, resolves canonical identity and community scope, and keeps only identifiers, consent, delivery state, alerts, and redacted audit metadata in Supabase. Production outbound messaging remains disabled until the canonical identity adapter, infrastructure, routes, consent policy, and pilots are validated.

## Deployment inputs and activation gates

The two environment inventories contain names only. Store API, webhook, origin, service-role, Microsoft, Twilio, database, Redis, object-storage, and SMTP credentials in the relevant secret manager. Never commit an environment file, backup, resident record, or provider credential. The Worker requires `CHATWOOT_API_TOKEN`, `CHATWOOT_WEBHOOK_SECRET`, and `CHATWOOT_ORIGIN_TOKEN` as secrets. Provider credentials belong in Chatwoot's encrypted configuration, not ATLAS browser settings.

Configure the approved production HTTPS origin and numeric account ID. Verify the deployed release signs account webhooks, and that its signing key matches the Worker secret. Configure the required inbox IDs and SMS sending numbers through the operator-owned routing table. Every enabled community needs a verified IANA timezone, first-response and follow-up thresholds, and an approved route. SMS additionally needs documented consent and an explicitly approved morning resume time before 19:00 local time.

Flags ship disabled in `wrangler.jsonc`. `ATLAS_COMMUNICATIONS_ENABLED` enables queue/API access; `ATLAS_COMMUNICATIONS_WRITE_ENABLED` enables agent mutations after the read-only pilot; `CHATWOOT_DEPLOYMENT_VALIDATED` requires successful infrastructure and protocol validation. `ATLAS_COMMUNICATIONS_OUTBOUND_ENABLED` and `ATLAS_COMMUNICATIONS_COMPLIANCE_APPROVED`, plus the route's channel pilot approval, enable outbound delivery. Approval records belong in the deployment change record. These flags must never be enabled merely to bypass a missing configuration error.

## Canonical identity connection

Entrata is the confirmed canonical source, initially refreshed by a monthly Resident Data workbook on the move-in cadence. Use the existing **Application / Resident Data Import** under Data Import; it preserves explicit **Person ID** and **Resident ID** columns along with Application ID, Lease ID, contact fields, and server-resolved community IDs. Application ID is never a person identity. Confirm the first actual workbook contains stable Entrata person/resident and lease keys; a workbook missing these remains usable for existing application metrics but cannot enable communication identity.

The service-only `atlas_resident_communication_identity` view joins the published source to `atlas_entrata_communication_identity_reviews` by import, application, person, lease, and canonical community IDs. An authorized server/operator process must review current-lease semantics and verified endpoints and populate the header-only `entrata-identity-review-template.csv`. Review stores IDs, evidence references, explicit validity times, and SHA-256 endpoint fingerprints, never copied endpoints. Email hashes cover the exact source email bytes; phone hashes cover the exact verified E.164 source number. Non-E.164 phone fields remain blocked. Browser uploads cannot populate verification or consent. Review expiry is explicit configuration, not a guessed monthly schedule. Only a unique latest source-effective snapshot is eligible; new, conflicting, expired, or deleted snapshots invalidate the previous linkage. Conflicting Person/Resident IDs or multiple source rows for a person require review. Endpoint changes invalidate the matching verification fingerprint. Names, emails, phones, and units are never integration keys.

Email automation is a future ingestion step using the same scoped, versioned publication and review process. No mailbox automation or schedule is enabled by this build. Validate the actual report format and source authenticity before automating ingestion.

Before a pilot, demonstrate a valid current lease, a changed lease, a deleted resident, conflicting identities, and an endpoint change. Do not fill the view by copying browser claims or independently assigning resident IDs. Identity display and delivery stay blocked until this relationship is repaired.

Contact identifiers use the deterministic canonical community/person key. Contact and conversation reservations are unique in Supabase; ambiguous upstream timeouts leave a pending operation requiring review rather than sending a duplicate. Operators must reconcile pending records against the same Chatwoot identifier/contact/conversation before completing the reservation. Never clear a pending reservation and blindly retry. Duplicate identity results require review and must not be merged automatically.

## Dedicated Chatwoot infrastructure

Use `compose.yaml` on a dedicated production host with a private database/Redis network, encrypted persistent disks, security updates, outbound network controls, time synchronization, and capacity appropriate to the pilot. Supply immutable approved image digests for Chatwoot, pgvector PostgreSQL, Redis, and Caddy. The configuration intentionally has no default image tag or domain. Validate the configuration against the selected release's [Docker deployment guide](https://developers.chatwoot.com/self-hosted/deployment/docker) and its environment sample before use.

Mount separate external application, PostgreSQL, Redis, and proxy secret environment files outside the repository with owner-only permissions. Give PostgreSQL only its password, Redis only its password, and the proxy only its origin secret. Set the application's Redis URL/password to the private Redis service and its PostgreSQL password to the database credential. Configure Amazon-compatible object storage with encryption, private ACLs, versioning, restricted IAM, lifecycle retention, and backup replication. The S3 service is the persistent attachment store; the local volume is retained for application scratch storage. Do not expose database or Redis ports publicly.

Create DNS for the approved domain and open only TLS plus the certificate challenge port. Caddy terminates TLS and forwards account API requests only with the Worker origin secret. It exposes the Twilio callback paths separately; Chatwoot must verify Twilio provider signatures. All ATLAS browser conversation traffic terminates at the JWT-authenticated Worker. The public ingress exposes neither the Chatwoot dashboard nor attachment URLs. Set up operator administration through a separate private ingress, protected by the organization's identity provider and VPN. Never embed that dashboard or its credentials in ATLAS.

Initialize the database using the pinned release's `rails db:chatwoot_prepare` task in a one-off container before starting web and Sidekiq. Run configuration validation, start PostgreSQL/Redis, prepare the schema, and then start web/worker/proxy. Confirm database and Redis health checks, web responsiveness, a Sidekiq heartbeat, TLS, private S3 uploads, and external Worker-to-Chatwoot API authentication. The Sidekiq health check verifies Redis process registration; monitoring must also measure queue age and failed jobs.

## Microsoft 365 and Twilio setup

Create the centralization account, agents, and teams in the private operator interface. Map each ATLAS user to its Chatwoot agent ID in `atlas_chatwoot_agent_links`; assignments recheck that the target ATLAS account is active and authorized for the conversation community. Give the Worker integration account only the account access needed by the API. Keep global administration separate from staff communications functions.

Register the Microsoft OAuth application according to the pinned Chatwoot release, store its application secret in the Chatwoot secret manager, and configure its exact callback URL. Add the Microsoft email inbox for **Central@risere.com** and authorize the correct mailbox. If this is a shared mailbox, confirm that the selected release and the Microsoft tenant support the required delegated access; successful personal-mailbox login is not proof of shared-mailbox delivery. The public proxy template blocks Microsoft callback/dashboard paths: expose the callback only through the approved operator ingress during mailbox authorization, with the OAuth redirect matching that ingress. Validate OAuth renewal and mailbox send/read permissions.

Create Twilio SMS inboxes and register only approved sending numbers. Configure inbound and delivery-status callback URLs for the pinned release. Verify Twilio request signatures in Chatwoot and exercise STOP and every enabled provider-supported opt-out keyword. Provider opt-out rejection must remain enabled even when application consent is present. Never disable Twilio's opt-out handling to make a send succeed.

Complete the routing template with canonical community IDs and exact configured inbox IDs. A shared Central mailbox is safe only when canonical contact linkage resolves the community; unknown contacts are rejected for identity review. Matching a sender email or phone alone does not authorize an inbound ATLAS link. Existing imported Chatwoot contacts need an operator-reviewed canonical linkage before their conversations appear in ATLAS.

## Database and Worker rollout

Apply `20261006183218_resident_communications.sql` first in staging. Verify all new table grants and RLS with active, inactive, scoped, market-restricted, region-restricted, and locked-page profiles. Browser writes to routing, consent, projections, audit, receipts, operations, and agent mappings are denied. Agent communication controls use validated Worker APIs; deployment configuration remains operator-only.

Publish the monthly Entrata workbook and load reviewed identity attestations, routes, agent mappings, and consent evidence through an authorized server-side process. The consent template stores an endpoint SHA-256 fingerprint, not the phone number or any message body. Use the verified canonical E.164 number for that fingerprint. Evidence references point to approved consent records. Staff cannot override opt-out through the composer; STOP marks the contact opted out even if no consent row previously existed. Provider-confirmed re-opt-in requires a separate reviewed process; this build does not expose a staff override.

Configure Worker secrets and non-secret deployment bindings through the deployment system. Build the static site and Worker with the established ATLAS release pipeline. No new secret is injected into the frontend build. Subscribe account webhooks to `message_created`, `message_updated`, `conversation_created`, `conversation_updated`, and `conversation_status_changed` at `/api/atlas/chatwoot/webhooks`.

Signature verification covers the exact `timestamp + "." + raw body` bytes, as implemented in [Chatwoot's webhook trigger](https://github.com/chatwoot/chatwoot/blob/develop/lib/webhooks/trigger.rb). A five-minute replay window and transactional receipt prevent stale and duplicate application. Receipts contain only a delivery fingerprint, event type, account/conversation IDs, and receipt time. Invalid/stale signatures return 401; unknown account/inbox/identity/events return 422; duplicate deliveries return 409 without applying changes; infrastructure errors return 502/503. Check retry behavior of the pinned Chatwoot release: account webhooks do not necessarily retry all failures automatically. Monitor failures and reconcile identifiers through an operator-controlled replay process using newly signed events, never forged headers or weakened verification.

Verified STOP revokes consent before upstream calls so a Chatwoot outage cannot delay blocking. Supabase then updates receipt, projections, opt-out, and alerts in one transaction. Message bodies and attachments are transient in the Worker and remain stored only by Chatwoot. Structured delivery rows prevent a successful unrelated message from clearing a failure. A separate minute cron refreshes time-based reminders seven days a week without changing the existing DLR schedule.

Scoped aggregate counts include all active conditions even when the compact list is limited to 100 records. Reminder thresholds can be updated through the scoped Worker policy route, without changing inbox routes, quiet hours, or deployment flags. The alert table is eligible for Supabase Postgres Changes with its SELECT RLS. The shipped browser uses an authenticated Worker fetch stream that revalidates JWT/profile and rereads scoped alerts every two seconds; bounded streams reconnect. This provides a short refresh delay, not instantaneous webhook push. No JWT appears in a stream URL. Session changes clear browser queue, history, and alert state; stale queued responses are discarded.

## Email, attachment, and export controls

Outbound recipients are resolved from the current canonical identity and compared to Chatwoot's linked recipient. The browser cannot set recipient, inbox, actor, HTML, or attachment fields. Replies use the existing Chatwoot conversation so that Chatwoot owns threading. In the pilot, verify Message-ID, In-Reply-To, References, reply subject, mailbox identity, and absence of duplicate conversations.

Attachment upload/download is deliberately blocked in this build. Production attachment access requires an approved scanning service, MIME and size allowlists, quarantine handling, and authenticated Worker streaming; adding a direct Chatwoot object-storage URL is prohibited. Exports currently contain only authorized conversation metadata, are scoped to one canonical community, are audited, and stop at 1,000 records with a truncation indicator. Message-content exports and unbounded export jobs are not enabled.

## Backup and restoration

Back up PostgreSQL with encrypted point-in-time recovery and daily logical dumps to a separate restricted storage account. Back up/version S3 objects and retain Redis persistence snapshots for job recovery. Keep application encryption keys, image digests, schema version, and secret references in a separately protected recovery vault. Establish approved recovery-point/recovery-time objectives and retention before activation. Backups must never be committed to Git or copied into ATLAS's public asset tree.

Test restoration into a private isolated environment: restore PostgreSQL, object storage, Redis, and application encryption keys; start the exact pinned release; verify contacts, conversations, attachments, worker queues, mailbox authorization, and provider configuration with outbound traffic disabled. Reconcile jobs before enabling delivery so restoration does not resend old messages. Record the successful restore drill and elapsed recovery time.

## Monitoring and incident response

Monitor TLS expiry, database/Redis health, web error rate, Sidekiq heartbeat and queue age, failed deliveries, Microsoft token refresh, Twilio callback/signature errors, S3 access, webhook verification failures, pending identity operations, reminder cron freshness, and scoped stream failures. Send monitoring notifications through the organization's existing operations system. The Compose template mounts `communication-log-filter.rb` to filter Rails parameters and replace Sidekiq error handlers that may serialize webhook job arguments. Verify the initializer against the pinned release and audit other log producers. Log only named rules, numeric statuses, timestamps, and redacted identifiers; disable HTTP payload and SQL parameter logging for this integration. Verify this at the host, application, proxy, Worker, and Supabase layers.

For delivery or isolation incidents, disable `ATLAS_COMMUNICATIONS_OUTBOUND_ENABLED` immediately; disable workspace access if scope or credential integrity is uncertain. Pause Chatwoot provider/background delivery where required, restrict the origin, preserve redacted audit and delivery identifiers, and involve operations/security. Revoke suspected tokens and provider credentials; investigate using Chatwoot's controlled message access instead of copying bodies into ATLAS logs. Reconcile pending operations and duplicate delivery risk before restoring service. Consent incidents require compliance review and continued SMS blocking.

## Upgrades, token rotation, and rollback

Before an upgrade, pin the new image digest, review release/security notes, back up all stores, and rehearse schema migration and restoration in staging. Verify the API shapes, webhook signatures and secret ownership, provider callbacks, current lease routing, and cross-community denial tests against that exact release. Upgrade during an approved window with outbound paused. Roll back the application image only if its schema is compatible; otherwise restore the tested backup into an isolated replacement environment and reconcile deliveries.

Rotate the API token by provisioning a replacement account credential in Chatwoot, updating the Worker secret, verifying read-only access, and then revoking the old token. Rotate the origin token on both the proxy and Worker under outbound pause. Rotate the webhook secret on Chatwoot and the Worker together; keep a short controlled cutover window, monitor signature failures, and reconcile missed identifiers. The receiver intentionally accepts one signing key; it does not silently accept unsigned deliveries during rotation.

ATLAS rollback starts by disabling all communications flags and reverting the frontend/Worker release. Preserve additive database tables and audit/receipts rather than deleting history. Keep Chatwoot delivery paused if the application cannot enforce policy. Restore previously accepted routes/consent only from the reviewed change record; never erase opt-out history to restore sending.

## Staged acceptance

1. Provision dedicated infrastructure, external secrets, TLS, storage, backups, monitoring, and restore evidence.
2. Apply the database/RLS and Worker APIs in staging and validate the monthly Entrata workbook and reviewed identity linkage.
3. Enable a read-only queue and verify each allowed role and restriction.
4. Pilot Central@risere.com with one approved community, including inbound/outbound threading and endpoint conflict denial.
5. Obtain compliance/legal approval for documented SMS consent, the verified timezone, 19:00 quiet-hours start, and the explicit morning resume time. Pilot Twilio with one approved community and controlled test endpoints.
6. Validate all alert conditions, resolution, duplicates, out-of-order events, refresh delay, and reminder thresholds.
7. Complete security/data-isolation review, including bundles, logs, grants, replay behavior, attachments remaining blocked, and export scoping.
8. Expand approved routes only after the pilot evidence is accepted. These implementation controls are not legal advice.

## Identity lineage

Canonical Entrata person/resident and current lease, mapped to the canonical ATLAS community
→ service-only canonical identity view and protected Worker scope resolution
→ deterministic Chatwoot contact, verified inbox route, and linked conversation
→ Central@risere.com email or Twilio SMS delivery
→ signed Chatwoot webhook with account/inbox verification
→ atomic receipt and redacted Supabase delivery/consent/alert projection
→ authorized ATLAS queue and scoped dashboard reminder.

The first actual Entrata workbook and identity review, approved production inputs, Microsoft/Twilio live pilot evidence, attachment scanning, and operational restore/security review remain activation prerequisites. Local automated evidence is recorded in `TEST-EVIDENCE.md`.
