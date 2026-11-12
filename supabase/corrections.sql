-- Line corrections: fix lines that were loaded with a wrong description, category or other field a rule reads,
-- keep a log of every change, and mark corrected lines. Safe to run more than once.
--
-- Corrections live in their own table, keyed by month and line, so they survive every reprocess and reapply
-- (records are rebuilt from the raw source files each time). The fingerprint guards against a re-uploaded source
-- file shifting line numbers: a correction only applies to a line whose fingerprint still matches.

alter table public.cashflow_records add column if not exists corrected boolean not null default false;
alter table public.cashflow_records add column if not exists corrected_fields text not null default '';

create table if not exists public.cashflow_record_corrections (
  id              uuid primary key default gen_random_uuid(),
  month_key       text not null,
  record_key      text not null,
  fingerprint     text not null,
  field           text not null check (field in (
                    'description','category_code','source','je_name','batch_name','vendor','vendor_no',
                    'pay_group','fpc','cost_item','cc','jobno','emp_no')),
  original_value  text not null default '',
  corrected_value text not null default '',
  reason          text not null check (length(btrim(reason)) > 0),
  line_summary    text not null default '',
  status          text not null default 'active' check (status in ('active','reverted')),
  match_status    text not null default 'applied' check (match_status in ('applied','relocated','unmatched')),
  corrected_by    text,
  corrected_at    timestamptz not null default now(),
  last_checked_at timestamptz,
  reverted_by     text,
  reverted_at     timestamptz,
  revert_reason   text
);

-- One active correction per line and field. A newer correction supersedes (reverts) the older one first.
create unique index if not exists cashflow_corrections_one_active
  on public.cashflow_record_corrections (month_key, record_key, field) where status = 'active';
create index if not exists cashflow_corrections_month
  on public.cashflow_record_corrections (month_key, status);

alter table public.cashflow_record_corrections enable row level security;

drop policy if exists cw_corrections_auth_all on public.cashflow_record_corrections;
create policy cw_corrections_auth_all on public.cashflow_record_corrections
  for all
  using ((select public.jps_has_any_app('{cashflow}'::text[])))
  with check ((select public.jps_has_any_app('{cashflow}'::text[])));

-- Writes that touch several rows run as one transaction, so a failure part-way cannot leave the log inconsistent.
-- Both run as the caller (security invoker), so the table policy above still decides who can use them.

-- Adds corrections. Any active correction on the same line and field is superseded first, and the new row keeps the
-- value the line had before the very first correction.
create or replace function public.cashflow_add_corrections(p_rows jsonb, p_who text)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare n integer;
begin
  update public.cashflow_record_corrections c
     set status = 'reverted', reverted_by = p_who, reverted_at = now(), revert_reason = 'Superseded by a newer correction'
    from jsonb_to_recordset(p_rows) as i(month_key text, record_key text, field text)
   where c.status = 'active' and c.month_key = i.month_key and c.record_key = i.record_key and c.field = i.field;

  insert into public.cashflow_record_corrections
    (month_key, record_key, fingerprint, field, original_value, corrected_value, reason, line_summary, corrected_by, corrected_at, last_checked_at)
  select i.month_key, i.record_key, i.fingerprint, i.field,
         coalesce((select c.original_value from public.cashflow_record_corrections c
                    where c.month_key = i.month_key and c.record_key = i.record_key and c.field = i.field
                      and c.status = 'reverted' and c.reverted_at = now() and c.revert_reason = 'Superseded by a newer correction'
                    limit 1), i.original_value),
         i.corrected_value, i.reason, i.line_summary, p_who, now(), now()
    from jsonb_to_recordset(p_rows) as i(month_key text, record_key text, fingerprint text, field text, original_value text,
                                         corrected_value text, reason text, line_summary text);
  get diagnostics n = row_count;
  return n;
end $$;

-- Moves corrections to new line numbers after a source file shifted them. Parks every key first so neighbouring
-- lines that each move by one do not clash on the unique index.
create or replace function public.cashflow_relocate_corrections(p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare n integer;
begin
  update public.cashflow_record_corrections c set record_key = '~' || c.id::text
    from jsonb_to_recordset(p_rows) as i(id uuid, record_key text) where c.id = i.id;
  update public.cashflow_record_corrections c
     set record_key = i.record_key, match_status = 'relocated', last_checked_at = now()
    from jsonb_to_recordset(p_rows) as i(id uuid, record_key text) where c.id = i.id;
  get diagnostics n = row_count;
  return n;
end $$;
