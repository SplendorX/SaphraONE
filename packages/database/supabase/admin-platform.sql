-- The admin platform (/admin): who on the team can open which tool, and a
-- log of every change made from it. Server-only: the app reads both with the
-- service role; row level security keeps everyone else out.
--
-- The owner signs in with ADMIN_SECRET (the owner key) and adds the team on
-- /admin/team by their One ID. Team members sign in with their own SaphraONE
-- account; each request is checked against this table.

create table if not exists public.admin_members (
  -- The member's SaphraONE wallet (lowercase): the account they sign in with.
  wallet_address text primary key,
  -- Their One ID or name when added, for the team list.
  label text,
  -- 'owner': every tool, and manages the team. 'member': only `tools`.
  role text not null default 'member' check (role in ('owner', 'member')),
  tools text[] not null default '{}',
  disabled boolean not null default false,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_members enable row level security;

create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  -- "owner-key", or the member's wallet.
  actor text not null,
  actor_label text,
  tool text not null,
  action text not null,
  -- What it was done to: usually a wallet.
  target text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_created_idx
  on public.admin_audit_log (created_at desc);
create index if not exists admin_audit_log_target_idx
  on public.admin_audit_log (target, created_at desc);

alter table public.admin_audit_log enable row level security;

-- Explicit grants (the service role reads and writes both tables), then
-- reload the API schema cache so the new tables are visible straight away.
revoke all on public.admin_members from anon, authenticated;
revoke all on public.admin_audit_log from anon, authenticated;
grant select, insert, update, delete on public.admin_members to service_role;
grant select, insert, update, delete on public.admin_audit_log to service_role;

notify pgrst, 'reload schema';
