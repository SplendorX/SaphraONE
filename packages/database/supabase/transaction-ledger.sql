-- Transaction ledger: one verified row per on-chain transaction an account
-- makes through SaphraONE. The source of truth for USDC campaigns and
-- leaderboards (stage 2): every row was read back from the chain, keyed on the
-- transaction hash so a retry never counts twice.
-- Server-only: RLS on, no policies (the service role reads and writes).
-- Safe to run more than once.

create table if not exists public.transaction_ledger (
  id uuid primary key default gen_random_uuid(),
  tx_hash text not null,
  -- The account the transaction belongs to (its owner wallet, lowercase).
  wallet_address text not null,
  -- The feature that made it: send, batch, payroll, recurepay, circle,
  -- invoice, checkout, swap, save, ...
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

alter table public.transaction_ledger enable row level security;

-- The server reads and writes with the service role. Tables created after the
-- original `grant all on all tables` don't inherit it.
grant usage on schema public to service_role;
grant select, insert, update, delete on public.transaction_ledger to service_role;
