# Budget Dashboard Review

This folder captures the original snippet, a safer revised component, and a browser-based playground so the current behavior can be reviewed before additional changes are made.

## Files

- `BudgetDashboard.original.tsx`: the component exactly as provided.
- `BudgetDashboard.improved.tsx`: a revision that addresses the biggest parsing and UX issues.
- `playground.html`: a no-build review harness with sample datasets, side-by-side parser behavior, and a lightweight visual dashboard.
- `executive-accountability-workbench.html`: the expanded three-layer prototype for financial, operational, and leasing accountability.
- `executive-accountability-workbench.js`: the upload parser, crosswalk engine, scorecard model, and export logic behind the workbench.
- `sample-clean.csv`: a happy-path CSV.
- `sample-formatted.csv`: a more realistic CSV with currency symbols, commas, and parentheses for negatives.

## Manual review flow

1. Open `playground.html` in a browser.
2. Click **Load clean sample** and compare **Original logic** vs **Improved logic**.
3. Click **Load formatted sample** to reproduce the number-parsing bug in the original logic.
4. Upload one of the sample CSV files or your own file to validate row detection, section grouping, and totals.

## Executive workbench flow

1. Open `executive-accountability-workbench.html`.
2. Use **Load Sample Pack** to populate financial, operational, and leasing CSVs instantly.
3. Change the **As Of Month** selector to validate pace and projection logic across periods.
4. Click different properties in **Property Ranking** to inspect crosswalked root-cause narratives.
5. Test the export actions for scorecards, board summary text, the ownership report HTML, and the board deck PPTX.

## What the improved version changes

- Guards against an empty file selection.
- Parses formatted accounting values such as `$12,500` and `(1,250)`.
- Treats section names case-insensitively for income detection.
- Falls back to `Uncategorized` when GL rows appear before a section heading.
- Adds basic upload validation and clearer empty states.
- Formats chart axes and tooltips as currency.
