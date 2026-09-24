# Complete local regression suite

Use Node 24 and install the locked application dependencies plus Playwright/Chromium, as the deployment workflow already does. Then run from any directory:

```sh
node /path/to/ATLAS/tools/test-all.mjs
```

The runner discovers every `tools/*.test.cjs`, every `tools/*.test.mjs`, and `test-ticker.mjs`. It runs them sequentially, starts an isolated disposable PostgreSQL fixture for the builder browser test, and stops child processes after each test. Hosted browser fixture URL overrides are removed. It does not deploy or write production data.

`ATLAS_PLAYWRIGHT` may point to an installed Playwright package. `ATLAS_XLSX` defaults to the repository's existing bundled parser. Browser tests otherwise use their own local or intercepted synthetic services.

Useful options:

- `--list`: print the discovered inventory without running tests.
- `--output output/test-all/release-check`: select a fresh ignored results directory; existing results are never overwritten.
- `--timeout-ms 180000`: maximum time per test, excluding owned fixture startup.
- `--strict-fixtures`: fail, instead of explicitly skipping, tests whose required private workbook is unavailable.

Two legacy source-specific tests require private workbooks:

| Test | Required environment variable |
| --- | --- |
| `budget-workbook-import.test.cjs` | `ATLAS_FISCAL_BUDGET_FIXTURE` |
| `collections-import.test.cjs` | `ATLAS_DELINQUENCY_FIXTURE` |

Missing dependencies, assertions, timeouts, or other failures are never converted to skips. Optional real-source branches inside other tests run only when their documented fixture variables are supplied; a normal CI run exercises their synthetic cases.

Each fresh results directory contains `results.json` and one detailed log per test. Standard output and the JSON report contain only test names, status, timing, sanitized prerequisite reasons, source revision/fingerprints, and log filenames. Detailed logs may include source values when private fixture variables are deliberately supplied, so keep them private. A source fingerprint change during the run is recorded explicitly; rerun affected checks or freeze and repeat the suite before making an exact-release claim.

The input fingerprint covers executable source, test code/JSON fixtures, migrations, dependency manifests and deployment configuration. Published measurements under `performance/evidence/` are excluded to avoid a self-referential hash when the suite's own result is published; they are not executable test inputs.

The runner exits nonzero when any test fails. An ordinary successful run may contain the two explicit private-fixture skips, which remain visible in the report. Use `--strict-fixtures` when both private fixtures are expected.

For CI, replace a hand-maintained test command list with `node tools/test-all.mjs --output output/test-all/ci` after dependency and Chromium installation. Retain the sanitized JSON report as a build artifact, including on failures. Separate browser performance timing runs from this regression suite so other test processes cannot distort measurements.
