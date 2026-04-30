# Cashflow Workbench

Multi-user cashflow mapping workbench for monthly indirect cashflow preparation.

## What It Does

- Upload monthly AP invoice/payment and cashbook text exports.
- Categorize AP outflows using mapping rules.
- Use cashbook debits for receipt-side cashflow rows.
- Keep cashbook credits as bank-side validation/control lines.
- Map exceptions from the unmapped queue.
- Save mapping rules to versioned CSV files.
- Save monthly processed records under `data/months/YYYY-MM/`.
- Commit changes to Git for audit history.

## Start Locally

```powershell
npm start
```

Open `http://localhost:8787`.

## Storage Model

The app uses Git-backed files instead of a database:

- `data/mappings/mapping_rules.csv`
- `data/mappings/base_case_rows.csv`
- `data/months/<month>/records.json`
- `data/months/<month>/summary.json`
- `data/audit/mapping_change_log.csv`

Excel is treated as an output/report format, not the live database.

## Monthly Workflow

1. Select or create a month.
2. Upload AP invoice/payment report and cashbook report(s).
3. Process files.
4. Use the mapping workbench to clear AP outflow exceptions.
5. Save mapping changes.
6. Export Base Case / exceptions.
7. Commit the month for audit.

## Reset / Wipe

- `Reset month` deletes the processed month folder locally and commits the deletion.
- GitHub history still retains prior versions unless an administrator performs a hard purge.
- Use hard purge only for sensitive data uploaded by mistake.
