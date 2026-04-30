do $$
begin
  if not exists (select 1 from pg_type where typname = 'channel_type') then
    create type public.channel_type as enum ('QUEUE', 'RANKING');
  end if;

  if not exists (select 1 from pg_type where typname = 'ready_check_status') then
    create type public.ready_check_status as enum ('PENDING', 'ACCEPTED', 'CANCELLED', 'TIMEOUT');
  end if;
end $$;

alter table public.player_stats
  add column if not exists guild_id text not null default 'global';

alter table public.player_stats
  add column if not exists mmr double precision
  generated always as ((20::double precision * ((mu - (3::double precision * sigma)) + 25::double precision))) stored;

alter table public.player_stats drop constraint if exists player_stats_pkey;
alter table public.player_stats add primary key (guild_id, user_id, role);

alter table public.matches
  add column if not exists guild_id text not null default 'global',
  add column if not exists source_channel_id text,
  add column if not exists discord_message_id text;

alter table public.match_participants
  add column if not exists display_name text,
  add column if not exists champion_name text,
  add column if not exists mmr_before double precision
  generated always as ((20::double precision * ((mu_before - (3::double precision * sigma_before)) + 25::double precision))) stored;

create table if not exists public.guild_settings (
  guild_id text primary key,
  queue_reset_enabled boolean not null default false,
  voice_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.discord_channels (
  channel_id text primary key,
  guild_id text not null,
  channel_type public.channel_type not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.queue_entries (
  guild_id text not null,
  channel_id text not null,
  user_id uuid not null references public.users(id) on delete cascade,
  role public.player_role not null,
  display_name text not null,
  joined_at timestamptz not null default now(),
  duo_user_id uuid references public.users(id) on delete set null,
  ready_check_id text,
  platform text not null default 'discord',
  platform_user_id text not null,
  primary key (channel_id, user_id, role)
);

create table if not exists public.ready_checks (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  channel_id text not null,
  discord_message_id text,
  status public.ready_check_status not null default 'PENDING',
  candidate_players jsonb not null default '[]'::jsonb,
  accepted_user_ids jsonb not null default '[]'::jsonb,
  cancelled_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '2 minutes')
);

create index if not exists idx_player_stats_guild_role_mmr
  on public.player_stats (guild_id, role, mmr desc);

create index if not exists idx_matches_guild_created
  on public.matches (guild_id, created_at desc);

create index if not exists idx_match_participants_user
  on public.match_participants (user_id, match_id);

create index if not exists idx_queue_entries_guild_channel
  on public.queue_entries (guild_id, channel_id, joined_at);

alter table public.guild_settings enable row level security;
alter table public.discord_channels enable row level security;
alter table public.queue_entries enable row level security;
alter table public.ready_checks enable row level security;
