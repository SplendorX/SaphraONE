-- Naira on-ramp and off-ramp through Centiiv Protocol, settled on Arc.
-- SwiftPay never holds the money: Centiiv's liquidity network converts and
-- settles on-chain. These tables track each order, the user's verified bank
-- accounts, and the signed webhooks Centiiv sends. Additive and idempotent.

create table if not exists public.ramp_orders (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null references public.profiles(wallet_address) on delete restrict,
  provider text not null default 'CENTIIV',
  direction text not null,
  fiat_currency text not null default 'NGN',
  -- Decimal strings, never floats.
  fiat_amount text,
  usdc_amount text,
  -- What the payer must send: NGN for an on-ramp, USDC for an off-ramp.
  total_to_pay text,
  quoted_rate text,
  quoted_fee text,
  quoted_receivable text,
  status text not null default 'PENDING',
  provider_order_id text,
  environment text not null,
  -- On-ramp: the virtual bank account the user pays into.
  payin_instructions jsonb,
  -- Off-ramp: Centiiv's temporary Arc wallet the user sends USDC to.
  deposit_address text,
  deposit_expires_at timestamptz,
  beneficiary_id uuid,
  -- Bank name, masked account number and the name the bank resolved.
  beneficiary_snapshot jsonb,
  -- Off-ramp: the user's USDC transfer to Centiiv.
  user_tx_hash text,
  -- On-ramp: Centiiv's USDC delivery to the user.
  delivery_tx_hash text,
  failure_reason text,
  idempotency_key text,
  activity_recorded_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ramp_orders_direction_check check (direction in ('ONRAMP', 'OFFRAMP')),
  constraint ramp_orders_status_check check (
    status in ('PENDING', 'PROCESSING', 'FULFILLED', 'FAILED', 'EXPIRED', 'REFUNDED', 'CANCELLED')
  ),
  constraint ramp_orders_environment_check check (environment in ('SANDBOX', 'LIVE')),
  constraint ramp_orders_currency_check check (fiat_currency in ('NGN'))
);

create unique index if not exists ramp_orders_provider_id_unique
  on public.ramp_orders (provider, provider_order_id)
  where provider_order_id is not null;

-- One on-chain transfer can settle exactly one withdrawal.
create unique index if not exists ramp_orders_user_tx_unique
  on public.ramp_orders (user_tx_hash)
  where user_tx_hash is not null;

-- A retried "Continue" tap with the same key returns the first order.
create unique index if not exists ramp_orders_idempotency_unique
  on public.ramp_orders (wallet_address, idempotency_key)
  where idempotency_key is not null;

create index if not exists ramp_orders_wallet_idx
  on public.ramp_orders (wallet_address, created_at desc);

create index if not exists ramp_orders_open_idx
  on public.ramp_orders (updated_at)
  where status in ('PENDING', 'PROCESSING');

create table if not exists public.ramp_beneficiaries (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null references public.profiles(wallet_address) on delete cascade,
  currency text not null default 'NGN',
  bank_code text not null,
  bank_name text,
  account_number text not null,
  -- From Centiiv's bank name check, never typed by the user.
  account_name text not null,
  created_at timestamptz not null default now(),
  constraint ramp_beneficiaries_unique unique (wallet_address, bank_code, account_number)
);

create table if not exists public.ramp_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'CENTIIV',
  -- The svix-id header, so a replayed delivery is recognised.
  event_id text not null,
  provider_order_id text,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint ramp_webhook_events_unique unique (provider, event_id)
);

alter table public.ramp_orders enable row level security;
alter table public.ramp_beneficiaries enable row level security;
alter table public.ramp_webhook_events enable row level security;

revoke all on public.ramp_orders from anon, authenticated;
revoke all on public.ramp_beneficiaries from anon, authenticated;
revoke all on public.ramp_webhook_events from anon, authenticated;

grant select, insert, update, delete on public.ramp_orders to service_role;
grant select, insert, update, delete on public.ramp_beneficiaries to service_role;
grant select, insert, update, delete on public.ramp_webhook_events to service_role;

drop policy if exists ramp_orders_no_client_access on public.ramp_orders;
create policy ramp_orders_no_client_access
  on public.ramp_orders
  for all
  using (false)
  with check (false);

drop policy if exists ramp_beneficiaries_no_client_access on public.ramp_beneficiaries;
create policy ramp_beneficiaries_no_client_access
  on public.ramp_beneficiaries
  for all
  using (false)
  with check (false);

drop policy if exists ramp_webhook_events_no_client_access on public.ramp_webhook_events;
create policy ramp_webhook_events_no_client_access
  on public.ramp_webhook_events
  for all
  using (false)
  with check (false);

-- Activity rows for bank deposits and withdrawals carry source 'ramp'. A
-- superset of the list in multichain.sql, so existing rows stay valid.
alter table public.account_activity
  drop constraint if exists account_activity_source_check;

alter table public.account_activity
  add constraint account_activity_source_check check (
    source in (
      'send', 'request', 'payroll', 'circle', 'swap', 'invoice',
      'save', 'earn', 'batch', 'recurepay', 'agent', 'points', 'checkout',
      'deposit', 'ramp'
    )
  );
