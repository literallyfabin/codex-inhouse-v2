create table if not exists public.user_riot_accounts (
  discord_id text primary key,
  puuid text not null unique,
  game_name text not null,
  tag_line text not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_riot_accounts_riot_id
  on public.user_riot_accounts (lower(game_name), lower(tag_line));

alter table public.user_riot_accounts enable row level security;
