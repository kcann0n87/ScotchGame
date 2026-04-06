// ==================== LLOYDS GAME ADMIN DASHBOARD ====================
const Admin = (() => {

// Reuse same Supabase credentials as mobile app
const SUPABASE_URL = 'https://sgflclztmzodywtrwndd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNnZmxjbHp0bXpvZHl3dHJ3bmRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MjczNjYsImV4cCI6MjA5MTAwMzM2Nn0.MrgGoIB8lvkaAdD2SAbh805JviYRfRBBmt3iHghrIdo';

let db = null;
let user = null;
let profile = null;
let activeTab = 'dashboard';

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
  const [profiles, rounds, rp, payments] = await Promise.all([
    db.from('profiles').select('*'),
    db.from('rounds').select('*').order('played_at', { ascending: false }),
    db.from('round_players').select('*'),
    db.from('payments').select('*').order('created_at', { ascending: false })
  ]);
  allProfiles = profiles.data || [];
  allRounds = rounds.data || [];
  allRoundPlayers = rp.data || [];
  allPayments = payments.data || [];
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
  // Find all rounds this player participated in, sorted by date desc
  const playerRPs = allRoundPlayers
    .filter(rp => rp.user_id === userId)
    .map(rp => {
      const round = allRounds.find(r => r.id === rp.round_id);
      return round ? { rp, round } : null;
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

  // Round entries
  const rps = allRoundPlayers.filter(rp => rp.user_id === userId);
  for (const rp of rps) {
    const round = allRounds.find(r => r.id === rp.round_id);
    if (!round) continue;
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
  if (!profile || !profile.is_admin) return renderAccessDenied();
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
    ...['dashboard', 'players', 'handicaps', 'ledger'].map(t =>
      h('div', { class: `tab ${activeTab === t ? 'active' : ''}`, onclick: () => { activeTab = t; selectedPlayerId = null; render(); } }, t)
    )
  );
  app.appendChild(tabs);

  if (activeTab === 'dashboard') renderDashboard(app);
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

// ==================== PLAYERS TAB ====================
let editingProfileId = null;
let editName = '';
let editHandicap = '';
let editEmail = '';

function renderPlayers(app) {
  app.appendChild(h('div', { class: 'card', style: 'margin-top:16px;' },
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

// ==================== DASHBOARD TAB ====================
function renderDashboard(app) {
  const board = getLeaderboard();
  const totalRounds = allRounds.length;
  const totalPlayers = allProfiles.length;
  const lastRound = allRounds[0];

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

// ==================== HANDICAPS TAB ====================
function renderHandicaps(app) {
  if (!handicapResults) computeAllHandicaps();
  const results = handicapResults;

  app.appendChild(h('div', { class: 'card', style: 'margin-top:16px;' },
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
