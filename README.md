# Cashflow Workbench

Supabase-backed static HTML cashflow workbench for monthly indirect cashflow preparation.

## What It Does

- Uses Supabase Auth for shared team access.
- Saves months, uploaded source text, processed records, rules, and audit logs in Supabase.
- Keeps the browser-based workflow lightweight so Vercel can host it as a plain static site.
- Categorizes AP outflows using the procedure-based default rules and lets the team edit them in-app.
- Merges the cashbook 180 and 132 files so the output keeps the clearer description plus the fuller account and entry detail.

## Deployment

This repo is Vercel-friendly as a plain static site:

- `index.html`
- `app.js`
- `config.js`
- `supabase/schema.sql`

No build step is required.

## Setup

1. Create a Supabase project.
2. Run [schema.sql](./supabase/schema.sql) in the Supabase SQL editor.
3. Copy [config.example.js](./config.example.js) to `config.js` and fill in:
   - `supabaseUrl`
   - `supabaseAnonKey`
4. Create your team users in Supabase Auth.
5. Deploy the repo to Vercel.

## Notes

- `config.js` currently ships with placeholders so the app can deploy before credentials are added.
- The Supabase anon key is safe to expose in the browser; keep the service role key out of the frontend.
- Live data now belongs in Supabase, not GitHub. GitHub remains for code and optional exports.
