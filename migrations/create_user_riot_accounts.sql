CREATE TABLE IF NOT EXISTS public.user_riot_accounts (
  discord_id   TEXT PRIMARY KEY,
  puuid        TEXT NOT NULL UNIQUE,
  game_name    TEXT NOT NULL,
  tag_line     TEXT NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable Row Level Security (optional but recommended)
ALTER TABLE public.user_riot_accounts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_user_riot_accounts_riot_id
  ON public.user_riot_accounts (LOWER(game_name), LOWER(tag_line));
