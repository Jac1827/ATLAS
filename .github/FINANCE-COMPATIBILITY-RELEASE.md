# Finance interface activation while preserving operations

The operational workspace projection is not ready to replace the live data
source. The shared September 19 archive predates newer browser import activity.
Do not set `ATLAS_SCOPED_WORKSPACE_READY` or publish that archive as a shortcut.

The explicit finance compatibility release composes the verified live operational
release `774663d5c700ea5d00a0b13a627f965f78173d7a4700f6728ed6a6620adbf8df`
with the current governed Budget Builder in an isolated `finance/` asset tree.
Its receipt records every changed operational adapter and before/after hashes.
Startup, operational storage, imports and source hydration remain preserved.
The financial modules use the existing authenticated central API and canonical
revision tables with server authorization. No financial baseline is approved or
published by the release build. No database or browser data is migrated.

Build with `node tools/build-atlas-finance-release.mjs` (preview default), review
the composition receipt and run the compatibility browser, security, packaging
and complete CI tests. The expected release hash must come from this independently
reviewed artifact. Run **Deploy Cloudflare Worker** manually against the reviewed
commit, target **production**, with `finance_release_hash` equal to that exact
64-character hash. Leave both client rollback inputs empty. Selection validation
rejects combined modes and malformed hashes; packaging rejects a content mismatch
before any asset-retention publication or hosting deployment.

Production builds once, retains all prior immutable releases, uses the current
Worker and bindings with `--keep-vars`, and sends the identical artifact to Worker
and Pages. Artifact content is verified again before Pages upload. The normal
workspace-readiness gate remains closed. Both-host activation is sequential;
verify both workflow results and the live manifest after completion.

This compatibility activation deliberately postpones the operational workspace
startup migration. Preserve and reconcile the newer full import history before
selecting an operational source for that separate migration. Financial source
mapping decisions still require approved resolution before publishing affected
financial values.
