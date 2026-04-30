create extension if not exists pgcrypto;

-- ============================================================
-- Tables
-- ============================================================

create table if not exists public.cashflow_months (
  id uuid primary key default gen_random_uuid(),
  month_key text not null unique,
  last_processed_at timestamptz,
  processed_by text,           -- name of the person who processed
  created_at timestamptz not null default now()
);

create table if not exists public.cashflow_source_uploads (
  id uuid primary key default gen_random_uuid(),
  month_id uuid not null references public.cashflow_months(id) on delete cascade,
  source_type text not null,
  file_name text not null,
  content_text text not null,
  created_by text,             -- name of the uploader
  created_at timestamptz not null default now()
);

create table if not exists public.cashflow_rules (
  id uuid primary key default gen_random_uuid(),
  rule_code text not null unique,
  rule_type text not null,
  match_value text not null,
  category text not null,
  base_case_row text,
  applies_to text not null default 'ap',
  paygroup_filter text,
  notes text,
  active boolean not null default true,
  created_by text,             -- name of the creator
  updated_by text,             -- name of the last editor
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cashflow_records (
  id uuid primary key default gen_random_uuid(),
  month_id uuid not null references public.cashflow_months(id) on delete cascade,
  record_key text not null,
  data_source text not null,
  source_file text,
  role text not null,
  source text,
  category_code text,
  batch_name text,
  je_name text,
  account text,
  description text,
  entry_item text,
  debit_usd numeric(18,2) not null default 0,
  credit_usd numeric(18,2) not null default 0,
  amount numeric(18,2) not null default 0,
  signed_amount numeric(18,2) not null default 0,
  vendor text,
  pay_group text,
  fpc text,
  cost_item text,
  cashbook_category text,
  base_case_row text,
  mapped boolean not null default false,
  mapping_rule text,
  raw_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(month_id, record_key)
);

create table if not exists public.cashflow_audit_log (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  month_key text,
  rule_code text,
  details text,
  user_name text,              -- name typed into the name field
  created_at timestamptz not null default now()
);

-- ============================================================
-- Migration: if tables were created with the old auth.users FK
-- columns, convert them to plain text. Safe to run repeatedly.
-- ============================================================
do $$ begin
  -- cashflow_months.processed_by  uuid -> text
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='cashflow_months'
      and column_name='processed_by' and data_type='uuid'
  ) then
    alter table public.cashflow_months
      drop constraint if exists cashflow_months_processed_by_fkey;
    alter table public.cashflow_months drop column processed_by;
    alter table public.cashflow_months add column processed_by text;
  end if;

  -- cashflow_source_uploads.created_by  uuid -> text
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='cashflow_source_uploads'
      and column_name='created_by' and data_type='uuid'
  ) then
    alter table public.cashflow_source_uploads
      drop constraint if exists cashflow_source_uploads_created_by_fkey;
    alter table public.cashflow_source_uploads drop column created_by;
    alter table public.cashflow_source_uploads add column created_by text;
  end if;

  -- cashflow_rules.created_by / updated_by  uuid -> text
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='cashflow_rules'
      and column_name='created_by' and data_type='uuid'
  ) then
    alter table public.cashflow_rules
      drop constraint if exists cashflow_rules_created_by_fkey,
      drop constraint if exists cashflow_rules_updated_by_fkey;
    alter table public.cashflow_rules
      drop column created_by,
      drop column updated_by;
    alter table public.cashflow_rules
      add column created_by text,
      add column updated_by text;
  end if;

  -- cashflow_audit_log: drop old auth columns, add user_name text
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='cashflow_audit_log'
      and column_name='user_id' and data_type='uuid'
  ) then
    alter table public.cashflow_audit_log
      drop constraint if exists cashflow_audit_log_user_id_fkey;
    alter table public.cashflow_audit_log drop column user_id;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='cashflow_audit_log'
      and column_name='user_email'
  ) then
    alter table public.cashflow_audit_log rename column user_email to user_name;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='cashflow_audit_log'
      and column_name='user_name'
  ) then
    alter table public.cashflow_audit_log add column user_name text;
  end if;
end $$;

-- ============================================================
-- Indexes for query performance
-- ============================================================
create index if not exists cashflow_records_month_id_idx
  on public.cashflow_records(month_id);
create index if not exists cashflow_records_mapped_idx
  on public.cashflow_records(month_id, mapped);
create index if not exists cashflow_records_data_source_idx
  on public.cashflow_records(month_id, data_source);
create index if not exists cashflow_records_base_case_row_idx
  on public.cashflow_records(month_id, base_case_row);
create index if not exists cashflow_source_uploads_month_id_idx
  on public.cashflow_source_uploads(month_id);
create index if not exists cashflow_audit_log_created_at_idx
  on public.cashflow_audit_log(created_at desc);
create index if not exists cashflow_audit_log_month_key_idx
  on public.cashflow_audit_log(month_key);

-- ============================================================
-- updated_at trigger on rules
-- ============================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists cashflow_rules_set_updated_at on public.cashflow_rules;
create trigger cashflow_rules_set_updated_at
before update on public.cashflow_rules
for each row execute procedure public.set_updated_at();

-- ============================================================
-- Row Level Security
-- No auth is required — the anon key is sufficient for the
-- finance team. All tables are open to any request that
-- arrives with the project's anon key.
-- ============================================================
alter table public.cashflow_months enable row level security;
alter table public.cashflow_source_uploads enable row level security;
alter table public.cashflow_rules enable row level security;
alter table public.cashflow_records enable row level security;
alter table public.cashflow_audit_log enable row level security;

drop policy if exists "anon full access months" on public.cashflow_months;
create policy "anon full access months"
  on public.cashflow_months for all using (true) with check (true);

drop policy if exists "anon full access uploads" on public.cashflow_source_uploads;
create policy "anon full access uploads"
  on public.cashflow_source_uploads for all using (true) with check (true);

drop policy if exists "anon full access rules" on public.cashflow_rules;
create policy "anon full access rules"
  on public.cashflow_rules for all using (true) with check (true);

drop policy if exists "anon full access records" on public.cashflow_records;
create policy "anon full access records"
  on public.cashflow_records for all using (true) with check (true);

drop policy if exists "anon full access audit" on public.cashflow_audit_log;
create policy "anon full access audit"
  on public.cashflow_audit_log for all using (true) with check (true);

-- Also drop the old "authenticated" policies if they exist
drop policy if exists "authenticated full access months" on public.cashflow_months;
drop policy if exists "authenticated full access uploads" on public.cashflow_source_uploads;
drop policy if exists "authenticated full access rules" on public.cashflow_rules;
drop policy if exists "authenticated full access records" on public.cashflow_records;
drop policy if exists "authenticated full access audit" on public.cashflow_audit_log;
