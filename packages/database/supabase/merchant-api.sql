-- SaphraONE Checkout for websites and platforms (ONLINE-CHECKOUT-PLAN.md).
-- A site's server creates a checkout session with a secret API key; each
-- session wraps one business_charges row (kind ONLINE), so payment
-- verification, matching and expiry stay exactly as for in-person charges.
-- Additive and idempotent: safe to run before the code deploys.
-- Requires business-checkout.sql.

-- ── Charges: online kind, refunded total ────────────────────────────────────

alter table public.business_charges
  drop constraint if exists business_charges_kind_check;
alter table public.business_charges
  add constraint business_charges_kind_check check (
    kind in ('MERCHANT', 'STOREFRONT', 'ONLINE')
  );

alter table public.business_charges
  add column if not exists amount_refunded text not null default '0';

-- ── API keys ────────────────────────────────────────────────────────────────

create table if not exists public.merchant_api_keys (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null references public.profiles(wallet_address) on delete restrict,
  mode text not null,
  name text not null,
  key_prefix text not null,
  key_hash text not null,
  created_by_wallet text not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint merchant_api_keys_hash_unique unique (key_hash),
  constraint merchant_api_keys_mode_check check (mode in ('live', 'test')),
  constraint merchant_api_keys_name_len check (char_length(name) between 1 and 60)
);

create index if not exists merchant_api_keys_active_idx
  on public.merchant_api_keys (wallet_address)
  where revoked_at is null;

-- ── Checkout sessions ───────────────────────────────────────────────────────

create table if not exists public.checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  public_id text not null,
  charge_id uuid not null references public.business_charges(id) on delete restrict,
  wallet_address text not null,
  api_key_id uuid references public.merchant_api_keys(id) on delete set null,
  mode text not null,
  client_reference_id text,
  customer_email text,
  line_items jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  success_url text not null,
  cancel_url text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  constraint checkout_sessions_public_id_unique unique (public_id),
  constraint checkout_sessions_charge_unique unique (charge_id),
  constraint checkout_sessions_mode_check check (mode in ('live', 'test')),
  constraint checkout_sessions_reference_len check (
    client_reference_id is null or char_length(client_reference_id) <= 200
  ),
  constraint checkout_sessions_email_len check (
    customer_email is null or char_length(customer_email) <= 254
  ),
  constraint checkout_sessions_success_url_len check (char_length(success_url) <= 2048),
  constraint checkout_sessions_cancel_url_len check (
    cancel_url is null or char_length(cancel_url) <= 2048
  )
);

create index if not exists checkout_sessions_wallet_idx
  on public.checkout_sessions (wallet_address, created_at desc);

-- A retried create with the same Idempotency-Key returns the first session.
create unique index if not exists checkout_sessions_idempotency_unique
  on public.checkout_sessions (wallet_address, idempotency_key)
  where idempotency_key is not null;

-- ── Refunds (any charge kind; used from Phase 3) ────────────────────────────

create table if not exists public.business_charge_refunds (
  id uuid primary key default gen_random_uuid(),
  public_id text not null,
  charge_id uuid not null references public.business_charges(id) on delete restrict,
  wallet_address text not null,
  amount text not null,
  currency text not null,
  destination_wallet text,
  status text not null default 'REQUESTED',
  tx_hash text,
  reason text,
  source text not null default 'DASHBOARD',
  created_by_wallet text,
  created_at timestamptz not null default now(),
  succeeded_at timestamptz,
  constraint business_charge_refunds_public_id_unique unique (public_id),
  constraint business_charge_refunds_tx_unique unique (tx_hash),
  constraint business_charge_refunds_status_check check (
    status in ('REQUESTED', 'SUCCEEDED', 'CANCELLED')
  ),
  constraint business_charge_refunds_currency_check check (currency in ('USDC', 'EURC')),
  constraint business_charge_refunds_source_check check (source in ('DASHBOARD', 'API')),
  constraint business_charge_refunds_reason_len check (
    reason is null or char_length(reason) <= 200
  )
);

create index if not exists business_charge_refunds_charge_idx
  on public.business_charge_refunds (charge_id);

-- ── Webhooks (used from Phase 2) ────────────────────────────────────────────

