-- Premium offers: campaigns on premium purchases (ALLIE Pro, automatic
-- deposits, automatic payroll), set on /admin/campaigns. A live offer lowers
-- the USDC price at checkout and/or adds bonus days to the term bought.
--
-- premium_offer_redemptions records each purchase an offer applied to, once
-- per purchase, for the per-member limit and the total cap.
-- Server-only: RLS on, no policies (the service role reads and writes).
-- Safe to run more than once.

create table if not exists public.premium_offers (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  -- The line on Home's banner and the checkout ("Half price on ALLIE Pro").
  headline text not null default '',
  -- ALLIE_PRO, EARN_AUTO_DEPOSIT, PAYROLL_AUTO_SCHEDULE.
  products text[] not null,
  discount_percent integer not null default 0,
  bonus_days integer not null default 0,
  -- How many purchases one member gets it on, and in all (null: no cap).
  max_per_member integer not null default 1,
  max_redemptions integer,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  status text not null default 'draft',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint premium_offers_title_check check (char_length(title) between 1 and 80),
  constraint premium_offers_headline_check check (char_length(headline) <= 140),
  constraint premium_offers_products_check check (
    cardinality(products) > 0
    and products <@ array['ALLIE_PRO', 'EARN_AUTO_DEPOSIT', 'PAYROLL_AUTO_SCHEDULE']::text[]
  ),
  constraint premium_offers_discount_check check (discount_percent between 0 and 90),
  constraint premium_offers_bonus_check check (bonus_days between 0 and 365),
  constraint premium_offers_something_check check (discount_percent > 0 or bonus_days > 0),
  constraint premium_offers_limits_check check (
    max_per_member >= 1 and (max_redemptions is null or max_redemptions >= 1)
  ),
  constraint premium_offers_window_check check (ends_at > starts_at),
  constraint premium_offers_status_check check (status in ('draft', 'live', 'ended'))
);

create index if not exists premium_offers_live_idx
  on public.premium_offers (status, ends_at);

create table if not exists public.premium_offer_redemptions (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.premium_offers(id) on delete restrict,
  wallet_address text not null,
  product text not null,
  -- The premium_purchases row it applied to: one offer per purchase.
  purchase_id uuid not null unique,
  base_price_usdc numeric not null,
  paid_usdc numeric not null,
  bonus_days integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists premium_offer_redemptions_offer_idx
  on public.premium_offer_redemptions (offer_id, wallet_address);

alter table public.premium_offers enable row level security;
alter table public.premium_offer_redemptions enable row level security;

revoke all on public.premium_offers from anon, authenticated;
revoke all on public.premium_offer_redemptions from anon, authenticated;
grant select, insert, update, delete on public.premium_offers to service_role;
grant select, insert, update, delete on public.premium_offer_redemptions to service_role;

notify pgrst, 'reload schema';
