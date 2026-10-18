-- Business KYB for the Naira ramp (Prembly CAC + TIN). Sits on top of
-- personal KYC: the person acting still needs Tier 1. Additive and
-- idempotent. One company number verifies one wallet.

create table if not exists public.kyb_profiles (
  wallet_address text primary key references public.profiles(wallet_address) on delete restrict,
  country text not null default 'NG',
  level text not null default 'NONE',
  status text not null default 'NONE',
  company_type text,
  rc_number text,
  company_name text,
  registration_date text,
  cac_status text,
  tin_hash text,
  tin_last4 text,
  tin_name text,
  director_match jsonb,
  flags jsonb not null default '{}'::jsonb,
  provider_ref_cac text,
  provider_ref_tin text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kyb_profiles_level_check check (level in ('NONE', 'BASIC', 'FULL')),
  constraint kyb_profiles_status_check check (
    status in ('NONE', 'PENDING', 'VERIFIED', 'MANUAL_REVIEW', 'REJECTED')
  ),
  constraint kyb_profiles_company_type_check check (
    company_type is null or company_type in ('RC', 'BN', 'IT')
  )
);

create unique index if not exists kyb_profiles_company_verified_unique
  on public.kyb_profiles (company_type, rc_number)
  where status = 'VERIFIED' and rc_number is not null and company_type is not null;

alter table public.kyb_profiles enable row level security;

revoke all on public.kyb_profiles from anon, authenticated;
grant select, insert, update, delete on public.kyb_profiles to service_role;

drop policy if exists kyb_profiles_no_client_access on public.kyb_profiles;
create policy kyb_profiles_no_client_access
  on public.kyb_profiles
  for all
  using (false)
  with check (false);

-- Which name an off-ramp beneficiary matched: the owner's KYC name or the
-- company's CAC name. Null on rows saved before KYB. Additive.
alter table public.ramp_beneficiaries
  add column if not exists name_match text;

alter table public.ramp_beneficiaries
  drop constraint if exists ramp_beneficiaries_name_match_check;
alter table public.ramp_beneficiaries
  add constraint ramp_beneficiaries_name_match_check check (
    name_match is null or name_match in ('OWNER', 'COMPANY')
  );

-- Papers a business sends for manual review (CAC status report, board
-- resolution). Only paths and metadata live here; the files sit in the
-- private kyb-documents bucket, read by reviewers through short signed URLs.
alter table public.kyb_profiles
  add column if not exists documents jsonb not null default '[]'::jsonb;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kyb-documents', 'kyb-documents', false, 3145728, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;
