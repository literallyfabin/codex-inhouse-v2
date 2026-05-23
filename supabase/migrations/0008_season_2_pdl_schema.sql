-- Season 2: introduces PDL (visible) on top of hidden MMR.
-- MMR stays for matchmaking; PDL drives ranking and tiers.
-- Idempotent.

begin;

-- 1) Tier/division/PDL columns on player_stats_global.
alter table public.player_stats_global
  add column if not exists pdl       integer not null default 0,
  add column if not exists tier      text    not null default 'BRONZE',
  add column if not exists division  integer not null default 4;

-- Constraint on division (1..4 for base tiers, 0 for apex tiers).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'player_stats_global_division_check'
  ) then
    alter table public.player_stats_global
      add constraint player_stats_global_division_check
      check (division between 0 and 4);
  end if;
end $$;

-- Index for ranking queries.
create index if not exists idx_player_stats_global_pdl
  on public.player_stats_global (guild_id, pdl desc);

-- 2) PDL history per match.
create table if not exists public.pdl_history (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  user_id  uuid not null references public.users(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  pdl_before       integer not null,
  pdl_after        integer not null,
  pdl_delta        integer not null,
  tier_before      text    not null,
  tier_after       text    not null,
  division_before  integer not null,
  division_after   integer not null,
  mmr_before       integer not null,
  mmr_after        integer not null,
  created_at       timestamptz not null default now()
);

create index if not exists idx_pdl_history_user
  on public.pdl_history (user_id, created_at desc);
create index if not exists idx_pdl_history_guild
  on public.pdl_history (guild_id, created_at desc);
create index if not exists idx_pdl_history_match
  on public.pdl_history (match_id);

-- 3) Reset PDL/tier/division for everyone (Season 2 starts fresh).
--    MMR (mu/sigma/mmr) is intentionally preserved from Season 1.
update public.player_stats_global
   set pdl = 0,
       tier = 'BRONZE',
       division = 4;

commit;
