-- Creator Partners (CREATOR-PARTNERS-PLAN.md): creators' branded links
-- (/join/<code>) give new accounts a welcome package for a set period, and
-- the creator a contract commission.
--   partner → offer (one campaign, its link code, perks and budget) → member
-- Server-only tables: RLS on, no policies (the service role reads and writes).
-- Needs rewards-v2.sql first. Safe to run more than once.

-- 1. New ledger entry types (the full list, as in rewards-v2.sql, plus two).
alter table public.swiftpoints_ledger_entries
  drop constraint if exists swiftpoints_ledger_entries_entry_type_check;

alter table public.swiftpoints_ledger_entries
  add constraint swiftpoints_ledger_entries_entry_type_check check (
    entry_type in (
      'REFERRER_PERSONAL_QUALIFICATION_REWARD',
      'REFERRER_BUSINESS_QUALIFICATION_REWARD',
      'REFERRED_PERSONAL_QUALIFICATION_REWARD',
      'REFERRED_BUSINESS_QUALIFICATION_REWARD',
      'REFERRER_PERSONAL_ACTIVITY_CASHBACK',
      'REFERRER_BUSINESS_ACTIVITY_CASHBACK',
      'TRANSACTION_CASHBACK',
      'STREAK_REWARD',
      'QUEST_REWARD',
      'DISCOUNT_CLAIM',
      'REDEMPTION',
      'PURCHASE',
      'GIFT_SENT',
      'GIFT_RECEIVED',
      'ENTITLEMENT_UNLOCK',
      'ADMIN_ADJUSTMENT',
      'REVERSAL',
      'PARTNER_WELCOME_POINTS',
      'PARTNER_CASHBACK_BOOST'
    )
  );

