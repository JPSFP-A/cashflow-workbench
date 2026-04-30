create extension if not exists pgcrypto;

create table if not exists public.cashflow_months (
  id uuid primary key default gen_random_uuid(),
  month_key text not null unique,
  last_processed_at timestamptz,
  processed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.cashflow_source_uploads (
  id uuid primary key default gen_random_uuid(),
  month_id uuid not null references public.cashflow_months(id) on delete cascade,
  source_type text not null,
  file_name text not null,
  content_text text not null,
  created_by uuid references auth.users(id) on delete set null,
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
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
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
  user_id uuid references auth.users(id) on delete set null,
  user_email text,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists cashflow_rules_set_updated_at on public.cashflow_rules;
create trigger cashflow_rules_set_updated_at
before update on public.cashflow_rules
for each row
execute procedure public.set_updated_at();

alter table public.cashflow_months enable row level security;
alter table public.cashflow_source_uploads enable row level security;
alter table public.cashflow_rules enable row level security;
alter table public.cashflow_records enable row level security;
alter table public.cashflow_audit_log enable row level security;

drop policy if exists "authenticated full access months" on public.cashflow_months;
create policy "authenticated full access months" on public.cashflow_months for all to authenticated using (true) with check (true);
drop policy if exists "authenticated full access uploads" on public.cashflow_source_uploads;
create policy "authenticated full access uploads" on public.cashflow_source_uploads for all to authenticated using (true) with check (true);
drop policy if exists "authenticated full access rules" on public.cashflow_rules;
create policy "authenticated full access rules" on public.cashflow_rules for all to authenticated using (true) with check (true);
drop policy if exists "authenticated full access records" on public.cashflow_records;
create policy "authenticated full access records" on public.cashflow_records for all to authenticated using (true) with check (true);
drop policy if exists "authenticated full access audit" on public.cashflow_audit_log;
create policy "authenticated full access audit" on public.cashflow_audit_log for all to authenticated using (true) with check (true);
