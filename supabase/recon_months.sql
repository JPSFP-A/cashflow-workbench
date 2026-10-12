-- Reconciliation by month for the Cash Workbench.
-- One row per saved month: net cash flow by section, what the account filter removes,
-- how many rules changed since the month was last saved, and the FinModel balance sheet
-- cash (cash and short-term deposits plus restricted cash) from the active baseline version.
--
-- SECURITY INVOKER: row level security on the cashflow_* and fm_* tables applies to the caller,
-- so someone without FinModel access gets nulls for the FinModel columns, not someone else's data.

create or replace function public.cashflow_recon_months()
returns table (
  month_key text,
  status text,
  last_processed_at timestamptz,
  rows_total bigint,
  unmapped bigint,
  receipts numeric,
  disbursements numeric,
  financing numeric,
  net_flow numeric,
  other_not_in_net numeric,
  excluded_rows bigint,
  excluded_amt numeric,
  rules_changed_since bigint,
  items_total numeric,
  saved_unexplained numeric,
  finmod_version text,
  finmod_opening numeric,
  finmod_closing numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with sec as (
    select base_case_row, lower(section) as section
    from cashflow_sections where coalesce(active, true)
  ),
  agg as (
    select
      m.id as month_id,
      m.month_key,
      count(*) as rows_total,
      count(*) filter (
        where not coalesce(r.mapped, false)
          and not (r.data_source = 'Cashbook' and f.include is false)
      ) as unmapped,
      coalesce(sum(r.signed_amount) filter (where s.section = 'receipts'), 0) as receipts,
      coalesce(sum(r.signed_amount) filter (where s.section = 'disbursements'), 0) as disbursements,
      coalesce(sum(r.signed_amount) filter (where s.section = 'financing'), 0) as financing,
      coalesce(sum(r.signed_amount) filter (where s.section is not null), 0) as net_flow,
      coalesce(sum(r.signed_amount) filter (where s.section is null and coalesce(r.base_case_row, '') <> ''), 0) as other_not_in_net,
      count(*) filter (where r.data_source = 'Cashbook' and f.include is false) as excluded_rows,
      coalesce(sum(r.signed_amount) filter (where r.data_source = 'Cashbook' and f.include is false), 0) as excluded_amt
    from cashflow_months m
    join cashflow_records r on r.month_id = m.id
    left join cashflow_account_filters f on f.fpc = r.fpc
    left join sec s on s.base_case_row = r.base_case_row
    group by m.id, m.month_key
  ),
  fv as (
    select id, code from fm_versions where status = 'active' and is_baseline limit 1
  ),
  cash as (
    select f.year, f.month, sum(f.value) * 1000 as bs_cash
    from fm_facts f join fv on fv.id = f.version_id
    where f.is_actual and f.line_id in ('BS:cash_and_short_term_deposits', 'BS:restricted_cash')
    group by f.year, f.month
  )
  select
    m.month_key,
    m.status,
    m.last_processed_at,
    coalesce(a.rows_total, 0),
    coalesce(a.unmapped, 0),
    coalesce(a.receipts, 0),
    coalesce(a.disbursements, 0),
    coalesce(a.financing, 0),
    coalesce(a.net_flow, 0),
    coalesce(a.other_not_in_net, 0),
    coalesce(a.excluded_rows, 0),
    coalesce(a.excluded_amt, 0),
    (select count(*) from cashflow_rules cr where cr.updated_at > m.last_processed_at)
      + (select count(*) from cashflow_account_filters af where af.updated_at > m.last_processed_at),
    coalesce((select sum((e ->> 'amount')::numeric) from jsonb_array_elements(coalesce(u.items, '[]'::jsonb)) e), 0),
    u.amount,
    (select code from fv),
    co.bs_cash,
    cc.bs_cash
  from cashflow_months m
  left join agg a on a.month_id = m.id
  left join cashflow_unexplained u on u.month_key = m.month_key
  left join cash cc on cc.year = split_part(m.month_key, '-', 1)::int and cc.month = split_part(m.month_key, '-', 2)::int
  left join cash co on (co.year, co.month) = (
    case when split_part(m.month_key, '-', 2)::int = 1 then split_part(m.month_key, '-', 1)::int - 1 else split_part(m.month_key, '-', 1)::int end,
    case when split_part(m.month_key, '-', 2)::int = 1 then 12 else split_part(m.month_key, '-', 2)::int - 1 end
  )
  order by m.month_key;
$$;

revoke all on function public.cashflow_recon_months() from public;
revoke all on function public.cashflow_recon_months() from anon;
grant execute on function public.cashflow_recon_months() to authenticated;
