-- ============================================================
-- SCOTCH GAME — SUPABASE SCHEMA
-- ============================================================
-- Run this entire file in the Supabase SQL Editor once, after
-- creating your project. It will create tables, indexes, and
-- Row Level Security policies.
--
-- To run:
--   1. Supabase dashboard → SQL Editor → New query
--   2. Paste this entire file
--   3. Click "Run"

-- ------------------------------------------------------------
-- 1. PROFILES — one row per registered user
-- ------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  display_name text not null,
  handicap integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists profiles_display_name_idx on profiles using gin (to_tsvector('english', display_name));
create index if not exists profiles_email_idx on profiles (email);

-- ------------------------------------------------------------
-- 2. (REMOVED) FRIENDSHIPS — feature dropped; table no longer used
-- ------------------------------------------------------------
-- Drop the old friendships table if it exists from a prior install
drop table if exists friendships cascade;

-- ------------------------------------------------------------
-- 3. ROUNDS — one row per completed round
-- ------------------------------------------------------------
create table if not exists rounds (
  id uuid primary key default gen_random_uuid(),
  scorer_id uuid not null references profiles(id) on delete cascade,
  course_name text not null,
  played_at timestamptz not null default now(),
  mode text not null default '4man',
  game_type text,
  game_type_1 text,
  game_type_2 text,
  data jsonb not null,        -- full round blob (scores, holes, courses)
  settlement jsonb not null,  -- computed settlement
  created_at timestamptz default now()
);
create index if not exists rounds_played_at_idx on rounds (played_at desc);
create index if not exists rounds_scorer_idx on rounds (scorer_id);

-- ------------------------------------------------------------
-- 4. ROUND_PLAYERS — one row per player in each round
-- ------------------------------------------------------------
create table if not exists round_players (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references rounds(id) on delete cascade,
  user_id uuid references profiles(id) on delete set null,
  invited_email text,
  display_name text not null,
  team text not null,
  stake text not null,
  handicap integer default 0,
  final_amount integer default 0,
  created_at timestamptz default now()
);
create index if not exists round_players_round_idx on round_players (round_id);
create index if not exists round_players_user_idx on round_players (user_id);
create index if not exists round_players_email_idx on round_players (invited_email);

-- ------------------------------------------------------------
-- 5. LIVE_SHARES — temporary sharable links for in-progress rounds
-- ------------------------------------------------------------
create table if not exists live_shares (
  code text primary key,
  scorer_id uuid not null references profiles(id) on delete cascade,
  round_local_id text,
  data jsonb,
  is_public boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  expires_at timestamptz default (now() + interval '48 hours')
);
create index if not exists live_shares_scorer_idx on live_shares (scorer_id);
-- Add is_public to existing tables
alter table live_shares add column if not exists is_public boolean default false;
create index if not exists live_shares_public_idx on live_shares (is_public, updated_at desc) where is_public = true;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table profiles       enable row level security;
alter table rounds         enable row level security;
alter table round_players  enable row level security;
alter table live_shares    enable row level security;

-- Profiles: anyone authenticated can read; users can only edit their own
drop policy if exists "profiles_read_all" on profiles;
create policy "profiles_read_all" on profiles for select using (auth.role() = 'authenticated');
drop policy if exists "profiles_update_own" on profiles;
create policy "profiles_update_own" on profiles for update using (auth.uid() = id);
drop policy if exists "profiles_insert_own" on profiles;
create policy "profiles_insert_own" on profiles for insert with check (auth.uid() = id);

-- Rounds: readable by any player linked to the round OR the scorer
drop policy if exists "rounds_select_player" on rounds;
create policy "rounds_select_player" on rounds for select using (
  auth.uid() = scorer_id
  or exists (
    select 1 from round_players rp
    where rp.round_id = rounds.id and rp.user_id = auth.uid()
  )
);
drop policy if exists "rounds_insert_own" on rounds;
create policy "rounds_insert_own" on rounds for insert with check (auth.uid() = scorer_id);
drop policy if exists "rounds_update_own" on rounds;
create policy "rounds_update_own" on rounds for update using (auth.uid() = scorer_id);
drop policy if exists "rounds_delete_own" on rounds;
create policy "rounds_delete_own" on rounds for delete using (auth.uid() = scorer_id);

-- Round players: readable by any player in the same round
drop policy if exists "round_players_select" on round_players;
create policy "round_players_select" on round_players for select using (
  exists (
    select 1 from round_players rp2
    where rp2.round_id = round_players.round_id
      and (rp2.user_id = auth.uid())
  )
  or exists (
    select 1 from rounds r where r.id = round_players.round_id and r.scorer_id = auth.uid()
  )
);
drop policy if exists "round_players_insert_by_scorer" on round_players;
create policy "round_players_insert_by_scorer" on round_players for insert with check (
  exists (select 1 from rounds r where r.id = round_players.round_id and r.scorer_id = auth.uid())
);
drop policy if exists "round_players_update_claim" on round_players;
create policy "round_players_update_claim" on round_players for update using (
  -- Users can claim guest rows matching their email
  (user_id is null and invited_email = (select email from profiles where id = auth.uid()))
  or exists (select 1 from rounds r where r.id = round_players.round_id and r.scorer_id = auth.uid())
);

-- Live shares: readable by any AUTHENTICATED user with the code (login required).
-- The 6-char code acts as a shared secret; anyone a scorer shares it with
-- must also have an account to view. Still no public/guest access.
drop policy if exists "live_shares_select_all" on live_shares;
drop policy if exists "live_shares_select_auth" on live_shares;
create policy "live_shares_select_auth" on live_shares for select using (auth.role() = 'authenticated');
drop policy if exists "live_shares_manage_own" on live_shares;
create policy "live_shares_manage_own" on live_shares for all using (auth.uid() = scorer_id) with check (auth.uid() = scorer_id);

-- ============================================================
-- REALTIME
-- ============================================================
-- Enable realtime on live_shares so listeners see updates
alter publication supabase_realtime add table live_shares;

-- ============================================================
-- DONE
-- ============================================================
-- Next steps (in Supabase dashboard):
--  1. Authentication → Providers → Enable:
--       Email (already on)
--       Magic Link (already on by default with Email)
--       Google (optional — requires Google OAuth setup)
--  2. Authentication → URL Configuration:
--       Site URL: https://your-repl-name.username.repl.co   (or your deployed URL)
--       Redirect URLs: add the same URL
--  3. Copy your Project URL and anon key from Settings → API
--  4. Paste them into supabase.js at the top of the file
