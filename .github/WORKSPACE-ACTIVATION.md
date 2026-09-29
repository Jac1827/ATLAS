# Activate the current operational workspace

The finance compatibility release keeps the retained operational runtime active.
It does not activate PR #37's Home and Reports changes. Full activation uses the
normal current-client build only after the current operational source is saved,
its source-bound startup projection is verified, and authenticated acceptance
passes. Keep `ATLAS_SCOPED_WORKSPACE_READY` closed until those checks pass.

## Preserve and identify the current source

Coordinate a single live-data owner. Complete any outstanding import recovery,
preserve a fresh complete backup, and reconcile all newer browser records before
Central Save. Verify the exact saved parent version, archive SHA-256, effective
time, complete history counts, and retained source fingerprints against that
fresh snapshot. A historical backup is regression evidence, not permission to
replace newer records. Do not use Central Pull or an older archive as a shortcut.

Financial draft approval and publication are separate operations. Preparing the
startup projection must not approve or publish financial values.

## Prepare the first projection without changing operational startup

First deliver the reviewed preparation page and archive reader through the
existing finance compatibility release process. Use its independently reviewed
release hash; retain every previously published immutable release. This stage
still leaves the retained operational workspace active.

After the live-data owner releases the source window, use the existing signed-in
admin session on the same origin. Open:

```
finance/portfolio-operations-dashboard/workspace-activation.html#version=EXPECTED_VERSION&archiveHash=EXPECTED_ARCHIVE_SHA256
```

Use the exact independently verified current parent identity. The page performs
no publication on load. **Check saved source** verifies the active admin and
matches the current parent against that identity. **Prepare verified workspace**
invokes the existing source-bound projection publisher and verifies its readback.
The page does not load the operational core, read or replace operational browser
storage, save a parent archive, or change authorization. An actor or source
change, cancellation, or pending result is not success.

The projection publisher retains its existing PostgreSQL JSONB UTF-8 limit of
16,777,216 bytes, including `contentHash`. Measure a fresh projection when its
source grows; compact JavaScript JSON size does not establish this limit. A
successful projection of a historical archive does not verify the current source.

## Verify and activate the current client

1. Freeze the reviewed current commit, including all newer repairs. Complete its
   discovered test suite, required private-fixture checks, and independent review.
2. Verify authenticated scoped reads of the exact current projection and source.
   Check current-source Home/Reports values and exports, refresh/reload, access
   boundaries, and the actual read-only approval queue. Isolated mocks and an
   unavailable/empty source do not establish production acceptance.
3. Separately verify explicit full-history loading and import workflows. The
   reduced startup reader does not prove that full-history hydration succeeds.
4. Enable the normal release gate only after those prerequisites pass. Dispatch
   **Deploy Cloudflare Worker** on the frozen reviewed commit, target
   **production**, with both rollback fields and `finance_release_hash` empty.
5. Compare both live manifests and the canonical/immutable entry assets against
   the reviewed artifact. Confirm the operational core, Home and Reports runtime
   is active, and that existing `/finance/` entry URLs still resolve correctly.
   Keep responsiveness shortfalls distinct from correctness and delivery checks.

The normal CLI stages small finance HTML redirects before packaging. For a
programmatic normal preview use `preserveFinanceEntryAliases: true`; finance
composition and rollback callers keep their existing exact source selection.
The staged redirects are part of the immutable release hash. They preserve
query strings, fragments and the GitHub Pages project prefix. They do not replace
any old immutable asset tree.
