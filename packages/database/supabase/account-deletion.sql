-- Account deletion: a user asks to delete their SaphraONE account from
-- Settings → Delete account. The request waits out a 30-day grace period
-- (signing back in and choosing "Restore" cancels it), then the daily cron
-- (/api/cron/account-deletion) erases the account's personal data.
--
-- The wallet itself lives on the blockchain and is never touched. Financial
-- records (payments, invoices, ledgers, audit logs) are kept for legal and
-- anti-fraud retention, no longer linked to a name, email or phone. The
-- profiles row stays as an anonymised tombstone because those records point
-- at it; its username becomes "deleted:<id>", which no one can search for or
-- claim. The old @username is held for 12 months (retired_usernames below)
-- before anyone else can take it.
--
-- Keyed by the wallet the account signed in with. Server-only.
-- Run in the Supabase SQL editor before turning the feature on.

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  owner_wallet text not null,
  status text not null default 'scheduled',
  -- Why they left (a fixed list) and anything they added. Kept, unlinked,
  -- after the account is erased: it holds no personal data.
  reason text,
  feedback text,
  -- Where the "deleted" email goes once the account is erased; cleared then.
  notify_email text,
  requested_at timestamptz not null default now(),
  scheduled_for timestamptz not null,
  cancelled_at timestamptz,
  completed_at timestamptz,
  purge_attempts integer not null default 0,
  last_error text,
  updated_at timestamptz not null default now(),
  constraint account_deletion_status_check
    check (status in ('scheduled', 'cancelled', 'completed')),
  constraint account_deletion_reason_len
    check (reason is null or char_length(reason) <= 40),
  constraint account_deletion_feedback_len
    check (feedback is null or char_length(feedback) <= 500)
);

-- At most one live request per account.
create unique index if not exists account_deletion_one_scheduled_idx
  on public.account_deletion_requests (owner_wallet)
  where status = 'scheduled';

create index if not exists account_deletion_due_idx
  on public.account_deletion_requests (status, scheduled_for);

alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from anon, authenticated;
grant select, insert, update, delete on public.account_deletion_requests to service_role;

drop policy if exists account_deletion_no_client_access on public.account_deletion_requests;
create policy account_deletion_no_client_access
  on public.account_deletion_requests
  for all
  using (false)
  with check (false);

-- The purge empties the personal fields on profiles; let service_role do it.
grant select, insert, update on public.profiles to service_role;

-- Usernames of erased accounts are held before anyone else can claim them,
-- so payments and contacts saved under the old @name can't quietly reach a
-- stranger. The original wallet can still take its name back during the hold.
create table if not exists public.retired_usernames (
  username text primary key,
  owner_wallet text not null,
  retired_at timestamptz not null default now(),
  available_at timestamptz not null,
  constraint retired_usernames_lowercase check (username = lower(username))
);

create index if not exists retired_usernames_owner_idx
  on public.retired_usernames (owner_wallet);

alter table public.retired_usernames enable row level security;
revoke all on public.retired_usernames from anon, authenticated;
grant select, insert, update, delete on public.retired_usernames to service_role;

drop policy if exists retired_usernames_no_client_access on public.retired_usernames;
create policy retired_usernames_no_client_access
  on public.retired_usernames
  for all
  using (false)
  with check (false);
