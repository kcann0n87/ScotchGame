// ==================== LLOYDS GAME ADMIN DASHBOARD ====================
const Admin = (() => {

// Reuse same Supabase credentials as mobile app
const SUPABASE_URL = 'https://sgflclztmzodywtrwndd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNnZmxjbHp0bXpvZHl3dHJ3bmRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MjczNjYsImV4cCI6MjA5MTAwMzM2Nn0.MrgGoIB8lvkaAdD2SAbh805JviYRfRBBmt3iHghrIdo';

// Course presets with tee ratings (same data as mobile app)
const COURSES = [
  { name: 'Bear Lakes CC - Lakes',
    pars: [4,3,5,4,4,5,4,3,4, 4,3,5,4,3,4,4,4,5],
    si:   [13,15,11,3,7,9,1,17,5, 6,18,14,4,16,2,10,12,8],
    tees: [
      { name: 'Gold', rating: 76.7 }, { name: 'Blue', rating: 72.6 }, { name: 'White', rating: 68.7 }
    ]},
  { name: 'Panther National',
    pars: [4,3,5,4,4,4,5,3,4, 4,5,4,3,4,4,3,4,5],
    si:   [15,11,9,1,5,13,7,17,3, 10,4,8,16,2,14,18,12,6],
    tees: [
      { name: 'Gold', rating: 71.4 }, { name: 'Blue', rating: 68.6 }, { name: 'White', rating: 63.7 }
    ]},
  { name: 'Boca Rio GC',
    pars: [5,4,3,4,4,3,4,5,4, 5,4,4,3,4,4,5,3,4],
    si:   [11,3,17,13,7,15,1,5,9, 10,4,14,18,6,2,12,16,8],
    tees: [
      { name: 'Blue', rating: 73.7 }, { name: 'White', rating: 71.6 }, { name: 'Gold', rating: 67.8 }
    ]},
  { name: 'Mizner CC',
    pars: [4,4,5,4,3,4,5,4,3, 4,4,4,3,4,5,5,3,4],
    si:   [7,1,11,15,9,3,5,17,13, 16,2,4,18,8,14,10,6,12],
    tees: [
      { name: 'Gold', rating: 72.8 }, { name: 'Blue', rating: 71.3 }, { name: 'White', rating: 69.2 }
    ]},
  { name: 'Boca Grove',
    pars: [4,5,3,4,4,4,5,3,4, 4,4,5,3,4,3,3,4,5],
    si:   [13,5,15,1,9,17,7,11,3, 4,12,6,14,2,18,16,8,10],
    tees: [
      { name: 'Tour', rating: 72.7 }, { name: 'Champion', rating: 70.5 }, { name: 'Member', rating: 68.6 }, { name: 'Middle', rating: 68.0 }
    ]},
  { name: 'Delaire CC - Lakes/Hills',
    pars: [4,5,4,3,4,5,3,4,4, 5,3,5,4,3,4,4,4,4],
    si:   [11,7,3,15,9,1,17,13,5, 10,16,4,14,18,2,6,12,8],
    tees: [
      { name: 'Blue', rating: 71.1 }, { name: 'White', rating: 69.7 }, { name: 'Gold', rating: 66.4 }
    ]},
  { name: 'Delaire CC - Hills/Woods',
    pars: [5,3,5,4,3,4,4,4,4, 4,5,3,4,5,4,3,4,4],
    si:   [9,15,3,13,17,1,5,11,7, 4,8,16,2,12,14,18,10,6],
    tees: [
      { name: 'Blue', rating: 70.7 }, { name: 'White', rating: 69.3 }, { name: 'Gold', rating: 66.3 }
    ]},
  { name: 'Delaire CC - Woods/Lakes',
    pars: [4,5,3,4,5,4,3,4,4, 4,5,4,3,4,5,3,4,4],
    si:   [3,7,15,1,11,13,17,9,5, 12,8,4,16,10,2,18,14,6],
    tees: [
      { name: 'Blue', rating: 71.0 }, { name: 'White', rating: 69.6 }, { name: 'Gold', rating: 66.1 }
    ]}
];

let db = null;
let user = null;
let profile = null;
let activeTab = 'dashboard';
let allCourses = null;

// Cached data
let allProfiles = null;
let allRounds = null;
let allRoundPlayers = null;
let allPayments = null;
let handicapResults = null;
let selectedPlayerId = null;
let paymentModal = false;

const root = document.getElementById('admin-root');

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'class') el.className = attrs[k];
    else if (k === 'onclick') el.onclick = attrs[k];
    else if (k === 'oninput') el.oninput = attrs[k];
    else if (k === 'onchange') el.onchange = attrs[k];
    else el.setAttribute(k, attrs[k]);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

// ==================== AUTH ====================
async function init() {
  try {
    const lib = window.supabase || window.Supabase;
    if (!lib || !lib.createClient) {
      root.innerHTML = '<div class="login-box"><h2>⛳ Lloyds Game Admin</h2><p>Supabase library not loaded. Try reloading.</p></div>';
      return;
    }
    db = lib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    // Refresh session first to avoid stale tokens
    await db.auth.refreshSession();
    const { data: { session } } = await db.auth.getSession();
    if (session) {
      user = session.user;
      await loadProfile();
    }
    db.auth.onAuthStateChange(async (ev, session) => {
      user = session ? session.user : null;
      profile = null;
      if (user) await loadProfile();
      render();
    });
    render();
  } catch (e) {
    console.error('Admin init error:', e);
    root.innerHTML = `<div class="login-box"><h2>⛳ Lloyds Game Admin</h2><p style="color:red;">Error: ${e.message}</p><p style="font-size:12px;">This page must be served over HTTP (not file://). Try opening it on GitHub Pages or Replit instead.</p></div>`;
  }
}

async function loadProfile() {
  if (!db || !user) return;
  const { data } = await db.from('profiles').select('*').eq('id', user.id).maybeSingle();
  profile = data;
}

async function signIn(email, pw) {
  const { error } = await db.auth.signInWithPassword({ email, password: pw });
  if (error) alert(error.message);
}

async function signOut() {
  await db.auth.signOut();
  user = null; profile = null;
  allProfiles = allRounds = allRoundPlayers = allPayments = handicapResults = null;
  render();
}

// ==================== DATA LOADING ====================
async function loadAllData() {
  if (!db || !user) return;
  const [profiles, rounds, rp, payments, courses] = await Promise.all([
    db.from('profiles').select('*'),
    db.from('rounds').select('*').order('played_at', { ascending: false }),
    db.from('round_players').select('*'),
    db.from('payments').select('*').order('created_at', { ascending: false }),
    db.from('courses').select('*').order('name')
  ]);
  allProfiles = profiles.data || [];
  allRounds = rounds.data || [];
  allRoundPlayers = rp.data || [];
  allPayments = payments.data || [];
  allCourses = courses.data || [];
  // Merge DB courses into the hardcoded COURSES list (DB takes priority)
  for (const c of allCourses) {
    const idx = COURSES.findIndex(x => x.name === c.name);
    const entry = { name: c.name, tees: c.tees || [], dbId: c.id, pars: c.pars, si: c.si };
    if (idx >= 0) COURSES[idx] = entry;
    else COURSES.push(entry);
  }
  render();
}

// ==================== HANDICAP ENGINE ====================
function computeAllHandicaps() {
  if (!allProfiles || !allRounds || !allRoundPlayers) return {};
  const results = {};
  for (const p of allProfiles) {
    results[p.id] = computePlayerHandicap(p.id);
  }
  handicapResults = results;
  return results;
}

function computePlayerHandicap(userId) {
  // Find all approved/manual rounds this player participated in, sorted by date desc
  const playerRPs = allRoundPlayers
    .filter(rp => rp.user_id === userId)
    .map(rp => {
      const round = allRounds.find(r => r.id === rp.round_id);
      if (!round) return null;
      if (round.status === 'pending' || round.status === 'rejected') return null;
      return { rp, round };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.round.played_at) - new Date(a.round.played_at));

  // Extract differentials from the round data blob
  const diffs = [];
  for (const { rp, round } of playerRPs) {
    const d = extractDifferential(round, rp);
    if (d !== null) diffs.push({ ...d, date: round.played_at, course: round.course_name, roundId: round.id });
  }

  // Take most recent 9 by date
  const recent9 = diffs.slice(0, 9);

  if (recent9.length < 9) {
    return { handicap: null, diffs: recent9, needed: 9 - recent9.length, message: `Need ${9 - recent9.length} more rounds` };
  }

  // Sort by differential value (ascending = best first)
  const sorted = recent9.map(d => d.diff).sort((a, b) => a - b);

  // Discard #1 (best), average #2-#5, discard #6-#9
  const counting = sorted.slice(1, 5);
  const avg = counting.reduce((s, v) => s + v, 0) / counting.length;
  const handicap = Math.round(avg);

  return {
    handicap,
    diffs: recent9,
    sorted,
    counting,
    avg,
    message: null
  };
}

function extractDifferential(round, roundPlayer) {
  const data = round.data;
  if (!data) return null;

  // Find this player in the round's teamA or teamB
  const allPlayers = [...(data.teamA || []), ...(data.teamB || [])];
  // Match by name (display_name from round_players should match)
  const player = allPlayers.find(p => p.name === roundPlayer.display_name);
  if (!player || !player.scores) return null;

  // Sum gross score
  const gross = player.scores.reduce((s, v) => s + (v || 0), 0);

  // Find tee rating
  const teeName = player.teesName || player.tees || '';
  const tees = data.course?.tees || [];
  const tee = tees.find(t => t.name === teeName);
  const rating = tee?.rating;

  if (!rating) return { gross, rating: null, diff: null, tee: teeName, missingRating: true };

  return { gross, rating, diff: gross - rating, tee: teeName, missingRating: false };
}

async function applyHandicaps() {
  if (!handicapResults || !db) return;
  let updated = 0;
  for (const [userId, result] of Object.entries(handicapResults)) {
    if (result.handicap !== null) {
      const current = allProfiles.find(p => p.id === userId);
      if (current && current.handicap !== result.handicap) {
        await db.from('profiles').update({ handicap: result.handicap }).eq('id', userId);
        current.handicap = result.handicap;
        updated++;
      }
    }
  }
  alert(`Updated ${updated} handicap(s).`);
  render();
}

// ==================== LEDGER ====================
function getPlayerLedger(userId) {
  const entries = [];

  // Round entries (only approved/manual rounds count)
  const rps = allRoundPlayers.filter(rp => rp.user_id === userId);
  for (const rp of rps) {
    const round = allRounds.find(r => r.id === rp.round_id);
    if (!round) continue;
    if (round.status === 'pending' || round.status === 'rejected') continue;
    entries.push({
      date: new Date(round.played_at),
      type: 'round',
      desc: round.course_name,
      amount: rp.final_amount || 0
    });
  }

  // Payment entries
  const pays = (allPayments || []).filter(p => p.user_id === userId);
  for (const p of pays) {
    entries.push({
      date: new Date(p.created_at),
      type: 'payment',
      desc: p.note || 'Payment',
      amount: p.amount
    });
  }

  // Sort chronologically
  entries.sort((a, b) => a.date - b.date);

  // Add running balance
  let balance = 0;
  for (const e of entries) {
    balance += e.amount;
    e.balance = balance;
  }

  return { entries, balance };
}

function getLeaderboard() {
  if (!allProfiles) return [];
  return allProfiles.map(p => {
    const ledger = getPlayerLedger(p.id);
    return { ...p, balance: ledger.balance, roundsPlayed: ledger.entries.filter(e => e.type === 'round').length };
  }).sort((a, b) => b.balance - a.balance);
}

async function recordPayment(userId, amount, note) {
  if (!db || !user) return;
  await db.from('payments').insert({ user_id: userId, amount, note, recorded_by: user.id });
  // Reload payments
  const { data } = await db.from('payments').select('*').order('created_at', { ascending: false });
  allPayments = data || [];
  paymentModal = false;
  render();
}

// ==================== RENDERING ====================
function render() {
  root.innerHTML = '';
  if (!user) return renderLogin();
  if (!profile) {
    // Profile not loaded yet — show loading instead of Access Denied
    root.innerHTML = '<div class="app"><div class="login-box"><h2>⛳ Lloyds Game Admin</h2><p>Loading profile...</p></div></div>';
    loadProfile().then(() => render());
    return;
  }
  if (!profile.is_admin) return renderAccessDenied();
  if (!allProfiles) { loadAllData(); root.innerHTML = '<div class="app"><p>Loading...</p></div>'; return; }

  // Header
  root.appendChild(h('div', { class: 'header' },
    h('h1', null, 'LLOYDS GAME ADMIN'),
    h('div', null,
      h('span', { class: 'user' }, profile.display_name || user.email),
      h('button', { onclick: signOut, style: 'margin-left:12px;' }, 'Sign Out')
    )
  ));

  const app = h('div', { class: 'app' });

  // Tabs
  const tabs = h('div', { class: 'tabs' },
    ...['dashboard', 'enter round', 'courses', 'players', 'handicaps', 'ledger'].map(t =>
      h('div', { class: `tab ${activeTab === t ? 'active' : ''}`, onclick: () => { activeTab = t; selectedPlayerId = null; render(); } }, t)
    )
  );
  app.appendChild(tabs);

  if (activeTab === 'dashboard') renderDashboard(app);
  else if (activeTab === 'enter round') renderEnterRound(app);
  else if (activeTab === 'courses') renderCourses(app);
  else if (activeTab === 'players') renderPlayers(app);
  else if (activeTab === 'handicaps') renderHandicaps(app);
  else if (activeTab === 'ledger') renderLedger(app);

  root.appendChild(app);

  // Payment modal
  if (paymentModal) renderPaymentModal();
}

function renderLogin() {
  let email = '', pw = '';
  const box = h('div', { class: 'login-box' },
    h('h2', null, '⛳ Lloyds Game Admin'),
    h('div', { class: 'field' },
      h('label', null, 'Email'),
      h('input', { type: 'email', placeholder: 'you@example.com', oninput: e => { email = e.target.value; } })
    ),
    h('div', { class: 'field' },
      h('label', null, 'Password'),
      h('input', { type: 'password', placeholder: '••••••••', oninput: e => { pw = e.target.value; } })
    ),
    h('button', { class: 'btn', style: 'width:100%;', onclick: () => signIn(email, pw) }, 'Sign In')
  );
  root.appendChild(box);
}

function renderAccessDenied() {
  root.appendChild(h('div', { class: 'app' },
    h('div', { class: 'card' },
      h('h2', null, 'Access Denied'),
      h('p', null, 'Your account does not have admin privileges.'),
      h('p', null, `Logged in as: ${user.email}`),
      h('button', { class: 'btn secondary', onclick: signOut }, 'Sign Out')
    )
  ));
}

// ==================== COURSES TAB ====================
let editingCourseId = null;
let showAddCourse = false;
let newCourseName = '';
let newCourseTees = [{ name: 'Blue', rating: '' }, { name: 'White', rating: '' }, { name: 'Gold', rating: '' }];

function renderCourses(app) {
  // Add Course form
  app.appendChild(h('div', { class: 'card', style: 'margin-top:16px;' },
    h('h2', null, 'Add Course'),
    !showAddCourse
      ? h('button', { class: 'btn secondary', onclick: () => { showAddCourse = true; newCourseName = ''; newCourseTees = [{ name: 'Blue', rating: '' }, { name: 'White', rating: '' }, { name: 'Gold', rating: '' }]; render(); } }, '+ Add Course')
      : h('div', null,
          h('div', { class: 'field' },
            h('label', null, 'Course Name'),
            h('input', { type: 'text', placeholder: 'Pine Valley CC', oninput: e => { newCourseName = e.target.value; } })
          ),
          h('h3', null, 'Tee Boxes'),
          ...newCourseTees.map((t, i) =>
            h('div', { style: 'display:flex;gap:8px;align-items:center;margin-bottom:6px;' },
              h('input', { type: 'text', value: t.name, placeholder: 'Tee name', style: 'flex:1;', oninput: e => { t.name = e.target.value; } }),
              h('input', { type: 'number', value: t.rating, placeholder: 'Rating', step: '0.1', style: 'width:80px;', oninput: e => { t.rating = e.target.value; } }),
              h('button', { class: 'btn sm danger', style: 'width:auto;', onclick: () => { newCourseTees.splice(i, 1); render(); } }, 'x')
            )
          ),
          h('button', { class: 'btn sm secondary', style: 'margin-bottom:12px;', onclick: () => { newCourseTees.push({ name: '', rating: '' }); render(); } }, '+ Add Tee'),
          h('div', { style: 'display:flex;gap:8px;' },
            h('button', { class: 'btn', onclick: async () => {
              if (!newCourseName.trim()) { alert('Enter a course name'); return; }
              const tees = newCourseTees.filter(t => t.name.trim()).map(t => ({ name: t.name.trim(), rating: t.rating ? parseFloat(t.rating) : null }));
              const { error } = await db.from('courses').insert({
                name: newCourseName.trim(),
                tees,
                created_by: user.id
              });
              if (error) { alert('Error: ' + error.message); return; }
              showAddCourse = false;
              allCourses = null;
              await loadAllData();
            } }, 'Save Course'),
            h('button', { class: 'btn secondary', onclick: () => { showAddCourse = false; render(); } }, 'Cancel')
          )
        )
  ));

  // Course list
  app.appendChild(h('div', { class: 'card' },
    h('h2', null, `All Courses (${COURSES.length})`),
    h('table', null,
      h('thead', null, h('tr', null,
        h('th', null, 'Course'),
        h('th', null, 'Tees'),
        h('th', null, 'Source'),
        h('th', null, '')
      )),
      h('tbody', null,
        ...COURSES.map(c => {
          const isEditing = editingCourseId === (c.dbId || c.name);
          const teeStr = (c.tees || []).map(t => `${t.name}${t.rating ? ' (' + t.rating + ')' : ''}`).join(', ');
          if (isEditing) {
            // Initialize edit state
            if (!c._editName) c._editName = c.name;
            if (!c._editTees) c._editTees = (c.tees || []).map(t => {
              // Only keep si if it has real overrides (not just sequential 1-18 or copy of default)
              let si = null;
              if (t.si && Array.isArray(t.si)) {
                const isSequential = t.si.every((v, idx) => v === idx + 1);
                const isDefaultCopy = c.si && t.si.every((v, idx) => v === c.si[idx]);
                if (!isSequential && !isDefaultCopy) si = [...t.si];
              }
              return { ...t, si };
            });
            if (!c._editPars) c._editPars = c.pars ? [...c.pars] : Array(18).fill(4);
            if (!c._editSi) c._editSi = c.si ? [...c.si] : Array(18).fill(0).map((_, i) => i + 1);

            const editTees = c._editTees;
            const editPars = c._editPars;
            const editSi = c._editSi;

            // Build the scorecard table: Hole | Par | Default Hcp | Tee1 Hcp | Tee2 Hcp | ...
            const scorecardRows = [];
            for (let hole = 0; hole < 18; hole++) {
              if (hole === 9) {
                scorecardRows.push(h('tr', { style: 'background:var(--bg);' },
                  h('td', { colspan: String(3 + editTees.length), style: 'text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);font-weight:700;padding:6px;' }, '— Back 9 —')
                ));
              }
              scorecardRows.push(h('tr', null,
                h('td', { style: 'font-weight:700;' }, String(hole + 1)),
                h('td', null, h('input', { type: 'number', value: editPars[hole], min: 3, max: 6, style: 'width:45px;text-align:center;padding:4px;',
                  oninput: e => { editPars[hole] = parseInt(e.target.value) || 4; } })),
                h('td', null, h('input', { type: 'number', value: editSi[hole], min: 1, max: 18, style: 'width:45px;text-align:center;padding:4px;font-weight:700;',
                  oninput: e => { editSi[hole] = parseInt(e.target.value) || 1; render(); } })),
                ...editTees.map(t => {
                  // Per-tee hcp: blank = uses default. Only show a value if it differs from default.
                  const hasOverride = t.si && t.si[hole] != null && t.si[hole] !== editSi[hole];
                  const displayVal = hasOverride ? String(t.si[hole]) : '';
                  return h('td', null, h('input', { type: 'number', value: displayVal, min: 1, max: 18,
                    placeholder: String(editSi[hole]),
                    style: `width:45px;text-align:center;padding:4px;${hasOverride ? 'font-weight:700;color:var(--green-dark);' : 'color:var(--muted);'}`,
                    oninput: e => {
                      if (!t.si) t.si = Array(18).fill(null);
                      const v = e.target.value;
                      t.si[hole] = v === '' ? null : (parseInt(v) || null);
                    }
                  }));
                })
              ));
            }
            // Totals row
            scorecardRows.push(h('tr', { style: 'font-weight:700;background:var(--bg);' },
              h('td', null, 'Total'),
              h('td', null, String(editPars.reduce((s, v) => s + v, 0))),
              h('td', null, ''),
              ...editTees.map(() => h('td', null, ''))
            ));

            return h('tr', { style: 'background:#fffdf5;vertical-align:top;' },
              h('td', { colspan: '4' },
                h('div', { class: 'field' },
                  h('label', null, 'Course Name'),
                  h('input', { type: 'text', value: c._editName, oninput: e => { c._editName = e.target.value; } })
                ),
                // Tee boxes with ratings
                h('h3', null, 'Tee Boxes'),
                ...editTees.map((t, i) =>
                  h('div', { style: 'display:flex;gap:8px;align-items:center;margin-bottom:6px;' },
                    h('input', { type: 'text', value: t.name, placeholder: 'Tee name', style: 'flex:1;', oninput: e => { t.name = e.target.value; } }),
                    h('input', { type: 'number', value: t.rating != null ? String(t.rating) : '', placeholder: 'Rating', step: '0.1', style: 'width:80px;', oninput: e => { t.rating = e.target.value ? parseFloat(e.target.value) : null; } }),
                    h('button', { class: 'btn sm danger', style: 'width:auto;', onclick: () => { editTees.splice(i, 1); render(); } }, 'x')
                  )
                ),
                h('button', { class: 'btn sm secondary', style: 'margin-bottom:12px;', onclick: () => { editTees.push({ name: '', rating: null, si: Array(18).fill(null) }); render(); } }, '+ Add Tee'),
                // Full scorecard: Par + Default Hcp + Per-tee Hcp
                h('h3', null, 'Scorecard'),
                h('div', { style: 'overflow-x:auto;' },
                  h('table', { style: 'font-size:12px;' },
                    h('thead', null, h('tr', null,
                      h('th', null, 'Hole'),
                      h('th', null, 'Par'),
                      h('th', null, 'Def Hcp'),
                      ...editTees.map(t => h('th', null, `${t.name || '?'} Hcp`))
                    )),
                    h('tbody', null, ...scorecardRows)
                  )
                ),
                // Save / Cancel
                h('div', { style: 'display:flex;gap:8px;margin-top:12px;' },
                  h('button', { class: 'btn sm', onclick: async () => {
                    const name = c._editName.trim();
                    const tees = editTees.filter(t => t.name?.trim()).map(t => {
                      // Only store si array if at least one hole differs from default
                      let siArr = null;
                      if (t.si) {
                        const hasAnyOverride = t.si.some((v, idx) => v != null && v !== editSi[idx]);
                        if (hasAnyOverride) {
                          // Fill nulls with default values for a complete 18-element array
                          siArr = t.si.map((v, idx) => v != null ? v : editSi[idx]);
                        }
                      }
                      return { name: t.name.trim(), rating: t.rating, si: siArr };
                    });
                    const pars = editPars;
                    const si = editSi;
                    if (c.dbId) {
                      await db.from('courses').update({ name, tees, pars, si, updated_at: new Date().toISOString() }).eq('id', c.dbId);
                    } else {
                      await db.from('courses').insert({ name, tees, pars, si, created_by: user.id });
                    }
                    editingCourseId = null;
                    delete c._editTees; delete c._editName; delete c._editPars; delete c._editSi;
                    allCourses = null;
                    await loadAllData();
                  } }, 'Save'),
                  h('button', { class: 'btn sm secondary', onclick: () => {
                    editingCourseId = null;
                    delete c._editTees; delete c._editName; delete c._editPars; delete c._editSi;
                    render();
                  } }, 'Cancel')
                )
              )
            );
          }
          return h('tr', { class: 'clickable', onclick: () => {
            editingCourseId = c.dbId || c.name;
            c._editTees = (c.tees || []).map(t => ({ ...t }));
            render();
          } },
            h('td', null, h('strong', null, c.name)),
            h('td', { style: 'font-size:12px;' }, teeStr || '—'),
            h('td', null, c.dbId ? h('span', { class: 'badge ok' }, 'Database') : h('span', { class: 'badge warn' }, 'Preset only')),
            h('td', { style: 'font-size:11px;color:var(--muted);' }, 'Click to edit')
          );
        })
      )
    )
  ));
}

// ==================== PLAYERS TAB ====================
let editingProfileId = null;
let editName = '';
let editHandicap = '';
let editEmail = '';
let showAddPlayer = false;
let addPlayerName = '';
let addPlayerHandicap = '';
let addPlayerEmail = '';

function renderPlayers(app) {
  // Add Player form
  app.appendChild(h('div', { class: 'card', style: 'margin-top:16px;' },
    h('h2', null, 'Add Player'),
    h('div', { style: 'font-size:12px;color:var(--muted);margin-bottom:12px;' },
      'Add players who don\'t have their own account. They\'ll show up in the app when linking players to a round.'),
    !showAddPlayer
      ? h('button', { class: 'btn secondary', onclick: () => { showAddPlayer = true; addPlayerName = ''; addPlayerHandicap = ''; addPlayerEmail = ''; render(); } }, '+ Add Player')
      : h('div', null,
          h('div', { class: 'field' },
            h('label', null, 'Name (required)'),
            h('input', { type: 'text', placeholder: 'Mike Johnson', oninput: e => { addPlayerName = e.target.value; } })
          ),
          h('div', { style: 'display:flex;gap:10px;' },
            h('div', { class: 'field', style: 'flex:1;' },
              h('label', null, 'Handicap'),
              h('input', { type: 'number', placeholder: '0', oninput: e => { addPlayerHandicap = e.target.value; } })
            ),
            h('div', { class: 'field', style: 'flex:2;' },
              h('label', null, 'Email (optional)'),
              h('input', { type: 'email', placeholder: 'mike@example.com', oninput: e => { addPlayerEmail = e.target.value; } })
            )
          ),
          h('div', { style: 'display:flex;gap:8px;margin-top:8px;' },
            h('button', { class: 'btn', onclick: async () => {
              if (!addPlayerName.trim()) { alert('Name is required'); return; }
              const newId = crypto.randomUUID();
              const { error } = await db.from('profiles').insert({
                id: newId,
                display_name: addPlayerName.trim(),
                handicap: addPlayerHandicap ? parseInt(addPlayerHandicap) || 0 : 0,
                email: addPlayerEmail.trim() || null
              });
              if (error) { alert('Error: ' + error.message); return; }
              showAddPlayer = false;
              allProfiles = null;
              await loadAllData();
            } }, 'Save Player'),
            h('button', { class: 'btn secondary', onclick: () => { showAddPlayer = false; render(); } }, 'Cancel')
          )
        )
  ));

  app.appendChild(h('div', { class: 'card' },
    h('h2', null, 'Manage Players'),
    h('div', { style: 'font-size:12px;color:var(--muted);margin-bottom:12px;' },
      'Click a player to edit their display name, handicap, or email.'),
    h('table', null,
      h('thead', null, h('tr', null,
        h('th', null, 'Name'),
        h('th', null, 'Email'),
        h('th', null, 'Handicap'),
        h('th', null, 'Admin'),
        h('th', null, '')
      )),
      h('tbody', null,
        ...allProfiles.map(p => {
          const isEditing = editingProfileId === p.id;
          if (isEditing) {
            return h('tr', { style: 'background:#fffdf5;' },
              h('td', null, h('input', { type: 'text', value: editName, style: 'width:100%;', oninput: e => { editName = e.target.value; } })),
              h('td', null, h('input', { type: 'email', value: editEmail, style: 'width:100%;', oninput: e => { editEmail = e.target.value; } })),
              h('td', null, h('input', { type: 'number', value: editHandicap, style: 'width:60px;', oninput: e => { editHandicap = e.target.value; } })),
              h('td', null, p.is_admin ? '★' : '—'),
              h('td', null,
                h('button', { class: 'btn sm', onclick: async () => {
                  const patch = {};
                  if (editName.trim() && editName.trim() !== p.display_name) patch.display_name = editName.trim();
                  if (editHandicap !== '' && parseInt(editHandicap) !== p.handicap) patch.handicap = parseInt(editHandicap) || 0;
                  if (editEmail.trim() && editEmail.trim() !== p.email) patch.email = editEmail.trim();
                  if (Object.keys(patch).length > 0) {
                    await db.from('profiles').update(patch).eq('id', p.id);
                    Object.assign(p, patch);
                  }
                  editingProfileId = null;
                  render();
                } }, 'Save'),
                h('button', { class: 'btn sm secondary', style: 'margin-left:4px;', onclick: () => { editingProfileId = null; render(); } }, 'Cancel')
              )
            );
          }
          return h('tr', { class: 'clickable', onclick: () => {
            editingProfileId = p.id;
            editName = p.display_name || '';
            editHandicap = p.handicap != null ? String(p.handicap) : '';
            editEmail = p.email || '';
            render();
          } },
            h('td', null, h('strong', null, p.display_name || '(no name)')),
            h('td', { style: 'font-size:12px;color:var(--muted);' }, p.email || '—'),
            h('td', null, p.handicap != null ? String(p.handicap) : '—'),
            h('td', null, p.is_admin ? h('span', { class: 'badge admin' }, 'Admin') : '—'),
            h('td', { style: 'font-size:11px;color:var(--muted);' }, 'Click to edit')
          );
        })
      )
    )
  ));
}

// ==================== ENTER ROUND TAB ====================
let roundEntry = null;
function initRoundEntry() {
  roundEntry = {
    date: new Date().toISOString().split('T')[0],
    course: COURSES[0] ? COURSES[0].name : '',
    players: [
      { profileId: '', tee: '', gross: '', amount: '' },
      { profileId: '', tee: '', gross: '', amount: '' },
      { profileId: '', tee: '', gross: '', amount: '' },
      { profileId: '', tee: '', gross: '', amount: '' },
    ]
  };
}

function renderEnterRound(app) {
  if (!roundEntry) initRoundEntry();
  const re = roundEntry;

  app.appendChild(h('div', { class: 'card', style: 'margin-top:16px;' },
    h('h2', null, 'Enter a Round'),
    h('div', { style: 'font-size:12px;color:var(--muted);margin-bottom:14px;' },
      'Manually enter a completed round. This creates round records for handicap calculation and updates the money ledger.'),

    // Date + Course dropdown
    h('div', { style: 'display:flex;gap:12px;margin-bottom:16px;' },
      h('div', { class: 'field', style: 'flex:1;' },
        h('label', null, 'Date'),
        h('input', { type: 'date', value: re.date, oninput: e => { re.date = e.target.value; } })
      ),
      h('div', { class: 'field', style: 'flex:2;' },
        h('label', null, 'Course'),
        h('select', { style: 'width:100%;', onchange: e => {
          re.course = e.target.value;
          // Reset tees for all players when course changes
          const tees = getCourseTees(re.course);
          re.players.forEach(p => { p.tee = tees[0] ? tees[0].name : ''; });
          render();
        } },
          h('option', { value: '' }, '-- Select Course --'),
          ...COURSES.map(c =>
            h('option', { value: c.name, ...(re.course === c.name ? { selected: 'selected' } : {}) }, c.name)
          ),
          h('option', { value: '__other__' }, 'Other (type manually)')
        ),
        re.course === '__other__'
          ? h('input', { type: 'text', placeholder: 'Course name', style: 'margin-top:6px;',
              oninput: e => { re.customCourse = e.target.value; } })
          : null
      )
    ),

    // Player rows
    (() => {
      const courseTees = getCourseTees(re.course);
      const isCustomCourse = !COURSES.find(c => c.name === re.course);
      return h('table', null,
        h('thead', null, h('tr', null,
          h('th', null, '#'),
          h('th', null, 'Player'),
          h('th', null, 'Tee'),
          h('th', null, 'Rating'),
          h('th', null, 'Gross'),
          h('th', null, 'Win/Lose ($)')
        )),
        h('tbody', null,
          ...re.players.map((p, i) => {
            const teeRating = getTeeRating(re.course, p.tee);
            return h('tr', null,
              h('td', null, String(i + 1)),
              h('td', null,
                h('select', { style: 'width:100%;', value: p.profileId, onchange: e => { p.profileId = e.target.value; } },
                  h('option', { value: '' }, '-- Select --'),
                  ...allProfiles.map(pr =>
                    h('option', { value: pr.id, ...(p.profileId === pr.id ? { selected: 'selected' } : {}) }, pr.display_name)
                  )
                )
              ),
              h('td', null,
                courseTees.length > 0
                  ? h('select', { style: 'width:80px;', onchange: e => { p.tee = e.target.value; render(); } },
                      ...courseTees.map(t =>
                        h('option', { value: t.name, ...(p.tee === t.name ? { selected: 'selected' } : {}) }, t.name)
                      )
                    )
                  : h('input', { type: 'text', value: p.tee || '', placeholder: 'Blue', style: 'width:70px;',
                      oninput: e => { p.tee = e.target.value; } })
              ),
              h('td', { style: 'font-weight:700;color:var(--green-dark);' },
                teeRating != null ? String(teeRating) : (isCustomCourse
                  ? h('input', { type: 'number', value: p.manualRating || '', placeholder: '72.5', step: '0.1', style: 'width:70px;',
                      oninput: e => { p.manualRating = e.target.value; } })
                  : '—')
              ),
              h('td', null, h('input', { type: 'number', value: p.gross, placeholder: '82', style: 'width:60px;', oninput: e => { p.gross = e.target.value; } })),
              h('td', null, h('input', { type: 'number', value: p.amount, placeholder: '+200', style: 'width:100px;', oninput: e => { p.amount = e.target.value; } }))
            );
          })
        )
      );
    })(),

    // Add/remove player buttons
    h('div', { style: 'display:flex;gap:8px;margin-top:12px;' },
      h('button', { class: 'btn sm secondary', onclick: () => {
        const tees = getCourseTees(re.course);
        re.players.push({ profileId: '', tee: tees[0] ? tees[0].name : '', gross: '', amount: '' });
        render();
      } }, '+ Add Player'),
      re.players.length > 2
        ? h('button', { class: 'btn sm secondary', onclick: () => {
            re.players.pop();
            render();
          } }, '- Remove Last')
        : null
    ),

    // Save button
    h('div', { style: 'margin-top:20px;display:flex;gap:10px;' },
      h('button', { class: 'btn gold', onclick: saveEnteredRound }, 'Save Round'),
      h('button', { class: 'btn secondary', onclick: () => { initRoundEntry(); render(); } }, 'Clear')
    )
  ));
}

async function saveEnteredRound() {
  const re = roundEntry;
  const courseName = re.course === '__other__' ? (re.customCourse || '').trim() : re.course.trim();
  if (!courseName) { alert('Select a course'); return; }
  const validPlayers = re.players.filter(p => p.profileId && p.gross);
  if (validPlayers.length < 2) { alert('Enter at least 2 players with scores'); return; }

  // Build round data blob
  const playerObjects = validPlayers.map(p => {
    const profile = allProfiles.find(pr => pr.id === p.profileId);
    const gross = parseInt(p.gross) || 0;
    const fakeScores = Array(18).fill(Math.round(gross / 18));
    fakeScores[0] += gross - fakeScores.reduce((s, v) => s + v, 0);
    return {
      name: profile ? profile.display_name : 'Unknown',
      scores: fakeScores,
      teesName: p.tee || 'Manual',
      handicap: profile ? (profile.handicap || 0) : 0,
      team: 'A',
      stake: 'full',
      id: p.profileId
    };
  });

  const tees = [...new Set(validPlayers.map(p => p.tee || 'Manual'))].map(name => {
    const knownRating = getTeeRating(courseName, name);
    const player = validPlayers.find(p => (p.tee || 'Manual') === name);
    const manualRating = player ? parseFloat(player.manualRating) || null : null;
    return { name, rating: knownRating || manualRating, si: null };
  });

  const roundData = {
    teamA: playerObjects,
    teamB: [],
    course: {
      name: courseName,
      tees,
      holes: Array(18).fill(null).map((_, i) => ({ par: 4, si: i + 1 }))
    }
  };

  // Save round
  const { data: roundRow, error } = await db.from('rounds').insert({
    scorer_id: user.id,
    course_name: courseName,
    played_at: re.date + 'T12:00:00Z',
    mode: 'manual',
    game_type: 'manual',
    data: roundData,
    settlement: { perPlayer: {} }
  }).select().single();

  if (error) { alert('Error saving round: ' + error.message); return; }

  // Save round_players rows
  const rpRows = validPlayers.map(p => {
    const profile = allProfiles.find(pr => pr.id === p.profileId);
    return {
      round_id: roundRow.id,
      user_id: p.profileId,
      display_name: profile ? profile.display_name : 'Unknown',
      team: 'A',
      stake: 'full',
      handicap: profile ? (profile.handicap || 0) : 0,
      final_amount: parseInt(p.amount) || 0
    };
  });

  const { error: rpError } = await db.from('round_players').insert(rpRows);
  if (rpError) { alert('Error saving players: ' + rpError.message); return; }

  alert(`Round saved! ${validPlayers.length} players at ${courseName}`);
  initRoundEntry();
  allRounds = null;
  allRoundPlayers = null;
  handicapResults = null;
  await loadAllData();
}

// ==================== DASHBOARD TAB ====================
function renderDashboard(app) {
  // Pending rounds awaiting approval
  const pendingRounds = allRounds.filter(r => r.status === 'pending');
  if (pendingRounds.length > 0) {
    app.appendChild(h('div', { class: 'card', style: 'margin-top:16px;border:2px solid var(--gold);' },
      h('h2', null, `Pending Rounds (${pendingRounds.length})`),
      h('div', { style: 'font-size:12px;color:var(--muted);margin-bottom:12px;' },
        'These rounds have been submitted but not yet approved. They do not count toward handicaps or the ledger until approved.'),
      h('table', null,
        h('thead', null, h('tr', null,
          h('th', null, 'Date'),
          h('th', null, 'Course'),
          h('th', null, 'Scorer'),
          h('th', null, 'Players'),
          h('th', null, '')
        )),
        h('tbody', null,
          ...pendingRounds.map(r => {
            const scorer = allProfiles.find(p => p.id === r.scorer_id);
            const rps = allRoundPlayers.filter(rp => rp.round_id === r.id);
            const playerNames = rps.map(rp => rp.display_name).join(', ');
            return h('tr', null,
              h('td', null, new Date(r.played_at).toLocaleDateString()),
              h('td', null, h('strong', null, r.course_name)),
              h('td', { style: 'font-size:12px;' }, scorer?.display_name || '—'),
              h('td', { style: 'font-size:12px;' }, playerNames || '—'),
              h('td', null,
                h('div', { style: 'display:flex;gap:4px;' },
                  h('button', { class: 'btn sm', onclick: async () => {
                    await db.from('rounds').update({ status: 'approved' }).eq('id', r.id);
                    // Recalculate handicaps for players in this round
                    const playerIds = rps.filter(rp => rp.user_id).map(rp => rp.user_id);
                    r.status = 'approved';
                    alert('Round approved!');
                    allRounds = null;
                    handicapResults = null;
                    await loadAllData();
                  } }, '✓ Approve'),
                  h('button', { class: 'btn sm danger', onclick: async () => {
                    if (!confirm('Reject this round? It will be hidden from all calculations.')) return;
                    await db.from('rounds').update({ status: 'rejected' }).eq('id', r.id);
                    r.status = 'rejected';
                    allRounds = null;
                    await loadAllData();
                  } }, '✗ Reject')
                )
              )
            );
          })
        )
      )
    ));
  }

  const board = getLeaderboard();
  const approvedRounds = allRounds.filter(r => r.status === 'approved' || r.status === 'manual' || !r.status);
  const totalRounds = approvedRounds.length;
  const totalPlayers = allProfiles.length;
  const lastRound = approvedRounds[0];

  app.appendChild(h('div', { class: 'stats-row', style: 'margin-top:16px;' },
    h('div', { class: 'stat-box' },
      h('div', { class: 'label' }, 'Players'),
      h('div', { class: 'val' }, String(totalPlayers))
    ),
    h('div', { class: 'stat-box' },
      h('div', { class: 'label' }, 'Rounds'),
      h('div', { class: 'val' }, String(totalRounds))
    ),
    h('div', { class: 'stat-box' },
      h('div', { class: 'label' }, 'Last Round'),
      h('div', { class: 'val', style: 'font-size:16px;' }, lastRound ? new Date(lastRound.played_at).toLocaleDateString() : '—')
    )
  ));

  // Quick leaderboard
  const card = h('div', { class: 'card' },
    h('h2', null, 'Lifetime Standings'),
    h('table', null,
      h('thead', null, h('tr', null,
        h('th', null, '#'),
        h('th', null, 'Player'),
        h('th', null, 'Rounds'),
        h('th', null, 'Handicap'),
        h('th', null, 'Balance')
      )),
      h('tbody', null,
        ...board.map((p, i) => h('tr', null,
          h('td', null, String(i + 1)),
          h('td', null, h('strong', null, p.display_name)),
          h('td', null, String(p.roundsPlayed)),
          h('td', null, String(p.handicap ?? '—')),
          h('td', { class: p.balance > 0 ? 'positive' : p.balance < 0 ? 'negative' : 'zero' },
            p.balance === 0 ? '$0' : p.balance > 0 ? `+$${p.balance}` : `-$${Math.abs(p.balance)}`)
        ))
      )
    )
  );
  app.appendChild(card);
}

// ==================== MANUAL ROUND ENTRY ====================
let showManualRound = false;
let manualPlayerId = '';
let manualDate = '';
let manualCourse = '';
let manualTee = '';
let manualRating = '';
let manualGross = '';

function getCourseTees(courseName) {
  const c = COURSES.find(x => x.name === courseName);
  return c ? c.tees : [];
}
function getTeeRating(courseName, teeName) {
  const tees = getCourseTees(courseName);
  const t = tees.find(x => x.name === teeName);
  return t ? t.rating : null;
}

async function saveManualRound() {
  if (!manualPlayerId || !manualGross || !manualRating || !manualCourse) {
    alert('Fill in player, course, rating, and gross score');
    return;
  }
  const player = allProfiles.find(p => p.id === manualPlayerId);
  if (!player) { alert('Player not found'); return; }
  const gross = parseInt(manualGross);
  const rating = parseFloat(manualRating);
  if (isNaN(gross) || isNaN(rating)) { alert('Invalid score or rating'); return; }
  const date = manualDate || new Date().toISOString().split('T')[0];

  // Build a minimal round data blob that the handicap engine can parse
  const fakeScores = Array(18).fill(Math.round(gross / 18));
  // Adjust first hole to make sum exact
  fakeScores[0] += gross - fakeScores.reduce((s, v) => s + v, 0);

  const roundData = {
    teamA: [{
      name: player.display_name,
      scores: fakeScores,
      teesName: manualTee || 'Manual',
      handicap: player.handicap || 0,
      team: 'A',
      stake: 'full'
    }],
    teamB: [],
    course: {
      name: manualCourse,
      tees: [{ name: manualTee || 'Manual', rating: rating, si: null }],
      holes: fakeScores.map((p, i) => ({ par: 4, si: i + 1 }))
    }
  };

  const { data: roundRow, error } = await db.from('rounds').insert({
    scorer_id: user.id,
    course_name: manualCourse,
    played_at: date + 'T12:00:00Z',
    mode: 'manual',
    game_type: 'manual',
    data: roundData,
    settlement: { perPlayer: {} }
  }).select().single();

  if (error) { alert('Error saving round: ' + error.message); return; }

  // Insert round_player row
  await db.from('round_players').insert({
    round_id: roundRow.id,
    user_id: player.id,
    display_name: player.display_name,
    team: 'A',
    stake: 'full',
    handicap: player.handicap || 0,
    final_amount: 0
  });

  alert('Round saved!');
  showManualRound = false;
  allRounds = null;
  allRoundPlayers = null;
  handicapResults = null;
  await loadAllData();
}

// ==================== HANDICAPS TAB ====================
function renderHandicaps(app) {
  if (!handicapResults) computeAllHandicaps();
  const results = handicapResults;

  // Manual round entry
  app.appendChild(h('div', { class: 'card', style: 'margin-top:16px;' },
    h('h2', null, 'Enter Historical Round'),
    h('div', { style: 'font-size:12px;color:var(--muted);margin-bottom:10px;' },
      'Manually add a past round for handicap calculation. Use this to transfer data from your old sheet.'),
    !showManualRound
      ? h('button', { class: 'btn secondary', onclick: () => { showManualRound = true; manualPlayerId = ''; manualDate = ''; manualCourse = ''; manualTee = ''; manualRating = ''; manualGross = ''; render(); } }, '+ Add Historical Round')
      : h('div', null,
          h('div', { style: 'display:flex;gap:10px;' },
            h('div', { class: 'field', style: 'flex:2;' },
              h('label', null, 'Player'),
              h('select', { onchange: e => { manualPlayerId = e.target.value; } },
                h('option', { value: '' }, '— Select —'),
                ...allProfiles.map(p => h('option', { value: p.id }, p.display_name))
              )
            ),
            h('div', { class: 'field', style: 'flex:1;' },
              h('label', null, 'Date'),
              h('input', { type: 'date', oninput: e => { manualDate = e.target.value; } })
            )
          ),
          h('div', { style: 'display:flex;gap:10px;' },
            h('div', { class: 'field', style: 'flex:2;' },
              h('label', null, 'Course'),
              h('input', { type: 'text', placeholder: 'Bear Lakes CC', oninput: e => { manualCourse = e.target.value; } })
            ),
            h('div', { class: 'field', style: 'flex:1;' },
              h('label', null, 'Tee'),
              h('input', { type: 'text', placeholder: 'Blue', oninput: e => { manualTee = e.target.value; } })
            )
          ),
          h('div', { style: 'display:flex;gap:10px;' },
            h('div', { class: 'field', style: 'flex:1;' },
              h('label', null, 'Course Rating'),
              h('input', { type: 'number', step: '0.1', placeholder: '72.5', oninput: e => { manualRating = e.target.value; } })
            ),
            h('div', { class: 'field', style: 'flex:1;' },
              h('label', null, 'Gross Score'),
              h('input', { type: 'number', placeholder: '82', oninput: e => { manualGross = e.target.value; } })
            )
          ),
          h('div', { style: 'display:flex;gap:8px;margin-top:8px;' },
            h('button', { class: 'btn', onclick: saveManualRound }, 'Save Round'),
            h('button', { class: 'btn secondary', onclick: () => { showManualRound = false; render(); } }, 'Cancel')
          )
        )
  ));

  app.appendChild(h('div', { class: 'card' },
    h('h2', null, 'Handicap Calculator'),
    h('div', { style: 'display:flex;gap:10px;align-items:center;margin-bottom:16px;' },
      h('button', { class: 'btn', onclick: () => { computeAllHandicaps(); render(); } }, 'Recalculate All'),
      h('button', { class: 'btn gold', onclick: applyHandicaps }, 'Apply to Profiles')
    ),
    h('table', null,
      h('thead', null, h('tr', null,
        h('th', null, 'Player'),
        h('th', null, 'Current'),
        h('th', null, 'Computed'),
        h('th', null, 'Rounds'),
        h('th', null, 'Status')
      )),
      h('tbody', null,
        ...allProfiles.map(p => {
          const r = results[p.id] || {};
          const changed = r.handicap !== null && r.handicap !== p.handicap;
          return h('tr', { class: 'clickable', onclick: () => { selectedPlayerId = selectedPlayerId === p.id ? null : p.id; render(); } },
            h('td', null, h('strong', null, p.display_name)),
            h('td', null, String(p.handicap ?? '—')),
            h('td', { class: changed ? 'positive' : '' }, r.handicap !== null ? String(r.handicap) : '—'),
            h('td', null, String((r.diffs || []).length) + '/9'),
            h('td', null,
              r.message ? h('span', { class: 'badge warn' }, r.message)
              : (r.diffs || []).some(d => d.missingRating) ? h('span', { class: 'badge warn' }, 'Missing rating')
              : changed ? h('span', { class: 'badge ok' }, 'Changed')
              : h('span', { class: 'badge ok' }, 'OK'))
          );
        })
      )
    )
  ));

  // Detail panel for selected player
  if (selectedPlayerId && results[selectedPlayerId]) {
    const r = results[selectedPlayerId];
    const p = allProfiles.find(x => x.id === selectedPlayerId);
    app.appendChild(h('div', { class: 'card' },
      h('h2', null, `${p.display_name} — Handicap Detail`),
      r.diffs.length === 0
        ? h('p', null, 'No rounds found for this player.')
        : h('table', null,
            h('thead', null, h('tr', null,
              h('th', null, '#'),
              h('th', null, 'Date'),
              h('th', null, 'Course'),
              h('th', null, 'Tee'),
              h('th', null, 'Gross'),
              h('th', null, 'Rating'),
              h('th', null, 'Diff'),
              h('th', null, 'Used?')
            )),
            h('tbody', null,
              ...r.diffs.map((d, i) => {
                let used = '—';
                if (r.sorted && d.diff !== null) {
                  const rank = r.sorted.indexOf(d.diff);
                  if (rank === 0) used = 'Best (discarded)';
                  else if (rank >= 1 && rank <= 4) used = '✓ Counting';
                  else used = 'Not used';
                }
                return h('tr', null,
                  h('td', null, String(i + 1)),
                  h('td', null, new Date(d.date).toLocaleDateString()),
                  h('td', null, d.course || '—'),
                  h('td', null, d.tee || '—'),
                  h('td', null, String(d.gross)),
                  h('td', null, d.rating != null ? String(d.rating) : h('span', { class: 'negative' }, 'Missing')),
                  h('td', { class: 'mono' }, d.diff != null ? String(d.diff) : '—'),
                  h('td', null, used)
                );
              })
            )
          ),
      r.handicap !== null
        ? h('div', { class: 'info' },
            `Formula: discard best (${r.sorted[0]}), average positions 2-5 (${r.counting.join(', ')}) = ${r.avg.toFixed(1)} → rounded to ${r.handicap}`)
        : null
    ));
  }
}

// ==================== LEDGER TAB ====================
function renderLedger(app) {
  const board = getLeaderboard();

  app.appendChild(h('div', { class: 'card', style: 'margin-top:16px;' },
    h('h2', null, 'Player Balances'),
    h('button', { class: 'btn', style: 'margin-bottom:16px;', onclick: () => { paymentModal = true; render(); } }, '+ Record Payment'),
    h('table', null,
      h('thead', null, h('tr', null,
        h('th', null, 'Player'),
        h('th', null, 'Rounds'),
        h('th', null, 'Balance'),
        h('th', null, '')
      )),
      h('tbody', null,
        ...board.map(p => h('tr', { class: 'clickable', onclick: () => { selectedPlayerId = selectedPlayerId === p.id ? null : p.id; render(); } },
          h('td', null, h('strong', null, p.display_name)),
          h('td', null, String(p.roundsPlayed)),
          h('td', { class: p.balance > 0 ? 'positive' : p.balance < 0 ? 'negative' : 'zero' },
            p.balance === 0 ? '$0' : p.balance > 0 ? `+$${p.balance}` : `-$${Math.abs(p.balance)}`),
          h('td', null, h('button', { class: 'btn sm secondary', onclick: e => {
            e.stopPropagation();
            paymentModal = p.id;
            render();
          } }, 'Pay'))
        ))
      )
    )
  ));

  // Selected player's bank statement
  if (selectedPlayerId) {
    const p = allProfiles.find(x => x.id === selectedPlayerId);
    const ledger = getPlayerLedger(selectedPlayerId);
    app.appendChild(h('div', { class: 'card' },
      h('h2', null, `${p.display_name} — Ledger`),
      ledger.entries.length === 0
        ? h('p', null, 'No entries.')
        : h('table', null,
            h('thead', null, h('tr', null,
              h('th', null, 'Date'),
              h('th', null, 'Type'),
              h('th', null, 'Description'),
              h('th', null, 'Amount'),
              h('th', null, 'Balance')
            )),
            h('tbody', null,
              ...ledger.entries.map(e => h('tr', null,
                h('td', null, e.date.toLocaleDateString()),
                h('td', null, h('span', { class: `badge ${e.type === 'payment' ? 'admin' : 'ok'}` }, e.type)),
                h('td', null, e.desc),
                h('td', { class: e.amount > 0 ? 'positive' : e.amount < 0 ? 'negative' : 'zero' },
                  e.amount === 0 ? '$0' : e.amount > 0 ? `+$${e.amount}` : `-$${Math.abs(e.amount)}`),
                h('td', { class: 'mono' },
                  e.balance === 0 ? '$0' : e.balance > 0 ? `+$${e.balance}` : `-$${Math.abs(e.balance)}`)
              ))
            )
          )
    ));
  }
}

function renderPaymentModal() {
  let userId = typeof paymentModal === 'string' ? paymentModal : '';
  let amount = '';
  let note = '';

  const close = () => { paymentModal = false; render(); };

  const modal = h('div', { class: 'modal-bg', onclick: e => { if (e.target === e.currentTarget) close(); } },
    h('div', { class: 'modal' },
      h('h3', null, 'Record Payment'),
      h('div', { class: 'field' },
        h('label', null, 'Player'),
        h('select', { onchange: e => { userId = e.target.value; } },
          h('option', { value: '' }, '— Select —'),
          ...allProfiles.map(p =>
            h('option', { value: p.id, ...(p.id === userId ? { selected: 'selected' } : {}) }, p.display_name)
          )
        )
      ),
      h('div', { class: 'field' },
        h('label', null, 'Amount (positive = received, negative = paid out)'),
        h('input', { type: 'number', placeholder: '-200', oninput: e => { amount = e.target.value; } })
      ),
      h('div', { class: 'field' },
        h('label', null, 'Note'),
        h('input', { type: 'text', placeholder: 'Venmo from Mike', oninput: e => { note = e.target.value; } })
      ),
      h('div', { style: 'display:flex;gap:10px;margin-top:16px;' },
        h('button', { class: 'btn', onclick: () => {
          if (!userId) { alert('Pick a player'); return; }
          const amt = parseInt(amount);
          if (isNaN(amt) || amt === 0) { alert('Enter a non-zero amount'); return; }
          recordPayment(userId, amt, note);
        } }, 'Save'),
        h('button', { class: 'btn secondary', onclick: close }, 'Cancel')
      )
    )
  );
  root.appendChild(modal);
}

// ==================== INIT ====================
init();
return {};
})();
