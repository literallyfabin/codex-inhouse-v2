-- Season 1 archive + reset for Season 2.
-- Idempotent: safe to re-run, but truncates live tables.
-- Run ONCE when officially closing Season 1.

begin;

-- 1) Archive Season 1 tables (snapshot of current state).
create table if not exists public.matches_s1                as select * from public.matches;
create table if not exists public.match_participants_s1    as select * from public.match_participants;
create table if not exists public.player_stats_global_s1   as select * from public.player_stats_global;
create table if not exists public.player_stats_s1          as select * from public.player_stats;

-- Helpful indexes on archive tables for memorial reads.
create index if not exists idx_matches_s1_guild_status      on public.matches_s1 (guild_id, status);
create index if not exists idx_matches_s1_completed_at      on public.matches_s1 (completed_at);
create index if not exists idx_match_participants_s1_match  on public.match_participants_s1 (match_id);
create index if not exists idx_match_participants_s1_user   on public.match_participants_s1 (user_id);
create index if not exists idx_player_stats_global_s1_guild on public.player_stats_global_s1 (guild_id);

-- 2) Reset live MATCH tables for Season 2.
-- Order: child tables first (cascade handles it anyway).
truncate table public.match_participants restart identity cascade;
truncate table public.matches            restart identity cascade;

-- 3) DO NOT TRUNCATE player_stats_global / player_stats.
--    MMR (mu/sigma) is carried into Season 2 to seed matchmaking from day 1.
--    Only PDL/tier/division are zeroed by migration 0008.

-- 4) Reset match_number sequence so Season 2 starts at #0001.
alter sequence public.matches_match_number_seq restart with 1;

-- NOTE: users, user_riot_accounts, guild_settings, discord_channels,
-- queue_entries, ready_checks are operational data — NOT reset.

commit;
