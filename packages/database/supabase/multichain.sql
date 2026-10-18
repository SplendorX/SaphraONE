-- SwiftPay Multichain receive: a deposit address per user per network,
-- swept to the user's Arc wallet over CCTP. The balance itself always lives
-- in the user's Arc wallet; these tables only track USDC on its way there.
-- The chain is the source of truth: a deposit is CREDITED only after the
-- mint is read back from the Arc RPC. Additive and idempotent.

-- One deposit wallet per user per network. `chain` is Circle's blockchain id
-- (BASE, BASE-SEPOLIA, ...), so testnet and mainnet rows never collide.
create table if not exists public.deposit_addresses (
  id uuid primary key default gen_random_uuid(),
  owner_wallet text not null references public.profiles(wallet_address) on delete restrict,
  chain text not null,
  address text not null,
  provider text not null default 'circle-dcw',
  provider_wallet_id text,
  last_checked_at timestamptz,
  last_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deposit_addresses_owner_chain_unique unique (owner_wallet, chain),
  constraint deposit_addresses_provider_check check (
    provider in ('circle-dcw', 'forwarder')
  )
);

create index if not exists deposit_addresses_address_idx
  on public.deposit_addresses (lower(address));

create unique index if not exists deposit_addresses_provider_wallet_unique
  on public.deposit_addresses (provider_wallet_id)
  where provider_wallet_id is not null;

create index if not exists deposit_addresses_activity_idx
  on public.deposit_addresses (last_activity_at desc nulls last);

-- One CCTP sweep: the address's whole balance burned on the source network
-- and minted to the owner's Arc wallet. Only one may be in flight per address.
create table if not exists public.chain_sweeps (
  id uuid primary key default gen_random_uuid(),
  deposit_address_id uuid not null references public.deposit_addresses(id) on delete restrict,
  owner_wallet text not null,
  chain text not null,
  state text not null default 'SWEEPING',
  amount text not null,
  amount_credited text,
  fee_units text,
  burn_tx_hash text,
  mint_tx_hash text,
  bridge_result jsonb,
  attempts integer not null default 1,
  last_error text,
  started_at timestamptz not null default now(),
  credited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chain_sweeps_state_check check (
    state in ('SWEEPING', 'BURNED', 'CREDITED', 'FAILED', 'NEEDS_REVIEW')
  )
);

-- SaphraONE's deposit fee on the sweep (USDC), taken out of `amount` before
-- the burn as App Kit's custom fee, to the platform fee wallet on the source
-- network. Pays for the gas Circle's Gas Station sponsors there.
alter table public.chain_sweeps add column if not exists service_fee text not null default '0';

create unique index if not exists chain_sweeps_one_in_flight
  on public.chain_sweeps (deposit_address_id)
  where state in ('SWEEPING', 'BURNED');

create index if not exists chain_sweeps_open_idx
  on public.chain_sweeps (state, updated_at)
  where state in ('SWEEPING', 'BURNED', 'FAILED');

create index if not exists chain_sweeps_owner_idx
  on public.chain_sweeps (owner_wallet, created_at desc);

create unique index if not exists chain_sweeps_mint_unique
  on public.chain_sweeps (lower(mint_tx_hash))
  where mint_tx_hash is not null;

-- Each USDC transfer into a deposit address. A replayed webhook or a second
-- poll finds the same (chain, source_tx_hash) and changes nothing.
create table if not exists public.chain_deposits (
  id uuid primary key default gen_random_uuid(),
  owner_wallet text not null,
  chain text not null,
  deposit_address_id uuid not null references public.deposit_addresses(id) on delete restrict,
  sweep_id uuid references public.chain_sweeps(id) on delete set null,
  state text not null default 'DETECTED',
  amount_in text not null,
  source_tx_hash text not null,
  sender_address text,
  provider_tx_id text,
  last_error text,
  detected_at timestamptz not null default now(),
  credited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chain_deposits_tx_unique unique (chain, source_tx_hash),
  constraint chain_deposits_state_check check (
    state in (
      'DETECTED', 'CONFIRMED', 'BELOW_MIN', 'SWEEPING', 'BURNED',
      'CREDITED', 'FAILED', 'NEEDS_REVIEW'
    )
  )
);

