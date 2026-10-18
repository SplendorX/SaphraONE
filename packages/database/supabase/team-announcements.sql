-- Team announcements: news the SaphraONE team posts from the admin platform
-- (/admin/announcements), shown to everyone as a card on Home beside live
-- campaigns and quests (app/api/announcements).
--
-- A card is live while status = 'live' and now is inside [starts_at, ends_at).
-- Server-only: RLS on, no policies (the service role reads and writes).
-- Safe to run more than once.

create table if not exists public.team_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  -- The pill under the text ("New", "Action needed"); empty for none.
  badge text not null default '',
  -- Where the card goes: an app path ("/rewards") or an https URL; empty for none.
  href text not null default '',
  -- The card's colours and art.
  tone text not null default 'news',
  status text not null default 'draft',
  -- Pinned cards come first; a card that can't be dismissed has no ×.
  pinned boolean not null default false,
  dismissible boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by text not null default '',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint team_announcements_title_check check (char_length(title) between 1 and 80),
  constraint team_announcements_body_check check (char_length(body) <= 240),
  constraint team_announcements_badge_check check (char_length(badge) <= 32),
  constraint team_announcements_href_check check (href = '' or href like '/%' or href like 'https://%'),
  constraint team_announcements_tone_check check (tone in ('news', 'important', 'update', 'maintenance')),
  constraint team_announcements_status_check check (status in ('draft', 'live', 'ended')),
  constraint team_announcements_window_check check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create index if not exists team_announcements_live_idx
  on public.team_announcements (status, starts_at desc);

alter table public.team_announcements enable row level security;

-- Explicit grants (only the service role reads and writes), then reload the
-- API schema cache so the table is visible straight away.
revoke all on public.team_announcements from anon, authenticated;
grant select, insert, update, delete on public.team_announcements to service_role;

notify pgrst, 'reload schema';
