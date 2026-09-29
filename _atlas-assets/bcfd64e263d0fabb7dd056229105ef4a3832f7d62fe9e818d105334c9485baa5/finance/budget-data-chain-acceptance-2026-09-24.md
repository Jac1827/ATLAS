# Budget data chain: release evidence and acceptance limits

This release adds immutable complete-workbook audits, independent database validation, explicit planning-cell and monthly-accounting reviews, and source-bound original-budget approval. It preserves existing original budgets, close versions, publications, and idempotent retries of previously committed requests.

## Implemented controls

- Full workbook inventory and static dependency graph, including hidden sheets, package metadata, names, tables, connections, external dependencies, formulas, cached values, errors, and source coordinates. Known conditional/lookup cycles are described conservatively and block approval until dependencies are resolved.
- Independent server checks for fingerprints, raw cell/node binding, ranges, omissions, missing caches, broken references, circular dependencies, and complete authority scope. A static validation result is retained with the immutable audit instead of repeating the full graph traversal on each transition.
- Explicit property, period, calendar/fiscal basis, scenario, GL registry, account nature, placement, sign, and input review. USD is the supported canonical currency; other currencies cannot silently publish as USD.
- Monthly authority includes BCR actuals, account identities, period headers, and their dependencies. T12, budget, and YTD columns remain supporting evidence. Re-imports preserve versions and compare against prior workbook evidence.
- Original-budget approval now requires a retained source workbook and approved mapping. The server reproduces every GL/month from its exact source cell. Browser-normalized rows cannot create a new approved original budget.
- Working reforecasts remain isolated until approved, locked, and transactionally published. Overrides retain owner, reason, period, and before/after evidence. Closed actuals remain independent immutable versions.
- Canonical report, Community Plan, Bonus-source, and forecast adapters retain value-and-version SHA-256 snapshot fingerprints. PDF downloads embed the exact snapshot evidence; CSV/XLSX exports carry the same lineage.
- Official Overview, Financial Review, Budget vs Actual, Reports and exports use shared financial snapshots. Legacy local financial report builders and print/export shortcuts cannot publish browser calculations. Backups, blank templates, and source evidence remain available.
- Approved original-budget GL amounts remain reportable before actuals close, including periods excluded from full-month actuals. Closed reports join the exact approved budget version and retain missing values; source-statement comparison budgets do not substitute for approved budgets.
- A blank short-term rental planning workbook is available under `portfolio-operations-dashboard/templates/ATLAS_Short_Term_Rental_Planning.xlsx` and from workbook intake. It requires actual property inputs and reviewed GL mappings.

## Completed tests

The selected existing workflow suite passed 76 checks after correcting two browser mocks and a cache-versioning regression. Additional workbook integrity, monthly governance, planning governance, original-budget publication, PDF/XLSX parity, and asset-version checks passed. These tests supplement acceptance; they do not establish business approval.

The real private Anthem January workbook passed the isolated database pipeline: 4 worksheets, 19,160 populated cells, 4,976 formulas, 137 posting rows, immutable audit storage, tamper rejection, review, atomic close/publication, canonical readback, retry, two separately authorized fixture roles, unauthorized-read rejection, and immutable-history checks. Its real 137-row financial output also passed exact XLSX roundtrip and PDF embedded-evidence parity.

Conventional, Student, and New Construction/Lease-Up source workbooks each detected six mutations: formula change, formula replaced by a hardcode, source sign change, period-header change, external link, and circular reference. These were in-memory test copies; originals were not modified. Those planning sources have existing blocking errors/dependencies, so the result is successful rejection, not approval-ready certification.

The new STR template has 8 sheets, 6,916 populated cells and 4,758 formulas. Formula/value, zero-versus-missing, cutoff, budget-comparison and source-date tests passed, as did all six integrity mutations and independent server validation. Its intentional margin ratio requires a review acknowledgement. It is a new template, not historical STR acceptance evidence. Owner-specific acceptance was excluded at the user's direction.

Live production verification also matched the retained Doro August version in the in-app browser and Chrome. All 128 visible GL/account/actual/source-YTD rows exactly matched the downloaded PDF evidence and Excel workbook. This verified an existing immutable production close, not a new planning approval.

## Acceptance still required

Issues #9 and #22 must remain open. Before closure, complete approval-ready real-workbook reruns for the applicable planning model families, canonical readback, two authorized live sessions, and exact screen/PDF/XLSX acceptance for the full consumer matrix. Isolated database roles, generated fixtures, retained legacy publications, and a blank STR template must not be represented as that full production sign-off.

Raw workbooks, full financial evidence, and private output files are excluded from the repository. Sanitized detailed proofs are retained in the task output directory.
