# Operational browser cache boundaries

Authenticated Dashboard reads and writes now bind manual property-field overrides, the property catalogue, and workspace context to the freshly validated workspace namespace. The People and Marketing-link adapters do not fill missing canonical records from unbound legacy storage. Canonical authorized People data continues through the existing shared roster; missing evidence remains unavailable. Old browser values are retained unchanged for explicit migration.

An absent Central client on HTTP(S) fails closed before hydration and presents a reload Retry action. It does not become an offline workspace. A successfully loaded client may still explicitly select unconfigured migration mode, and file-based offline use remains available. `tools/missing-central-client-browser.test.mjs` aborts the client script with other-actor localStorage and IndexedDB fixtures, verifies no private reads, rendered data or operational requests, and then verifies recovery to normal sign-in.

Weekly and daily legacy backups are not automatically imported in configured mode. Changing workspace clears their in-memory references. New scoped backup records keep the existing IndexedDB contract.

The Leasing Velocity Report handoff stores the current access context with its scoped payload. The standalone reader fetches a current profile before accepting that payload, rejects a different actor/backend/access scope, and clears an open report when access changes. Opening Blank Template does not read a previous report. Generation also rejects a change of workspace while its asynchronous work is running.

The legacy standalone Financial Accountability page has no scoped canonical cache relationship. Its original financial source is preserved as inert script text; the hosted route shows an unavailable notice and a link to ATLAS Reports. It validates the current profile without adopting old financial caches. Explicit unconfigured offline mode retains the original implementation. Active ATLAS Reports and finance calculation formulas are unchanged.

`node tools/operational-cache-scope.test.cjs` seeds other-actor legacy values and verifies no configured fallback or mutation, isolated catalogue/locks, zero/null preservation, backup guards, LVR authorization and transition behavior, and the inactive financial script. `tools/central-services-people-scope.test.cjs` and `tools/marketing-cache-scope.test.cjs` cover the related consumers. These are synthetic local checks; no production financial or employee records were changed.
