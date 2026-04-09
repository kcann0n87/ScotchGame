-- ============================================================
-- RESET DATA — wipes all rounds, round_players, payments, and
-- any active live_shares. Keeps profiles (users), friendships,
-- and courses intact.
--
-- Run this in: Supabase Dashboard → SQL Editor → New Query
--
-- WARNING: This is destructive. There's no undo.
-- ============================================================

-- 1. Delete any live share rows first (they reference scorer profiles)
delete from live_shares;

-- 2. Delete all payment/ledger entries (resets money balances to $0)
delete from payments;

-- 3. Delete round_players (explicit even though rounds CASCADE would handle it)
delete from round_players;

-- 4. Delete all rounds
delete from rounds;

-- 5. (Optional) Verify everything is empty
select 'rounds' as table_name, count(*) from rounds
union all
select 'round_players', count(*) from round_players
union all
select 'payments', count(*) from payments
union all
select 'live_shares', count(*) from live_shares;
-- Expected: all zeros

-- ============================================================
-- NOT TOUCHED (preserved):
--   profiles       — user accounts, display names, handicaps
--   friendships    — friend connections
--   courses        — course definitions + tees
-- ============================================================
