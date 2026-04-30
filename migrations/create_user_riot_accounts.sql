-- Migration: Create user_riot_accounts table
-- Run this in the Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.user_riot_accounts (
  discord_id   TEXT PRIMARY KEY,
  puuid        TEXT NOT NULL UNIQUE,
  game_name    TEXT NOT NULL,
  tag_line     TEXT NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable Row Level Security (optional but recommended)
ALTER TABLE public.user_riot_accounts ENABLE ROW LEVEL SECURITY;

-- Allow the service role (used by our bot's anon/service key) to read/write
CREATE POLICY "Service role can manage riot accounts"
  ON public.user_riot_accounts
  FOR ALL
  USING (true)
  WITH CHECK (true);
