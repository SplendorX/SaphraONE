-- Transaction ledger and USDC campaigns.
--
-- 1. transaction_ledger: one verified row per on-chain transaction an account
--    makes through SaphraONE, read back from the chain and keyed on the
--    transaction hash so a retry never counts twice.
-- 2. campaigns + campaign_standings(): admin-defined USDC campaigns ranked
--    from the ledger.
-- 3. campaign_winners: the frozen result of an ended campaign, reviewed and
--    paid from the treasury one row at a time.
-- Server-only: RLS on, no policies (the service role reads and writes).
-- Safe to run more than once.

-- ── 1. Ledger ───────────────────────────────────────────────────────────────

create table if not exists public.transaction_ledger (
  id uuid primary key default gen_random_uuid(),
  tx_hash text not null,
  -- The account the transaction belongs to (its owner wallet, lowercase).
  wallet_address text not null,
  -- The feature that made it: send, batch, payroll, recurepay, circle,
  -- invoice, checkout, agent, swap, save, ...
  source text not null,
  token text not null,
  -- What reached payees, after fees and the account's own savings legs.
  amount numeric not null,
  amount_usd numeric not null,
  -- Platform fees the account paid in this transaction.
  fee_amount numeric not null default 0,
  fee_usd numeric not null default 0,
  -- Who was paid: { "0xabc…": 12.5, ... } in `token`.
  payees jsonb not null default '{}'::jsonb,
  payee_count integer not null default 0,
  -- Counts toward campaigns. When false, ineligible_reason says why.
  eligible boolean not null,
  ineligible_reason text,
  chain_id integer not null,
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,

  constraint transaction_ledger_unique_tx unique (tx_hash, wallet_address),
  constraint transaction_ledger_amounts_check check (amount >= 0 and amount_usd >= 0 and fee_amount >= 0 and fee_usd >= 0)
);

-- Leaderboards read a window of eligible rows, then group by wallet.
create index if not exists transaction_ledger_eligible_time_idx
  on public.transaction_ledger (eligible, occurred_at desc);
create index if not exists transaction_ledger_wallet_time_idx
  on public.transaction_ledger (wallet_address, occurred_at desc);
create index if not exists transaction_ledger_source_time_idx
  on public.transaction_ledger (source, occurred_at desc);

-- Where the backfill (and the Agent Wallet sweep) got to.
create table if not exists public.ledger_backfill_state (
  id text primary key,
  cursor_at timestamptz,
  cursor_id text,
  processed bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- ── 2. Campaigns ────────────────────────────────────────────────────────────

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text not null default '',
  -- What ranks a wallet: USD volume paid, number of payments, USD fees paid,
  -- or distinct people paid.
  metric text not null,
  -- Ledger sources that count; empty means every eligible payment.
  sources text[] not null default '{}',
  -- A payment smaller than this (USD) is ignored.
  min_amount_usd numeric not null default 0,
  -- A wallet needs at least this score to place (and, for threshold, to win).
  min_score numeric not null default 0,
  excluded_wallets text[] not null default '{}',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  prize_pool_usdc numeric not null,
  -- top: payout_splits[i] percent of the pool to rank i.
  -- threshold: threshold_prize_usdc to every qualifying wallet, best rank
  -- first, until the pool runs out.
  payout_type text not null,
  payout_splits numeric[] not null default '{}',
  threshold_prize_usdc numeric not null default 0,
  status text not null default 'draft',
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint campaigns_metric_check check (metric in ('volume', 'payments', 'fees', 'unique_payees')),
  constraint campaigns_payout_type_check check (payout_type in ('top', 'threshold')),
  constraint campaigns_status_check check (status in ('draft', 'live', 'finalized', 'paid', 'cancelled')),
  constraint campaigns_window_check check (ends_at > starts_at),
  constraint campaigns_amounts_check check (prize_pool_usdc >= 0 and min_amount_usd >= 0 and min_score >= 0 and threshold_prize_usdc >= 0)
);

create index if not exists campaigns_status_idx on public.campaigns (status, ends_at desc);

-- Every wallet's standing in a campaign, best first. Callers filter and page
-- the result (rank <= 10, wallet_address = …).
create or replace function public.campaign_standings(p_campaign uuid)
returns table (
  wallet_address text,
  score numeric,
  payments bigint,
  volume_usd numeric,
  fees_usd numeric,
  unique_payees bigint,
  rank bigint
)
language sql
stable
as $$
  with c as (
    select * from public.campaigns where id = p_campaign
  ),
  counted as (
    select l.*
    from public.transaction_ledger l, c
    where l.eligible
      and l.occurred_at >= c.starts_at
      and l.occurred_at < c.ends_at
      and (cardinality(c.sources) = 0 or l.source = any (c.sources))
      and l.amount_usd >= c.min_amount_usd
      and not (l.wallet_address = any (c.excluded_wallets))
  ),
  totals as (
    select
      counted.wallet_address,
      count(*) as payments,
      sum(counted.amount_usd) as volume_usd,
      sum(counted.fee_usd) as fees_usd
    from counted
    group by counted.wallet_address
  ),
  payees as (
    select counted.wallet_address, count(distinct payee) as unique_payees
    from counted, jsonb_object_keys(counted.payees) as payee
    group by counted.wallet_address
  ),
  scored as (
    select
      t.wallet_address,
      case c.metric
        when 'volume' then t.volume_usd
        when 'payments' then t.payments::numeric
        when 'fees' then t.fees_usd
        else coalesce(p.unique_payees, 0)::numeric
      end as score,
      t.payments,
      t.volume_usd,
      t.fees_usd,
      coalesce(p.unique_payees, 0) as unique_payees
    from totals t
    left join payees p on p.wallet_address = t.wallet_address
    cross join c
  )
  select
    s.wallet_address,
    s.score,
    s.payments,
    s.volume_usd,
    s.fees_usd,
    s.unique_payees,
    -- Ties go to the bigger volume, then the wallet address, so a rank never
    -- changes between two reads of the same data.
    row_number() over (order by s.score desc, s.volume_usd desc, s.wallet_address) as rank
  from scored s, c
  where s.score > 0 and s.score >= c.min_score
$$;

-- ── 3. Winners and payouts ──────────────────────────────────────────────────

create table if not exists public.campaign_winners (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  wallet_address text not null,
  rank integer not null,
  score numeric not null,
  amount_usdc numeric not null,
  -- REVIEW → PENDING (payout sent) → PAID; REJECTED by an admin; a payout
  -- that may or may not have gone out stays PENDING with last_error.
  status text not null default 'REVIEW',
  payout_tx_hash text,
  last_error text,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint campaign_winners_unique unique (campaign_id, wallet_address),
  constraint campaign_winners_status_check check (status in ('REVIEW', 'PENDING', 'PAID', 'REJECTED')),
  constraint campaign_winners_amount_check check (amount_usdc > 0)
);

create index if not exists campaign_winners_campaign_idx on public.campaign_winners (campaign_id, rank);

-- ── Access ──────────────────────────────────────────────────────────────────

alter table public.transaction_ledger enable row level security;
alter table public.ledger_backfill_state enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_winners enable row level security;

revoke all on function public.campaign_standings(uuid) from public, anon, authenticated;

-- The server reads and writes with the service role. Tables created after the
-- original `grant all on all tables` don't inherit it.
grant usage on schema public to service_role;
grant select, insert, update, delete on
  public.transaction_ledger,
  public.ledger_backfill_state,
  public.campaigns,
  public.campaign_winners
to service_role;
grant execute on function public.campaign_standings(uuid) to service_role;
