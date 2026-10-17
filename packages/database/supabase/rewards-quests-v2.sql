-- Quests v2: who a quest is for, a "first N people" limit, and the points
-- each completion paid (percentage rewards vary per person).
-- Additive and idempotent. Requires rewards-v2.sql.

alter table public.rewards_quests
  add column if not exists audience text not null default 'all';
alter table public.rewards_quests
  drop constraint if exists rewards_quests_audience_check;
alter table public.rewards_quests
  add constraint rewards_quests_audience_check check (audience in ('all', 'personal', 'business'));

alter table public.rewards_quests
  add column if not exists max_completions integer;
alter table public.rewards_quests
  drop constraint if exists rewards_quests_max_completions_check;
alter table public.rewards_quests
  add constraint rewards_quests_max_completions_check check (
    max_completions is null or max_completions > 0
  );

alter table public.rewards_quests
  add column if not exists updated_at timestamptz not null default now();

alter table public.rewards_quest_completions
  add column if not exists points_awarded numeric;

-- One completion, at most once per wallet and never past the quest's limit.
-- The quest row is locked so two people finishing at the same moment can't
-- both take the last place. Returns 'awarded', 'already' or 'full'.
create or replace function public.rewards_complete_quest(
  p_quest uuid,
  p_wallet text,
  p_points numeric
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max integer;
  v_count integer;
begin
  select max_completions into v_max
  from public.rewards_quests
  where id = p_quest
  for update;
  if not found then
    return 'missing';
  end if;

  if exists (
    select 1 from public.rewards_quest_completions
    where quest_id = p_quest and wallet_address = lower(p_wallet)
  ) then
    return 'already';
  end if;

  if v_max is not null then
    select count(*) into v_count
    from public.rewards_quest_completions
    where quest_id = p_quest;
    if v_count >= v_max then
      return 'full';
    end if;
  end if;

  insert into public.rewards_quest_completions (quest_id, wallet_address, points_awarded)
  values (p_quest, lower(p_wallet), p_points)
  on conflict (quest_id, wallet_address) do nothing;
  return case when found then 'awarded' else 'already' end;
end;
$$;

revoke all on function public.rewards_complete_quest(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.rewards_complete_quest(uuid, text, numeric) to service_role;
