create extension if not exists "pgcrypto";

do $$
begin
  if not exists (select 1 from pg_type where typname = 'player_role') then
    create type public.player_role as enum ('TOP', 'JGL', 'MID', 'ADC', 'SUP');
  end if;

  if not exists (select 1 from pg_type where typname = 'match_status') then
    create type public.match_status as enum ('PENDING', 'ONGOING', 'COMPLETED', 'CANCELLED');
  end if;

  if not exists (select 1 from pg_type where typname = 'match_team') then
    create type public.match_team as enum ('BLUE', 'RED');
  end if;

  if not exists (select 1 from pg_type where typname = 'winning_team') then
    create type public.winning_team as enum ('BLUE', 'RED', 'NONE');
  end if;
end $$;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  discord_id text unique,
  whatsapp_id text unique,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_has_platform_identity check (discord_id is not null or whatsapp_id is not null)
);

create table if not exists public.player_stats (
  user_id uuid not null references public.users(id) on delete cascade,
  role public.player_role not null,
  mu double precision not null default 25.0,
  sigma double precision not null default 8.333333333333334,
  updated_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  status public.match_status not null default 'PENDING',
  team_blue jsonb not null default '[]'::jsonb,
  team_red jsonb not null default '[]'::jsonb,
  winning_team public.winning_team not null default 'NONE',
  blue_expected_winrate double precision not null default 0.5,
  mu_difference double precision not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.match_participants (
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete restrict,
  role public.player_role not null,
  team public.match_team not null,
  mu_before double precision not null,
  sigma_before double precision not null,
  primary key (match_id, user_id, role),
  unique (match_id, team, role)
);

alter table public.users enable row level security;
alter table public.player_stats enable row level security;
alter table public.matches enable row level security;
alter table public.match_participants enable row level security;
