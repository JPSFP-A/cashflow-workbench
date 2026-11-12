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

-- One active correction per line and field. A correction whose line has gone (unmatched) no longer claims a line
-- number, so it cannot block another correction from moving there. A newer correction supersedes the older one.
drop index if exists public.cashflow_corrections_one_active;
create unique index cashflow_corrections_one_active
  on public.cashflow_record_corrections (month_key, record_key, field)
  where status = 'active' and match_status <> 'unmatched';
create index if not exists cashflow_corrections_month
  on public.cashflow_record_corrections (month_key, status);

alter table public.cashflow_record_corrections enable row level security;

drop policy if exists cw_corrections_auth_all on public.cashflow_record_corrections;
create policy cw_corrections_auth_all on public.cashflow_record_corrections
  for all
  using ((select public.jps_has_any_app('{cashflow}'::text[])))
  with check ((select public.jps_has_any_app('{cashflow}'::text[])));

-- Grants. This project does not grant new tables to the API roles automatically, so without these the app gets
-- "permission denied" and process and reapply fail. No anon access: the table policy needs a signed-in user anyway.
grant select, insert, update, delete on public.cashflow_record_corrections to authenticated;
grant all on public.cashflow_record_corrections to service_role;

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
   where c.status = 'active' and c.match_status <> 'unmatched'
     and c.month_key = i.month_key and c.record_key = i.record_key and c.field = i.field;

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

-- Records what happened to every correction on a save, in one transaction: unmatched first (they leave the index),
-- then moved lines (keys are parked first so neighbours that each shift by one do not clash), then lines in place.
create or replace function public.cashflow_record_correction_outcomes(p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.cashflow_record_corrections c set match_status = 'unmatched', last_checked_at = now()
    from jsonb_to_recordset(p_rows) as i(id uuid, match_status text, record_key text)
   where c.id = i.id and i.match_status = 'unmatched';

  update public.cashflow_record_corrections c set record_key = '~' || c.id::text, match_status = 'relocated'
    from jsonb_to_recordset(p_rows) as i(id uuid, match_status text, record_key text)
   where c.id = i.id and i.match_status = 'relocated';

  update public.cashflow_record_corrections c set record_key = i.record_key, last_checked_at = now()
    from jsonb_to_recordset(p_rows) as i(id uuid, match_status text, record_key text)
   where c.id = i.id and i.match_status = 'relocated';

  update public.cashflow_record_corrections c set match_status = 'applied', last_checked_at = now()
    from jsonb_to_recordset(p_rows) as i(id uuid, match_status text, record_key text)
   where c.id = i.id and i.match_status = 'applied';

  return jsonb_array_length(p_rows);
end $$;

drop function if exists public.cashflow_relocate_corrections(jsonb);

revoke execute on function public.cashflow_add_corrections(jsonb, text) from public, anon;
revoke execute on function public.cashflow_record_correction_outcomes(jsonb) from public, anon;
grant execute on function public.cashflow_add_corrections(jsonb, text) to authenticated, service_role;
grant execute on function public.cashflow_record_correction_outcomes(jsonb) to authenticated, service_role;