-- 2. Partners: the creator, their wallet and contract terms.
create table if not exists public.creator_partners (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null unique,
  display_name text not null,
  handle text,
  avatar_url text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'PAUSED', 'ENDED')),
  -- Null: the normal referral tiers. Otherwise the contract rate.
  commission_bps integer check (commission_bps is null or commission_bps between 0 and 5000),
  -- FIXED: exactly the contract rate. AT_LEAST_TIER: whichever is higher.
  commission_mode text not null default 'AT_LEAST_TIER' check (commission_mode in ('FIXED', 'AT_LEAST_TIER')),
  contract_starts_at timestamptz,
  contract_ends_at timestamptz,
  -- Paid once per activated member, at most bounty_monthly_cap a month.
  bounty_usdc numeric not null default 0 check (bounty_usdc >= 0),
  bounty_monthly_cap integer not null default 0 check (bounty_monthly_cap >= 0),
  kyc_status text not null default 'NONE' check (kyc_status in ('NONE', 'PENDING', 'VERIFIED')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Offers: one campaign under a partner, with its own link code.
create table if not exists public.partner_offers (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.creator_partners(id) on delete restrict,
  code text not null unique check (code ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$'),
  title text not null,
  headline text not null default '',
  terms_md text not null default '',
  status text not null default 'DRAFT' check (status in ('DRAFT', 'LIVE', 'PAUSED', 'ENDED')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  perk_days integer not null default 30 check (perk_days between 1 and 365),
  max_members integer check (max_members is null or max_members > 0),
  budget_usdc numeric not null default 0 check (budget_usdc >= 0),
  spent_usdc numeric not null default 0 check (spent_usdc >= 0),
  members_count integer not null default 0 check (members_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists partner_offers_partner_idx on public.partner_offers (partner_id);

-- 4. The perks an offer gives, one row per kind; `config` holds its numbers.
create table if not exists public.partner_offer_perks (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.partner_offers(id) on delete cascade,
  kind text not null check (
    kind in ('FEE_REBATE', 'WELCOME_POINTS', 'CASHBACK_BOOST', 'ALLIE_PRO_TRIAL', 'PREMIUM_DISCOUNT')
  ),
  config jsonb not null default '{}'::jsonb,
  unique (offer_id, kind)
);

-- 5. Members: accounts created through an offer's link.
create table if not exists public.partner_members (
  wallet_address text primary key,
  offer_id uuid not null references public.partner_offers(id) on delete restrict,
  partner_id uuid not null references public.creator_partners(id) on delete restrict,
  referral_id uuid,
  perks_start_at timestamptz not null default now(),
  perks_end_at timestamptz not null,
  perks_status text not null default 'ACTIVE' check (
    perks_status in ('ACTIVE', 'NO_PERKS', 'HELD', 'REVOKED', 'ENDED')
  ),
  no_perks_reason text,
  signup_ip_hash text,
  signup_agent_hash text,
  trial_granted_at timestamptz,
  bounty_paid_at timestamptz,
  ending_notice_at timestamptz,
  reviewed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists partner_members_offer_idx on public.partner_members (offer_id, created_at desc);
create index if not exists partner_members_ip_idx on public.partner_members (signup_ip_hash, created_at desc);

-- 6. Perk claims: USDC rebates paid out of the treasury.
create table if not exists public.partner_perk_claims (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null,
  amount_usdc numeric not null check (amount_usdc > 0),
  status text not null default 'PENDING' check (status in ('PENDING', 'PAID', 'FAILED', 'REVIEW')),
  automatic boolean not null default false,
  payout_tx_hash text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists partner_perk_claims_wallet_idx on public.partner_perk_claims (wallet_address, created_at desc);

-- 7. One row per use of a perk. `use_key` is the transaction hash, purchase
--    id or "welcome", so a retry never pays twice.
--    PENDING → CLAIMABLE (after the hold) → CLAIMED (USDC) / CREDITED (points)
--    GRANTED: a perk with nothing to pay (the ALLIE Pro trial).
create table if not exists public.partner_perk_events (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null,
  offer_id uuid not null references public.partner_offers(id) on delete restrict,
  kind text not null,
  use_key text not null,
  amount_usdc numeric not null default 0 check (amount_usdc >= 0),
  points numeric not null default 0 check (points >= 0),
  -- What it costs the offer's budget, in USD (points at $0.01).
  budget_usd numeric not null default 0 check (budget_usd >= 0),
  status text not null default 'PENDING' check (
    status in ('PENDING', 'CLAIMABLE', 'CLAIMED', 'CREDITED', 'GRANTED', 'REVERSED')
  ),
  claimable_at timestamptz not null default now(),
  claim_id uuid references public.partner_perk_claims(id) on delete set null,
  ledger_entry_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (wallet_address, kind, use_key)
);

create index if not exists partner_perk_events_wallet_idx on public.partner_perk_events (wallet_address, status);
create index if not exists partner_perk_events_offer_idx on public.partner_perk_events (offer_id, created_at desc);
create index if not exists partner_perk_events_due_idx on public.partner_perk_events (status, claimable_at);

-- 8. Premium purchases: how much of one a partner discount gave back, so a
--    points discount is only claimed on what was really paid.
alter table public.premium_purchases
  add column if not exists partner_rebate_usdc numeric not null default 0 check (partner_rebate_usdc >= 0);

-- 9. Take `p_amount` from an offer's budget, only if it fits. Concurrent
--    perks can't overspend: the row is locked while it's checked.
create or replace function public.partner_reserve_budget(p_offer_id uuid, p_amount numeric)
returns boolean
language plpgsql
as $$
declare
  v_budget numeric;
  v_spent numeric;
begin
  if p_amount <= 0 then
    return true;
  end if;
  select budget_usdc, spent_usdc into v_budget, v_spent
  from public.partner_offers where id = p_offer_id for update;
  if not found or v_spent + p_amount > v_budget then
    return false;
  end if;
  update public.partner_offers
  set spent_usdc = v_spent + p_amount, updated_at = now()
  where id = p_offer_id;
  return true;
end;
$$;

-- Give back budget a reversed perk had taken.
create or replace function public.partner_release_budget(p_offer_id uuid, p_amount numeric)
returns void
language plpgsql
as $$
begin
  update public.partner_offers
  set spent_usdc = greatest(0, spent_usdc - greatest(p_amount, 0)), updated_at = now()
  where id = p_offer_id;
end;
$$;

-- Count a new member with perks, only while the offer has room.
create or replace function public.partner_take_seat(p_offer_id uuid)
returns boolean
language plpgsql
as $$
declare
  v_max integer;
  v_count integer;
begin
  select max_members, members_count into v_max, v_count
  from public.partner_offers where id = p_offer_id for update;
  if not found or (v_max is not null and v_count >= v_max) then
    return false;
  end if;
  update public.partner_offers
  set members_count = v_count + 1, updated_at = now()
  where id = p_offer_id;
  return true;
end;
$$;

alter table public.creator_partners enable row level security;
alter table public.partner_offers enable row level security;
alter table public.partner_offer_perks enable row level security;
alter table public.partner_members enable row level security;
alter table public.partner_perk_claims enable row level security;
alter table public.partner_perk_events enable row level security;

revoke all on function public.partner_reserve_budget(uuid, numeric) from public, anon, authenticated;
revoke all on function public.partner_release_budget(uuid, numeric) from public, anon, authenticated;
revoke all on function public.partner_take_seat(uuid) from public, anon, authenticated;

grant usage on schema public to service_role;
grant select, insert, update, delete on
  public.creator_partners,
  public.partner_offers,
  public.partner_offer_perks,
  public.partner_members,
  public.partner_perk_claims,
  public.partner_perk_events
to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on function public.partner_reserve_budget(uuid, numeric) to service_role;
grant execute on function public.partner_release_budget(uuid, numeric) to service_role;
grant execute on function public.partner_take_seat(uuid) to service_role;
