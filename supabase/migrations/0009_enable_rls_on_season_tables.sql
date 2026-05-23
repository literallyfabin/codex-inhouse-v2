-- Season archive/PDL tables live in public, so keep RLS enabled like the
-- existing bot tables. The backend service key still bypasses RLS.

alter table public.matches_s1 enable row level security;
alter table public.match_participants_s1 enable row level security;
alter table public.player_stats_global_s1 enable row level security;
alter table public.player_stats_s1 enable row level security;
alter table public.pdl_history enable row level security;
