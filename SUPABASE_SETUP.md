# Supabase Setup — Enable Cloud Sync, History & Stats

The app works fully offline without any of this. Set up Supabase only when you want:
- Sign-in across devices
- Round history
- Lifetime stats (win/loss, per-course, head-to-head)
- Live share (watch a round in progress from another phone)

Total time: **~10 minutes.** Free tier is fine forever.

---

## 1. Create a Supabase account

1. Go to [https://supabase.com](https://supabase.com)
2. Click **Start your project** → Sign up (Google / GitHub / email)
3. Create a new organization (pick any name)
4. Click **New project**
   - **Name:** `ScotchGame` (or whatever)
   - **Database password:** generate a strong one and save it somewhere (you won't need it often)
   - **Region:** pick the closest to you
   - **Plan:** Free
5. Wait ~2 minutes while the project spins up

## 2. Create the tables (run the SQL schema)

1. In your Supabase project dashboard, click **SQL Editor** in the left sidebar
2. Click **+ New query**
3. Open the file [`SUPABASE_SCHEMA.sql`](./SUPABASE_SCHEMA.sql) from this repo
4. Copy its **entire** contents into the SQL editor
5. Click **Run** (or press Cmd+Enter)
6. You should see "Success. No rows returned."

This creates:
- `profiles` — registered users
- `friendships` — player relationships
- `rounds` — full round data
- `round_players` — per-player rows for each round
- `live_shares` — temporary shareable codes
- All the Row Level Security policies (linked-players-only privacy)

## 3. Enable auth providers

1. Click **Authentication** → **Providers** in the left sidebar
2. **Email** — should already be on. Under it, make sure "Confirm email" is your choice:
   - **On** (default): users must click a link in their email before they can sign in. More secure.
   - **Off**: users can sign in immediately after signup. Friendlier but less secure.
3. **Magic Link** — automatically works with Email; no extra config needed
4. **Google** (optional but nice):
   - You'll need a Google Cloud project with OAuth credentials
   - Follow [Supabase's Google provider guide](https://supabase.com/docs/guides/auth/social-login/auth-google)
   - If you skip Google, the "Continue with Google" button will show an error when tapped; everything else still works

## 4. Set your site URL

1. **Authentication** → **URL Configuration**
2. **Site URL:** your app's URL (for Replit this is `https://your-repl-name.username.repl.co`; for GitHub Pages it's `https://yourname.github.io/ScotchGame/scotch-app/`)
3. **Redirect URLs:** add the same URL (one per line). Include both `http://` and `https://` variants if testing locally.
4. Click **Save**

## 5. Copy your project credentials

1. **Settings** → **API**
2. Copy:
   - **Project URL** (looks like `https://xxxxxxxxxxxx.supabase.co`)
   - **anon public** API key (looks like `eyJhbGci...`)
3. Open `scotch-app/supabase.js` in your editor
4. Find the top of the file:
   ```js
   const SUPABASE_URL = '';           // <-- PASTE YOUR PROJECT URL
   const SUPABASE_ANON_KEY = '';      // <-- PASTE YOUR ANON PUBLIC KEY
   ```
5. Paste the values between the quotes:
   ```js
   const SUPABASE_URL = 'https://xxxxxxxxxxxx.supabase.co';
   const SUPABASE_ANON_KEY = 'eyJhbGci...';
   ```
6. **Save the file**
7. Run the build script: `cd scotch-app && python3 build.py` (or just let your hosting rebuild if it does that automatically)
8. Commit and push

**Note on security:** The anon key is designed to be public. Row Level Security policies (from step 2) enforce that users can only see their own data. Do NOT paste the *service role* key here — that bypasses RLS.

## 6. Test it

1. Reload your app
2. Home screen → **Account** card → **Sign In / Sign Up**
3. Click **Sign Up**, fill in display name, email, and password
4. Check your email for a confirmation link (if you left "Confirm email" on)
5. Click the link, then return to the app and sign in
6. Start a round, finish 18 holes, go to the settlement screen — it auto-saves
7. Tap **Account** → **Round History** — you should see the round
8. Tap **Lifetime Stats** — totals show your round

## Troubleshooting

**"Cloud sync not set up" on the login screen**
- `SUPABASE_URL` or `SUPABASE_ANON_KEY` is still empty in `supabase.js`
- You didn't rebuild the app after editing `supabase.js` (run `python3 build.py`)
- The Supabase JS CDN script failed to load (check browser console)

**"Invalid login credentials"**
- Email confirmation is required and you haven't clicked the link yet
- Password is wrong

**"Row-level security policy violation"**
- You didn't run `SUPABASE_SCHEMA.sql` in step 2, or it didn't finish cleanly
- Re-run the entire SQL file in the SQL editor

**Round saved but doesn't appear in history**
- Supabase caches — close and reopen the History screen
- Check the browser console for errors
- Verify in the Supabase dashboard: **Table Editor** → **rounds** should show your round, and **round_players** should have your user_id linked

**Google sign-in doesn't work**
- Google provider isn't enabled in Authentication → Providers
- Redirect URL in Google Cloud Console doesn't match your Supabase callback URL
- For now, just use email + password; it's fine

## Free tier limits (reference)

- **50,000 monthly active users** — you'll never hit this
- **500 MB database** — each round is ~5 KB, so ~100,000 rounds
- **2 GB bandwidth** — plenty for a golf group
- **Unlimited API requests**
- No credit card required

If you ever outgrow the free tier, Supabase's Pro plan is $25/month. You won't.

---

## What happens when you invite someone by email

When the scorer adds a player by email at round setup, and that email isn't yet a registered user:
1. The round still saves with their row (name + email, no user_id)
2. Supabase can send them an invite email (optional, requires the "Send invites" toggle in Authentication → Users)
3. When they later sign up with that same email, the app automatically **claims** all their historical guest rows — they instantly see every past round they were in, with their real lifetime stats.

This is the "retroactive linking" feature. It's handled by the `claimGuestRows()` function in `supabase.js` and the `round_players_update_claim` RLS policy in the schema.
