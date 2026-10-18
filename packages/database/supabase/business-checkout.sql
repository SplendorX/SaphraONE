-- SwiftPay Checkout: quick in-person charges for Business accounts.
-- A merchant charge (or a storefront charge the customer types in) is paid to
-- the business wallet by any route; the chain is the source of truth and each
-- transaction can be claimed by exactly one charge. Additive and idempotent.

create table if not exists public.business_charges (
  id uuid primary key default gen_random_uuid(),
  public_id text not null,
  wallet_address text not null references public.profiles(wallet_address) on delete restrict,
  kind text not null default 'MERCHANT',
  status text not null default 'OPEN',
  currency text not null default 'USDC',
  amount text not null,
  tip_amount text not null default '0',
  amount_received text not null default '0',
  overpayment text not null default '0',
  note text,
  payer_wallet text,
  pending_method text,
  pending_ref text,
  pending_started_at timestamptz,
  reported_amount text,
  created_block bigint,
  idempotency_key text,
  expires_at timestamptz not null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_charges_public_id_unique unique (public_id),
  constraint business_charges_kind_check check (
    kind in ('MERCHANT', 'STOREFRONT')
  ),
  constraint business_charges_status_check check (
    status in ('OPEN', 'PAID', 'EXPIRED', 'CANCELLED')
  ),
  constraint business_charges_currency_check check (
    currency in ('USDC', 'EURC')
  ),
  constraint business_charges_pending_method_check check (
    pending_method is null
    or pending_method in ('WALLET', 'SWIFTPAY', 'ONRAMP', 'BRIDGE')
  ),
  constraint business_charges_note_len check (
    note is null or char_length(note) <= 140
  )
);

create index if not exists business_charges_wallet_idx
  on public.business_charges (wallet_address, created_at desc);

-- A retried "Charge" tap with the same key returns the first charge.
create unique index if not exists business_charges_idempotency_unique
  on public.business_charges (wallet_address, idempotency_key)
  where idempotency_key is not null;

create index if not exists business_charges_open_expiry_idx
  on public.business_charges (expires_at)
  where status = 'OPEN';

create index if not exists business_charges_matchable_idx
  on public.business_charges (wallet_address, created_block)
  where status = 'OPEN' and pending_method in ('ONRAMP', 'BRIDGE');

create table if not exists public.business_charge_payments (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null references public.business_charges(id) on delete restrict,
  tx_hash text not null,
  amount text not null,
  asset text not null,
  source text not null,
  matched_by text not null,
  payer_wallet text,
  block_number bigint,
  status text not null default 'CONFIRMED',
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint business_charge_payments_tx_unique unique (tx_hash),
  constraint business_charge_payments_asset_check check (
    asset in ('USDC', 'EURC')
  ),
  constraint business_charge_payments_source_check check (
    source in ('SWIFTPAY', 'WALLET', 'ONRAMP', 'BRIDGE', 'RECONCILE')
  ),
  constraint business_charge_payments_matched_by_check check (
    matched_by in ('RECEIPT', 'SCAN')
  )
);

create index if not exists business_charge_payments_charge_idx
  on public.business_charge_payments (charge_id);

-- Where the hash-less matcher (card/bank, bridge) last read each merchant's
-- incoming transfers. Same shape as incoming_transfer_cursors.
create table if not exists public.business_checkout_scan_cursors (
  chain_id integer not null,
  wallet_address text not null,
  last_block bigint not null,
  updated_at timestamptz not null default now(),
  primary key (chain_id, wallet_address)
);

alter table public.business_charges enable row level security;
alter table public.business_charge_payments enable row level security;
alter table public.business_checkout_scan_cursors enable row level security;

revoke all on public.business_charges from anon, authenticated;
revoke all on public.business_charge_payments from anon, authenticated;
revoke all on public.business_checkout_scan_cursors from anon, authenticated;

grant select, insert, update, delete on public.business_charges to service_role;
grant select, insert, update, delete on public.business_charge_payments to service_role;
grant select, insert, update, delete on public.business_checkout_scan_cursors to service_role;

drop policy if exists business_charges_no_client_access on public.business_charges;
create policy business_charges_no_client_access
  on public.business_charges
  for all
  using (false)
  with check (false);

drop policy if exists business_charge_payments_no_client_access on public.business_charge_payments;
create policy business_charge_payments_no_client_access
  on public.business_charge_payments
  for all
  using (false)
  with check (false);

drop policy if exists business_checkout_scan_cursors_no_client_access on public.business_checkout_scan_cursors;
create policy business_checkout_scan_cursors_no_client_access
  on public.business_checkout_scan_cursors
  for all
  using (false)
  with check (false);

-- Activity rows from charge payers carry source 'checkout'. 'points' is
-- already written by the app but was missing from the constraint. A superset
-- of the previous list, so existing rows stay valid.
alter table public.account_activity
  drop constraint if exists account_activity_source_check;

-- The full list of sources (apps/web/lib/activity/types.ts), the same in every
-- file that sets this constraint, so re-running any one never drops a source
-- rows already use.
alter table public.account_activity
  add constraint account_activity_source_check check (
    source in (
      'send', 'request', 'payroll', 'circle', 'swap', 'invoice',
      'save', 'earn', 'batch', 'recurepay', 'agent', 'points', 'checkout',
      'deposit', 'ramp'
    )
  );