create table if not exists public.merchant_webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null references public.profiles(wallet_address) on delete restrict,
  url text not null,
  secret_encrypted text not null,
  events text[] not null default '{}',
  disabled_at timestamptz,
  failing_since timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint merchant_webhook_endpoints_url_len check (char_length(url) <= 2048)
);

create index if not exists merchant_webhook_endpoints_wallet_idx
  on public.merchant_webhook_endpoints (wallet_address);

create table if not exists public.merchant_webhook_events (
  id uuid primary key default gen_random_uuid(),
  public_id text not null,
  wallet_address text not null,
  type text not null,
  dedupe_key text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint merchant_webhook_events_public_id_unique unique (public_id),
  constraint merchant_webhook_events_dedupe_unique unique (dedupe_key)
);

create index if not exists merchant_webhook_events_wallet_idx
  on public.merchant_webhook_events (wallet_address, created_at desc);

create table if not exists public.merchant_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.merchant_webhook_events(id) on delete cascade,
  endpoint_id uuid not null references public.merchant_webhook_endpoints(id) on delete cascade,
  wallet_address text not null,
  status text not null default 'PENDING',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  last_status_code integer,
  last_error text,
  last_attempt_at timestamptz,
  succeeded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint merchant_webhook_deliveries_unique unique (event_id, endpoint_id),
  constraint merchant_webhook_deliveries_status_check check (
    status in ('PENDING', 'SUCCEEDED', 'FAILED')
  )
);

create index if not exists merchant_webhook_deliveries_due_idx
  on public.merchant_webhook_deliveries (next_attempt_at)
  where status = 'PENDING';

create index if not exists merchant_webhook_deliveries_wallet_idx
  on public.merchant_webhook_deliveries (wallet_address, created_at desc);

-- ── Access: server only ─────────────────────────────────────────────────────

alter table public.merchant_api_keys enable row level security;
alter table public.checkout_sessions enable row level security;
alter table public.business_charge_refunds enable row level security;
alter table public.merchant_webhook_endpoints enable row level security;
alter table public.merchant_webhook_events enable row level security;
alter table public.merchant_webhook_deliveries enable row level security;

revoke all on public.merchant_api_keys from anon, authenticated;
revoke all on public.checkout_sessions from anon, authenticated;
revoke all on public.business_charge_refunds from anon, authenticated;
revoke all on public.merchant_webhook_endpoints from anon, authenticated;
revoke all on public.merchant_webhook_events from anon, authenticated;
revoke all on public.merchant_webhook_deliveries from anon, authenticated;

grant select, insert, update, delete on public.merchant_api_keys to service_role;
grant select, insert, update, delete on public.checkout_sessions to service_role;
grant select, insert, update, delete on public.business_charge_refunds to service_role;
grant select, insert, update, delete on public.merchant_webhook_endpoints to service_role;
grant select, insert, update, delete on public.merchant_webhook_events to service_role;
grant select, insert, update, delete on public.merchant_webhook_deliveries to service_role;

drop policy if exists merchant_api_keys_no_client_access on public.merchant_api_keys;
create policy merchant_api_keys_no_client_access
  on public.merchant_api_keys for all using (false) with check (false);

drop policy if exists checkout_sessions_no_client_access on public.checkout_sessions;
create policy checkout_sessions_no_client_access
  on public.checkout_sessions for all using (false) with check (false);

drop policy if exists business_charge_refunds_no_client_access on public.business_charge_refunds;
create policy business_charge_refunds_no_client_access
  on public.business_charge_refunds for all using (false) with check (false);

drop policy if exists merchant_webhook_endpoints_no_client_access on public.merchant_webhook_endpoints;
create policy merchant_webhook_endpoints_no_client_access
  on public.merchant_webhook_endpoints for all using (false) with check (false);

drop policy if exists merchant_webhook_events_no_client_access on public.merchant_webhook_events;
create policy merchant_webhook_events_no_client_access
  on public.merchant_webhook_events for all using (false) with check (false);

drop policy if exists merchant_webhook_deliveries_no_client_access on public.merchant_webhook_deliveries;
create policy merchant_webhook_deliveries_no_client_access
  on public.merchant_webhook_deliveries for all using (false) with check (false);
