# Central Services move-out workspace

The Move Out workspace provides expandable workload lists and a single full-width case form. Saved documents retain their template version and manual corrections. Field inspections are explicitly excluded from the required Move-Out Inspection and MORF completion paths.

## Administrator setup

In Central Services → Settings, select MOG, Notice to Vacate Confirmation, or Possession Confirmation. Configure required fields, source mappings, approved instruction text and layout sections, preview, and publish. Template versions are centrally stored; existing saved documents keep their original version. Download/upload uses a structured JSON template, up to 100 KB. DOCX/PDF template conversion is not implemented. Supported merge tokens are the fields shown in the mapping dropdown. Uploaded content is plain text, never executable HTML.

NTV instructions are intentionally unapproved until an administrator supplies approved content. Default forms do not determine fees, policy, or actual possession dates. ETF amount is required only when ETF is Yes. PDF output uses the existing RISE logo and palette, with a standard-font fallback where Gotham is unavailable.

## Microsoft configuration

Configure these server-side Cloudflare Worker secrets through the approved secret-management process:

- `ATLAS_MS_TENANT_ID`
- `ATLAS_MS_CLIENT_ID`
- `ATLAS_MS_CLIENT_SECRET`

The Entra application requires administrator-consented Microsoft Graph application permissions `Mail.Send` and `Calendars.ReadWrite`, with Exchange application access scoped to the Central shared mailbox and approved technician mailboxes. The sender is fixed to `central@risere.com`; staff can edit recipients, subject and body. Do not place credentials in browser configuration or source control. See [Graph sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0) and [create event](https://learn.microsoft.com/en-us/graph/api/user-post-events?view=graph-rest-1.0).

The Settings connection check confirms credential presence, not consent or delivery. A real, approved non-resident test is needed after IT configuration to establish tenant-specific delivery and calendar access. HTTP 202 means Microsoft accepted the email, not that the recipient received it. The application records that distinction.

## Persistence and synchronization

Cases, saved document values, inspection appointments, inspections and MORF records synchronize through a community-scoped canonical Supabase snapshot. Each acknowledged write creates an immutable revision and requires the expected version; concurrent edits are retained locally for reconciliation instead of overwriting shared records. Photo originals upload first to immutable, community-scoped content-addressed records; only committed references enter a canonical snapshot. IndexedDB/localStorage remain recovery caches. The Central Services status line distinguishes local recovery from a verified shared version. Use Refresh / retry shared cases to retrieve another session’s changes. A newly connected browser with no cases hydrates the shared state. Existing divergent local records are not automatically merged. Export local recovery includes originals; do not clear the cache until conflicts are reconciled. Request IDs and acknowledged versions persist in a dedicated IndexedDB outbox before writes, so a full localStorage quota does not block recovery and retrying a lost response does not create duplicate revisions. Failed local hydration never acknowledges a remote base or publishes an empty replacement. External sending/calendar changes require a verified shared save first. No source actual, lifecycle policy or possession/lease date is inferred by synchronization. Template versions and attempted external operation receipts are stored centrally in Supabase, accessible only through the authenticated and community-scoped Worker. The email receipt contains the completed PDF, recipients and actor; browser history retains the corresponding document snapshot.

Calendar creation, changes and cancellation initiated in ATLAS are sent to the assigned technician's Outlook calendar. Outlook changes are read by Refresh Microsoft status and every 60 seconds while the appointment editor is open and has no unsaved edits. There is no background webhook or synchronization while ATLAS is closed. An externally deleted event is shown as cancelled. Outlook/Teams display depends on the same Exchange mailbox being enabled for that employee.

A field appointment cannot advance possession, required inspection or MORF steps. The actual possession receipt explicitly confirms the returned date/time independently of the expected move-out date. Technician reassignment requires cancellation of the existing event first.

## Retry and recovery

Each external action receives a durable request ID before Microsoft is called. A repeat with the same ID returns its retained result. Pending/unknown operations block another action for the same case/document or appointment. If the browser loses its response, use Check sending status / Refresh Microsoft status. A confirmed rejection can be retried after correction. An unknown provider outcome requires an administrator to verify the shared mailbox Sent Items or technician event before resolving the retained receipt; never clear it just to force a retry. Calendar creation also carries a stable Graph transaction ID.

Canonical snapshots, immutable revision history, photos, templates and receipts have RLS enabled with no anonymous/authenticated table grants. Only the service role can access them, after the Worker applies user role and community checks. The Supabase `RLS enabled, no policy` informational advisory is intentional for these service-only tables.

## Verification

The moveout document, browser, integration and database tests cover prepopulation, required/ETF fields, approved instructions, separate actual possession, PDF generation, active ownership, unsaved-change navigation, failed send retry, durable duplicate prevention, calendar updates/cancellation and field/required inspection isolation. Microsoft responses in tests are synthetic; no resident email or real calendar event is sent by tests.

For a live acceptance test after configuration, use an approved synthetic case and internal test recipients: publish templates, send the document once, check Central Sent Items, schedule an active test technician, verify Outlook/Teams, edit the appointment both ways, cancel, then print the case and inspection with a test photo. Validate normal community access restrictions as well as administrator access.

## Rollback

Revert the application commit and redeploy through the normal gated pipeline. Retain the additive tables and receipt data; do not drop them or delete operation history during rollback. Saved case objects and inspection IDs are preserved and remain compatible with the existing normalizers.

Canonical-state rollback: revert the client and Worker together; retain all additive tables and original photos. Revisions are append-only to the service role. No source records are removed. Images are bounded to 10 MiB originals (14 MiB encoded), metadata to 8 MiB; oversize writes remain unsynchronized with local evidence preserved. Current storage uses private Postgres photo records, not public object URLs.
