-- Personal KYC for the Naira ramp (Prembly). A wallet passes Tier 1 (phone
-- OTP + BVN/NIN) once, then optionally Tier 2 (liveness + face match) for
-- higher daily limits. Additive and idempotent. Never stores the raw BVN,
-- NIN, selfie, or Prembly photo.

create table if not exists public.kyc_profiles (
  wallet_address text primary key references public.profiles(wallet_address) on delete restrict,
  country text not null default 'NG',
  tier smallint not null default 0,
  status text not null default 'NONE',
  provider text not null default 'PREMBLY',
  id_type text,
  id_hash text,
  id_last4 text,
  first_name text,
  last_name text,
  middle_name text,
  dob text,
  phone_e164 text,
  phone_verified_at timestamptz,
  otp_provider text,
  tier1_verified_at timestamptz,
  tier2_verified_at timestamptz,
  liveness_score numeric,
  face_match_score numeric,
  flags jsonb not null default '{}'::jsonb,
  provider_ref text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kyc_profiles_tier_check check (tier in (0, 1, 2)),
  constraint kyc_profiles_status_check check (
    status in ('NONE', 'PENDING', 'VERIFIED', 'MANUAL_REVIEW', 'REJECTED')
  ),
  constraint kyc_profiles_id_type_check check (id_type is null or id_type in ('BVN', 'NIN'))
);

create unique index if not exists kyc_profiles_id_hash_verified_unique
  on public.kyc_profiles (id_hash)
  where status = 'VERIFIED' and id_hash is not null;

create table if not exists public.kyc_attempts (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null references public.profiles(wallet_address) on delete cascade,
  subject text not null default 'PERSON',
  step text not null,
  id_hash text,
  result text not null,
  reason_code text,
  provider_code text,
  provider_ref text,
  created_at timestamptz not null default now(),
  constraint kyc_attempts_subject_check check (subject in ('PERSON', 'BUSINESS')),
  constraint kyc_attempts_step_check check (
    step in (
      'PHONE_OTP', 'ID_LOOKUP', 'LIVENESS', 'FACE_MATCH',
      'CAC_LOOKUP', 'TIN_LOOKUP', 'DIRECTOR_MATCH'
    )
  ),
  constraint kyc_attempts_result_check check (result in ('PASS', 'FAIL', 'ERROR'))
);

create index if not exists kyc_attempts_wallet_idx
  on public.kyc_attempts (wallet_address, created_at desc);

create index if not exists kyc_attempts_hash_idx
  on public.kyc_attempts (id_hash, created_at desc)
  where id_hash is not null;

alter table public.kyc_profiles enable row level security;
alter table public.kyc_attempts enable row level security;

revoke all on public.kyc_profiles from anon, authenticated;
revoke all on public.kyc_attempts from anon, authenticated;

grant select, insert, update, delete on public.kyc_profiles to service_role;
grant select, insert, update, delete on public.kyc_attempts to service_role;

drop policy if exists kyc_profiles_no_client_access on public.kyc_profiles;
create policy kyc_profiles_no_client_access
  on public.kyc_profiles
  for all
  using (false)
  with check (false);

drop policy if exists kyc_attempts_no_client_access on public.kyc_attempts;
create policy kyc_attempts_no_client_access
  on public.kyc_attempts
  for all
  using (false)
  with check (false);
