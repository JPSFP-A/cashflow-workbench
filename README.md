# Cashflow Workbench

Static HTML cashflow workbench for monthly indirect cashflow preparation.

## What It Does

- Upload AP invoice/payment and cashbook text exports directly in the browser.
- Categorize AP outflows using the procedure-based default rules.
- Merge the cashbook 180 and 132 files so the output keeps the clearer description plus the fuller account/entry detail.
- Map exceptions from the unmapped queue and immediately reapply the rules in-session.
- Export records, mapping rules, and an Excel-compatible report.

## Deployment

This repo is now Vercel-friendly as a plain static site. The main app is:

- `index.html`

Vercel can deploy it without a build step.

## Important Limitation

This static version does not save changes back to GitHub by itself. If you edit rules in the browser, export the updated mapping rules CSV and reuse it next month.
