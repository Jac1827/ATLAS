# Scoped workspace projection

`20260924205459_scoped_workspace_projection.sql` adds a read-only RPC and private JSON filtering helpers. It changes no financial rows, archive records, document policies or permissions on existing tables. The mirrored SQL is `centralization/scoped-workspace-projection.sql`.

`atlas_read_workspace_projection()` accepts no caller-selected document or scope. It reads the current `atlas_dashboard_state_v1` manifest and its exact archive-hash/version projection in one database snapshot. Missing, deleted, wrong-module, wrong-source or mismatched projection records return `status: unavailable`; they never fall back to a legacy archive. Equivalent timestamp spellings are compared as timestamps and the original source spelling is returned so the complete projection hash remains verifiable.

The caller must have an active canonical profile and account and a recognized role. The reader mirrors the existing role/tab matrix and page locks. Home, Reports or Community Command allow the operational aggregate projection. Traffic-only and Renewals-only access receives corresponding monthly and provenance fields. Other separate-API workspaces receive community identity/settings only. When every operational page is locked, self-service Settings still initializes with an empty authorized projection. Admin and Executive retain their existing full-document read boundary when an operational workspace is allowed; Settings-only access stays empty. Other roles receive only uniquely resolved canonical community names or active aliases allowed by `atlas_can_access_community`. Ambiguous aliases, deleted communities and conflicting canonical UUIDs are omitted. Inactive communities additionally require explicit assignment. Market or region labels do not bypass the canonical community authorization helper.

The filtered community payload uses an explicit operational aggregate allowlist. Monthly values retain their original JSON types, zero and null, source/version fields, metric provenance, dated snapshot history and trend source aggregates. Private Bonus, employee, resident, renewal-detail and contract-document subtrees are omitted. Global data contains only the filtered `portfolioMonthScopeByPeriod`. Current aggregate import lineage and Box Score values are filtered by community and field; imported zero values, source identities and period boundaries remain available. Upload batches, source archives, exceptions, arbitrary global keys and mixed-community records are excluded. Privileged detail workspaces must continue using their own canonical APIs.

The response is:

```text
{status, reason?, source, projection?, scopeFingerprint?,
 projectionVersion?, projectionContentHash?,
 projectionHashFormat: 'postgres-jsonb-sha256', fullProjection?, operationalMode?}
```

The source binds the document key, version, archive hash and effective time. `scopeFingerprint` binds the current actor, profile access, module locks and resolved canonical communities. Cache receipts must also bind `projectionVersion` and `projectionContentHash`, because an authorized admin can repair a derived document without changing its parent. The existing app-document administration model remains unchanged.

When the shared source is unavailable, the client still permits account Settings after a successful current profile/access check. This exception neither marks source data available nor permits an operational page. A failed or revoked access check keeps the barrier in place.

Full Admin/Executive projections retain their original JavaScript stable-JSON `contentHash`; the client verifies it. Filtered projections intentionally omit that full-body hash. The client computes a new local digest over the authenticated RPC result and retains the server scope/source receipt. The PostgreSQL JSONB hash is a separate representation and must not be compared to the JavaScript stable-JSON digest. The derived projection is materialized only through the existing admin-controlled workflow after archive verification; the reader does not unzip or independently recalculate the archive in a SQL request.

`node tools/scoped-workspace-projection-db.test.cjs` passes against the complete 77-migration local replay. Coverage includes scoped and full roles, anonymous/disabled/module-category locks, self-service-only context, scope changes, raw-document and private-helper denial, ambiguous/inactive aliases, UUID contradiction, private-field removal, exact full-body hash, zero/null/provenance and missing/stale parent sources. These are synthetic local checks. The configured integration deployed the reader automatically with PR #30; live function bodies, grants and denied anonymous access were verified. PR #31 subsequently deployed the dedicated source-bound publisher. Authenticated scoped-value and performance acceptance remain pending because publication has not yet produced the matching projection.

Activate the matching client adapter only after the materialized projection is verified. An ordinary rollback can restore the previous app while retaining this reader for already-open repaired pages and immutable asset releases. Revoke endpoint access only when a separate security need requires it, with the resulting unavailable state made explicit. Keep archive/projection records and existing document RLS intact; do not widen archive access as a fallback.