create index if not exists chain_deposits_owner_idx
  on public.chain_deposits (owner_wallet, created_at desc);

create index if not exists chain_deposits_address_open_idx
  on public.chain_deposits (deposit_address_id)
  where state in ('DETECTED', 'CONFIRMED', 'BELOW_MIN', 'SWEEPING', 'BURNED', 'FAILED');

create index if not exists chain_deposits_sweep_idx
  on public.chain_deposits (sweep_id);

-- Outbound cross-chain sends (Part 2 of the plan): burned on Arc, minted at
-- the destination. Created now so the schema lands in one migration.
create table if not exists public.chain_transfers (
  id uuid primary key default gen_random_uuid(),
  intent_id uuid,
  owner_wallet text not null,
  dest_chain text not null,
  dest_address text not null,
  amount text not null,
  fee_units text,
  amount_received text,
  burn_tx_hash text,
  mint_tx_hash text,
  bridge_result jsonb,
  state text not null default 'PENDING',
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chain_transfers_state_check check (
    state in ('PENDING', 'BURNED', 'COMPLETED', 'FAILED', 'NEEDS_REVIEW')
  )
);

-- SwiftPay's flat service fee on each send (paid as its own Arc transfer
-- before the burn). FAILED rows with a service_fee_tx_hash and no burn are
-- owed a refund.
alter table public.chain_transfers
  add column if not exists service_fee_units text,
  add column if not exists service_fee_tx_hash text;

create index if not exists chain_transfers_owner_idx
  on public.chain_transfers (owner_wallet, created_at desc);

-- One burn backs exactly one transfer.
create unique index if not exists chain_transfers_burn_unique
  on public.chain_transfers (lower(burn_tx_hash))
  where burn_tx_hash is not null;

create index if not exists chain_transfers_burned_idx
  on public.chain_transfers (updated_at)
  where state = 'BURNED';

-- Activity rows for USDC that arrived from another network carry source
-- 'deposit'. A superset of the previous list, so existing rows stay valid.
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

-- ─── Access ──────────────────────────────────────────────────────────────────
-- RLS on with no client access. Only the server's service-role client reads or
-- writes these rows, after authorizing the owner wallet.

alter table public.deposit_addresses enable row level security;
alter table public.chain_sweeps enable row level security;
alter table public.chain_deposits enable row level security;
alter table public.chain_transfers enable row level security;

revoke all on public.deposit_addresses from anon, authenticated;
revoke all on public.chain_sweeps from anon, authenticated;
revoke all on public.chain_deposits from anon, authenticated;
revoke all on public.chain_transfers from anon, authenticated;

grant select, insert, update, delete on public.deposit_addresses to service_role;
grant select, insert, update, delete on public.chain_sweeps to service_role;
grant select, insert, update, delete on public.chain_deposits to service_role;
grant select, insert, update, delete on public.chain_transfers to service_role;

drop policy if exists deposit_addresses_no_client_access on public.deposit_addresses;
create policy deposit_addresses_no_client_access
  on public.deposit_addresses for all using (false) with check (false);

drop policy if exists chain_sweeps_no_client_access on public.chain_sweeps;
create policy chain_sweeps_no_client_access
  on public.chain_sweeps for all using (false) with check (false);

drop policy if exists chain_deposits_no_client_access on public.chain_deposits;
create policy chain_deposits_no_client_access
  on public.chain_deposits for all using (false) with check (false);

drop policy if exists chain_transfers_no_client_access on public.chain_transfers;
create policy chain_transfers_no_client_access
  on public.chain_transfers for all using (false) with check (false);
