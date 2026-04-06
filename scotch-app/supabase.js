// ==================== SUPABASE CLIENT ====================
// Thin wrapper around the Supabase JS client for auth + rounds/friends sync.
//
// SETUP:
//   1. Create a free project at https://supabase.com
//   2. In the Supabase dashboard → Settings → API, copy:
//      - Project URL          → paste into SUPABASE_URL below
//      - anon/public API key  → paste into SUPABASE_ANON_KEY below
//   3. In the SQL editor, run the contents of SUPABASE_SCHEMA.sql (in repo root)
//   4. In Authentication → Providers, enable Email, Magic Link, and (optionally) Google
//   5. Save this file and reload the app
//
// SAFETY: The anon key is safe to expose publicly. Row Level Security enforces
// who can read/write what. Never paste the SERVICE ROLE key here.

const SUPABASE_URL = 'https://sgflclztmzodywtrwndd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNnZmxjbHp0bXpvZHl3dHJ3bmRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MjczNjYsImV4cCI6MjA5MTAwMzM2Nn0.MrgGoIB8lvkaAdD2SAbh805JviYRfRBBmt3iHghrIdo';

const SupabaseClient = (() => {
  let _client = null;
  let _user = null;
  let _profile = null;
  const _listeners = [];

  function getSupabaseLib() {
    // The CDN UMD build may expose as window.supabase or window.Supabase
    return window.supabase || window.Supabase;
  }

  function isConfigured() {
    const lib = getSupabaseLib();
    return !!(SUPABASE_URL && SUPABASE_ANON_KEY && lib && lib.createClient);
  }

  function notify() {
    for (const fn of _listeners) {
      try { fn(_user, _profile); } catch (e) { console.error(e); }
    }
  }
  function onAuthChange(fn) {
    _listeners.push(fn);
    // Fire immediately with current state
    try { fn(_user, _profile); } catch (e) {}
    return () => {
      const i = _listeners.indexOf(fn);
      if (i >= 0) _listeners.splice(i, 1);
    };
  }

  async function init() {
    if (!isConfigured()) { console.warn('Supabase not configured or library not loaded'); return; }
    const lib = getSupabaseLib();
    const hadAuthInUrl = !!(window.location.hash && window.location.hash.includes('access_token')) ||
                         !!(window.location.search && new URLSearchParams(window.location.search).has('code'));

    _client = lib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const { data: { session } } = await _client.auth.getSession();
    if (session) {
      _user = session.user;
      await loadProfile();
    }

    if (hadAuthInUrl) {
      window.history.replaceState({}, '', window.location.pathname);
    }

    _client.auth.onAuthStateChange(async (event, session) => {
      _user = session ? session.user : null;
      _profile = null;
      if (_user) {
        await loadProfile();
        await claimGuestRows();
      }
      notify();
    });
    notify();

    return { session, hadAuthInUrl };
  }

  async function loadProfile() {
    if (!_client || !_user) return null;
    const { data, error } = await _client
      .from('profiles')
      .select('*')
      .eq('id', _user.id)
      .maybeSingle();
    if (data) _profile = data;
    else if (!error) {
      // Auto-create profile row
      const name = _user.user_metadata?.full_name || _user.email.split('@')[0];
      try {
        const { data: created, error: insertErr } = await _client
          .from('profiles')
          .insert({ id: _user.id, email: _user.email, display_name: name })
          .select()
          .single();
        if (insertErr) console.warn('Profile auto-create failed:', insertErr);
        else _profile = created;
      } catch (e) { console.warn('Profile create exception:', e); }
    }
    return _profile;
  }

  async function claimGuestRows() {
    if (!_client || !_user || !_user.email) return;
    // Link any round_players rows where invited_email matches and user_id is null
    await _client
      .from('round_players')
      .update({ user_id: _user.id })
      .is('user_id', null)
      .eq('invited_email', _user.email.toLowerCase());
  }

  // ---------- Auth methods ----------
  async function signInWithEmail(email, password) {
    if (!_client) throw new Error('Supabase not configured');
    return _client.auth.signInWithPassword({ email, password });
  }
  async function signUpWithEmail(email, password, displayName) {
    if (!_client) throw new Error('Supabase not configured');
    return _client.auth.signUp({
      email, password,
      options: { data: { full_name: displayName } }
    });
  }
  async function signInWithMagicLink(email) {
    if (!_client) throw new Error('Supabase not configured');
    return _client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.href }
    });
  }
  async function signInWithGoogle() {
    if (!_client) throw new Error('Supabase not configured');
    return _client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.href }
    });
  }
  async function signOut() {
    if (!_client) return;
    await _client.auth.signOut();
    _user = null;
    _profile = null;
    notify();
  }

  // ---------- Profile ----------
  async function updateProfile(patch) {
    if (!_client || !_user) return null;
    const { data } = await _client
      .from('profiles')
      .update(patch)
      .eq('id', _user.id)
      .select()
      .single();
    if (data) _profile = data;
    notify();
    return data;
  }

  // ---------- Friends / player search ----------
  async function searchUsersByName(query) {
    if (!_client) return [];
    try {
      let q = _client.from('profiles').select('id, display_name, email, handicap').order('display_name').limit(100);
      if (query && query.trim()) {
        const s = query.trim().replace(/'/g, "''"); // escape single quotes
        q = q.or(`display_name.ilike.%${s}%,email.ilike.%${s}%`);
      }
      const { data, error } = await q;
      if (error) { console.warn('searchUsersByName error:', error); return []; }
      return data || [];
    } catch (e) {
      console.warn('searchUsersByName exception:', e);
      return [];
    }
  }
  async function getFriends() {
    if (!_client || !_user) return [];
    const { data } = await _client
      .from('friendships')
      .select('friend_id, profiles:friend_id(id, display_name, email, handicap)')
      .eq('user_id', _user.id);
    return (data || []).map(r => r.profiles).filter(Boolean);
  }
  async function addFriend(friendId) {
    if (!_client || !_user) return;
    await _client.from('friendships').insert({ user_id: _user.id, friend_id: friendId });
  }

  // ---------- Rounds ----------
  async function saveRound(round, settlement) {
    if (!_client || !_user) return null;
    // Insert the round metadata
    const { data: roundRow, error } = await _client
      .from('rounds')
      .insert({
        scorer_id: _user.id,
        course_name: round.course?.name || 'Unknown',
        played_at: round.date || new Date().toISOString(),
        mode: round.mode || '4man',
        game_type: round.gameType || 'scotch',
        game_type_1: round.gameType1 || null,
        game_type_2: round.gameType2 || null,
        data: round,
        settlement: settlement
      })
      .select()
      .single();
    if (error) { console.error('saveRound error', error); return null; }

    // Insert round_players
    const players = [...round.teamA, ...round.teamB];
    const rows = players.map(p => ({
      round_id: roundRow.id,
      user_id: p.userId || null,
      invited_email: p.invitedEmail ? p.invitedEmail.toLowerCase() : null,
      display_name: p.name,
      team: p.team,
      stake: p.stake,
      handicap: p.handicap || 0,
      final_amount: settlement.perPlayer?.[p.id] || 0
    }));
    await _client.from('round_players').insert(rows);

    // Send invite emails to any unlinked players with emails
    for (const p of players) {
      if (!p.userId && p.invitedEmail) {
        try {
          await _client.auth.admin.inviteUserByEmail?.(p.invitedEmail);
        } catch (e) { /* admin API may not be available client-side */ }
      }
    }

    // Auto-recalculate handicaps for all linked players in this round
    try {
      await recalcHandicapsForPlayers(players.filter(p => p.userId).map(p => p.userId));
    } catch (e) {
      console.warn('Auto handicap recalc failed:', e);
    }

    return roundRow;
  }

  // ---------- Handicap auto-recalculation ----------
  // Custom formula: rolling last 9 rounds by date, compute differential
  // (gross - course rating), sort by value, discard best, average #2-#5.
  async function recalcHandicapsForPlayers(userIds) {
    if (!_client || !userIds || userIds.length === 0) return;

    for (const userId of userIds) {
      try {
        // Get this player's most recent 9 round_players rows (with round data)
        const { data: rps } = await _client
          .from('round_players')
          .select('display_name, round_id, rounds(played_at, data)')
          .eq('user_id', userId)
          .order('rounds(played_at)', { ascending: false })
          .limit(9);

        if (!rps || rps.length < 9) continue; // not enough rounds

        // Extract differentials
        const diffs = [];
        for (const rp of rps) {
          const round = rp.rounds;
          if (!round || !round.data) continue;
          const data = round.data;
          const allPlayers = [...(data.teamA || []), ...(data.teamB || [])];
          const player = allPlayers.find(p => p.name === rp.display_name);
          if (!player || !player.scores) continue;

          const gross = player.scores.reduce((s, v) => s + (v || 0), 0);
          const teeName = player.teesName || player.tees || '';
          const tee = (data.course?.tees || []).find(t => t.name === teeName);
          if (!tee || !tee.rating) continue;

          diffs.push(gross - tee.rating);
        }

        if (diffs.length < 9) continue;

        // Sort by value ascending (best = lowest)
        diffs.sort((a, b) => a - b);

        // Discard #1 (best), average #2-#5
        const counting = diffs.slice(1, 5);
        const avg = counting.reduce((s, v) => s + v, 0) / counting.length;
        const handicap = Math.round(avg);

        // Write back to profile
        await _client.from('profiles').update({ handicap }).eq('id', userId);
      } catch (e) {
        console.warn(`Handicap recalc failed for ${userId}:`, e);
      }
    }
  }

  async function listMyRounds() {
    if (!_client || !_user) return [];
    // Get round IDs where I'm a player
    const { data: playerRows } = await _client
      .from('round_players')
      .select('round_id, final_amount')
      .eq('user_id', _user.id);
    const ids = (playerRows || []).map(r => r.round_id);
    if (ids.length === 0) return [];
    const { data: rounds } = await _client
      .from('rounds')
      .select('*')
      .in('id', ids)
      .order('played_at', { ascending: false });
    const amountById = {};
    for (const r of (playerRows || [])) amountById[r.round_id] = r.final_amount;
    return (rounds || []).map(r => ({ ...r, my_amount: amountById[r.id] }));
  }

  async function getMyStats() {
    if (!_client || !_user) return null;
    const [{ data: playerRows }, { data: paymentRows }] = await Promise.all([
      _client.from('round_players')
        .select('round_id, final_amount, rounds(mode, game_type, course_name)')
        .eq('user_id', _user.id),
      _client.from('payments')
        .select('amount')
        .eq('user_id', _user.id)
    ]);
    const rows = playerRows || [];
    const stats = {
      roundsPlayed: rows.length,
      totalWon: 0,
      totalLost: 0,
      netTotal: 0,
      wins: 0,
      losses: 0,
      ties: 0,
      byCourse: {},
      paymentsTotal: 0
    };
    for (const r of rows) {
      const amt = r.final_amount || 0;
      stats.netTotal += amt;
      if (amt > 0) { stats.totalWon += amt; stats.wins++; }
      else if (amt < 0) { stats.totalLost += -amt; stats.losses++; }
      else stats.ties++;
      const course = r.rounds?.course_name || 'Unknown';
      if (!stats.byCourse[course]) stats.byCourse[course] = { rounds: 0, net: 0 };
      stats.byCourse[course].rounds++;
      stats.byCourse[course].net += amt;
    }
    // Add payments (settlements) to get ledger balance
    for (const p of (paymentRows || [])) {
      stats.paymentsTotal += (p.amount || 0);
    }
    stats.ledgerBalance = stats.netTotal + stats.paymentsTotal;
    return stats;
  }

  async function getHeadToHead() {
    if (!_client || !_user) return [];
    // Find all rounds I'm in, then everyone else in those rounds → sum their deltas vs me.
    const { data: myRows } = await _client
      .from('round_players')
      .select('round_id, team, final_amount')
      .eq('user_id', _user.id);
    if (!myRows || myRows.length === 0) return [];
    const roundIds = myRows.map(r => r.round_id);
    const myTeamByRound = Object.fromEntries(myRows.map(r => [r.round_id, r.team]));
    const { data: allRows } = await _client
      .from('round_players')
      .select('round_id, user_id, display_name, team, final_amount')
      .in('round_id', roundIds);
    const byOpp = {};
    for (const r of (allRows || [])) {
      if (!r.user_id || r.user_id === _user.id) continue;
      const myTeam = myTeamByRound[r.round_id];
      const sameTeam = r.team === myTeam;
      const key = r.user_id;
      if (!byOpp[key]) byOpp[key] = { name: r.display_name, as_partner: 0, as_opponent: 0, rounds: 0, net: 0 };
      byOpp[key].rounds++;
      if (sameTeam) byOpp[key].as_partner++;
      else byOpp[key].as_opponent++;
      // Opponent's final amount is the inverse signal — rough head-to-head
      byOpp[key].net += (r.final_amount || 0);
    }
    return Object.entries(byOpp).map(([id, v]) => ({ id, ...v }));
  }

  // ---------- Live share ----------
  async function createLiveShare(roundLocalId) {
    if (!_client || !_user) return null;
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    const { data } = await _client
      .from('live_shares')
      .insert({ code, scorer_id: _user.id, round_local_id: roundLocalId })
      .select()
      .single();
    return data;
  }
  async function updateLiveShare(code, round) {
    if (!_client) return;
    await _client.from('live_shares').update({ data: round, updated_at: new Date().toISOString() }).eq('code', code);
  }
  async function subscribeToLiveShare(code, onUpdate) {
    if (!_client) return null;
    const { data } = await _client.from('live_shares').select('*').eq('code', code).maybeSingle();
    if (data) onUpdate(data);
    const channel = _client
      .channel(`live-${code}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'live_shares', filter: `code=eq.${code}` },
        payload => onUpdate(payload.new))
      .subscribe();
    return () => _client.removeChannel(channel);
  }

  // ---------- Courses ----------
  async function loadCourses() {
    if (!_client) return [];
    const { data, error } = await _client.from('courses').select('*').order('name');
    if (error) { console.warn('loadCourses error:', error); return []; }
    return data || [];
  }

  // ---------- Public API ----------
  return {
    init,
    isConfigured,
    getUser: () => _user,
    getProfile: () => _profile,
    onAuthChange,
    // auth
    signInWithEmail,
    signUpWithEmail,
    signInWithMagicLink,
    signInWithGoogle,
    signOut,
    updateProfile,
    // social
    searchUsersByName,
    getFriends,
    addFriend,
    // rounds
    saveRound,
    listMyRounds,
    getMyStats,
    getHeadToHead,
    // courses
    loadCourses,
    // live share
    createLiveShare,
    updateLiveShare,
    subscribeToLiveShare
  };
})();
