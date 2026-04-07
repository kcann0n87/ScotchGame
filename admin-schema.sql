-- ============================================================
-- SCOTCH GAME — ADMIN SCHEMA MIGRATION
-- ============================================================
-- Run this in Supabase SQL Editor AFTER the main SUPABASE_SCHEMA.sql.
-- Adds admin support: is_admin flag, admin RLS policies, payments table.

-- 1. Add is_admin column to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin boolean DEFAULT false;

-- 2. Payments table — records cash settlements
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount integer NOT NULL,
  note text,
  recorded_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_user_idx ON payments (user_id);
CREATE INDEX IF NOT EXISTS payments_created_idx ON payments (created_at DESC);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- 3. Admin RLS policies

-- Admin can read ALL rounds
DROP POLICY IF EXISTS "rounds_select_admin" ON rounds;
CREATE POLICY "rounds_select_admin" ON rounds FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- Admin can read ALL round_players
DROP POLICY IF EXISTS "round_players_select_admin" ON round_players;
CREATE POLICY "round_players_select_admin" ON round_players FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- Admin can update ANY profile (for writing handicaps)
DROP POLICY IF EXISTS "profiles_update_admin" ON profiles;
CREATE POLICY "profiles_update_admin" ON profiles FOR UPDATE
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- Admin can insert new profiles (for manual/guest players who don't have accounts)
DROP POLICY IF EXISTS "profiles_insert_admin" ON profiles;
CREATE POLICY "profiles_insert_admin" ON profiles FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- Admin can delete profiles
DROP POLICY IF EXISTS "profiles_delete_admin" ON profiles;
CREATE POLICY "profiles_delete_admin" ON profiles FOR DELETE
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- Payments: admin can do everything; regular users can read their own
DROP POLICY IF EXISTS "payments_admin_all" ON payments;
CREATE POLICY "payments_admin_all" ON payments FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

DROP POLICY IF EXISTS "payments_select_own" ON payments;
CREATE POLICY "payments_select_own" ON payments FOR SELECT
  USING (user_id = auth.uid());

-- 4. Courses table — synced between admin and mobile app
CREATE TABLE IF NOT EXISTS courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  tees jsonb NOT NULL DEFAULT '[]',
  pars jsonb,
  si jsonb,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS courses_name_idx ON courses (name);

ALTER TABLE courses ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read courses
DROP POLICY IF EXISTS "courses_select_all" ON courses;
CREATE POLICY "courses_select_all" ON courses FOR SELECT
  USING (auth.role() = 'authenticated');

-- Admin can manage courses
DROP POLICY IF EXISTS "courses_admin_all" ON courses;
CREATE POLICY "courses_admin_all" ON courses FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- 5. Add status column to rounds for admin approval
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending';
CREATE INDEX IF NOT EXISTS rounds_status_idx ON rounds (status);

-- 6. Set admin flag for the primary admin
UPDATE profiles SET is_admin = true WHERE email = 'kcannonpoker@gmail.com';
