create sequence if not exists public.matches_match_number_seq
  as integer
  start with 1
  increment by 1;

alter table public.matches
  add column if not exists match_number integer;

alter table public.matches
  alter column match_number set default nextval('public.matches_match_number_seq');

update public.matches
  set match_number = nextval('public.matches_match_number_seq')
  where match_number is null;

alter table public.matches
  alter column match_number set not null;

create unique index if not exists idx_matches_match_number
  on public.matches (match_number);

select setval(
  'public.matches_match_number_seq',
  greatest(coalesce((select max(match_number) from public.matches), 0), 1),
  coalesce((select max(match_number) from public.matches), 0) > 0
);

alter sequence public.matches_match_number_seq
  owned by public.matches.match_number;
