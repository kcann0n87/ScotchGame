// ==================== SCOTCH APP UI ====================
const App = (() => {

const STORAGE_KEY = 'scotch_v2';
let state = {
  screen: 'home',
  currentHoleIdx: 0,
  round: null,
  courses: [],
  expanded: { middle: false, top: false, bottom: false },
  expandedPlayer: null,
  // Auth state (mirrors Supabase client's internal state)
  authUser: null,
  authProfile: null,
  // Login screen UI state
  loginMode: 'signin',  // 'signin' | 'signup' | 'magic'
  loginEmail: '',
  loginPassword: '',
  loginDisplayName: '',
  loginMessage: null,
  loginError: null,
  // Player picker modal
  playerPickerIndex: null,    // index into newRoundDraft.players currently being edited
  playerPickerQuery: '',
  playerPickerResults: null,
  // Live share
  liveShareCode: null,
  liveShareUrl: null,
  liveViewData: null,
  liveViewCode: null,
  liveViewUnsubscribe: null,
  // Live chat
  liveChatMessages: [],
  liveChatHandle: null,
  liveChatName: '',
  liveChatInput: ''
};

// ---------- Persistence ----------
let _liveShareTimer = null;
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  // Throttled live share push (every 3s max)
  if (state.liveShareCode && state.round && typeof SupabaseClient !== 'undefined' && SupabaseClient.isConfigured()) {
    if (!_liveShareTimer) {
      _liveShareTimer = setTimeout(async () => {
        _liveShareTimer = null;
        try { await SupabaseClient.updateLiveShare(state.liveShareCode, state.round); } catch(e) {}
      }, 3000);
    }
  }
}
function load() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) state = Object.assign(state, JSON.parse(s));
  } catch (e) {}
  // Don't trust cached auth state — Supabase is the source of truth.
  // Supabase.init() will repopulate authUser/authProfile from its own
  // session storage. Without this, a stale cached authUser can reappear
  // after signOut until the page is reloaded.
  state.authUser = null;
  state.authProfile = null;
  // Migrate older course shapes to the simple { name, holes, tees: [names] } shape
  if (state.courses) {
    for (const c of state.courses) migrateCourse(c);
  }
  // Migrate pullie → polie on any in-progress round data
  if (state.round && Array.isArray(state.round.holes)) {
    for (const h of state.round.holes) {
      if (h && h.pullie !== undefined) { h.polie = h.pullie; delete h.pullie; }
      if (h && h.pullie2 !== undefined) { h.polie2 = h.pullie2; delete h.pullie2; }
    }
  }
}

function migrateCourse(course) {
  if (!Array.isArray(course.tees)) course.tees = [];
  // Convert legacy mainTeesName + teeSets -> flat tees array
  if (course.mainTeesName && course.tees.length === 0) {
    course.tees.push(course.mainTeesName);
  }
  if (Array.isArray(course.teeSets)) {
    for (const ts of course.teeSets) {
      if (ts && ts.name) {
        const existing = course.tees.find(t => (typeof t === 'string' ? t : t.name) === ts.name);
        if (!existing) course.tees.push({ name: ts.name, si: ts.si || null });
      }
    }
  }
  delete course.mainTeesName;
  delete course.teeSets;
  // Normalize any string entries to objects { name, si: null }
  course.tees = course.tees.map(t =>
    typeof t === 'string' ? { name: t, si: null } : { name: t.name, si: t.si || null }
  );
  // Seed default tees if still empty
  if (course.tees.length === 0) {
    course.tees = [
      { name: 'Blue',  si: null, rating: null, slope: null },
      { name: 'White', si: null, rating: null, slope: null },
      { name: 'Gold',  si: null, rating: null, slope: null }
    ];
  }
  // Backfill rating on existing tees
  for (const t of course.tees) {
    if (t.rating === undefined) t.rating = null;
    delete t.slope; // not used
  }
  // Re-sync pars/SI from preset by name match so corrections to preset data
  // propagate to courses already saved in the user's local state.
  if (course.name && Array.isArray(COURSE_PRESETS)) {
    const preset = COURSE_PRESETS.find(p => p.name === course.name);
    if (preset && Array.isArray(preset.pars) && Array.isArray(preset.si)) {
      const sameLen = Array.isArray(course.holes) && course.holes.length === preset.pars.length;
      if (!sameLen) {
        course.holes = preset.pars.map((par, i) => ({ par, si: preset.si[i] }));
      } else {
        for (let i = 0; i < preset.pars.length; i++) {
          course.holes[i] = { ...(course.holes[i] || {}), par: preset.pars[i], si: preset.si[i] };
        }
      }
    }
  }
}

// Look up a tee by name on a course. Returns { name, si } or null.
function findTee(course, teeName) {
  if (!course || !Array.isArray(course.tees)) return null;
  return course.tees.find(t => t.name === teeName) || null;
}

// Return a copy of a course's tees sorted by rating descending (hardest first).
// Unrated tees sink to the bottom, preserving their relative order.
function sortedTees(course) {
  if (!course || !Array.isArray(course.tees)) return [];
  const rated = course.tees.filter(t => t.rating != null && !isNaN(parseFloat(t.rating)));
  const unrated = course.tees.filter(t => !(t.rating != null && !isNaN(parseFloat(t.rating))));
  rated.sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating));
  return [...rated, ...unrated];
}

// Per-course default tee picks requested by the user. If the named tee
// exists on the course, use it; otherwise fall back to the highest-rated
// (hardest) tee from sortedTees().
const COURSE_DEFAULT_TEES = {
  'Mizner CC': 'Blue/Gold',
  'Bear Lakes CC — Lakes': 'Blue',
  'Boca Rio GC': 'Red/White'
};
function defaultTeeForCourse(course) {
  if (!course || !Array.isArray(course.tees) || course.tees.length === 0) return '';
  const preferred = COURSE_DEFAULT_TEES[course.name];
  if (preferred) {
    const match = course.tees.find(t => t.name === preferred);
    if (match) return match.name;
  }
  const sorted = sortedTees(course);
  return sorted[0] ? sorted[0].name : course.tees[0].name;
}

// Get the SI array to use for a player based on their selected tee.
// Returns an 18-element array (per-tee override) or null (use course default).
function siArrayForTee(course, teeName) {
  const tee = findTee(course, teeName);
  if (tee && Array.isArray(tee.si) && tee.si.length === 18) return tee.si.slice();
  return null;
}

// Swap SIs between nines so the starting 9 has the odd numbers (1,3,5,…,17)
// and the other nine gets even (2,4,6,…,18), preserving relative difficulty
// within each nine. Used when starting on the back 9.
// Input: siArray of length 18 (hole order 1–18). Returns a new array.
function swapSiForStartNine(siArray, startNine) {
  if (startNine !== 'back') return siArray.slice();
  const front = siArray.slice(0, 9).map((si, i) => ({ i, si }));
  const back  = siArray.slice(9, 18).map((si, i) => ({ i: i + 9, si }));
  // Sort each nine by original SI (hardest first)
  front.sort((a, b) => a.si - b.si);
  back.sort((a, b) => a.si - b.si);
  const out = Array(18);
  // Back (starting nine) gets odd SIs 1,3,5,…,17
  back.forEach((h, k) => { out[h.i] = 2 * k + 1; });
  // Front (second nine) gets even SIs 2,4,6,…,18
  front.forEach((h, k) => { out[h.i] = 2 * k + 2; });
  return out;
}

function uid() { return Math.random().toString(36).slice(2, 9); }

// ---------- Default course templates ----------
const DEFAULT_PARS = [4,4,4,3,5,4,4,3,4,4,4,3,5,4,4,4,3,5];
const DEFAULT_SI = [7,1,13,17,3,5,11,15,9,8,2,14,18,4,6,12,16,10];

// Real course presets (par + men's handicap index per hole)
const COURSE_PRESETS = [
  {
    name: 'Bear Lakes CC — Lakes',
    pars: [4,3,5,4,4,5,4,3,4, 4,3,5,4,3,4,4,4,5],
    si:   [13,15,11,3,7,9,1,17,5, 6,18,14,4,16,2,10,12,8]
  },
  {
    name: 'Boca Grove',
    pars: [4,5,3,4,4,4,5,3,4, 4,4,5,3,4,3,3,4,5],
    si:   [13,5,15,1,9,17,7,11,3, 4,12,6,14,2,18,16,8,10]
  },
  {
    name: 'Boca Rio GC',
    pars: [5,4,3,4,4,3,4,5,4, 5,4,4,3,4,4,5,3,4],
    si:   [11,3,17,13,7,15,1,5,9, 10,4,14,18,6,2,12,16,8]
  },
  {
    name: 'Delaire CC — Hills/Woods',
    pars: [5,3,5,4,3,4,4,4,4, 4,5,3,4,5,4,3,4,4],
    si:   [9,15,3,13,17,1,5,11,7, 4,8,16,2,12,14,18,10,6]
  },
  {
    name: 'Delaire CC — Lakes/Hills',
    pars: [4,5,4,3,4,5,3,4,4, 5,3,5,4,3,4,4,4,4],
    si:   [11,7,3,15,9,1,17,13,5, 10,16,4,14,18,2,6,12,8]
  },
  {
    name: 'Delaire CC — Woods/Lakes',
    pars: [4,5,3,4,5,4,3,4,4, 4,5,4,3,4,5,3,4,4],
    si:   [3,7,15,1,11,13,17,9,5, 12,8,4,16,10,2,18,14,6]
  },
  {
    name: 'Mizner CC',
    pars: [4,4,5,4,3,4,5,4,3, 4,4,4,3,4,5,5,3,4],
    si:   [7,1,11,15,9,3,5,17,13, 16,2,4,18,8,14,10,6,12]
  },
  {
    name: 'Panther National',
    pars: [4,3,5,4,4,4,5,3,4, 4,5,4,3,4,4,3,4,5],
    si:   [15,11,9,1,5,13,7,17,3, 10,4,8,16,2,14,18,12,6]
  },
  {
    name: 'The International — Oaks',
    pars: [5,3,4,3,4,4,4,5,4, 4,3,5,3,5,4,4,3,5],
    si:   [9,17,11,15,13,3,1,7,5, 2,16,8,18,12,4,6,14,10]
  },
  {
    name: 'The International — Pines',
    pars: [4,4,3,5,4,3,5,4,4, 3,5,4,4,3,4,3,4,5],
    si:   [5,9,7,15,1,13,11,17,3, 14,6,12,8,10,2,18,4,16]
  },
  {
    name: 'Broken Sound — Old Course',
    pars: [5,4,3,4,4,5,4,3,4, 5,4,3,4,3,4,5,4,4],
    si:   [9,1,15,11,7,5,17,13,3, 8,16,12,4,14,2,18,10,6]
  },
  {
    name: 'The Wanderers Club',
    pars: [4,5,3,4,3,4,5,4,4, 4,3,5,4,4,4,3,4,5],
    si:   [7,3,11,5,13,1,9,17,15, 10,12,6,18,8,16,2,14,4]
  }
];

function defaultTeesList() {
  return [
    { name: 'Blue',  si: null, rating: null },
    { name: 'White', si: null, rating: null },
    { name: 'Gold',  si: null, rating: null }
  ];
}

function newCourse(name) {
  return {
    id: uid(),
    name: name || 'New Course',
    holes: DEFAULT_PARS.map((par, i) => ({ par, si: DEFAULT_SI[i] })),
    tees: defaultTeesList()
  };
}

function courseFromPreset(preset) {
  return {
    id: uid(),
    name: preset.name,
    holes: preset.pars.map((par, i) => ({ par, si: preset.si[i] })),
    tees: defaultTeesList()
  };
}

// ---------- Round factory ----------
function newRound(course, players, teamAIds, teamBIds, mode, playhouse, startNine, gameType, gameType1, gameType2) {
  const pars = course.holes.map(h => h.par);
  const sn = startNine === 'back' ? 'back' : 'front';
  // Clone the course so we can apply startNine swap without mutating the master course
  const courseForRound = {
    ...course,
    startNine: sn,
    holes: course.holes.map(hole => ({ ...hole }))
  };
  if (sn === 'back') {
    const defaultSi = course.holes.map(h => h.si);
    const swapped = swapSiForStartNine(defaultSi, 'back');
    courseForRound.holes.forEach((hole, i) => { hole.si = swapped[i]; });
  }
  function attachTees(p) {
    let siArray = siArrayForTee(course, p.tees);
    if (siArray && sn === 'back') {
      siArray = swapSiForStartNine(siArray, 'back');
    }
    return {
      ...p,
      scores: Array(18).fill(null),
      teesName: p.tees || '',
      siArray: siArray || null
    };
  }
  const teamA = players.filter(p => teamAIds.includes(p.id)).map(attachTees);
  const teamB = players.filter(p => teamBIds.includes(p.id)).map(attachTees);
  const baseStrokes = Scoring.computeBaseStrokes([...teamA, ...teamB]);
  return {
    id: uid(),
    date: new Date().toISOString(),
    mode: mode || '4man',
    playhouse: !!playhouse,
    startNine: sn,
    gameType: gameType || 'scotch',
    gameType1: gameType1 || gameType || 'scotch',
    gameType2: gameType2 || gameType || 'scotch',
    // Per-matchup individual Nassau formats, keyed by indyKey(aId, bId).
    // Each entry: { format: '3way' | 'auto2down', backDouble: bool }.
    // Populated on the Indy Format screen (state.screen = 'indyFormat') before hole 1.
    indyMatchFormats: {},
    course: courseForRound,
    teamA,
    teamB,
    baseStrokes,
    holes: Array(18).fill(null).map(() => ({
      ctp: null, polie: null, roll: 1, playhoused: false,
      ctp2: null, polie2: null, roll2: 1
    })),
    golfFees: {},
    hostId: null,
    indyBackChoice: {}
  };
}

// ---------- Team name helpers ----------
// Returns first initial of each player joined by "/", e.g. "K/G"
function teamLabel(players) {
  if (!players || players.length === 0) return '?';
  return players.map(p => (p.name || '?')[0].toUpperCase()).join('/');
}
function teamLabels(round) {
  return {
    a: teamLabel(round.teamA),
    b: teamLabel(round.teamB)
  };
}
// Full first names version for headers/banners
function teamLabelFull(players) {
  if (!players || players.length === 0) return '?';
  return players.map(p => (p.name || '?').split(' ')[0]).join('/');
}
function teamLabelsFull(round) {
  return { a: teamLabelFull(round.teamA), b: teamLabelFull(round.teamB) };
}

// ---------- Rendering ----------
const root = document.getElementById('app');

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      if (k === 'class') el.className = attrs[k];
      else if (k === 'onclick') el.onclick = attrs[k];
      else if (k === 'oninput') el.oninput = attrs[k];
      else if (k === 'onchange') el.onchange = attrs[k];
      else if (k === 'html') el.innerHTML = attrs[k];
      else el.setAttribute(k, attrs[k]);
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

function render(preserveScroll) {
  const scrollY = window.scrollY;
  root.innerHTML = '';
  if (!preserveScroll) {
    root.classList.remove('screen-fade');
    void root.offsetWidth;
    root.classList.add('screen-fade');
  }
  save();
  if (state.screen === 'home') renderHome();
  else if (state.screen === 'newRound') renderNewRound();
  else if (state.screen === 'courses') renderCourses();
  else if (state.screen === 'courseEdit') renderCourseEdit();
  else if (state.screen === 'indyFormat') renderIndyFormat();
  else if (state.screen === 'round') renderRound();
  else if (state.screen === 'summary') renderSummary();
  else if (state.screen === 'login') renderLogin();
  else if (state.screen === 'account') renderAccount();
  else if (state.screen === 'history') renderHistory();
  else if (state.screen === 'stats') renderStats();
  else if (state.screen === 'liveView') renderLiveView();
  // Restore scroll position when re-rendering the same screen (or live view)
  if (preserveScroll || state.screen === 'liveView') requestAnimationFrame(() => window.scrollTo(0, scrollY));
}

// ---------- Home screen ----------
function renderHome() {
  const header = h('div', { class: 'header' },
    h('div', { class: 'header-row' },
      h('div', null,
        h('h1', null, "LLOYD'S GAME"),
        h('div', { class: 'sub' }, 'Golf gambling tracker')
      )
    )
  );
  root.appendChild(header);

  // Kick off a background load of public live games (once per home render)
  if (state.authUser && typeof SupabaseClient !== 'undefined' && SupabaseClient.isConfigured() && !state._publicGamesLoading) {
    state._publicGamesLoading = true;
    SupabaseClient.listPublicLiveGames().then(list => {
      state._publicGames = list || [];
      state._publicGamesLoading = false;
      render(true);
    }).catch(() => { state._publicGamesLoading = false; });
  }

  const hero = h('div', { class: 'card' },
    h('div', { style: 'text-align:center;padding:var(--space-lg) 0;' },
      h('div', { class: 'hero-icon' }, '⛳'),
      h('div', { class: 'hero-title' }, state.round ? 'Round in progress' : 'Ready to play'),
      state.round
        ? h('div', { class: 'hero-subtitle' }, `${state.round.course.name}`)
        : null,
      state.round
        ? h('div', null,
            h('button', { class: 'btn', onclick: () => { state.screen = 'round'; render(); } }, 'Resume Round'),
            h('button', { class: 'btn secondary', style: 'margin-top:var(--space-sm);', onclick: () => {
              if (confirm('Discard current round?')) { state.round = null; state.currentHoleIdx = 0; render(); }
            }}, 'New Round')
          )
        : h('button', { class: 'btn', onclick: () => { state.screen = 'newRound'; render(); } }, 'Start New Round')
    )
  );
  root.appendChild(hero);

  // Account / sign-in card
  const isCloudOn = typeof SupabaseClient !== 'undefined' && SupabaseClient.isConfigured();
  const accountCard = h('div', { class: 'card' },
    h('h2', null, 'Account'),
    state.authUser
      ? h('div', null,
          h('div', { style: 'font-size:15px;font-weight:700;' }, state.authProfile?.display_name || state.authUser.email),
          h('div', { style: 'font-size:12px;color:var(--muted);margin-bottom:12px;' }, state.authUser.email),
          h('button', { class: 'btn secondary', onclick: () => { state.screen = 'account'; render(); } }, 'Account · History · Stats')
        )
      : h('div', null,
          h('div', { style: 'font-size:12px;color:var(--muted);margin-bottom:10px;' },
            isCloudOn
              ? 'Sign in to sync rounds, see your history, and track lifetime stats across devices.'
              : 'Cloud sync not configured yet. The app works fully offline — your data stays on this device.'),
          h('button', { class: 'btn', onclick: () => { state.screen = 'login'; render(); } },
            isCloudOn ? 'Sign In / Sign Up' : 'Set Up Cloud Sync')
        )
  );
  root.appendChild(accountCard);

  // Live public games card — always shown when signed in
  if (state.authUser && isCloudOn) {
    const games = state._publicGames || [];
    // Filter out my own currently-shared round to avoid duplication with the hero card
    const visible = games.filter(g => !(state.liveShareCode && g.code === state.liveShareCode));
    const loading = state._publicGamesLoading && !state._publicGames;
    const liveCard = h('div', { class: 'card' },
      h('div', { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;' },
        h('h2', { style: 'margin:0;' }, '📡 Live Now'),
        h('button', {
          class: 'btn secondary btn-sm',
          style: 'width:auto;padding:6px 12px;font-size:11px;margin:0;',
          onclick: () => {
            state._publicGamesLoading = true;
            render(true);
            SupabaseClient.listPublicLiveGames().then(list => {
              state._publicGames = list || [];
              state._publicGamesLoading = false;
              render(true);
            }).catch(() => { state._publicGamesLoading = false; render(true); });
          }
        }, '↻ Refresh')
      ),
      visible.length === 0
        ? h('div', { class: 'empty', style: 'padding:20px 10px;' },
            h('div', { class: 'icon' }, '📡'),
            h('div', { style: 'font-size:13px;color:var(--muted);' },
              loading ? 'Loading live games…' : 'No live games right now'),
            !loading ? h('div', { style: 'font-size:11px;color:var(--muted);margin-top:6px;' },
              'Start a public round and it\'ll show up here for other players.') : null
          )
        : h('div', null,
            h('div', { style: 'font-size:12px;color:var(--muted);margin-bottom:10px;' },
              'Public rounds currently being played. Tap to watch.'),
            ...visible.map(g => {
            const d = g.data || {};
            const courseName = (d.course && d.course.name) || 'Golf Round';
            const teamA = d.teamA || [];
            const teamB = d.teamB || [];
            const namesA = teamA.map(p => (p.name || '?').split(' ')[0]).join('/');
            const namesB = teamB.map(p => (p.name || '?').split(' ')[0]).join('/');
            // Estimate hole in progress
            const allP = [...teamA, ...teamB];
            let played = 0;
            for (let i = 0; i < 18; i++) {
              if (allP.some(p => p.scores && p.scores[i] != null)) played++;
            }
            const updated = g.updated_at ? new Date(g.updated_at) : null;
            const mins = updated ? Math.floor((Date.now() - updated.getTime()) / 60000) : null;
            const timeStr = mins == null ? '' : mins < 1 ? 'just now' : mins < 60 ? `${mins}m ago` : `${Math.floor(mins/60)}h ago`;
            return h('div', {
              class: 'list-item',
              style: 'cursor:pointer;',
              onclick: () => {
                // Open the live viewer in a NEW tab so users can keep their
                // current session (e.g. an in-progress round) open alongside it.
                const url = `${location.origin}${location.pathname}?live=${g.code}`;
                window.open(url, '_blank', 'noopener');
              }
            },
              h('div', { style: 'flex:1;min-width:0;' },
                h('div', { class: 'main' }, `${namesA || '?'} vs ${namesB || '?'}`),
                h('div', { class: 'sub' }, `${courseName} • hole ${Math.min(played + 1, 18)} • ${timeStr}`)
              ),
              h('div', { style: 'color:var(--green);font-weight:700;font-size:18px;' }, '›')
            );
          })
        )
    );
    root.appendChild(liveCard);
  }
}

// ---------- Courses screen ----------
function renderCourses() {
  root.appendChild(h('div', { class: 'header' },
    h('div', { class: 'header-row' },
      h('button', { class: 'back-btn', onclick: () => { state.screen = 'home'; render(); } }, '← Back'),
      h('h1', null, 'Courses'),
      h('span', { style: 'width:50px;' })
    )
  ));

  const card = h('div', { class: 'card' },
    h('h2', null, 'Saved Courses'),
    state.courses.length === 0
      ? h('div', { class: 'empty' }, h('div', { class: 'icon' }, '🏌️'), 'No courses yet')
      : h('div', null,
          ...state.courses.map(c =>
            h('div', { class: 'list-item', onclick: () => {
              state.editingCourseId = c.id; state.screen = 'courseEdit'; render();
            }},
              h('div', null,
                h('div', { class: 'main' }, c.name),
                h('div', { class: 'sub' }, `Par ${c.holes.reduce((a,b)=>a+b.par,0)}`)
              ),
              h('div', { style: 'color:var(--muted);' }, '›')
            )
          )
        ),
    h('button', { class: 'btn', style: 'margin-top:12px;', onclick: () => {
      const c = newCourse('New Course');
      state.courses.push(c);
      state.editingCourseId = c.id;
      state.screen = 'courseEdit';
      render();
    }}, '+ Add Course'),
    h('h3', { style: 'margin-top:18px;' }, 'Import Preset'),
    h('div', { style: 'font-size:12px;color:var(--muted);margin-bottom:8px;' }, 'Real South Florida course data (par + handicap index).'),
    ...COURSE_PRESETS.map(preset => {
      const already = state.courses.some(c => c.name === preset.name);
      return h('button', {
        class: 'btn secondary',
        style: 'margin-bottom:6px;',
        disabled: already ? 'true' : undefined,
        onclick: () => {
          state.courses.push(courseFromPreset(preset));
          save();
          render();
        }
      }, already ? `✓ ${preset.name} (added)` : `+ ${preset.name}`);
    })
  );
  root.appendChild(card);
}

function renderCourseEdit() {
  const course = state.courses.find(c => c.id === state.editingCourseId);
  if (!course) { state.screen = 'courses'; return render(); }
  migrateCourse(course);

  root.appendChild(h('div', { class: 'header' },
    h('div', { class: 'header-row' },
      h('button', { class: 'back-btn', onclick: () => { state.screen = 'courses'; render(); } }, '← Back'),
      h('h1', null, 'Edit Course'),
      h('span', { style: 'width:50px;' })
    )
  ));

  const card = h('div', { class: 'card' },
    h('div', { class: 'field' },
      h('label', null, 'Course name'),
      h('input', { type: 'text', value: course.name, oninput: e => { course.name = e.target.value; save(); } })
    ),
    h('h3', null, 'Par & Handicap'),
    h('table', { class: 'totals-table' },
      h('thead', null,
        h('tr', null,
          h('th', null, '#'),
          h('th', null, 'Par'),
          h('th', null, 'Hcp')
        )
      ),
      h('tbody', null,
        ...course.holes.map((hole, i) =>
          h('tr', null,
            h('td', null, String(i + 1)),
            h('td', null,
              h('input', { type: 'number', value: hole.par, min: 3, max: 6,
                style: 'width:60px;padding:6px;text-align:center;',
                oninput: e => { hole.par = parseInt(e.target.value) || 4; save(); } })
            ),
            h('td', null,
              h('input', { type: 'number', value: hole.si, min: 1, max: 18,
                style: 'width:60px;padding:6px;text-align:center;',
                oninput: e => { hole.si = parseInt(e.target.value) || 1; save(); } })
            )
          )
        )
      )
    ),

    // Tee boxes (with optional per-tee handicap override)
    h('h3', { style: 'margin-top:18px;' }, 'Tee Boxes'),
    h('div', { style: 'font-size:12px;color:var(--muted);margin-bottom:8px;' },
      'These show up in the dropdown when starting a round. Tap "Override Hcp" to use a different handicap allocation for this tee (used in individual match strokes).'),
    ...course.tees.map((tee, idx) => {
      const hasOverride = Array.isArray(tee.si) && tee.si.length === 18;
      const isOpen = state.expandedTeeIdx === idx;
      return h('div', { style: 'background:var(--bg);border-radius:8px;padding:10px;margin-bottom:8px;' },
        h('div', { class: 'field-row', style: 'align-items:center;gap:8px;' },
          h('input', {
            type: 'text',
            value: tee.name,
            style: 'flex:1;',
            placeholder: 'Tee name',
            oninput: e => { tee.name = e.target.value; save(); }
          }),
          h('div', { style: 'flex:0 0 80px;' },
            h('input', {
              type: 'number',
              value: tee.rating != null ? String(tee.rating) : '',
              placeholder: 'Rating',
              style: 'text-align:center;padding:10px 6px;font-size:13px;',
              step: '0.1',
              oninput: e => {
                const v = e.target.value;
                tee.rating = v === '' ? null : parseFloat(v) || null;
                save();
              }
            })
          ),
          h('button', {
            class: `btn btn-sm ${hasOverride ? 'gold' : 'secondary'}`,
            style: 'width:auto;',
            onclick: () => {
              state.expandedTeeIdx = isOpen ? null : idx;
              render();
            }
          }, hasOverride ? '★ Hcp' : 'Override Hcp'),
          h('button', {
            class: 'btn danger btn-sm',
            style: 'width:auto;',
            onclick: () => {
              if (confirm(`Delete "${tee.name}"?`)) {
                course.tees.splice(idx, 1);
                if (state.expandedTeeIdx === idx) state.expandedTeeIdx = null;
                save();
                render();
              }
            }
          }, '×')
        ),
        isOpen
          ? h('div', { style: 'margin-top:10px;' },
              h('div', { style: 'font-size:11px;color:var(--muted);margin-bottom:6px;' },
                'Per-hole handicap index 1–18 for this tee. Leave blank to use the course default.'),
              h('div', { style: 'display:flex;gap:8px;align-items:center;margin-bottom:8px;' },
                h('button', {
                  class: 'btn secondary btn-sm',
                  style: 'width:auto;',
                  onclick: () => {
                    if (!Array.isArray(tee.si) || tee.si.length !== 18) {
                      tee.si = course.holes.map(hole => hole.si);
                    } else {
                      tee.si = null;
                    }
                    save();
                    render();
                  }
                }, hasOverride ? 'Remove Override' : 'Seed from Default')
              ),
              hasOverride
                ? h('table', { class: 'totals-table' },
                    h('thead', null,
                      h('tr', null,
                        h('th', null, '#'),
                        h('th', null, 'Hcp')
                      )
                    ),
                    h('tbody', null,
                      ...tee.si.map((siVal, i) =>
                        h('tr', null,
                          h('td', null, String(i + 1)),
                          h('td', null,
                            h('input', {
                              type: 'number',
                              value: siVal,
                              min: 1,
                              max: 18,
                              style: 'width:60px;padding:6px;text-align:center;',
                              oninput: e => {
                                tee.si[i] = parseInt(e.target.value) || 1;
                                save();
                              }
                            })
                          )
                        )
                      )
                    )
                  )
                : null
            )
          : null
      );
    }),
    h('button', {
      class: 'btn secondary',
      style: 'margin-bottom:16px;',
      onclick: () => {
        course.tees.push({ name: 'New Tee', si: null, rating: null });
        save();
        render();
      }
    }, '+ Add Tee Box'),

    h('button', { class: 'btn danger', style: 'margin-top:16px;', onclick: () => {
      if (confirm('Delete course?')) {
        state.courses = state.courses.filter(c => c.id !== course.id);
        state.screen = 'courses'; render();
      }
    }}, 'Delete Course')
  );
  root.appendChild(card);
}

// ---------- New round ----------
let newRoundDraft = null;
function ensureDraft() {
  if (!newRoundDraft) {
    // Refresh profiles from server to get latest handicaps
    if (typeof SupabaseClient !== 'undefined' && SupabaseClient.isConfigured() && state.authUser) {
      state._allProfiles = null;
      state._profilesLoading = false;
      // Reload own profile in background
      SupabaseClient.searchUsersByName('').then(data => {
        state._allProfiles = data || [];
        // Update own profile handicap if changed
        const myLatest = (data || []).find(p => p.id === state.authUser.id);
        if (myLatest && state.authProfile) {
          state.authProfile.handicap = myLatest.handicap;
        }
        // Trigger a re-render so new-round player pickers see the loaded list
        if (state.screen === 'newRound') render(true);
      }).catch(() => {});
    }
    // Pre-fill Player 1 with the logged-in user's profile
    const me = state.authProfile;
    const myUser = state.authUser;
    const p1 = {
      id: uid(),
      name: me ? me.display_name : '',
      handicap: me ? (me.handicap ?? '') : '',
      team: 'A',
      stake: 'full',
      swing: false,
      tees: '',
      userId: myUser ? myUser.id : null,
      invitedEmail: null
    };
    newRoundDraft = {
      courseId: state.courses[0] ? state.courses[0].id : null,
      mode: '4man',
      playhouse: false,
      startNine: 'front',
      gameType: 'scotch',
      gameType1: 'scotch',
      gameType2: 'scotch',
      isPublic: true,
      editingRoundId: null,
      players: [
        p1,
        { id: uid(), name: '', handicap: '', team: 'A', stake: 'full', swing: false, tees: '', userId: null, invitedEmail: null },
        { id: uid(), name: '', handicap: '', team: 'B', stake: 'full', swing: false, tees: '', userId: null, invitedEmail: null },
        { id: uid(), name: '', handicap: '', team: 'B', stake: 'full', swing: false, tees: '', userId: null, invitedEmail: null },
      ]
    };
  }
}

function renderNewRound() {
  ensureDraft();
  const isEditing = !!newRoundDraft.editingRoundId;
  root.appendChild(h('div', { class: 'header' },
    h('div', { class: 'header-row' },
      h('button', { class: 'back-btn', onclick: () => {
        if (isEditing) {
          // Cancel edit — discard draft and return to round
          newRoundDraft = null;
          state.screen = 'round';
          render();
        } else {
          newRoundDraft = null;
          state.screen = 'home';
          render();
        }
      } }, isEditing ? '← Cancel' : '← Back'),
      h('h1', null, isEditing ? 'Edit Setup' : 'New Round'),
      h('span', { style: 'width:50px;' })
    )
  ));

  // Public / Private toggle (only when cloud sync is on & user signed in & NOT editing existing round)
  const cloudOn = state.authUser && typeof SupabaseClient !== 'undefined' && SupabaseClient.isConfigured();
  if (cloudOn && !isEditing) {
    const visibilityCard = h('div', { class: 'card' },
      h('h2', null, 'Visibility'),
      h('div', { style: 'font-size:12px;color:var(--muted);margin-bottom:8px;' },
        'Public games appear on the home page of other signed-in users so they can watch live. Private games are only visible via the shared link.'),
      h('div', { class: 'toggle-group' },
        h('div', { class: `toggle ${newRoundDraft.isPublic ? 'active' : ''}`,
          onclick: () => { newRoundDraft.isPublic = true; render(); } },
          '🌐 Public', h('br'), h('span', { style: 'font-size:10px;' }, 'Anyone can watch')),
        h('div', { class: `toggle ${!newRoundDraft.isPublic ? 'active' : ''}`,
          onclick: () => { newRoundDraft.isPublic = false; render(); } },
          '🔒 Private', h('br'), h('span', { style: 'font-size:10px;' }, 'Link only'))
      )
    );
    root.appendChild(visibilityCard);
  }

  // Playhouse toggle
  const playhouseCard = h('div', { class: 'card' },
    h('h2', null, 'Playhouse'),
    h('div', { style: 'font-size:12px;color:var(--muted);margin-bottom:8px;' },
      'If enabled, you can playhouse individual holes to double their middle-game points.'),
    h('div', { class: 'toggle-group' },
      h('div', { class: `toggle ${!newRoundDraft.playhouse ? 'active' : ''}`,
        onclick: () => { newRoundDraft.playhouse = false; render(); } }, 'Off'),
      h('div', { class: `toggle ${newRoundDraft.playhouse ? 'active' : ''}`,
        onclick: () => { newRoundDraft.playhouse = true; render(); } }, 'Playhouse Game')
    )
  );
  root.appendChild(playhouseCard);

  // Individual Nassau per-matchup format is chosen on the next screen
  // (after Start Round) so players can pick 3-Way or 2-Down Auto per pair.

  // Mode selector
  const modeCard = h('div', { class: 'card' },
    h('h2', null, 'Game Mode'),
    h('div', { class: 'toggle-group' },
      h('div', { class: `toggle ${newRoundDraft.mode === '4man' ? 'active' : ''}`,
        onclick: () => {
          newRoundDraft.mode = '4man';
          if (newRoundDraft.players.length > 4) newRoundDraft.players = newRoundDraft.players.slice(0, 4);
          newRoundDraft.players.forEach(p => p.swing = false);
          render();
        }
      }, '4-Man', h('br'), h('span', { style: 'font-size:11px;' }, '2 vs 2')),
      h('div', { class: `toggle ${newRoundDraft.mode === '5man' ? 'active' : ''}`,
        onclick: () => {
          newRoundDraft.mode = '5man';
          if (newRoundDraft.players.length < 5) {
            // Insert as 3rd player (index 2) to keep Team A grouped at top
            newRoundDraft.players.splice(2, 0, { id: uid(), name: '', handicap: '', team: 'A', stake: 'full', swing: false, tees: '', userId: null, invitedEmail: null });
          }
          render();
        }
      }, '5-Man', h('br'), h('span', { style: 'font-size:11px;' }, '3 vs 2 with swing'))
    ),
    // Game type selector (the middle-game rule set)
    h('h3', { style: 'margin-top:14px;' },
      newRoundDraft.mode === '5man' ? 'Middle Game Type (per game)' : 'Middle Game Type'),
    newRoundDraft.mode === '5man'
      ? h('div', null,
          h('div', { style: 'font-size:11px;color:var(--muted);margin-bottom:6px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;' }, 'Game 1'),
          h('div', { class: 'toggle-group', style: 'margin-bottom:10px;' },
            h('div', {
              class: `toggle ${newRoundDraft.gameType1 === 'scotch' ? 'active' : ''}`,
              onclick: () => { newRoundDraft.gameType1 = 'scotch'; render(); }
            }, 'Scotch', h('br'), h('span', { style: 'font-size:10px;' }, 'Low/Total/CTP/Bd')),
            h('div', {
              class: `toggle ${newRoundDraft.gameType1 === '9point' ? 'active' : ''}`,
              onclick: () => { newRoundDraft.gameType1 = '9point'; render(); }
            }, '9-Point', h('br'), h('span', { style: 'font-size:10px;' }, 'Low/Total/High'))
          ),
          h('div', { style: 'font-size:11px;color:var(--muted);margin-bottom:6px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;' }, 'Game 2'),
          h('div', { class: 'toggle-group' },
            h('div', {
              class: `toggle ${newRoundDraft.gameType2 === 'scotch' ? 'active' : ''}`,
              onclick: () => { newRoundDraft.gameType2 = 'scotch'; render(); }
            }, 'Scotch', h('br'), h('span', { style: 'font-size:10px;' }, 'Low/Total/CTP/Bd')),
            h('div', {
              class: `toggle ${newRoundDraft.gameType2 === '9point' ? 'active' : ''}`,
              onclick: () => { newRoundDraft.gameType2 = '9point'; render(); }
            }, '9-Point', h('br'), h('span', { style: 'font-size:10px;' }, 'Low/Total/High'))
          )
        )
      : h('div', { class: 'toggle-group' },
          h('div', {
            class: `toggle ${newRoundDraft.gameType === 'scotch' ? 'active' : ''}`,
            onclick: () => { newRoundDraft.gameType = 'scotch'; render(); }
          }, 'Scotch', h('br'), h('span', { style: 'font-size:10px;' }, 'Low/Total/CTP/Bd/Keep/Take')),
          h('div', {
            class: `toggle ${newRoundDraft.gameType === '9point' ? 'active' : ''}`,
            onclick: () => { newRoundDraft.gameType = '9point'; render(); }
          }, '9-Point', h('br'), h('span', { style: 'font-size:10px;' }, 'Low/Total/High/Keep/Take'))
        )
  );
  root.appendChild(modeCard);

  // Course select
  const courseCard = h('div', { class: 'card' },
    h('h2', null, 'Course'),
    state.courses.length === 0
      ? h('div', null,
          h('div', { class: 'warning' }, 'No courses saved. Add one first.'),
          h('button', { class: 'btn secondary', onclick: () => { state.screen = 'courses'; render(); } }, 'Manage Courses')
        )
      : h('select', {
          onchange: e => {
            newRoundDraft.courseId = e.target.value;
            // Reset all player tee selections to the course's default
            const newCourse = state.courses.find(c => c.id === e.target.value);
            const defTee = defaultTeeForCourse(newCourse);
            for (const p of newRoundDraft.players) p.tees = defTee;
            render();
          }
        },
          ...state.courses.map(c =>
            h('option', { value: c.id, ...(c.id === newRoundDraft.courseId ? { selected: 'selected' } : {}) }, c.name)
          )
        ),
    // Start nine toggle
    h('h3', { style: 'margin-top:14px;' }, 'Starting Nine'),
    h('div', { style: 'font-size:11px;color:var(--muted);margin-bottom:6px;' },
      'If you start on the back, the handicap order swaps so the hardest holes on the starting nine get odd SIs.'),
    h('div', { class: 'toggle-group' },
      h('div', {
        class: `toggle ${newRoundDraft.startNine === 'front' ? 'active' : ''}`,
        onclick: () => { newRoundDraft.startNine = 'front'; render(); }
      }, 'Front 9 First'),
      h('div', {
        class: `toggle ${newRoundDraft.startNine === 'back' ? 'active' : ''}`,
        onclick: () => { newRoundDraft.startNine = 'back'; render(); }
      }, 'Back 9 First')
    )
  );
  root.appendChild(courseCard);

  // Players
  const is5 = newRoundDraft.mode === '5man';

  const playersCard = h('div', { class: 'card' },
    h('h2', null, 'Players'),
    h('div', { style: 'font-size:12px;color:var(--muted);margin-bottom:10px;' },
      is5
        ? 'Tap a player on the 3-man team to make them the swing. Action splits by stake shares (full=2, half=1).'
        : 'Each player picks full or half stake. Mixed pairings settle at the lower stake.'),
    ...(() => {
      // Compute Game 1 / Game 2 assignment for 5-man mode.
      const gameLabel = {};
      if (is5) {
        const teamA = newRoundDraft.players.filter(p => p.team === 'A');
        const teamB = newRoundDraft.players.filter(p => p.team === 'B');
        const bigTeam  = teamA.length === 3 ? teamA : (teamB.length === 3 ? teamB : null);
        if (bigTeam) {
          const swing = bigTeam.find(p => p.swing);
          const nonSwings = bigTeam.filter(p => !p.swing);
          if (nonSwings[0]) gameLabel[nonSwings[0].id] = 'G1';
          if (nonSwings[1]) gameLabel[nonSwings[1].id] = 'G2';
          if (swing) gameLabel[swing.id] = 'BOTH';
          const smallTeam = bigTeam === teamA ? teamB : teamA;
          for (const p of smallTeam) gameLabel[p.id] = 'BOTH';
        }
      }
      return newRoundDraft.players.map((p, i) => {
        const tag = gameLabel[p.id];
        const badge = tag === 'G1'
          ? h('span', { class: 'game-badge g1' }, 'Game 1')
          : tag === 'G2'
            ? h('span', { class: 'game-badge g2' }, 'Game 2')
            : tag === 'BOTH'
              ? h('span', { class: 'game-badge both' }, 'Both Games')
              : null;
        const linkedBadge = p.userId
          ? h('span', { class: 'link-badge linked' }, '★ Linked')
          : null;
        // Build autocomplete suggestions based on typed name
        const nameVal = p.name || '';
        const isCloud = state.authUser && typeof SupabaseClient !== 'undefined' && SupabaseClient.isConfigured();
        const alreadyLinked = new Set(newRoundDraft.players.filter((x, xi) => xi !== i && x.userId).map(x => x.userId));
        let suggestions = [];
        if (isCloud && nameVal.length >= 1 && !p.userId && state._allProfiles) {
          const q = nameVal.toLowerCase();
          suggestions = state._allProfiles
            .filter(pr => {
              if (alreadyLinked.has(pr.id)) return false;
              const dn = (pr.display_name || '').toLowerCase();
              const em = (pr.email || '').toLowerCase();
              return dn.includes(q) || em.includes(q);
            })
            .slice(0, 8);
        }
        // Load all profiles once for autocomplete
        if (isCloud && !state._allProfiles && !state._profilesLoading) {
          state._profilesLoading = true;
          SupabaseClient.searchUsersByName('').then(data => {
            state._allProfiles = data || [];
            state._profilesLoading = false;
            render(true);
          });
        }
        return h('div', { class: `player-card team-${p.team.toLowerCase()}` },
          h('div', { class: 'info' },
            h('div', { class: 'field', style: 'position:relative;' },
              h('label', null, `Player ${i+1}${p.swing ? ' • SWING' : ''}`, badge ? ' ' : '', badge, linkedBadge ? ' ' : '', linkedBadge),
              p.userId
                ? h('div', { style: 'display:flex;gap:6px;align-items:center;' },
                    h('div', { style: 'flex:1;padding:12px 14px;background:var(--green-soft);border-radius:var(--radius);font-weight:700;font-size:15px;color:var(--green-dark);' }, p.name),
                    h('button', { class: 'btn secondary btn-sm', style: 'width:auto;padding:8px 12px;font-size:11px;',
                      onclick: () => { p.userId = null; p.name = ''; p.handicap = ''; render(true); }
                    }, '✕')
                  )
                : h('div', null,
                    h('input', { type: 'text', value: nameVal, placeholder: `Player ${i+1}`,
                      id: `player-name-${i}`,
                      autocomplete: 'off',
                      oninput: e => {
                        p.name = e.target.value;
                        // Debounce render + restore focus for mobile keyboard
                        clearTimeout(p._nameTimer);
                        p._nameTimer = setTimeout(() => {
                          const pos = e.target.selectionStart;
                          render(true);
                          requestAnimationFrame(() => {
                            const el = document.getElementById(`player-name-${i}`);
                            if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (_) {} }
                          });
                        }, 150);
                      }
                    }),
                    suggestions.length > 0
                      ? h('div', { style: 'position:absolute;left:0;right:0;top:100%;z-index:50;background:white;border:1px solid var(--border);border-radius:0 0 var(--radius) var(--radius);box-shadow:var(--shadow-md);max-height:240px;overflow-y:auto;' },
                          ...suggestions.map(s => {
                            const label = s.display_name || s.email || '(no name)';
                            return h('div', {
                              style: 'padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border-light);font-size:14px;',
                              onclick: () => {
                                p.name = label;
                                p.userId = s.id;
                                p.handicap = s.handicap || 0;
                                render(true);
                              }
                            },
                              h('strong', null, label),
                              h('span', { style: 'color:var(--muted);margin-left:8px;font-size:12px;' }, `Hcp ${s.handicap ?? 0}`)
                            );
                          })
                        )
                      : null
                  )
            ),
          h('div', { class: 'field', style: 'margin-top:6px;' },
            h('label', null, 'Team'),
            h('select', { style: 'width:100%;', onchange: e => { p.team = e.target.value; render(); } },
              h('option', { value: 'A', ...(p.team === 'A' ? { selected: 'selected' } : {}) }, 'Team A'),
              h('option', { value: 'B', ...(p.team === 'B' ? { selected: 'selected' } : {}) }, 'Team B')
            )
          ),
          h('div', { class: 'field-row' },
            h('div', { class: 'field', style: 'flex:0 0 90px;' },
              h('label', null, 'Handicap'),
              h('input', { type: 'number', value: p.handicap === '' || p.handicap == null ? '' : p.handicap,
                min: -10, max: 54, placeholder: '0',
                oninput: e => {
                  const v = e.target.value;
                  p.handicap = v === '' ? '' : (v === '-' ? v : (parseInt(v, 10) ?? 0));
                } })
            ),
            h('div', { class: 'field', style: 'flex:1;min-width:0;' },
              h('label', null, 'Stake'),
              h('select', { style: 'width:100%;', onchange: e => { p.stake = e.target.value; } },
                h('option', { value: 'full', ...(p.stake === 'full' ? { selected: 'selected' } : {}) }, 'Full ($100)'),
                h('option', { value: '1.25x', ...(p.stake === '1.25x' ? { selected: 'selected' } : {}) }, '1.25× ($125)'),
                h('option', { value: '0.75x', ...(p.stake === '0.75x' ? { selected: 'selected' } : {}) }, '¾ ($75)'),
                h('option', { value: 'half', ...(p.stake === 'half' ? { selected: 'selected' } : {}) }, 'Half ($50)')
              )
            )
          ),
          h('div', { class: 'field', style: 'margin-top:6px;' },
            h('label', null, 'Tees'),
            (() => {
              const course = state.courses.find(c => c.id === newRoundDraft.courseId);
              // Sort tees hardest-first (highest rating at top of dropdown)
              const tees = sortedTees(course);
              // Default this player's tees to the course's configured default
              if (!p.tees && tees.length > 0) p.tees = defaultTeeForCourse(course);
              return h('select', {
                onchange: e => {
                  const v = e.target.value;
                  if (v === '__add__') {
                    const name = prompt('New tee box name:');
                    if (name && name.trim() && course) {
                      const trimmed = name.trim();
                      const exists = course.tees.find(t => t.name === trimmed);
                      if (!exists) course.tees.push({ name: trimmed, si: null, rating: null });
                      p.tees = trimmed;
                      save();
                      render();
                    } else {
                      render();
                    }
                    return;
                  }
                  p.tees = v;
                  save();
                }
              },
                ...tees.map(tee => {
                  let label = tee.name;
                  if (tee.rating) label += ` (${tee.rating})`;
                  if (Array.isArray(tee.si) && tee.si.length === 18) label += ' ★';
                  return h('option', { value: tee.name, ...(p.tees === tee.name ? { selected: 'selected' } : {}) }, label);
                }),
                h('option', { value: '__add__' }, '+ Add new tee…')
              );
            })()
          ),
          // Swing toggle: only on 5-man, only for 3-man team members
          is5 && (() => {
            const teamA = newRoundDraft.players.filter(x => x.team === 'A');
            const teamB = newRoundDraft.players.filter(x => x.team === 'B');
            const bigTeam = teamA.length === 3 ? teamA : (teamB.length === 3 ? teamB : null);
            const isOnBigTeam = bigTeam && bigTeam.some(x => x.id === p.id);
            if (!isOnBigTeam) return null;
            return h('button', {
              class: `btn btn-sm ${p.swing ? 'gold' : 'secondary'}`,
              style: 'margin-top:8px;width:100%;',
              onclick: () => {
                newRoundDraft.players.forEach(x => x.swing = false);
                p.swing = true;
                render();
              }
            }, p.swing ? '★ SWING (plays both games)' : 'Make Swing');
          })()
        )
      );
      });
    })()
  );
  root.appendChild(playersCard);

  // Start / Save button
  root.appendChild(h('div', { class: 'card' },
    h('button', { class: 'btn gold', onclick: async () => {
      const course = state.courses.find(c => c.id === newRoundDraft.courseId);
      if (!course) { alert('Pick a course'); return; }
      const teamA = newRoundDraft.players.filter(p => p.team === 'A').map(p => p.id);
      const teamB = newRoundDraft.players.filter(p => p.team === 'B').map(p => p.id);
      const mode = newRoundDraft.mode;
      if (mode === '4man') {
        if (teamA.length !== 2 || teamB.length !== 2) { alert('4-man mode needs exactly 2 players on each team'); return; }
      } else {
        if (newRoundDraft.players.length !== 5) { alert('5-man mode needs 5 players'); return; }
        if (!(teamA.length === 3 && teamB.length === 2) && !(teamA.length === 2 && teamB.length === 3)) {
          alert('5-man mode needs a 3-man team and a 2-man team'); return;
        }
        const bigTeam = teamA.length === 3 ? newRoundDraft.players.filter(p=>p.team==='A') : newRoundDraft.players.filter(p=>p.team==='B');
        if (!bigTeam.some(p => p.swing)) { alert('Tap a player on the 3-man team to make them the swing'); return; }
      }
      // Coerce empty handicaps to 0 and empty names to "Player N"
      newRoundDraft.players.forEach((p, i) => {
        if (p.handicap === '' || p.handicap == null) p.handicap = 0;
        if (!p.name || !p.name.trim()) p.name = `Player ${i+1}`;
      });

      if (isEditing && state.round && state.round.id === newRoundDraft.editingRoundId) {
        // EDIT MODE: Apply changes to existing round in-place (preserves scores, ctps, etc.)
        const rebuilt = newRound(
          course,
          newRoundDraft.players,
          teamA, teamB,
          mode,
          newRoundDraft.playhouse,
          newRoundDraft.startNine,
          newRoundDraft.gameType,
          newRoundDraft.gameType1,
          newRoundDraft.gameType2
        );
        // Preserve existing per-match indy formats (edit mode should not reset choices)
        rebuilt.indyMatchFormats = state.round.indyMatchFormats || {};
        // Build lookup of old player scores by id
        const oldScoresById = {};
        for (const p of [...state.round.teamA, ...state.round.teamB]) {
          oldScoresById[p.id] = p.scores ? p.scores.slice() : Array(18).fill(null);
        }
        // Preserve scores for players that existed before
        for (const p of [...rebuilt.teamA, ...rebuilt.teamB]) {
          if (oldScoresById[p.id]) p.scores = oldScoresById[p.id];
        }
        // Preserve per-hole state (ctp, polie, rolls, playhoused, indyBackChoice, golfFees, hostId)
        rebuilt.id = state.round.id;
        rebuilt.date = state.round.date;
        rebuilt.holes = state.round.holes;
        rebuilt.golfFees = state.round.golfFees || {};
        rebuilt.hostId = state.round.hostId || null;
        rebuilt.indyBackChoice = state.round.indyBackChoice || {};
        state.round = rebuilt;
        // Adjust current hole if startNine changed
        if (state.currentHoleIdx == null) {
          state.currentHoleIdx = newRoundDraft.startNine === 'back' ? 9 : 0;
        }
        newRoundDraft = null;
        state.screen = 'round';
        render();
        return;
      }

      // CREATE MODE
      state.round = newRound(
        course,
        newRoundDraft.players,
        teamA, teamB,
        mode,
        newRoundDraft.playhouse,
        newRoundDraft.startNine,
        newRoundDraft.gameType,
        newRoundDraft.gameType1,
        newRoundDraft.gameType2
      );
      // Seed every A×B matchup with a default format so the Indy Format screen
      // has a complete list to render.
      for (const pa of state.round.teamA) {
        for (const pb of state.round.teamB) {
          const k = Scoring.indyKey(pa.id, pb.id);
          state.round.indyMatchFormats[k] = { format: '3way', backDouble: false };
        }
      }
      state.currentHoleIdx = newRoundDraft.startNine === 'back' ? 9 : 0;
      const wantPublic = !!newRoundDraft.isPublic;
      // Detour through the per-matchup Nassau format screen before play begins.
      state.screen = 'indyFormat';
      newRoundDraft = null;
      render();

      // Auto-create a live share if user wants public visibility
      if (wantPublic && state.authUser && typeof SupabaseClient !== 'undefined' && SupabaseClient.isConfigured()) {
        try {
          const share = await SupabaseClient.createLiveShare(state.round.id, true);
          if (share) {
            state.liveShareCode = share.code;
            state.liveShareUrl = `${location.origin}${location.pathname}?live=${share.code}`;
            await SupabaseClient.updateLiveShare(share.code, state.round, true);
            save();
            render();
          }
        } catch (e) { console.warn('auto public live share failed:', e); }
      }
    }}, isEditing ? 'Save Changes' : 'Start Round')
  ));

  // Player picker modal (only renders when playerPickerIndex is set)
  const modal = renderPlayerPickerModal();
  if (modal) root.appendChild(modal);
}

// ---------- Per-matchup Individual Nassau format screen ----------
// Shown after Start Round is pressed and before the first hole. Each A×B pair
// picks its own format (3-Way or 2-Down Auto), and auto-press matches get the
// Back Doubled sub-option.
function renderIndyFormat() {
  const r = state.round;
  if (!r) { state.screen = 'home'; return render(); }
  if (!r.indyMatchFormats) r.indyMatchFormats = {};
  // If true, this screen was reached from the round (mid-game edit), so
  // the Back button returns to the round rather than discarding it.
  const isMidRoundEdit = !!state._indyFormatMidRoundEdit;

  root.appendChild(h('div', { class: 'header' },
    h('div', { class: 'header-row' },
      h('button', { class: 'back-btn', onclick: () => {
        if (isMidRoundEdit) {
          state._indyFormatMidRoundEdit = false;
          state.screen = 'round';
          render();
        } else {
          // Fresh round flow — going back discards the round and returns to setup
          state.round = null;
          state.screen = 'newRound';
          render();
        }
      } }, '← Back'),
      h('h1', null, 'Individual Matches'),
      h('span', { style: 'width:50px;' })
    )
  ));

  root.appendChild(h('div', { class: 'card' },
    h('div', { style: 'font-size:13px;color:var(--muted);margin-bottom:4px;' },
      'Pick the Nassau format for each player-vs-player matchup. You can mix formats — not every pair has to play the same game.')
  ));

  // Bulk action row — handy for quickly setting all matches to one format
  const setAll = (fmt) => {
    for (const k in r.indyMatchFormats) {
      r.indyMatchFormats[k].format = fmt;
      if (fmt !== 'auto2down') r.indyMatchFormats[k].backDouble = false;
    }
    save();
    render();
  };
  root.appendChild(h('div', { class: 'card' },
    h('h3', { style: 'margin-top:0;' }, 'Quick Set'),
    h('div', { class: 'toggle-group' },
      h('div', { class: 'toggle', onclick: () => setAll('3way') }, 'All 3-Way'),
      h('div', { class: 'toggle', onclick: () => setAll('auto2down') }, 'All 2-Down Auto')
    )
  ));

  for (const pa of r.teamA) {
    for (const pb of r.teamB) {
      const key = Scoring.indyKey(pa.id, pb.id);
      const entry = r.indyMatchFormats[key] || (r.indyMatchFormats[key] = { format: '3way', backDouble: false });
      root.appendChild(h('div', { class: 'card' },
        h('h3', { style: 'margin-top:0;margin-bottom:8px;' }, `${pa.name} vs ${pb.name}`),
        h('div', { class: 'toggle-group' },
          h('div', {
            class: `toggle ${entry.format === '3way' ? 'active' : ''}`,
            onclick: () => {
              entry.format = '3way';
              entry.backDouble = false;
              save();
              render();
            }
          }, '3-Way', h('br'), h('span', { style: 'font-size:10px;' }, 'Front / Back / Total + turn press')),
          h('div', {
            class: `toggle ${entry.format === 'auto2down' ? 'active' : ''}`,
            onclick: () => {
              entry.format = 'auto2down';
              save();
              render();
            }
          }, '2-Down Auto', h('br'), h('span', { style: 'font-size:10px;' }, 'Auto-press every 2 strokes down'))
        )
      ));
    }
  }

  root.appendChild(h('div', { class: 'card' },
    h('button', { class: 'btn gold', onclick: () => {
      save();
      state._indyFormatMidRoundEdit = false;
      state.screen = 'round';
      render();
    } }, isMidRoundEdit ? 'Done →' : 'Start Round →')
  ));
}

// ---------- Round play screen ----------
function renderRound() {
  const r = state.round;
  if (!r) { state.screen = 'home'; return render(); }
  if (!r.indyBackChoice) r.indyBackChoice = {};
  const hIdx = state.currentHoleIdx;
  const hole = r.course.holes[hIdx];
  const holeData = r.holes[hIdx];
  const result = Scoring.computeRound(r);

  // Header
  const liveBtn = (state.authUser && typeof SupabaseClient !== 'undefined' && SupabaseClient.isConfigured())
    ? h('button', { class: 'back-btn', style: state.liveShareCode ? 'background:var(--gold);color:#2a1f04;' : '',
        onclick: async () => {
          if (state.liveShareCode) {
            // Copy the live URL
            const url = state.liveShareUrl || `${location.origin}${location.pathname}?live=${state.liveShareCode}`;
            try {
              await navigator.clipboard.writeText(url);
              alert('Live link copied!');
            } catch(e) { prompt('Share this link:', url); }
            return;
          }
          // Create a PUBLIC share by default so other signed-in users can
          // discover this game in their Live Now list. Scorer can later toggle
          // it private from the Edit Setup screen.
          const share = await SupabaseClient.createLiveShare(r.id, true);
          if (share) {
            state.liveShareCode = share.code;
            state.liveShareUrl = `${location.origin}${location.pathname}?live=${share.code}`;
            // Push initial state + re-assert public flag in case the INSERT
            // raced with the default.
            await SupabaseClient.updateLiveShare(share.code, r, true);
            render();
          }
        }
      }, state.liveShareCode ? '📡 Copy Link' : '📡 Share')
    : null;

  // Background-fetch public live games so we can show a Live Now strip
  // mid-round too (lets players watch other rounds while playing).
  if (state.authUser && typeof SupabaseClient !== 'undefined' && SupabaseClient.isConfigured() && !state._publicGamesLoading && !state._publicGamesInRoundFetched) {
    state._publicGamesLoading = true;
    state._publicGamesInRoundFetched = true;
    SupabaseClient.listPublicLiveGames().then(list => {
      state._publicGames = list || [];
      state._publicGamesLoading = false;
      render(true);
    }).catch(() => { state._publicGamesLoading = false; });
  }

  root.appendChild(h('div', { class: 'header' },
    h('div', { class: 'header-row' },
      h('button', { class: 'back-btn', onclick: () => { state.screen = 'home'; render(); } }, '← Home'),
      h('div', null,
        h('h1', null, r.course.name),
        h('div', { class: 'sub' }, `${r.teamA.map(p=>p.name).join(' / ')} vs ${r.teamB.map(p=>p.name).join(' / ')}`)
      ),
      h('div', { style: 'display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;' },
        h('button', {
          class: 'back-btn',
          title: 'Edit individual Nassau formats per matchup',
          style: 'font-size:12px;padding:4px 10px;',
          onclick: () => {
            state._indyFormatMidRoundEdit = true;
            state.screen = 'indyFormat';
            render();
          }
        }, '$ Nassau'),
        h('button', {
          class: 'back-btn',
          title: 'Edit setup (players, handicaps, tees)',
          style: 'font-size:12px;padding:4px 10px;',
          onclick: () => {
            // Rebuild newRoundDraft from the live round so user can edit setup
            const allPlayers = [...r.teamA, ...r.teamB];
            newRoundDraft = {
              courseId: (state.courses.find(c => c.name === r.course.name) || {}).id || (state.courses[0] && state.courses[0].id),
              mode: r.mode || '4man',
              playhouse: !!r.playhouse,
              startNine: r.startNine || 'front',
              gameType: r.gameType || 'scotch',
              gameType1: r.gameType1 || r.gameType || 'scotch',
              gameType2: r.gameType2 || r.gameType || 'scotch',
              isPublic: !!state.liveShareCode,
              editingRoundId: r.id,
              players: allPlayers.map(p => ({
                id: p.id,
                name: p.name,
                handicap: p.handicap == null ? 0 : p.handicap,
                team: r.teamA.some(x => x.id === p.id) ? 'A' : 'B',
                stake: p.stake || 'full',
                swing: !!p.swing,
                tees: p.teesName || p.tees || '',
                userId: p.userId || null,
                invitedEmail: p.invitedEmail || null
              }))
            };
            state.screen = 'newRound';
            render();
          }
        }, '✎ Edit'),
        liveBtn,
        h('button', { class: 'back-btn', onclick: () => { state.screen = 'summary'; render(); } }, 'Σ')
      )
    )
  ));

  // Live Now strip — compact list of OTHER public games in progress.
  // Tapping any opens the live viewer in a new tab so you can watch while scoring.
  if (state.authUser && typeof SupabaseClient !== 'undefined' && SupabaseClient.isConfigured()) {
    const otherGames = (state._publicGames || []).filter(g =>
      !(state.liveShareCode && g.code === state.liveShareCode)
    );
    if (otherGames.length > 0) {
      root.appendChild(h('div', {
        style: 'margin:0 14px 10px;padding:8px 12px;background:var(--card);border:1px solid var(--border-light);border-radius:var(--radius);'
      },
        h('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:6px;' },
          h('div', { style: 'font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--green);' },
            `📡 Live Now (${otherGames.length})`),
          h('div', { style: 'font-size:10px;color:var(--muted);' }, 'tap to watch')
        ),
        h('div', { style: 'display:flex;gap:6px;overflow-x:auto;padding-bottom:2px;' },
          ...otherGames.map(g => {
            const d = g.data || {};
            const teamA = d.teamA || [];
            const teamB = d.teamB || [];
            const namesA = teamA.map(p => (p.name || '?').split(' ')[0]).join('/') || '?';
            const namesB = teamB.map(p => (p.name || '?').split(' ')[0]).join('/') || '?';
            const allP = [...teamA, ...teamB];
            let played = 0;
            for (let i = 0; i < 18; i++) {
              if (allP.some(p => p.scores && p.scores[i] != null)) played++;
            }
            return h('button', {
              class: 'btn secondary btn-sm',
              style: 'flex:0 0 auto;margin:0;padding:6px 10px;font-size:11px;white-space:nowrap;',
              onclick: () => {
                // Open live view in a NEW tab so the scorer's round stays put.
                const url = `${location.origin}${location.pathname}?live=${g.code}`;
                window.open(url, '_blank', 'noopener');
              }
            }, `${namesA} v ${namesB} · H${Math.min(played + 1, 18)}`);
          })
        )
      ));
    }
  }

  // Compute running tallies
  const playOrder = (r.startNine === 'back'
    ? [9,10,11,12,13,14,15,16,17, 0,1,2,3,4,5,6,7,8]
    : [0,1,2,3,4,5,6,7,8, 9,10,11,12,13,14,15,16,17]);
  const curPos = playOrder.indexOf(hIdx);
  // BEFORE this hole (for header)
  const holesBefore = playOrder.slice(0, curPos);
  // INCLUDING this hole (for bottom tally)
  const holesThrough = playOrder.slice(0, curPos + 1);

  function sumHoles(pts, holes) {
    let a = 0, b = 0;
    for (const hi of holes) { const p = pts.points[hi]; if (p) { a += p.a; b += p.b; } }
    return { a, b };
  }
  // For top/bottom tally, only use the Front and Back main segments (not presses/overall)
  // to avoid double-counting holes that appear in multiple overlapping segments.
  function sumGameHoles(game, holes) {
    let a = 0, b = 0;
    const front = game.segments.find(s => s.name === 'Front');
    const back = game.segments.find(s => s.name === 'Back');
    for (const seg of [front, back]) {
      if (!seg) continue;
      for (const p of seg.points) { if (holes.includes(p.h)) { a += p.a; b += p.b; } }
    }
    return { a, b };
  }

  // Before current hole (header display)
  const beforeMid = result.mode === '5man'
    ? { a: sumHoles(result.game1, holesBefore).a + sumHoles(result.game2, holesBefore).a,
        b: sumHoles(result.game1, holesBefore).b + sumHoles(result.game2, holesBefore).b }
    : sumHoles(result, holesBefore);
  const beforeTop = result.mode === '5man'
    ? { a: sumGameHoles(result.game1.top, holesBefore).a + sumGameHoles(result.game2.top, holesBefore).a,
        b: sumGameHoles(result.game1.top, holesBefore).b + sumGameHoles(result.game2.top, holesBefore).b }
    : sumGameHoles(result.top, holesBefore);
  const beforeBot = result.mode === '5man'
    ? { a: sumGameHoles(result.game1.bottom, holesBefore).a + sumGameHoles(result.game2.bottom, holesBefore).a,
        b: sumGameHoles(result.game1.bottom, holesBefore).b + sumGameHoles(result.game2.bottom, holesBefore).b }
    : sumGameHoles(result.bottom, holesBefore);

  // Through current hole (bottom tally)
  const thruMid = result.mode === '5man'
    ? { a: sumHoles(result.game1, holesThrough).a + sumHoles(result.game2, holesThrough).a,
        b: sumHoles(result.game1, holesThrough).b + sumHoles(result.game2, holesThrough).b }
    : sumHoles(result, holesThrough);
  const thruTop = result.mode === '5man'
    ? { a: sumGameHoles(result.game1.top, holesThrough).a + sumGameHoles(result.game2.top, holesThrough).a,
        b: sumGameHoles(result.game1.top, holesThrough).b + sumGameHoles(result.game2.top, holesThrough).b }
    : sumGameHoles(result.top, holesThrough);
  const thruBot = result.mode === '5man'
    ? { a: sumGameHoles(result.game1.bottom, holesThrough).a + sumGameHoles(result.game2.bottom, holesThrough).a,
        b: sumGameHoles(result.game1.bottom, holesThrough).b + sumGameHoles(result.game2.bottom, holesThrough).b }
    : sumGameHoles(result.bottom, holesThrough);

  const tally = teamLabels(r);
  // Determine the SCORER'S team (the app user). All games in the hole header
  // are displayed from this perspective: positive = scorer's team is winning.
  // Falls back to team A if the user isn't actually a player in the round.
  const scorerUserId = state.authUser ? state.authUser.id : null;
  const scorerPlayer = scorerUserId
    ? [...r.teamA, ...r.teamB].find(p => p.userId === scorerUserId)
    : null;
  const scorerTeam = scorerPlayer ? scorerPlayer.team : 'A';
  const scorerFlip = scorerTeam === 'B';

  // Middle tally from scorer's perspective: positive value when scorer's team is up.
  function tallyStr(t) {
    if (t.a === t.b) return 'Even';
    const myPts = scorerFlip ? t.b : t.a;
    const theirPts = scorerFlip ? t.a : t.b;
    const myName = scorerFlip ? tally.b : tally.a;
    const theirName = scorerFlip ? tally.a : tally.b;
    return myPts > theirPts
      ? `${myName} +${myPts - theirPts}`
      : `${theirName} +${theirPts - myPts}`;
  }
  function tallyClr(t) {
    // Use scorer's team color when they're winning, opponent's when losing.
    const myPts = scorerFlip ? t.b : t.a;
    const theirPts = scorerFlip ? t.a : t.b;
    if (myPts === theirPts) return 'rgba(255,255,255,0.7)';
    return myPts > theirPts
      ? (scorerFlip ? 'var(--team-b)' : 'var(--team-a)')
      : (scorerFlip ? 'var(--team-a)' : 'var(--team-b)');
  }

  // Build slash-separated press tally for top/bottom games from SCORER'S perspective.
  // Only shows segments for the CURRENT nine (front or back based on current hole).
  function pressSlashStr(game, holes) {
    const currentNineEnd = hIdx <= 8 ? 8 : 17;
    const segs = [
      ...game.segments.filter(s => s.name !== 'Overall' && s.endHole === currentNineEnd),
      ...game.presses.filter(p => p.endHole === currentNineEnd)
    ];
    const parts = [];
    for (const seg of segs) {
      let a = 0, b = 0;
      for (const p of seg.points) { if (holes.includes(p.h)) { a += p.a; b += p.b; } }
      if (seg.points.filter(p => holes.includes(p.h)).length === 0) continue;
      // Flip so positive = scorer's team is winning the segment.
      const diff = scorerFlip ? (b - a) : (a - b);
      parts.push(diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`);
    }
    return parts.length === 0 ? 'Even' : parts.join('/');
  }
  function pressSlashColor(game, holes) {
    const currentNineEnd = hIdx <= 8 ? 8 : 17;
    const mainSeg = game.segments.find(s => s.name !== 'Overall' && s.endHole === currentNineEnd);
    let a = 0, b = 0;
    if (mainSeg) {
      for (const p of mainSeg.points) { if (holes.includes(p.h)) { a += p.a; b += p.b; } }
    }
    // Color reflects who's ACTUALLY leading (team colors stay consistent), not the
    // scorer's perspective — so visual cue still matches team identity.
    return a > b ? 'var(--team-a)' : b > a ? 'var(--team-b)' : 'var(--muted)';
  }

  // Hole header — shows tally BEFORE this hole (who's up, not raw scores)
  root.appendChild(h('div', { class: 'hole-header' },
    h('div', { class: 'hole-number' }, String(hIdx + 1)),
    (() => {
      const topG = result.mode === '5man' ? result.game1.top : result.top;
      const botG = result.mode === '5man' ? result.game1.bottom : result.bottom;
      const topMain = sumGameHoles(topG, holesBefore);
      const botMain = sumGameHoles(botG, holesBefore);
      const topWho = topMain.a > topMain.b ? tally.a : topMain.b > topMain.a ? tally.b : '';
      const botWho = botMain.a > botMain.b ? tally.a : botMain.b > botMain.a ? tally.b : '';
      return h('div', { style: 'margin-top:6px;display:flex;gap:14px;justify-content:center;color:rgba(255,255,255,0.9);' },
        h('div', { style: 'text-align:center;' },
          h('div', { style: 'font-size:10px;opacity:0.7;' }, 'Top'),
          topWho ? h('div', { style: 'font-size:10px;opacity:0.7;' }, topWho) : null,
          h('div', { style: 'font-size:14px;font-weight:700;' }, pressSlashStr(topG, holesBefore))
        ),
        h('div', { style: 'text-align:center;' },
          h('div', { style: 'font-size:10px;opacity:0.7;' }, 'Mid'),
          h('div', { style: 'font-size:14px;font-weight:700;' }, tallyStr(beforeMid))
        ),
        h('div', { style: 'text-align:center;' },
          h('div', { style: 'font-size:10px;opacity:0.7;' }, 'Bot'),
          botWho ? h('div', { style: 'font-size:10px;opacity:0.7;' }, botWho) : null,
          h('div', { style: 'font-size:14px;font-weight:700;' }, pressSlashStr(botG, holesBefore))
        )
      );
    })(),
    h('div', { class: 'hole-info' },
      h('span', null, 'PAR ', h('strong', null, String(hole.par))),
      h('span', null, 'HCP ', h('strong', null, String(hole.si)))
    )
  ));

  // Turn prompt: for each indy pairing, ask for back-9-bet choice when starting second nine
  // front-first: shows on H10 (hIdx === 9); back-first: shows on H1 (hIdx === 0)
  // 3-Way matches get a press/no-press choice; auto2down matches get a
  // Back-Doubled toggle (replaces the old pre-round sub-option).
  const turnHoleIdx = r.startNine === 'back' ? 0 : 9;
  if (hIdx === turnHoleIdx) {
    const prompts = buildIndyBackPrompts(r);
    if (prompts.length > 0) {
      root.appendChild(h('div', { class: 'card', style: 'border:2px solid var(--gold);' },
        h('h2', null, 'Back 9 — Individual Matches'),
        h('div', { style: 'font-size:12px;color:var(--muted);margin-bottom:10px;' },
          'Set the back-9 choice for each individual match.'),
        ...prompts.map(pr => {
          if (pr.format === 'auto2down') {
            const entry = r.indyMatchFormats[pr.key];
            return h('div', { style: 'padding:10px;background:var(--bg);border-radius:8px;margin-bottom:8px;' },
              h('div', { style: 'font-size:13px;font-weight:700;margin-bottom:6px;' },
                `${pr.aName} vs ${pr.bName}`,
                h('span', { style: 'font-size:11px;color:var(--muted);margin-left:8px;font-weight:500;' }, '2-Down Auto')
              ),
              h('div', { style: 'font-size:11px;color:var(--muted);margin-bottom:6px;' },
                'Back 9 worth double? (Base back-9 bet pays 2×. New auto-presses still pay 1×.)'),
              h('div', { class: 'toggle-group' },
                h('div', {
                  class: `toggle ${!entry.backDouble ? 'active' : ''}`,
                  onclick: () => { entry.backDouble = false; save(); render(true); }
                }, 'Normal'),
                h('div', {
                  class: `toggle ${entry.backDouble ? 'active' : ''}`,
                  onclick: () => { entry.backDouble = true; save(); render(true); }
                }, 'Back Doubled')
              )
            );
          }
          const currentChoice = r.indyBackChoice[pr.key] || 'none';
          const choices = pr.state === 'tied'
            ? [
                { key: '2way', label: '2-Way', desc: 'Back + Total (normal)' },
                { key: '3way', label: '3-Way', desc: 'Back is doubled (tie carries over)' }
              ]
            : [
                { key: 'none', label: 'No Press', desc: `${pr.leaderName} won front` },
                { key: 'press', label: 'Press', desc: `${pr.trailingName} presses — back is doubled` }
              ];
          return h('div', { style: 'padding:10px;background:var(--bg);border-radius:8px;margin-bottom:8px;' },
            h('div', { style: 'font-size:13px;font-weight:700;margin-bottom:6px;' },
              `${pr.aName} vs ${pr.bName}`,
              h('span', { style: 'font-size:11px;color:var(--muted);margin-left:8px;font-weight:500;' },
                pr.state === 'tied' ? 'Front tied' : `${pr.leaderName} +${Math.abs(pr.frontDiff)} after front`)
            ),
            h('div', { class: 'toggle-group' },
              ...choices.map(c =>
                h('div', {
                  class: `toggle ${currentChoice === c.key ? 'active' : ''}`,
                  onclick: () => { r.indyBackChoice[pr.key] = c.key; save(); render(true); }
                },
                  c.label,
                  h('br'),
                  h('span', { style: 'font-size:10px;font-weight:500;opacity:0.8;' }, c.desc)
                )
              )
            )
          );
        })
      ));
    }
  }

  // Mini hole grid
  const miniFront = h('div', { class: 'hole-grid-mini' },
    ...Array(9).fill(0).map((_, i) => {
      const done = r.teamA.concat(r.teamB).every(p => p.scores[i] != null);
      const cur = i === hIdx;
      return h('div', {
        class: `h ${cur ? 'current' : done ? 'done' : ''}`,
        onclick: () => { state.currentHoleIdx = i; render(); }
      }, String(i + 1));
    })
  );
  const miniBack = h('div', { class: 'hole-grid-mini' },
    ...Array(9).fill(0).map((_, j) => {
      const i = j + 9;
      const done = r.teamA.concat(r.teamB).every(p => p.scores[i] != null);
      const cur = i === hIdx;
      return h('div', {
        class: `h ${cur ? 'current' : done ? 'done' : ''}`,
        onclick: () => { state.currentHoleIdx = i; render(); }
      }, String(i + 1));
    })
  );
  root.appendChild(h('div', { class: 'card' }, miniFront, h('div', { style: 'height:6px;' }), miniBack));

  // Score entry
  const scoreCard = h('div', { class: 'card' },
    h('h2', null, 'Scores'),
    ...r.teamA.map(p => renderScoreRow(p, hIdx, r, 'A')),
    ...r.teamB.map(p => renderScoreRow(p, hIdx, r, 'B'))
  );
  root.appendChild(scoreCard);

  // Playhouse toggle — first decision after scores, before CTP
  if (r.playhouse) {
    root.appendChild(h('div', { class: 'card' },
      h('h2', null, 'Playhouse'),
      h('div', { style: 'font-size:12px;color:var(--muted);margin-bottom:8px;' },
        'Doubles this hole\'s middle-game points (declared before the hole).'),
      h('div', { class: 'toggle-group' },
        h('div', { class: `toggle ${!holeData.playhoused ? 'active' : ''}`,
          onclick: () => { holeData.playhoused = false; render(true); } }, 'Normal'),
        h('div', { class: `toggle ${holeData.playhoused ? 'active' : ''}`,
          onclick: () => { holeData.playhoused = true; render(true); } }, '🏠 Playhouse ×2')
      )
    ));
  }

  // CTP / Polie / Roll — one section in 4-man, two in 5-man
  // In 9-point mode, CTP & Polie are hidden (only Roll shown)
  const is5man = r.mode === '5man';
  const games = is5man
    ? [{ label: 'Game 1', ctpKey: 'ctp',  polieKey: 'polie',  rollKey: 'roll',  gameType: r.gameType1 || 'scotch' },
       { label: 'Game 2', ctpKey: 'ctp2', polieKey: 'polie2', rollKey: 'roll2', gameType: r.gameType2 || 'scotch' }]
    : [{ label: null, ctpKey: 'ctp', polieKey: 'polie', rollKey: 'roll', gameType: r.gameType || 'scotch' }];

  for (const g of games) {
    const ck = g.ctpKey, pk = g.polieKey, rk = g.rollKey;
    const isScotch = g.gameType !== '9point';
    const headerLabel = g.label
      ? `${g.label} — ${isScotch ? 'Closest to the Pin' : '9-Point Game'}`
      : (isScotch ? 'Closest to the Pin' : '9-Point Game');

    const cardChildren = [h('h2', null, headerLabel)];

    if (isScotch) {
      cardChildren.push(
        h('div', { class: 'toggle-group' },
          h('div', { class: `toggle team-a ${holeData[ck] === 'A' ? 'active' : ''}`,
            onclick: () => { holeData[ck] = holeData[ck] === 'A' ? null : 'A'; render(true); }
          }, 'Team A'),
          h('div', { class: `toggle team-b ${holeData[ck] === 'B' ? 'active' : ''}`,
            onclick: () => { holeData[ck] = holeData[ck] === 'B' ? null : 'B'; render(true); }
          }, 'Team B'),
          h('div', { class: `toggle ${holeData[ck] === 'NONE' ? 'active' : ''}`,
            onclick: () => { holeData[ck] = holeData[ck] === 'NONE' ? null : 'NONE'; render(true); }
          }, 'None')
        ),
        (holeData[ck] === 'NONE')
          ? h('div', null,
              h('h3', null, 'Polie (no one hit green in reg)'),
              h('div', { class: 'toggle-group' },
                h('div', { class: `toggle team-a ${holeData[pk] === 'A' ? 'active' : ''}`,
                  onclick: () => { holeData[pk] = holeData[pk] === 'A' ? null : 'A'; render(true); }
                }, 'Team A'),
                h('div', { class: `toggle team-b ${holeData[pk] === 'B' ? 'active' : ''}`,
                  onclick: () => { holeData[pk] = holeData[pk] === 'B' ? null : 'B'; render(true); }
                }, 'Team B'),
                h('div', { class: `toggle ${holeData[pk] == null ? 'active' : ''}`,
                  onclick: () => { holeData[pk] = null; render(true); }
                }, 'None')
              )
            )
          : null
      );
    } else {
      cardChildren.push(
        h('div', { style: 'font-size:12px;color:var(--muted);margin-bottom:8px;' },
          '9-Point scoring: Low 3 · Total 3 · High Ball 3 · Keep 1 · Take 2 · Blitz (low+total+high) doubles.')
      );
    }

    cardChildren.push(
      h('h3', null, 'Roll'),
      h('div', { class: 'toggle-group' },
        h('div', { class: `toggle ${(holeData[rk] || 1) === 1 ? 'active' : ''}`,
          onclick: () => { holeData[rk] = 1; render(true); }
        }, '1x'),
        h('div', { class: `toggle ${holeData[rk] === 2 ? 'active' : ''}`,
          onclick: () => { holeData[rk] = 2; render(true); }
        }, '2x Roll'),
        h('div', { class: `toggle ${holeData[rk] === 3 ? 'active' : ''}`,
          onclick: () => { holeData[rk] = 3; render(true); }
        }, '3x Re-roll')
      )
    );

    root.appendChild(h('div', { class: 'card' }, ...cardChildren));
  }

  // Hole result summary — Middle game points + Top/Bottom hole results
  // Helper: find per-hole point entry in a game's front/back main segment
  function holePointsIn(game, holeIdx) {
    if (!game) return null;
    const seg = game.segments.find(s =>
      s.name !== 'Overall' && holeIdx >= s.startHole && holeIdx <= s.endHole
    );
    if (!seg) return null;
    return seg.points.find(p => p.h === holeIdx) || null;
  }
  function topBottomRow(label, entry, names) {
    if (!entry) return null;
    const aWin = entry.a > entry.b;
    const bWin = entry.b > entry.a;
    const labelEl = aWin
      ? h('span', { class: 'tb-result team-a' }, `${names.a} +${entry.a - entry.b}`)
      : bWin
        ? h('span', { class: 'tb-result team-b' }, `${names.b} +${entry.b - entry.a}`)
        : h('span', { class: 'tb-result tied' }, 'Tied');
    return h('div', { class: 'tb-row' },
      h('span', { class: 'tb-label' }, label),
      labelEl
    );
  }

  const holeGames = result.mode === '5man'
    ? [{ label: 'Game 1', hp: result.game1.points[hIdx], sub: result.game1, subRound: result.sub1 },
       { label: 'Game 2', hp: result.game2.points[hIdx], sub: result.game2, subRound: result.sub2 }]
    : [{ label: null, hp: result.points[hIdx], sub: result, subRound: null }];

  for (const g of holeGames) {
    const hp = g.hp;
    if (!hp) continue;
    const winner = hp.a > hp.b ? 'A' : hp.b > hp.a ? 'B' : 'T';
    const bd = hp.breakdown;
    const chips = [];
    if (bd.low && bd.low !== 'T') chips.push(`Low→${bd.low} (3)`);
    if (bd.total && bd.total !== 'T') chips.push(`Total→${bd.total} (3)`);
    if (bd.highBall && bd.highBall !== 'T') chips.push(`High→${bd.highBall} (3)`);
    if (bd.ctp && bd.ctp !== 'NONE') chips.push(`CTP→${bd.ctp} (2)`);
    if (bd.birdie && bd.birdie !== 'T') chips.push(`Birdie→${bd.birdie} (4)`);
    if (bd.polie) chips.push(`Polie→${bd.polie} (1)`);
    if (bd.keepTake) chips.push(bd.keepTake.startsWith('Keep') ? 'Keep' : 'Take');
    if (bd.blitz) chips.push(`BLITZ ×2 →${bd.blitz}`);
    if (bd.roll && bd.roll > 1) chips.push(`ROLL ×${bd.roll}`);
    if (bd.playhoused) chips.push(`PLAYHOUSE ×2`);

    // Top / Bottom per-hole results
    const topEntry    = holePointsIn(g.sub.top, hIdx);
    const bottomEntry = holePointsIn(g.sub.bottom, hIdx);

    // In 5-man, show only the 2 players actually in this sub-game
    const tl = g.subRound ? teamLabels(g.subRound) : teamLabels(r);
    // Only show the winning team's NET points (what they actually earn in the middle
    // game for this hole = winner.points − loser.points). Previously this showed
    // hp.a or hp.b (raw pre-subtraction total), which double-counted vs. the running
    // summary and confused users after Keep/Take + Roll/Playhouse multipliers.
    const winnerName = winner === 'A' ? tl.a : winner === 'B' ? tl.b : null;
    const winnerPts = Math.abs(hp.a - hp.b);
    const winnerColor = winner === 'A' ? 'var(--team-a)' : winner === 'B' ? 'var(--team-b)' : 'var(--muted)';

    root.appendChild(h('div', { class: 'card' },
      h('h2', null, g.label ? `${g.label} — Hole Points` : 'Hole Points'),
      h('div', { style: 'text-align:center;padding:8px 0;' },
        hp.a === 0 && hp.b === 0
          ? h('div', { style: 'font-size:18px;font-weight:700;color:var(--muted);' }, 'No points scored')
          : winner === 'T'
            ? h('div', null,
                h('div', { style: 'font-size:14px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:1px;' }, 'Tied'),
                h('div', { style: 'font-size:36px;font-weight:900;color:var(--muted);font-feature-settings:"tnum";' }, String(hp.a))
              )
            : h('div', null,
                h('div', { style: `font-size:14px;color:${winnerColor};font-weight:700;text-transform:uppercase;letter-spacing:1px;` }, winnerName),
                h('div', { style: `font-size:48px;font-weight:900;color:${winnerColor};font-feature-settings:"tnum";` }, `+${winnerPts}`)
              )
      ),
      chips.length > 0
        ? h('div', { style: 'font-size:11px;color:var(--muted);text-align:center;margin-top:4px;line-height:1.5;' }, chips.join(' • '))
        : null,
      // Top & Bottom game hole results
      h('div', { class: 'tb-summary' },
        topBottomRow('Top Game', topEntry, tl),
        topBottomRow('Bottom Game', bottomEntry, tl)
      )
    ));
  }

  // Running game tally — through this hole (includes current)
  root.appendChild(h('div', { style: 'text-align:center;padding:10px 14px;margin:0 14px;background:var(--card);border-radius:var(--radius);border:1px solid var(--border-light);font-size:14px;font-weight:700;display:flex;justify-content:space-around;' },
    h('div', null,
      h('div', { style: 'font-size:10px;text-transform:uppercase;color:var(--muted);letter-spacing:1px;' }, 'Top'),
      h('div', { style: `color:${pressSlashColor(result.mode === '5man' ? result.game1.top : result.top, holesThrough)};` },
        pressSlashStr(result.mode === '5man' ? result.game1.top : result.top, holesThrough))
    ),
    h('div', null,
      h('div', { style: 'font-size:10px;text-transform:uppercase;color:var(--muted);letter-spacing:1px;' }, 'Middle'),
      h('div', { style: `color:${tallyClr(thruMid)};` }, tallyStr(thruMid))
    ),
    h('div', null,
      h('div', { style: 'font-size:10px;text-transform:uppercase;color:var(--muted);letter-spacing:1px;' }, 'Bottom'),
      h('div', { style: `color:${pressSlashColor(result.mode === '5man' ? result.game1.bottom : result.bottom, holesThrough)};` },
        pressSlashStr(result.mode === '5man' ? result.game1.bottom : result.bottom, holesThrough))
    )
  ));

  // Bottom nav — respects startNine play order (reuse playOrder from tally above)
  const playPos = playOrder.indexOf(hIdx);
  const isFirst = playPos === 0;
  const isLast  = playPos === 17;
  const nav = h('div', { class: 'bottom-nav' },
    h('button', { class: 'btn secondary btn-sm', onclick: () => {
      if (!isFirst) { state.currentHoleIdx = playOrder[playPos - 1]; render(); }
    }, ...(isFirst ? { disabled: 'true' } : {}) }, '← Prev'),
    h('button', { class: 'btn btn-sm', onclick: () => {
      if (!isLast) { state.currentHoleIdx = playOrder[playPos + 1]; render(); }
      else { state.round.roundComplete = true; state.screen = 'summary'; render(); }
    }}, isLast ? 'Finish' : 'Next →')
  );
  root.appendChild(nav);
}

function renderScoreRow(player, hIdx, round, team) {
  const si = round.course.holes[hIdx].si;
  const strokes = Scoring.strokesOnHole(round.baseStrokes[player.id] || 0, si);
  const val = player.scores[hIdx];
  const isXVal = val === 'X' || val === 'x';
  const valStyle = val == null
    ? 'color:var(--muted);'
    : (isXVal ? 'color:var(--team-b);font-weight:900;' : '');
  return h('div', { class: 'score-grid' },
    h('div', null,
      h('div', { class: 'pname' }, player.name),
      h('div', null,
        h('span', { class: 'pteam' }, `Hcp ${player.handicap || 0}`),
        strokes > 0 ? h('span', { class: 'strokes' }, ` • ${'●'.repeat(strokes)}`) : null
      )
    ),
    h('div', { class: 'stepper' },
      h('button', { onclick: () => {
        const par = round.course.holes[hIdx].par;
        const cur = player.scores[hIdx];
        if (cur == null) {
          // First tap down = birdie
          player.scores[hIdx] = par - 1;
        } else if (cur === 'X' || cur === 'x') {
          // Back out of X → triple bogey
          player.scores[hIdx] = par + 3;
        } else {
          player.scores[hIdx] = Math.max(1, cur - 1);
        }
        render(true);
      }}, '−'),
      h('div', { class: 'val', style: valStyle }, val == null ? '–' : (isXVal ? 'X' : String(val))),
      h('button', { onclick: () => {
        const par = round.course.holes[hIdx].par;
        const cur = player.scores[hIdx];
        if (cur == null) {
          // First tap up = par
          player.scores[hIdx] = par;
        } else if (cur === 'X' || cur === 'x') {
          // Already X — stay X (max)
          return;
        } else if (cur === par + 3) {
          // After triple bogey → X (did not finish)
          player.scores[hIdx] = 'X';
        } else {
          player.scores[hIdx] = cur + 1;
        }
        render(true);
      }}, '+'),
      h('button', {
        class: 'x-btn',
        style: `margin-left:6px;padding:0 10px;font-size:13px;font-weight:800;background:${isXVal ? 'var(--team-b)' : 'var(--bg)'};color:${isXVal ? 'white' : 'var(--team-b)'};border:1px solid var(--team-b);border-radius:8px;`,
        onclick: () => {
          if (isXVal) {
            // Toggle X off → clear to null
            player.scores[hIdx] = null;
          } else {
            player.scores[hIdx] = 'X';
          }
          render(true);
        }
      }, 'X')
    )
  );
}

// ---------- Summary / Settlement ----------
function renderSummary() {
  const r = state.round;
  if (!r) { state.screen = 'home'; return render(); }
  const result = Scoring.computeRound(r);
  const settlement = Scoring.settle(r, result);

  // Cloud sync is now manual — user taps "Submit for Review" button (below)

  // Ensure golf fee state exists on the round
  if (!r.golfFees) r.golfFees = {};
  if (r.hostId === undefined) r.hostId = null;

  // Apply golf fees to perPlayer: each non-host player's fee is debited from
  // their total and credited to the host.
  const allPlayers = [...r.teamA, ...r.teamB];
  const adjustedPerPlayer = { ...settlement.perPlayer };
  let hostCredit = 0;
  for (const p of allPlayers) {
    const fee = Number(r.golfFees[p.id]) || 0;
    if (fee > 0 && p.id !== r.hostId) {
      adjustedPerPlayer[p.id] = (adjustedPerPlayer[p.id] || 0) - fee;
      hostCredit += fee;
    }
  }
  if (r.hostId && hostCredit > 0) {
    adjustedPerPlayer[r.hostId] = (adjustedPerPlayer[r.hostId] || 0) + hostCredit;
  }

  root.appendChild(h('div', { class: 'header' },
    h('div', { class: 'header-row' },
      h('button', { class: 'back-btn', onclick: () => { state.screen = 'round'; render(); } }, '← Round'),
      h('h1', null, 'Settlement'),
      h('span', { style: 'width:50px;' })
    )
  ));

  // Golf Fees card — at the TOP so it can't be missed after H18
  root.appendChild(renderGolfFeesCard(r, allPlayers, hostCredit));

  // Running score summary with press slashes (cumulative, all holes)
  const allHoleIdxs = Array(18).fill(0).map((_, i) => i);
  const scoredHoles = allHoleIdxs.filter(i => allPlayers.some(p => p.scores[i] != null));
  function summarySlash(game) {
    const segs = [...game.segments.filter(s => s.name !== 'Overall'), ...game.presses];
    const parts = [];
    for (const seg of segs) {
      let a = 0, b = 0;
      for (const p of seg.points) { if (scoredHoles.includes(p.h)) { a += p.a; b += p.b; } }
      if (seg.points.filter(p => scoredHoles.includes(p.h)).length === 0) continue;
      const diff = a - b;
      parts.push(diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`);
    }
    return parts.length === 0 ? 'Even' : parts.join('/');
  }
  function summarySlashClr(game) {
    const front = game.segments.find(s => s.name === 'Front');
    const back = game.segments.find(s => s.name === 'Back');
    let a = 0, b = 0;
    for (const seg of [front, back]) { if (!seg) continue; for (const p of seg.points) { if (scoredHoles.includes(p.h)) { a += p.a; b += p.b; } } }
    return a > b ? 'var(--team-a-light)' : b > a ? 'var(--team-b-light)' : 'var(--muted)';
  }
  function summaryMid(pts) {
    let a = 0, b = 0;
    for (const hi of scoredHoles) { const p = pts.points[hi]; if (p) { a += p.a; b += p.b; } }
    return { a, b };
  }
  const stl2 = teamLabels(r);
  const topG = result.mode === '5man' ? result.game1.top : result.top;
  const botG = result.mode === '5man' ? result.game1.bottom : result.bottom;
  const midT = result.mode === '5man'
    ? { a: summaryMid(result.game1).a + summaryMid(result.game2).a, b: summaryMid(result.game1).b + summaryMid(result.game2).b }
    : summaryMid(result);
  const midStr2 = midT.a === midT.b ? 'Even' : midT.a > midT.b ? `${stl2.a} +${midT.a-midT.b}` : `${stl2.b} +${midT.b-midT.a}`;
  const midClr2 = midT.a > midT.b ? 'var(--team-a-light)' : midT.b > midT.a ? 'var(--team-b-light)' : 'var(--muted)';

  root.appendChild(h('div', { style: 'display:flex;justify-content:space-around;padding:14px;margin:14px;background:var(--card);border-radius:var(--radius-lg);border:1px solid var(--border-light);box-shadow:var(--shadow);font-weight:700;' },
    h('div', { style: 'text-align:center;' },
      h('div', { style: 'font-size:10px;text-transform:uppercase;color:var(--muted);letter-spacing:1px;margin-bottom:4px;' }, 'Top'),
      h('div', { style: `font-size:16px;color:${summarySlashClr(topG)};` }, summarySlash(topG))
    ),
    h('div', { style: 'text-align:center;' },
      h('div', { style: 'font-size:10px;text-transform:uppercase;color:var(--muted);letter-spacing:1px;margin-bottom:4px;' }, 'Middle'),
      h('div', { style: `font-size:16px;color:${midClr2};` }, midStr2)
    ),
    h('div', { style: 'text-align:center;' },
      h('div', { style: 'font-size:10px;text-transform:uppercase;color:var(--muted);letter-spacing:1px;margin-bottom:4px;' }, 'Bottom'),
      h('div', { style: `font-size:16px;color:${summarySlashClr(botG)};` }, summarySlash(botG))
    )
  ));

  // Render points / top / bottom — differs by mode
  const gameViews = result.mode === '5man'
    ? [{ label: 'Game 1', pts: result.game1, subRound: result.sub1 },
       { label: 'Game 2', pts: result.game2, subRound: result.sub2 }]
    : [{ label: null, pts: result, subRound: null }];

  for (const gv of gameViews) {
    // In 5-man, use the sub-round (2 players per team) for labels
    const displayRound = gv.subRound || r;
    if (gv.label) {
      const gl = teamLabels(displayRound);
      root.appendChild(h('div', { class: 'card', style: 'background:var(--green-dark);color:white;padding:10px 16px;' },
        h('div', { style: 'font-size:11px;text-transform:uppercase;letter-spacing:1px;opacity:0.7;' }, gv.label),
        h('div', { style: 'font-size:13px;margin-top:4px;opacity:0.9;' }, `${gl.a} vs ${gl.b}`)
      ));
    }
    root.appendChild(renderTopGameCard(gv.pts, displayRound));
    root.appendChild(renderMiddleGameCard(gv.pts, displayRound));
    root.appendChild(renderBottomGameCard(gv.pts, displayRound));
    root.appendChild(renderPerHoleAllGames(gv.pts, displayRound, gv.label));
  }

  // Action split (5-man only)
  if (settlement.mode === '5man' && settlement.actionSplit) {
    const as = settlement.actionSplit;
    root.appendChild(h('div', { class: 'card' },
      h('h2', null, '3-Man Team Action Split'),
      h('div', { style: 'font-size:12px;color:var(--muted);margin-bottom:8px;' },
        `Pool: ${as.pool >= 0 ? '+' : '−'}$${Math.abs(as.pool)} split by stake shares (full=2, half=1).`),
      h('table', { class: 'totals-table' },
        h('thead', null,
          h('tr', null,
            h('th', null, 'Player'),
            h('th', null, 'Shares'),
            h('th', null, '%'),
            h('th', null, 'Cut')
          )
        ),
        h('tbody', null,
          ...as.shares.map(s => h('tr', null,
            h('td', null, s.name),
            h('td', null, String(s.shares)),
            h('td', null, `${s.pct}%`),
            h('td', null, `${(settlement.perPlayer[s.id]||0) >= 0 ? '+' : '−'}$${Math.abs(settlement.perPlayer[s.id]||0)}`)
          ))
        )
      )
    ));
  }

  // (Golf Fees card already added at top of summary)

  // Per-player cash (tap a player to expand breakdown)
  root.appendChild(h('div', { class: 'card' },
    h('h2', null, 'Player Totals'),
    h('div', { style: 'font-size:11px;color:var(--muted);margin-bottom:8px;' }, 'Tap a player to see the math.'),
    ...[...r.teamA, ...r.teamB].map(p => {
      const amt = adjustedPerPlayer[p.id] || 0;
      const color = amt > 0 ? 'var(--green-light)' : amt < 0 ? 'var(--red)' : 'var(--muted)';
      const sign = amt > 0 ? '+' : amt < 0 ? '−' : '';
      const badges = [];
      if (p.swing) badges.push('SWING');
      const stakeLabels = { 'full': 'Full', 'half': 'Half', '1.25x': '1.25×', '0.75x': '¾' };
      badges.push(stakeLabels[p.stake] || 'Full');
      const isOpen = state.expandedPlayer === p.id;
      return h('div', null,
        h('div', {
          class: `player-card team-${p.team.toLowerCase()}`,
          style: 'cursor:pointer;',
          onclick: () => {
            state.expandedPlayer = isOpen ? null : p.id;
            render();
          }
        },
          h('div', { class: 'info' },
            h('div', { class: 'name' }, p.name, h('span', { style: 'font-size:12px;color:var(--muted);margin-left:8px;' }, isOpen ? '▾' : '▸')),
            h('div', { class: 'hcp' }, `Team ${p.team} • Hcp ${p.handicap} • ${badges.join(' • ')}`)
          ),
          h('div', { style: `font-size:22px;font-weight:800;color:${color};` },
            amt === 0 ? '$0' : `${sign}$${Math.abs(amt)}`)
        ),
        isOpen ? renderPlayerBreakdown(p, r, result, settlement, { hostCredit, hostId: r.hostId, golfFees: r.golfFees }) : null
      );
    })
  ));

  // Individual Net Nassau matches
  if (settlement.indy && settlement.indy.length > 0) {
    // Each pair's format may differ; show a column indicating which was used.
    const anyAuto = settlement.indy.some(m => m.format === 'auto2down');
    const indyDescription = anyAuto
      ? 'Per-matchup Nassau. 3W = Front/Back/Total + turn press. AP = 2-down auto-presses (each press pays one stake).'
      : 'Net Nassau front/back/total. Flat $100 per segment (full) or $50 (half).';
    root.appendChild(h('div', { class: 'card' },
      h('h2', null, 'Individual Matches'),
      h('div', { style: 'font-size:12px;color:var(--muted);margin-bottom:8px;' }, indyDescription),
      h('table', { class: 'totals-table' },
        h('thead', null,
          h('tr', null,
            h('th', null, 'Matchup'),
            h('th', null, 'Fmt'),
            h('th', null, 'F'),
            h('th', null, 'B'),
            h('th', null, 'Tot'),
            anyAuto ? h('th', null, 'Pr') : null,
            h('th', null, '$')
          )
        ),
        h('tbody', null,
          ...settlement.indy.map(m => {
            const sign = (d) => d > 0 ? 'A' : d < 0 ? 'B' : '—';
            const amt = m.aAmount;
            const txt = amt === 0 ? '—' : (amt > 0 ? `+$${amt} A` : `+$${Math.abs(amt)} B`);
            const fmtLabel = m.format === 'auto2down' ? (m.backDouble ? 'AP×' : 'AP') : '3W';
            return h('tr', null,
              h('td', { style: 'font-size:11px;' }, `${m.aName} vs ${m.bName}`),
              h('td', { style: 'font-size:10px;color:var(--muted);' }, fmtLabel),
              h('td', { class: m.frontDiff > 0 ? 'team-a' : m.frontDiff < 0 ? 'team-b' : '' }, sign(m.frontDiff)),
              h('td', { class: m.backDiff  > 0 ? 'team-a' : m.backDiff  < 0 ? 'team-b' : '' }, sign(m.backDiff)),
              h('td', { class: m.totalDiff > 0 ? 'team-a' : m.totalDiff < 0 ? 'team-b' : '' }, sign(m.totalDiff)),
              anyAuto ? h('td', { style: 'font-size:11px;' }, m.format === 'auto2down' ? String(m.pressCount || 0) : '—') : null,
              h('td', { style: 'font-size:11px;' }, txt)
            );
          })
        )
      )
    ));
  }

  // Per-player totals banner — only show winners
  const winners = allPlayers.filter(p => (adjustedPerPlayer[p.id] || 0) > 0);
  if (winners.length > 0) {
    root.appendChild(h('div', { class: 'card', style: 'background:var(--green);color:white;' },
      h('h2', { style: 'color:white;' }, 'Winners'),
      h('div', { style: 'display:flex;flex-wrap:wrap;justify-content:space-around;padding:8px 0;gap:12px;' },
        ...winners.map(p => {
          const amt = adjustedPerPlayer[p.id] || 0;
          return h('div', { style: 'text-align:center;min-width:80px;' },
            h('div', { style: 'font-size:14px;opacity:0.9;' }, p.name.split(' ')[0]),
            h('div', { style: 'font-size:28px;font-weight:900;' }, `+$${amt}`)
          );
        })
      )
    ));
  }

  // Player scores card (gross + net totals for each player)
  // Gross is the RAW entered score — same number the bet scoring used
  // (no net-double-bogey cap during play). The "(rep N)" hint shows the
  // capped total that would be sent to the admin / handicap system, so a
  // player can see at a glance whether anything got adjusted down on
  // submission.
  root.appendChild(h('div', { class: 'card' },
    h('h2', null, 'Player Scores'),
    h('div', { style: 'font-size:11px;color:var(--muted);margin-bottom:6px;' },
      'Gross shown is what was entered (and what the bets used). Reported total (sent to admin / copy-to-text) caps each hole at Net Double Bogey and converts any X to net double.'),
    h('table', { class: 'totals-table' },
      h('thead', null,
        h('tr', null,
          h('th', null, 'Player'),
          h('th', null, 'Gross'),
          h('th', null, 'Net'),
          h('th', null, '$')
        )
      ),
      h('tbody', null,
        ...allPlayers.map(p => {
          let grossRaw = 0;
          let netRaw = 0;
          let grossReported = 0;
          let hasAdj = false;
          for (let i = 0; i < 18; i++) {
            const raw = p.scores[i];
            if (raw == null || raw === '') continue;
            const cap = Scoring.cappedGross(r, p, i);
            const si = r.course.holes[i].si;
            const strokes = Scoring.strokesOnHole(r.baseStrokes[p.id] || 0, si);
            if (raw === 'X' || raw === 'x') {
              // No numeric raw value — count the cap in both totals.
              grossRaw += cap;
              netRaw += cap - strokes;
              hasAdj = true;
            } else {
              grossRaw += raw;
              netRaw += raw - strokes;
              if (cap < raw) hasAdj = true;
            }
            grossReported += cap;
          }
          const amt = adjustedPerPlayer[p.id] || 0;
          const cls = amt > 0 ? 'team-a' : amt < 0 ? 'team-b' : '';
          const txt = amt === 0 ? '$0' : (amt > 0 ? `+$${amt}` : `−$${Math.abs(amt)}`);
          const grossCell = hasAdj
            ? h('td', null,
                String(grossRaw),
                h('span', { style: 'font-size:10px;color:var(--muted);margin-left:4px;' },
                  `(rep ${grossReported})`))
            : h('td', null, String(grossRaw));
          return h('tr', null,
            h('td', { style: 'font-weight:600;font-size:13px;' }, p.name),
            grossCell,
            h('td', null, String(netRaw)),
            h('td', { class: cls, style: 'font-weight:700;' }, txt)
          );
        })
      )
    )
  ));

  // Copy-to-text button
  root.appendChild(h('div', { class: 'card' },
    h('button', { class: 'btn gold', onclick: () => {
      const text = buildCopyText(r, result, settlement, adjustedPerPlayer);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          () => alert('Copied to clipboard!'),
          () => { prompt('Copy this:', text); }
        );
      } else {
        prompt('Copy this:', text);
      }
    }}, '📋 Copy Summary to Text'),
    // Submit for Review
    (() => {
      const canSubmit = state.authUser && typeof SupabaseClient !== 'undefined' && SupabaseClient.isConfigured();
      const alreadySaved = r.cloudSavedId && r.cloudSavedId !== 'pending';
      if (alreadySaved) {
        return h('div', { class: 'info', style: 'margin-top:10px;text-align:center;' }, '✓ Submitted — waiting for admin approval');
      }
      if (!canSubmit) {
        return h('div', { style: 'margin-top:10px;font-size:12px;color:var(--muted);text-align:center;' }, 'Sign in to submit this round for review.');
      }
      return h('button', { class: 'btn gold', style: 'margin-top:10px;', onclick: async () => {
        try {
          r.cloudSavedId = 'pending';
          render(true);
          // Send a "reporting" clone with scores capped at net-double-bogey
          // (and any X converted to net-double) so the admin sees pure numeric
          // values and downstream handicap calc has real numbers to work with.
          const reportingRound = Scoring.toReportingRound(r);
          const row = await SupabaseClient.saveRound(reportingRound, { ...settlement, perPlayer: adjustedPerPlayer });
          if (row) {
            r.cloudSavedId = row.id;
            historyCache = null;
            statsCache = null;
            save();
            // Send email summary to all logged-in players (fire and forget)
            try {
              const summaryText = buildCopyText(r, result, settlement, adjustedPerPlayer);
              SupabaseClient.sendRoundEmail(row.id, summaryText, r.course?.name, r.date);
            } catch (e) { console.warn('Email send failed:', e); }
            alert('Round submitted for admin review!');
            render(true);
          } else {
            r.cloudSavedId = null;
            alert('Submit returned no data. Check console for errors.');
            render(true);
          }
        } catch (err) {
          console.error('Submit failed:', err);
          r.cloudSavedId = null;
          alert('Failed to submit: ' + (err.message || String(err)));
          render(true);
        }
      }}, r.cloudSavedId === 'pending' ? 'Submitting...' : '✓ Submit for Review');
    })(),
    h('button', { class: 'btn danger', style: 'margin-top:10px;', onclick: async () => {
      if (confirm('End round and clear?')) {
        // Tear down the live share first so spectators' Live Now list clears.
        if (state.liveShareCode && typeof SupabaseClient !== 'undefined' && SupabaseClient.isConfigured()) {
          try { await SupabaseClient.endLiveShare(state.liveShareCode); } catch (e) {}
        }
        state.liveShareCode = null;
        state.liveShareUrl = null;
        state.round = null;
        state.currentHoleIdx = 0;
        state.screen = 'home';
        render();
      }
    }}, 'End Round')
  ));
}

// Build a plain-text summary suitable for pasting into a message
function buildCopyText(round, result, settlement, adjustedPerPlayer) {
  const lines = [];
  const courseName = round.course?.name || 'Course';
  const date = new Date(round.date).toLocaleDateString();
  lines.push(`⛳ ${courseName} — ${date}`);
  lines.push('');
  lines.push('SCORES:');
  const allPlayers = [...round.teamA, ...round.teamB];
  for (const p of allPlayers) {
    // Report capped gross (net-double-bogey) so the reported number matches
    // whatever the bet scoring used. X holes → net double bogey.
    let gross = 0;
    for (let i = 0; i < 18; i++) {
      const raw = p.scores[i];
      if (raw == null || raw === '') continue;
      gross += Scoring.cappedGross(round, p, i);
    }
    const amt = adjustedPerPlayer[p.id] || 0;
    const amtStr = amt === 0 ? 'Even' : (amt > 0 ? `+$${amt}` : `−$${Math.abs(amt)}`);
    const teeName = p.teesName || p.tees || '';
    const teesStr = teeName ? ` (${teeName})` : '';
    lines.push(`${p.name}${teesStr}: ${gross} — ${amtStr}`);
  }
  return lines.join('\n');
}

// Per-hole combined summary across all three games: Top / Middle / Bottom
// Format for each team cell: "T/M/B" showing per-hole points won in each game
function renderPerHoleAllGames(pts, round, label) {
  // For each hole, compute per-hole points scored by A and B in each game
  function pointsAtHole(h_, seg) {
    const p = seg.points.find(pt => pt.h === h_);
    return p || { a: 0, b: 0 };
  }
  const topFront = pts.top.segments.find(s => s.name === 'Front');
  const topBack  = pts.top.segments.find(s => s.name === 'Back');
  const botFront = pts.bottom.segments.find(s => s.name === 'Front');
  const botBack  = pts.bottom.segments.find(s => s.name === 'Back');

  const rows = [];
  for (let i = 0; i < 18; i++) {
    const top = i < 9 ? pointsAtHole(i, topFront) : pointsAtHole(i, topBack);
    const mid = pts.points[i] || { a: 0, b: 0 };
    const bot = i < 9 ? pointsAtHole(i, botFront) : pointsAtHole(i, botBack);

    const aStr = `${top.a}/${mid.a}/${bot.a}`;
    const bStr = `${top.b}/${mid.b}/${bot.b}`;
    const anyA = top.a || mid.a || bot.a;
    const anyB = top.b || mid.b || bot.b;

    if (i === 9) {
      rows.push(h('tr', { style: 'background:var(--bg);' },
        h('td', { colspan: '3', style: 'text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);font-weight:700;padding:6px;' }, '— Back 9 —')
      ));
    }

    rows.push(h('tr', null,
      h('td', null, String(i+1)),
      h('td', { class: anyA ? 'team-a' : '', style: 'font-family:ui-monospace,monospace;font-size:13px;' }, aStr),
      h('td', { class: anyB ? 'team-b' : '', style: 'font-family:ui-monospace,monospace;font-size:13px;' }, bStr)
    ));
  }

  return h('div', { class: 'card' },
    h('h2', null, label ? `${label} — Per Hole Totals` : 'Per Hole Totals'),
    h('div', { style: 'font-size:11px;color:var(--muted);margin-bottom:6px;' },
      'Format: Top / Middle / Bottom — points scored by each team on that hole.'),
    h('table', { class: 'totals-table' },
      h('thead', null,
        h('tr', null,
          h('th', null, 'H'),
          h('th', { class: 'team-a' }, teamLabels(round).a),
          h('th', { class: 'team-b' }, teamLabels(round).b)
        )
      ),
      h('tbody', null, ...rows)
    )
  );
}

// For each A×B indy pairing, check front-9 state and whether a back-9 prompt is needed.
// Returns prompts for BOTH 3-way matches (press/no-press choice) and auto2down
// matches (back-9 doubled toggle). The mid-round UI renders them differently.
function buildIndyBackPrompts(round) {
  const prompts = [];
  // Determine the "first nine" in play order — that's what we check for scoring complete.
  const firstNineIdxs = round.startNine === 'back'
    ? [9,10,11,12,13,14,15,16,17]
    : [0,1,2,3,4,5,6,7,8];
  const formats = round.indyMatchFormats || {};
  for (const pa of round.teamA) {
    for (const pb of round.teamB) {
      const k = Scoring.indyKey(pa.id, pb.id);
      const entry = formats[k] || { format: '3way' };
      const firstNineDone = firstNineIdxs.every(i => pa.scores[i] != null && pb.scores[i] != null);
      if (!firstNineDone) continue;
      if (entry.format === 'auto2down') {
        prompts.push({
          key: k,
          format: 'auto2down',
          aName: pa.name,
          bName: pb.name,
          backDouble: !!entry.backDouble
        });
      } else {
        const match = Scoring.computeIndyMatch(round, pa, pb);
        // "front diff" in this context = diff after the FIRST nine played
        const diff = round.startNine === 'back' ? match.backDiff : match.frontDiff;
        const state = diff === 0 ? 'tied' : 'decided';
        const leaderName = diff > 0 ? pa.name : diff < 0 ? pb.name : null;
        const trailingName = diff > 0 ? pb.name : diff < 0 ? pa.name : null;
        prompts.push({
          key: k,
          format: '3way',
          aName: pa.name,
          bName: pb.name,
          state,
          frontDiff: diff,
          leaderName,
          trailingName
        });
      }
    }
  }
  return prompts;
}

// Golf Fees card — shown at top of settlement so it's unmissable
function renderGolfFeesCard(r, allPlayers, hostCredit) {
  return h('div', { class: 'card', style: 'border:2px solid var(--gold);' },
    h('h2', null, '⛳ Golf Fees'),
    h('div', { style: 'font-size:12px;color:var(--muted);margin-bottom:10px;' },
      'Pick who hosted (paid the tab) and enter what each player owes. Fees credit the host and debit each payer.'),
    h('div', { class: 'field' },
      h('label', null, 'Host (who paid the tab)'),
      h('select', {
        onchange: e => { r.hostId = e.target.value || null; save(); render(); }
      },
        h('option', { value: '', ...(r.hostId ? {} : { selected: 'selected' }) }, '— None —'),
        ...allPlayers.map(p =>
          h('option', { value: p.id, ...(r.hostId === p.id ? { selected: 'selected' } : {}) }, p.name)
        )
      )
    ),
    ...allPlayers.map(p => {
      const isHost = r.hostId === p.id;
      const cur = r.golfFees[p.id] != null ? String(r.golfFees[p.id]) : '';
      return h('div', { class: 'field-row', style: 'align-items:center;gap:10px;margin-bottom:6px;' },
        h('div', { style: 'flex:1;font-size:14px;font-weight:600;' },
          p.name, isHost ? h('span', { style: 'font-size:10px;color:var(--gold);margin-left:6px;' }, '★ HOST') : null
        ),
        h('div', { style: 'flex:0 0 130px;' },
          h('input', {
            type: 'number',
            inputmode: 'decimal',
            placeholder: isHost ? '(host gets credit)' : '$0',
            value: cur,
            disabled: isHost ? 'true' : undefined,
            style: isHost ? 'opacity:0.5;' : '',
            // Update + save on every keystroke, but DON'T re-render — that
            // destroys the input and steals focus mid-type. Re-render on
            // blur/Enter (onchange) so the host-credit total refreshes once
            // the user is done typing.
            oninput: e => {
              const v = e.target.value;
              if (v === '') delete r.golfFees[p.id];
              else r.golfFees[p.id] = Number(v) || 0;
              save();
            },
            onchange: () => render(true)
          })
        )
      );
    }),
    hostCredit > 0 && r.hostId
      ? h('div', { class: 'info', style: 'margin-top:8px;' },
          `${allPlayers.find(p => p.id === r.hostId)?.name || 'Host'} credited +$${hostCredit} for golf fees.`)
      : null
  );
}

// Build the dollar breakdown for one player using the engine's computed lines.
function renderPlayerBreakdown(player, round, result, settlement, fees) {
  const sections = [];

  // Team game section(s) — from settlement.playerBreakdown (4-man) or G1/G2 (5-man)
  const teamBreakdowns = [];
  if (settlement.mode === '5man') {
    if (settlement.playerBreakdownG1 && settlement.playerBreakdownG1[player.id]) {
      teamBreakdowns.push(settlement.playerBreakdownG1[player.id]);
    }
    if (settlement.playerBreakdownG2 && settlement.playerBreakdownG2[player.id]) {
      teamBreakdowns.push(settlement.playerBreakdownG2[player.id]);
    }
  } else if (settlement.playerBreakdown && settlement.playerBreakdown[player.id]) {
    teamBreakdowns.push(settlement.playerBreakdown[player.id]);
  }

  for (const tb of teamBreakdowns) {
    const label = tb.game === 'main' ? 'Team Games'
      : `Team Games (${tb.game})`;
    const pctLabel = tb.effectiveFactor !== 1
      ? ` — ${Math.round(tb.effectiveFactor * 100)}% game`
      : '';
    sections.push({
      title: label + pctLabel,
      lines: tb.lines.map(l => ({
        label: l.label,
        calc: l.calc,
        amt: l.amount === 0 ? '$0' : (l.amount > 0 ? `+$${l.amount}` : `−$${Math.abs(l.amount)}`)
      })),
      subtotal: tb.subtotal
    });
  }

  // Individual Nassau matches (still per-pair at lower stake)
  const playerIndy = (settlement.indy || []).filter(m => m.aId === player.id || m.bId === player.id);
  for (const m of playerIndy) {
    const playerIsA = m.aId === player.id;
    const opponent = playerIsA ? m.bName : m.aName;
    const lines = [];
    const segs = [
      { name: 'Front 9 net', diff: m.frontDiff },
      { name: 'Back 9 net',  diff: m.backDiff },
      { name: 'Total 18 net', diff: m.totalDiff }
    ];
    for (const s of segs) {
      if (s.diff === 0) { lines.push({ label: s.name, calc: 'Tied', amt: '$0' }); continue; }
      const sign = (s.diff > 0 && playerIsA) || (s.diff < 0 && !playerIsA) ? '+' : '−';
      lines.push({ label: `${s.name} (${s.diff > 0 ? 'A' : 'B'} by ${Math.abs(s.diff)})`, calc: `flat $${m.perSeg}`, amt: `${sign}$${m.perSeg}` });
    }
    const totalFromIndy = playerIsA ? m.aAmount : -m.aAmount;
    sections.push({
      title: `Indy vs ${opponent} (${m.stake})`,
      lines,
      subtotal: totalFromIndy
    });
  }

  // Golf fees section
  if (fees) {
    const myFee = Number(fees.golfFees[player.id]) || 0;
    const isHost = fees.hostId === player.id;
    if (isHost && fees.hostCredit > 0) {
      sections.push({
        title: 'Golf Fees (host credit)',
        lines: [{ label: 'Credit from other players', calc: 'host paid the tab', amt: `+$${fees.hostCredit}` }],
        subtotal: fees.hostCredit
      });
    } else if (!isHost && myFee > 0) {
      sections.push({
        title: 'Golf Fees',
        lines: [{ label: 'Your share (owed to host)', calc: 'fee entered', amt: `−$${myFee}` }],
        subtotal: -myFee
      });
    }
  }

  // 5-man action split note
  const is5man = round.mode === '5man';
  const bigTeam = is5man ? (round.teamA.length === 3 ? round.teamA : round.teamB) : null;
  const isBigTeamPlayer = bigTeam && bigTeam.some(p => p.id === player.id);
  let actionSplitNote = null;
  if (is5man && isBigTeamPlayer && settlement.actionSplit) {
    const as = settlement.actionSplit;
    const myShare = as.shares.find(s => s.id === player.id);
    const preSplit = as.preSplit[player.id] || 0;
    const indyTotal = playerIndy.reduce((s, m) => {
      const playerIsA = m.aId === player.id;
      return s + (playerIsA ? m.aAmount : -m.aAmount);
    }, 0);
    const postSplit = Math.round(as.pool * (myShare.shares / (as.shares.reduce((s,x)=>s+x.shares,0))));
    actionSplitNote = h('div', { class: 'breakdown-split' },
      h('div', { style: 'font-weight:700;font-size:13px;' }, '3-Man Action Split'),
      h('div', { style: 'font-size:12px;color:var(--muted);margin-top:4px;' },
        `Team pool $${as.pool} × ${myShare.pct}% share = ${postSplit >= 0 ? '+' : '−'}$${Math.abs(postSplit)}`),
      h('div', { style: 'font-size:12px;color:var(--muted);' },
        `Your pre-split contribution was ${preSplit >= 0 ? '+' : '−'}$${Math.abs(preSplit)}`),
      indyTotal !== 0 ? h('div', { style: 'font-size:12px;color:var(--muted);' },
        `Plus individual Nassau (not pooled): ${indyTotal >= 0 ? '+' : '−'}$${Math.abs(indyTotal)}`) : null
    );
  }

  return h('div', { class: 'breakdown' },
    ...sections.map(sec =>
      h('div', { class: 'breakdown-section' },
        h('div', { class: 'breakdown-title' }, sec.title),
        ...sec.lines.map(l =>
          h('div', { class: 'breakdown-line' },
            h('div', { class: 'bl-label' }, l.label),
            h('div', { class: 'bl-calc' }, l.calc),
            h('div', { class: 'bl-amt' }, l.amt)
          )
        ),
        h('div', { class: 'breakdown-subtotal' },
          h('span', null, 'Subtotal'),
          h('span', { style: `color:${sec.subtotal > 0 ? 'var(--green-light)' : sec.subtotal < 0 ? 'var(--red)' : 'var(--muted)'};` },
            sec.subtotal === 0 ? '$0' : (sec.subtotal > 0 ? `+$${sec.subtotal}` : `−$${Math.abs(sec.subtotal)}`))
        )
      )
    ),
    actionSplitNote
  );
}

// Collapsible card wrapper. `key` is a key into state.expanded.
function collapsibleCard(key, title, summaryContent, bodyFn) {
  const isOpen = !!state.expanded[key];
  const header = h('div', {
    class: 'collapsible-header',
    onclick: () => { state.expanded[key] = !state.expanded[key]; render(); }
  },
    h('div', { style: 'flex:1;min-width:0;' },
      h('h2', { style: 'margin:0 0 4px 0;' }, title),
      summaryContent
    ),
    h('div', { class: 'collapsible-arrow' }, isOpen ? '▾' : '▸')
  );
  return h('div', { class: 'card' },
    header,
    isOpen ? h('div', { class: 'collapsible-body' }, ...bodyFn()) : null
  );
}

function renderMiddleGameCard(pts, round) {
  const tl = teamLabels(round);
  const a = pts.pointsTotal.a, b = pts.pointsTotal.b;
  const diff = a - b;
  const winner = diff > 0 ? tl.a : diff < 0 ? tl.b : null;
  const summary = winner
    ? h('div', { class: 'big-diff' },
        h('span', { class: diff > 0 ? 'team-a-color' : 'team-b-color' },
          `${winner} +${Math.abs(diff)} pts`)
      )
    : h('div', { class: 'big-diff muted' }, 'Even');
  return collapsibleCard('middle', 'Middle Game — Points', summary, () => [
    // Full per-hole breakdown
    h('table', { class: 'totals-table', style: 'margin-top:8px;' },
      h('thead', null,
        h('tr', null,
          h('th', null, 'Hole'),
          h('th', null, tl.a),
          h('th', null, tl.b),
          h('th', null, 'Notes')
        )
      ),
      h('tbody', null,
        ...pts.points.map((p, i) => {
          if (!p) return h('tr', null,
            h('td', null, String(i+1)),
            h('td', null, '—'), h('td', null, '—'), h('td', null, '')
          );
          const notes = [];
          if (p.breakdown.blitz) notes.push('BLITZ');
          if (p.breakdown.keepTake) notes.push(p.breakdown.keepTake.startsWith('Keep') ? 'Keep' : 'Take');
          if (p.breakdown.roll > 1) notes.push(`×${p.breakdown.roll}`);
          return h('tr', null,
            h('td', null, String(i+1)),
            h('td', { class: p.a > p.b ? 'team-a' : '' }, String(p.a)),
            h('td', { class: p.b > p.a ? 'team-b' : '' }, String(p.b)),
            h('td', { style: 'font-size:10px;color:var(--muted);' }, notes.join(' '))
          );
        }),
        h('tr', { style: 'font-weight:800;background:var(--bg);' },
          h('td', null, 'Total'),
          h('td', { class: a > b ? 'team-a' : '' }, String(a)),
          h('td', { class: b > a ? 'team-b' : '' }, String(b)),
          h('td', null, '')
        )
      )
    )
  ]);
}

// Count segment "wins" (segments with non-tie result)
function countSegmentWins(game) {
  const allSegs = [...game.segments, ...game.presses];
  let aWins = 0, bWins = 0;
  for (const seg of allSegs) {
    const t = Scoring.segTotal(seg);
    if (t.a > t.b) aWins++;
    else if (t.b > t.a) bWins++;
  }
  return { aWins, bWins, total: allSegs.length };
}

function renderTopGameCard(pts, round) {
  const wins = countSegmentWins(pts.top);
  const tl2 = teamLabels(round);
  const summary = h('div', { class: 'games-summary' },
    h('span', { class: 'team-a-color' }, `${tl2.a} ${wins.aWins}`),
    h('span', { class: 'dash' }, '·'),
    h('span', { class: 'team-b-color' }, `${tl2.b} ${wins.bWins}`),
    h('span', { class: 'muted' }, `of ${wins.total} segments`)
  );
  return collapsibleCard('top', 'Top Game — Low/Total', summary, () => {
    const frontMain = pts.top.segments.find(s => s.name === 'Front');
    const backMain = pts.top.segments.find(s => s.name === 'Back');
    const frontPresses = pts.top.presses.filter(p => p.endHole === 8);
    const backPresses = pts.top.presses.filter(p => p.endHole === 17);
    return [
      h('div', { class: 'nine-group' },
        h('div', { class: 'nine-label' }, 'Front 9'),
        ...renderChain(frontMain, frontPresses, 'top')
      ),
      h('div', { class: 'nine-group' },
        h('div', { class: 'nine-label' }, 'Back 9'),
        ...renderChain(backMain, backPresses, 'top')
      ),
      renderPerHoleTable(pts, round, 'top')
    ];
  });
}

function renderBottomGameCard(pts, round) {
  const wins = countSegmentWins(pts.bottom);
  const tl3 = teamLabels(round);
  const summary = h('div', { class: 'games-summary' },
    h('span', { class: 'team-a-color' }, `${tl3.a} ${wins.aWins}`),
    h('span', { class: 'dash' }, '·'),
    h('span', { class: 'team-b-color' }, `${tl3.b} ${wins.bWins}`),
    h('span', { class: 'muted' }, `of ${wins.total} segments`)
  );
  return collapsibleCard('bottom', 'Bottom Game — Net Nassau', summary, () => {
    const frontMain = pts.bottom.segments.find(s => s.name === 'Front');
    const backMain = pts.bottom.segments.find(s => s.name === 'Back');
    const overall = pts.bottom.segments.find(s => s.name === 'Overall');
    const frontPresses = pts.bottom.presses.filter(p => p.endHole === 8);
    const backPresses = pts.bottom.presses.filter(p => p.endHole === 17);
    return [
      h('div', { style: 'font-size:11px;color:var(--muted);margin-bottom:8px;font-style:italic;' },
        'Strokes: full handicap (every player gets their full course handicap, allocated by SI). NDB cap rises with the strokes received on each hole.'),
      h('div', { class: 'nine-group' },
        h('div', { class: 'nine-label' }, 'Front 9'),
        ...renderChain(frontMain, frontPresses, 'bottom')
      ),
      h('div', { class: 'nine-group' },
        h('div', { class: 'nine-label' }, 'Back 9'),
        ...renderChain(backMain, backPresses, 'bottom')
      ),
      h('div', { class: 'nine-group' },
        h('div', { class: 'nine-label' }, 'Overall 18'),
        renderSegRow(overall, 0, 'overall')
      ),
      renderPerHoleTable(pts, round, 'bottom')
    ];
  });
}

// Running status per hole across main + all active presses in that nine.
// Each cell shows a slash-separated list: "main/press1/press2" for whichever team
// is leading each segment. Both columns can have values at the same hole when
// main and a press have different leaders.
function renderPerHoleTable(pts, round, which) {
  const game = which === 'top' ? pts.top : pts.bottom;
  const frontMain = game.segments.find(s => s.name === 'Front');
  const backMain  = game.segments.find(s => s.name === 'Back');
  const frontPresses = game.presses.filter(p => p.endHole === 8);
  const backPresses  = game.presses.filter(p => p.endHole === 17);

  // Build running net per seg indexed by hole
  function runningNetSeries(seg) {
    const series = {};
    let a = 0, b = 0;
    for (const p of seg.points) {
      a += p.a; b += p.b;
      series[p.h] = a - b;
    }
    return series;
  }

  const frontSegs = [frontMain, ...frontPresses].map(s => ({ seg: s, series: runningNetSeries(s) }));
  const backSegs  = [backMain,  ...backPresses ].map(s => ({ seg: s, series: runningNetSeries(s) }));

  // For hole h, gather running nets on all segments that cover it.
  // Also computes per-hole delta (change from previous scored hole in that seg).
  function gatherAt(h, segList) {
    const aVals = [];
    const bVals = [];
    let aDelta = 0, bDelta = 0;
    for (const { seg, series } of segList) {
      if (h < seg.startHole || h > seg.endHole) continue;
      const keys = Object.keys(series).map(k => parseInt(k, 10)).sort((x, y) => x - y);
      const currentIdx = keys.findIndex(k => k >= h);
      if (currentIdx === -1 || keys[currentIdx] > h) continue;
      const net = series[keys[currentIdx]];
      const prevNet = currentIdx > 0 ? series[keys[currentIdx - 1]] : 0;
      const delta = net - prevNet; // change caused by THIS hole
      if (net > 0) aVals.push(net);
      else if (net < 0) bVals.push(-net);
      // Track total delta from A's perspective
      aDelta += delta;
    }
    return { aVals, bVals, delta: aDelta };
  }

  function rowForHole(i) {
    const segList = i < 9 ? frontSegs : backSegs;
    const { aVals, bVals, delta } = gatherAt(i, segList);
    const aText = aVals.length === 0 ? null : aVals.join('/');
    const bText = bVals.length === 0 ? null : bVals.join('/');
    // Per-hole delta annotation: positive = A gained, negative = B gained
    const deltaText = delta > 0 ? ` (+${delta})` : delta < 0 ? ` (${delta})` : '';
    const deltaClass = delta > 0 ? 'team-a' : delta < 0 ? 'team-b' : '';
    return h('tr', null,
      h('td', null, String(i+1)),
      aText
        ? h('td', { class: 'team-a', style: 'font-weight:800;font-size:15px;' }, aText)
        : h('td', { style: 'color:var(--border);' }, '—'),
      bText
        ? h('td', { class: 'team-b', style: 'font-weight:800;font-size:15px;' }, bText)
        : h('td', { style: 'color:var(--border);' }, '—'),
      h('td', { class: deltaClass, style: 'font-size:11px;font-weight:600;' }, deltaText || '—')
    );
  }

  const rows = [];
  for (let i = 0; i < 9; i++) rows.push(rowForHole(i));
  rows.push(h('tr', { style: 'background:var(--bg);' },
    h('td', { colspan: '4', style: 'text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);font-weight:700;padding:6px;' }, '— Back 9 —')
  ));
  for (let i = 9; i < 18; i++) rows.push(rowForHole(i));

  return h('div', { style: 'margin-top:10px;' },
    h('h3', null, 'Running Score'),
    h('div', { style: 'font-size:11px;color:var(--muted);margin-bottom:6px;' },
      'Cumulative net (main/press). Δ column shows who won the hole and by how much.'),
    h('table', { class: 'totals-table' },
      h('thead', null,
        h('tr', null,
          h('th', null, 'Hole'),
          h('th', { class: 'team-a' }, teamLabels(round).a),
          h('th', { class: 'team-b' }, teamLabels(round).b),
          h('th', null, 'Δ')
        )
      ),
      h('tbody', null, ...rows)
    )
  );
}

// Renders a segment row. Match play: shows net (winner has diff, loser has dash).
function renderSegRow(seg, level, kind) {
  const t = Scoring.segTotal(seg);
  const diff = t.a - t.b;
  const aNet = diff > 0 ? diff : 0;
  const bNet = diff < 0 ? -diff : 0;
  const status = diff > 0 ? 'won-a' : diff < 0 ? 'won-b' : 'tied';
  const statusText = diff > 0 ? `A +${diff}` : diff < 0 ? `B +${-diff}` : 'Even';

  const indentChildren = [];
  if (level > 0) {
    indentChildren.push(h('div', { class: `seg-indent level-${level}` }));
  }

  return h('div', { class: `seg-row ${kind}` },
    ...indentChildren,
    level > 0 ? h('span', { class: 'seg-connector', style: `left:${(level-1)*14 + 4}px;` }, '↳') : null,
    h('div', { class: 'seg-info' },
      h('div', { class: 'seg-name' }, seg.name),
      h('div', { class: 'seg-holes' }, `Holes ${seg.startHole+1}–${seg.endHole+1}`)
    ),
    h('div', { class: 'seg-score' },
      diff > 0
        ? h('div', { class: 'a win' }, String(aNet))
        : h('div', { class: 'dash', style: 'min-width:22px;text-align:center;' }, '–'),
      h('div', { class: 'dash' }, '·'),
      diff < 0
        ? h('div', { class: 'b win' }, String(bNet))
        : h('div', { class: 'dash', style: 'min-width:22px;text-align:center;' }, '–')
    ),
    h('div', { class: `seg-status ${status}` }, statusText)
  );
}

// Chain presses together: each press is nested under its parent (the previous press in that nine)
function renderChain(mainSeg, presses, kind) {
  const rows = [renderSegRow(mainSeg, 0, 'main')];
  // Presses are in order they were opened; each chains from previous (level++)
  presses.forEach((p, i) => {
    rows.push(renderSegRow(p, i + 1, 'press'));
  });
  return rows;
}

function renderSegmentCard(title, game) {
  const frontMain = game.segments.find(s => s.name === 'Front');
  const backMain  = game.segments.find(s => s.name === 'Back');
  const overall   = game.segments.find(s => s.name === 'Overall'); // bottom game only
  const frontPresses = game.presses.filter(p => p.endHole === 8);
  const backPresses  = game.presses.filter(p => p.endHole === 17);

  return h('div', { class: 'card' },
    h('h2', null, title),
    h('div', { class: 'nine-group' },
      h('div', { class: 'nine-label' }, 'Front 9'),
      ...renderChain(frontMain, frontPresses, 'top')
    ),
    h('div', { class: 'nine-group' },
      h('div', { class: 'nine-label' }, 'Back 9'),
      ...renderChain(backMain, backPresses, 'top')
    ),
    overall
      ? h('div', { class: 'nine-group' },
          h('div', { class: 'nine-label' }, 'Overall 18'),
          renderSegRow(overall, 0, 'overall')
        )
      : null
  );
}

// ==================== AUTH / LOGIN SCREENS ====================

function renderLogin() {
  root.appendChild(h('div', { class: 'header' },
    h('div', { class: 'header-row' },
      h('button', { class: 'back-btn', onclick: () => { state.screen = 'home'; render(); } }, '← Back'),
      h('h1', null, 'SIGN IN'),
      h('span', { style: 'width:50px;' })
    )
  ));

  if (typeof SupabaseClient === 'undefined') {
    root.appendChild(h('div', { class: 'card' },
      h('h2', null, 'Cloud Sync Not Set Up'),
      h('div', { class: 'warning' },
        'Supabase client module not found. Make sure supabase.js is included in the build.'),
      h('button', { class: 'btn secondary', style: 'margin-top:12px;',
        onclick: () => { state.screen = 'home'; render(); } }, 'Continue Without Login')
    ));
    return;
  }

  if (!SupabaseClient.isConfigured()) {
    // CDN might still be loading — retry in 1 second
    if (!state._loginRetried) {
      state._loginRetried = true;
      setTimeout(() => { state._loginRetried = false; render(); }, 1500);
    }
    root.appendChild(h('div', { class: 'card' },
      h('h2', null, 'Connecting…'),
      h('div', { class: 'info' },
        'Loading Supabase library. If this takes more than a few seconds, try reloading the page.'),
      h('button', { class: 'btn secondary', style: 'margin-top:12px;',
        onclick: () => { state.screen = 'home'; render(); } }, 'Continue Without Login')
    ));
    return;
  }

  const mode = state.loginMode || 'signin';
  const card = h('div', { class: 'card' },
    h('h2', null, mode === 'signup' ? 'Create Account' : mode === 'magic' ? 'Magic Link' : 'Sign In'),
    // Mode switcher
    h('div', { class: 'toggle-group', style: 'margin-bottom:16px;' },
      h('div', { class: `toggle ${mode === 'signin' ? 'active' : ''}`,
        onclick: () => { state.loginMode = 'signin'; state.loginError = null; state.loginMessage = null; render(); } }, 'Sign In'),
      h('div', { class: `toggle ${mode === 'signup' ? 'active' : ''}`,
        onclick: () => { state.loginMode = 'signup'; state.loginError = null; state.loginMessage = null; render(); } }, 'Sign Up'),
      h('div', { class: `toggle ${mode === 'magic' ? 'active' : ''}`,
        onclick: () => { state.loginMode = 'magic'; state.loginError = null; state.loginMessage = null; render(); } }, 'Magic Link')
    ),
    // Display name (signup only)
    mode === 'signup' ? h('div', { class: 'field' },
      h('label', null, 'Display Name'),
      h('input', { type: 'text', value: state.loginDisplayName || '', placeholder: 'Kyle Cannon',
        oninput: e => { state.loginDisplayName = e.target.value; } })
    ) : null,
    h('div', { class: 'field' },
      h('label', null, 'Email'),
      h('input', { type: 'email', value: state.loginEmail || '', placeholder: 'you@example.com',
        oninput: e => { state.loginEmail = e.target.value; } })
    ),
    mode !== 'magic' ? h('div', { class: 'field' },
      h('label', null, 'Password'),
      h('input', { type: 'password', value: state.loginPassword || '', placeholder: '••••••••',
        oninput: e => { state.loginPassword = e.target.value; } })
    ) : null,
    mode === 'signin' ? h('div', { style: 'text-align:right;margin-top:4px;' },
      h('a', { href: '#', style: 'font-size:12px;color:var(--green-light);', onclick: async (e) => {
        e.preventDefault();
        if (!state.loginEmail || !state.loginEmail.trim()) {
          state.loginError = 'Enter your email above first.';
          render();
          return;
        }
        try {
          const { error } = await SupabaseClient.resetPassword(state.loginEmail.trim());
          if (error) throw error;
          state.loginMessage = 'Password reset email sent! Check your inbox.';
          state.loginError = null;
        } catch (err) {
          state.loginError = err.message || String(err);
        }
        render();
      }}, 'Forgot Password?')
    ) : null,
    state.loginError ? h('div', { class: 'warning' }, state.loginError) : null,
    state.loginMessage ? h('div', { class: 'info' }, state.loginMessage) : null,
    h('button', { class: 'btn', style: 'margin-top:8px;', onclick: async () => {
      state.loginError = null;
      state.loginMessage = null;
      try {
        if (mode === 'signin') {
          const { error } = await SupabaseClient.signInWithEmail(state.loginEmail, state.loginPassword);
          if (error) throw error;
          state.screen = 'account';
        } else if (mode === 'signup') {
          if (!state.loginDisplayName || !state.loginDisplayName.trim()) {
            state.loginError = 'Please enter a display name.';
            render();
            return;
          }
          const { error } = await SupabaseClient.signUpWithEmail(state.loginEmail, state.loginPassword, state.loginDisplayName.trim());
          if (error) throw error;
          state.loginMessage = 'Check your email to confirm your account.';
        } else if (mode === 'magic') {
          const { error } = await SupabaseClient.signInWithMagicLink(state.loginEmail);
          if (error) throw error;
          state.loginMessage = 'Magic link sent! Check your email.';
        }
        render();
      } catch (err) {
        state.loginError = err.message || String(err);
        render();
      }
    }}, mode === 'signup' ? 'Create Account' : mode === 'magic' ? 'Send Link' : 'Sign In'),
    h('button', { class: 'btn secondary', style: 'margin-top:10px;', onclick: async () => {
      state.loginError = null;
      try {
        await SupabaseClient.signInWithGoogle();
      } catch (err) {
        state.loginError = err.message || 'Google sign-in not configured on the server.';
        render();
      }
    }}, 'Continue with Google')
  );
  root.appendChild(card);
}

function renderAccount() {
  const user = state.authUser;
  const profile = state.authProfile;
  // Password recovery flow
  if (user && SupabaseClient.isPasswordRecovery()) {
    root.appendChild(h('div', { class: 'header' },
      h('div', { class: 'header-row' },
        h('span', { style: 'width:50px;' }),
        h('h1', null, 'RESET PASSWORD'),
        h('span', { style: 'width:50px;' })
      )
    ));
    let newPw = '';
    root.appendChild(h('div', { class: 'card' },
      h('div', { class: 'icon', style: 'font-size:36px;text-align:center;margin-bottom:12px;' }, '🔑'),
      h('p', { style: 'text-align:center;color:var(--muted);font-size:13px;' }, 'Enter your new password below.'),
      h('div', { class: 'field' },
        h('label', null, 'New Password'),
        h('input', { type: 'password', placeholder: '••••••••', oninput: e => { newPw = e.target.value; } })
      ),
      state.loginError ? h('div', { class: 'warning' }, state.loginError) : null,
      state.loginMessage ? h('div', { class: 'info' }, state.loginMessage) : null,
      h('button', { class: 'btn', style: 'margin-top:8px;', onclick: async () => {
        if (!newPw || newPw.length < 6) {
          state.loginError = 'Password must be at least 6 characters.';
          render();
          return;
        }
        try {
          const { error } = await SupabaseClient.updatePassword(newPw);
          if (error) throw error;
          state.loginError = null;
          state.loginMessage = null;
          render();
        } catch (err) {
          state.loginError = err.message || String(err);
          render();
        }
      }}, 'Set New Password')
    ));
    return;
  }
  root.appendChild(h('div', { class: 'header' },
    h('div', { class: 'header-row' },
      h('button', { class: 'back-btn', onclick: () => { state.screen = 'home'; render(); } }, '← Back'),
      h('h1', null, 'ACCOUNT'),
      h('span', { style: 'width:50px;' })
    )
  ));
  if (!user) {
    root.appendChild(h('div', { class: 'card' },
      h('div', { class: 'empty' },
        h('div', { class: 'icon' }, '👤'),
        'Not signed in.'
      ),
      h('button', { class: 'btn', onclick: () => { state.screen = 'login'; render(); } }, 'Sign In / Sign Up')
    ));
    return;
  }
  // Check if display name needs to be set (magic link / Google users)
  const needsName = profile && (!profile.display_name || profile.display_name === user.email.split('@')[0]);
  if (needsName) {
    let newName = profile.display_name || '';
    root.appendChild(h('div', { class: 'card', style: 'border:2px solid var(--gold);' },
      h('h2', null, 'Set Your Display Name'),
      h('div', { style: 'font-size:13px;color:var(--muted);margin-bottom:10px;' },
        'Please enter your full name so other players can find and link you.'),
      h('div', { class: 'field' },
        h('label', null, 'Display Name'),
        h('input', { type: 'text', value: newName, placeholder: 'e.g. Kyle Cannon',
          oninput: e => { newName = e.target.value; } })
      ),
      h('button', { class: 'btn gold', onclick: async () => {
        if (!newName || !newName.trim()) { alert('Please enter a name'); return; }
        await SupabaseClient.updateProfile({ display_name: newName.trim() });
        render();
      }}, 'Save Name')
    ));
    return;
  }

  // Load stats for balance if not cached
  if (!statsCache && typeof SupabaseClient !== 'undefined' && SupabaseClient.isConfigured()) {
    loadStats();
  }
  const balance = statsCache ? (statsCache.ledgerBalance ?? statsCache.netTotal) : null;
  const balColor = balance > 0 ? 'var(--green-light)' : balance < 0 ? 'var(--team-b)' : 'var(--muted)';
  const balText = balance == null ? '' : balance === 0 ? '$0' : balance > 0 ? `+$${balance}` : `-$${Math.abs(balance)}`;

  root.appendChild(h('div', { class: 'card' },
    h('h2', null, 'Profile'),
    h('div', { style: 'display:flex;justify-content:space-between;align-items:center;' },
      h('div', null,
        h('div', { style: 'font-size:16px;font-weight:700;' }, profile?.display_name || user.email),
        h('div', { style: 'font-size:13px;color:var(--muted);margin-top:2px;' }, user.email),
        h('div', { style: 'font-size:12px;color:var(--muted);margin-top:4px;' }, `Handicap: ${profile?.handicap ?? 0}`)
      ),
      balance != null
        ? h('div', { style: `font-size:24px;font-weight:900;color:${balColor};font-feature-settings:"tnum";` }, balText)
        : null
    ),
    h('button', { class: 'btn secondary', style: 'margin-top:16px;',
      onclick: () => { state.screen = 'history'; render(); } }, 'Round History'),
    h('button', { class: 'btn secondary', style: 'margin-top:8px;',
      onclick: () => { state.screen = 'stats'; render(); } }, 'Stats'),
    h('button', { class: 'btn danger', style: 'margin-top:16px;', onclick: async () => {
      // Clear local state FIRST so the button press always visually logs out,
      // even if the remote call stalls or errors.
      state.authUser = null;
      state.authProfile = null;
      statsCache = null;
      h2hCache = null;
      historyCache = null;
      state.screen = 'home';
      save();
      render();
      try { await SupabaseClient.signOut(); } catch (e) { console.warn('signOut failed:', e); }
    }}, 'Sign Out')
  ));
}

// ==================== HISTORY SCREEN ====================
let historyCache = null;
async function loadHistory() {
  if (!SupabaseClient || !SupabaseClient.isConfigured() || !state.authUser) return [];
  try {
    historyCache = await SupabaseClient.listMyRounds();
  } catch (e) {
    console.error('loadHistory error:', e);
    historyCache = [];
  }
  render();
}
function renderHistory() {
  root.appendChild(h('div', { class: 'header' },
    h('div', { class: 'header-row' },
      h('button', { class: 'back-btn', onclick: () => { state.screen = 'account'; render(); } }, '← Back'),
      h('h1', null, 'HISTORY'),
      h('span', { style: 'width:50px;' })
    )
  ));
  if (!state.authUser) {
    root.appendChild(h('div', { class: 'card' },
      h('div', { class: 'empty' }, 'Sign in to see your history.')
    ));
    return;
  }
  if (historyCache === null) {
    root.appendChild(h('div', { class: 'card' }, h('div', { class: 'empty' }, 'Loading…')));
    loadHistory();
    return;
  }
  if (historyCache.length === 0) {
    root.appendChild(h('div', { class: 'card' },
      h('div', { class: 'empty' },
        h('div', { class: 'icon' }, '⛳'),
        'No rounds yet. Finish a round while signed in to save it here.')
    ));
    return;
  }
  root.appendChild(h('div', { class: 'card' },
    h('h2', null, `${historyCache.length} Rounds`),
    ...historyCache.map(r => {
      const amt = r.my_amount || 0;
      const amtColor = amt > 0 ? 'var(--green-light)' : amt < 0 ? 'var(--team-b)' : 'var(--muted)';
      const amtText = amt === 0 ? 'Even' : amt > 0 ? `+$${amt}` : `−$${Math.abs(amt)}`;
      const date = new Date(r.played_at).toLocaleDateString();
      return h('div', { class: 'list-item' },
        h('div', null,
          h('div', { class: 'main' }, r.course_name),
          h('div', { class: 'sub' }, `${date} · ${r.mode === '5man' ? '5-Man' : '4-Man'} · ${r.game_type === '9point' ? '9-Point' : 'Scotch'}`)
        ),
        h('div', { style: `font-weight:900;font-size:18px;color:${amtColor};font-feature-settings:"tnum";` }, amtText)
      );
    })
  ));
}

// ==================== LIFETIME STATS SCREEN ====================
let statsCache = null;
let h2hCache = null;
async function loadStats() {
  if (!SupabaseClient || !SupabaseClient.isConfigured() || !state.authUser) return;
  try {
    statsCache = await SupabaseClient.getMyStats();
    h2hCache = await SupabaseClient.getHeadToHead();
  } catch (e) {
    console.error('loadStats error:', e);
    statsCache = statsCache || { roundsPlayed: 0, totalWon: 0, totalLost: 0, netTotal: 0, wins: 0, losses: 0, ties: 0, byCourse: {}, paymentsTotal: 0 };
    h2hCache = h2hCache || [];
  }
  render();
}
function renderStats() {
  root.appendChild(h('div', { class: 'header' },
    h('div', { class: 'header-row' },
      h('button', { class: 'back-btn', onclick: () => { state.screen = 'account'; render(); } }, '← Back'),
      h('h1', null, 'STATS'),
      h('button', { class: 'back-btn', title: 'Refresh',
        onclick: () => { statsCache = null; h2hCache = null; render(); }
      }, '↻')
    )
  ));
  if (!state.authUser) {
    root.appendChild(h('div', { class: 'card' }, h('div', { class: 'empty' }, 'Sign in to see your stats.')));
    return;
  }
  if (statsCache === null) {
    root.appendChild(h('div', { class: 'card' }, h('div', { class: 'empty' }, 'Loading…')));
    loadStats();
    return;
  }
  // Silent background refresh so admin payments propagate on next render
  if (!state._statsRefreshing) {
    state._statsRefreshing = true;
    SupabaseClient.getMyStats().then(fresh => {
      state._statsRefreshing = false;
      if (fresh && JSON.stringify(fresh) !== JSON.stringify(statsCache)) {
        statsCache = fresh;
        if (state.screen === 'stats') render(true);
      }
    }).catch(() => { state._statsRefreshing = false; });
  }
  const s = statsCache;
  // Current Balance = rounds net + admin payments (same as account/home card)
  const bal = s.ledgerBalance != null ? s.ledgerBalance : s.netTotal;
  root.appendChild(h('div', { class: 'result-banner' },
    h('div', { class: 'label' }, 'Current Balance'),
    h('div', { class: 'amount', style: `color:${bal < 0 ? '#ffb3ad' : 'white'};` },
      bal === 0 ? 'Even' : bal > 0 ? `+$${bal}` : `−$${Math.abs(bal)}`
    ),
    (s.paymentsTotal !== 0)
      ? h('div', { style: 'font-size:11px;opacity:0.75;margin-top:4px;' },
          `Rounds: ${s.netTotal >= 0 ? '+' : '−'}$${Math.abs(s.netTotal)}  •  Payments: ${s.paymentsTotal >= 0 ? '+' : '−'}$${Math.abs(s.paymentsTotal)}`
        )
      : null
  ));
  root.appendChild(h('div', { class: 'card' },
    h('h2', null, 'Totals'),
    h('table', { class: 'totals-table' },
      h('tbody', null,
        h('tr', null, h('td', null, 'Rounds played'), h('td', null, String(s.roundsPlayed))),
        h('tr', null, h('td', null, 'Wins'), h('td', { class: 'team-a' }, String(s.wins))),
        h('tr', null, h('td', null, 'Losses'), h('td', { class: 'team-b' }, String(s.losses))),
        h('tr', null, h('td', null, 'Ties'), h('td', null, String(s.ties))),
        h('tr', null, h('td', null, 'Total won'), h('td', null, `$${s.totalWon}`)),
        h('tr', null, h('td', null, 'Total lost'), h('td', null, `$${s.totalLost}`))
      )
    )
  ));
  const courses = Object.entries(s.byCourse).sort((a, b) => b[1].rounds - a[1].rounds);
  if (courses.length > 0) {
    root.appendChild(h('div', { class: 'card' },
      h('h2', null, 'By Course'),
      h('table', { class: 'totals-table' },
        h('thead', null, h('tr', null,
          h('th', null, 'Course'),
          h('th', null, 'Rounds'),
          h('th', null, 'Net')
        )),
        h('tbody', null,
          ...courses.map(([name, c]) => h('tr', null,
            h('td', { style: 'text-align:left;font-size:12px;' }, name),
            h('td', null, String(c.rounds)),
            h('td', { class: c.net > 0 ? 'team-a' : c.net < 0 ? 'team-b' : '' },
              c.net === 0 ? '—' : c.net > 0 ? `+$${c.net}` : `−$${Math.abs(c.net)}`)
          ))
        )
      )
    ));
  }
  // Head-to-head records
  if (h2hCache === null && state.authUser) {
    loadStats(); // will load h2h too
  }
  if (h2hCache && h2hCache.length > 0) {
    root.appendChild(h('div', { class: 'card' },
      h('h2', null, 'Head to Head'),
      h('table', { class: 'totals-table' },
        h('thead', null, h('tr', null,
          h('th', null, 'Player'),
          h('th', null, 'Rounds'),
          h('th', null, 'As Partner'),
          h('th', null, 'As Opp'),
          h('th', null, 'Their Net')
        )),
        h('tbody', null,
          ...h2hCache.sort((a, b) => b.rounds - a.rounds).map(opp =>
            h('tr', null,
              h('td', { style: 'text-align:left;font-size:12px;font-weight:600;' }, opp.name),
              h('td', null, String(opp.rounds)),
              h('td', null, String(opp.as_partner)),
              h('td', null, String(opp.as_opponent)),
              h('td', { class: opp.net > 0 ? 'team-a' : opp.net < 0 ? 'team-b' : '' },
                opp.net === 0 ? '—' : opp.net > 0 ? `+$${opp.net}` : `−$${Math.abs(opp.net)}`)
            )
          )
        )
      )
    ));
  }
}

// ==================== LIVE VIEW SCREEN ====================
function renderLiveView() {
  root.appendChild(h('div', { class: 'header' },
    h('div', { class: 'header-row' },
      h('button', { class: 'back-btn', onclick: () => {
        if (state.liveViewUnsubscribe) { state.liveViewUnsubscribe(); state.liveViewUnsubscribe = null; }
        if (state.liveChatHandle) { state.liveChatHandle.unsubscribe(); state.liveChatHandle = null; }
        state.liveChatMessages = [];
        state.liveViewData = null;
        state.liveViewCode = null;
        state.screen = 'home';
        render();
      } }, '← Exit'),
      h('h1', null, 'LIVE VIEW'),
      h('div', { style: 'font-size:10px;color:rgba(255,255,255,0.7);' }, state.liveViewCode || '')
    )
  ));

  if (!state.liveViewData) {
    root.appendChild(h('div', { class: 'card' },
      h('div', { class: 'empty' },
        h('div', { class: 'icon' }, '📡'),
        'Connecting to live round…')
    ));
    return;
  }

  const liveRound = state.liveViewData;
  const result = Scoring.computeRound(liveRound);
  const settlement = Scoring.settle(liveRound, result);

  const allPlayers = [...liveRound.teamA, ...liveRound.teamB];
  const tl = teamLabels(liveRound);

  // Find played holes (non-null scores)
  const playedHoleSet = [];
  for (let i = 0; i < 18; i++) {
    if (allPlayers.some(p => p.scores[i] != null)) playedHoleSet.push(i);
  }

  // Middle game tally (only played holes)
  function sumMidPlayed(pts) {
    let a = 0, b = 0;
    for (const hi of playedHoleSet) { const p = pts.points[hi]; if (p) { a += p.a; b += p.b; } }
    return { a, b };
  }
  const midTally = result.mode === '5man'
    ? { a: sumMidPlayed(result.game1).a + sumMidPlayed(result.game2).a,
        b: sumMidPlayed(result.game1).b + sumMidPlayed(result.game2).b }
    : sumMidPlayed(result);
  const tlFull = teamLabelsFull(liveRound);
  const midStr = midTally.a === midTally.b ? 'Even'
    : midTally.a > midTally.b ? `${tlFull.a} +${midTally.a - midTally.b}`
    : `${tlFull.b} +${midTally.b - midTally.a}`;
  const midClr = midTally.a > midTally.b ? 'var(--team-a)' : midTally.b > midTally.a ? 'var(--team-b)' : 'var(--muted)';

  // Top/Bottom press slash tally — shown from the LEADER'S perspective.
  // The leader is whichever team is up in the main segment of the currently
  // active nine (i.e., the nine containing the most recent played hole).
  // Values are flipped so that the leader always sees positive numbers first.
  const latestPlayed = playedHoleSet.length ? playedHoleSet[playedHoleSet.length - 1] : 0;
  const activeNineEnd = latestPlayed <= 8 ? 8 : 17;

  function liveGameView(game) {
    // Only show segments/presses for the currently active nine.
    const segs = [
      ...game.segments.filter(s => s.name !== 'Overall' && s.endHole === activeNineEnd),
      ...game.presses.filter(p => p.endHole === activeNineEnd)
    ];
    const mainSeg = segs[0]; // front or back main
    // Main-segment leader determines the perspective for the whole card.
    let ma = 0, mb = 0;
    if (mainSeg) {
      for (const p of mainSeg.points) { if (playedHoleSet.includes(p.h)) { ma += p.a; mb += p.b; } }
    }
    // Flip = true when team B leads the main (so we flip all values to B's perspective).
    const flip = mb > ma;
    const leaderTeam = ma > mb ? 'A' : mb > ma ? 'B' : null;
    const leaderName = leaderTeam === 'A' ? tl.a : leaderTeam === 'B' ? tl.b : null;
    const parts = [];
    for (const seg of segs) {
      let a = 0, b = 0;
      for (const p of seg.points) { if (playedHoleSet.includes(p.h)) { a += p.a; b += p.b; } }
      if (seg.points.filter(p => playedHoleSet.includes(p.h)).length === 0) continue;
      const diff = flip ? (b - a) : (a - b);
      parts.push(diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`);
    }
    const color = leaderTeam === 'A' ? 'var(--team-a)'
                : leaderTeam === 'B' ? 'var(--team-b)'
                : 'var(--muted)';
    return {
      str: parts.length === 0 ? 'Even' : parts.join('/'),
      leaderName,
      color
    };
  }
  function liveSlashStr(game) { return liveGameView(game).str; }
  function liveSlashClr(game) { return liveGameView(game).color; }
  const topGame = result.mode === '5man' ? result.game1.top : result.top;
  const botGame = result.mode === '5man' ? result.game1.bottom : result.bottom;
  const topView = liveGameView(topGame);
  const botView = liveGameView(botGame);

  // Banner with course name and middle game score
  root.appendChild(h('div', { class: 'result-banner' },
    h('div', { class: 'label' }, liveRound.course?.name || 'Live Round'),
    h('div', { class: 'amount' }, midStr)
  ));

  // Game tallies card — each column shows the leader's name (of the current nine)
  // and values from their perspective.
  root.appendChild(h('div', { style: 'display:flex;justify-content:space-around;padding:12px 14px;margin:0 14px 14px;background:var(--card);border-radius:var(--radius);border:1px solid var(--border-light);font-size:14px;font-weight:700;gap:8px;' },
    h('div', { style: 'text-align:center;flex:1;min-width:0;' },
      h('div', { style: 'font-size:10px;text-transform:uppercase;color:var(--muted);letter-spacing:1px;' }, 'Top'),
      topView.leaderName
        ? h('div', { style: `font-size:10px;color:${topView.color};font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;` }, topView.leaderName)
        : null,
      h('div', { style: `color:${topView.color};` }, topView.str)
    ),
    h('div', { style: 'text-align:center;flex:1;min-width:0;' },
      h('div', { style: 'font-size:10px;text-transform:uppercase;color:var(--muted);letter-spacing:1px;' }, 'Middle'),
      h('div', { style: `color:${midClr};` }, midStr)
    ),
    h('div', { style: 'text-align:center;flex:1;min-width:0;' },
      h('div', { style: 'font-size:10px;text-transform:uppercase;color:var(--muted);letter-spacing:1px;' }, 'Bottom'),
      botView.leaderName
        ? h('div', { style: `font-size:10px;color:${botView.color};font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;` }, botView.leaderName)
        : null,
      h('div', { style: `color:${botView.color};` }, botView.str)
    )
  ));

  // Cumulative running match — per-hole who's up in all 3 games (MOVED UP)
  const matchRows = [];
  for (let i = 0; i < 18; i++) {
    if (!allPlayers.some(p => p.scores[i] != null)) continue;
    const thru = Array.from({ length: i + 1 }, (_, k) => k);
    function midThru2(pts) { let a=0,b=0; for(const hi of thru){const p=pts.points[hi];if(p){a+=p.a;b+=p.b;}} return {a,b}; }
    const mt2 = result.mode==='5man'?{a:midThru2(result.game1).a+midThru2(result.game2).a,b:midThru2(result.game1).b+midThru2(result.game2).b}:midThru2(result);
    const midStr4 = mt2.a===mt2.b?'Even':mt2.a>mt2.b?`${tl.a} +${mt2.a-mt2.b}`:`${tl.b} +${mt2.b-mt2.a}`;
    const midClr4 = mt2.a>mt2.b?'var(--team-a-light)':mt2.b>mt2.a?'var(--team-b-light)':'var(--muted)';
    function slashThru2(game) {
      const nineEnd = i<=8?8:17;
      const segs=[...game.segments.filter(s=>s.name!=='Overall'&&s.endHole===nineEnd),...game.presses.filter(p=>p.endHole===nineEnd)];
      const parts=[];
      for(const seg of segs){let a=0,b=0;for(const p of seg.points){if(thru.includes(p.h)){a+=p.a;b+=p.b;}}if(seg.points.filter(p=>thru.includes(p.h)).length===0)continue;const d=a-b;parts.push(d===0?'E':d>0?`+${d}`:`${d}`);}
      return parts.length===0?'Even':parts.join('/');
    }
    function slashWho2(game) {
      const nineEnd = i<=8?8:17;
      const main=game.segments.find(s=>s.name!=='Overall'&&s.endHole===nineEnd);
      if(!main)return '';
      let a=0,b=0;for(const p of main.points){if(thru.includes(p.h)){a+=p.a;b+=p.b;}}
      return a>b?tl.a:b>a?tl.b:'';
    }
    const tg2=result.mode==='5man'?result.game1.top:result.top;
    const bg2=result.mode==='5man'?result.game1.bottom:result.bottom;
    if (i===9) matchRows.push(h('tr',{style:'background:var(--bg);'},h('td',{colspan:'4',style:'text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);font-weight:700;padding:6px;'},'— Back 9 —')));
    matchRows.push(h('tr', null,
      h('td', { style: 'font-weight:700;' }, String(i+1)),
      h('td', { style: 'text-align:left;font-size:11px;' },
        slashWho2(tg2) ? h('span',{style:'color:var(--muted);font-size:9px;'},slashWho2(tg2)+' ') : null,
        h('span',{style:'font-weight:700;'},slashThru2(tg2))
      ),
      h('td', { style: `text-align:left;font-size:11px;color:${midClr4};font-weight:700;` }, midStr4),
      h('td', { style: 'text-align:left;font-size:11px;' },
        slashWho2(bg2) ? h('span',{style:'color:var(--muted);font-size:9px;'},slashWho2(bg2)+' ') : null,
        h('span',{style:'font-weight:700;'},slashThru2(bg2))
      )
    ));
  }
  root.appendChild(h('div', { class: 'card' },
    h('h2', null, 'Match Progress'),
    h('div', { style: 'overflow-x:auto;' },
      h('table', { class: 'totals-table', style: 'font-size:12px;' },
        h('thead', null, h('tr', null,
          h('th', null, 'H'),
          h('th', { style: 'text-align:left;' }, 'Top'),
          h('th', { style: 'text-align:left;' }, 'Middle'),
          h('th', { style: 'text-align:left;' }, 'Bottom')
        )),
        h('tbody', null, ...matchRows)
      )
    )
  ));

  // Players card
  root.appendChild(h('div', { class: 'card' },
    h('h2', null, 'Players'),
    ...allPlayers.map(p => {
      const amt = settlement.perPlayer?.[p.id] || 0;
      const scored = p.scores.filter(s => s != null && s !== '');
      // Display raw gross — what the player actually entered. For X holes
      // (did-not-finish) fall back to the net-double-bogey cap since there's
      // no numeric raw value to sum.
      let gross = 0;
      for (let i = 0; i < 18; i++) {
        const raw = p.scores[i];
        if (raw == null || raw === '') continue;
        if (raw === 'X' || raw === 'x') gross += Scoring.cappedGross(liveRound, p, i);
        else gross += raw;
      }
      const holesPlayed = scored.length;
      const color = amt > 0 ? 'var(--green-light)' : amt < 0 ? 'var(--team-b)' : 'var(--muted)';
      return h('div', { class: `player-card team-${p.team.toLowerCase()}` },
        h('div', { class: 'info' },
          h('div', { class: 'name' }, p.name),
          h('div', { class: 'hcp' }, `Gross ${gross} (${holesPlayed} holes)`)
        ),
        h('div', { style: `font-size:20px;font-weight:900;color:${color};` },
          amt === 0 ? '$0' : (amt > 0 ? `+$${amt}` : `−$${Math.abs(amt)}`))
      );
    })
  ));

  // Scorecard
  const courseHoles = liveRound.course?.holes || [];
  root.appendChild(h('div', { class: 'card' },
    h('h2', null, 'Scorecard'),
    h('div', { style: 'overflow-x:auto;' },
      h('table', { class: 'totals-table', style: 'font-size:12px;' },
        h('thead', null, h('tr', null,
          h('th', null, 'H'),
          h('th', null, 'Par'),
          ...allPlayers.map(p => h('th', null, p.name.split(' ')[0]))
        )),
        h('tbody', null,
          ...Array(18).fill(0).map((_, i) => {
            const anyScored = allPlayers.some(p => p.scores[i] != null);
            if (!anyScored) return null;
            const par = courseHoles[i]?.par || 4;
            return h('tr', null,
              h('td', { style: 'font-weight:700;' }, String(i + 1)),
              h('td', null, String(par)),
              ...allPlayers.map(p => {
                const s = p.scores[i];
                if (s == null) return h('td', { style: 'color:var(--muted);' }, '–');
                if (s === 'X' || s === 'x') {
                  return h('td', { style: 'color:var(--team-b);font-weight:900;' }, 'X');
                }
                const diff = s - par;
                const color = diff < 0 ? 'var(--team-a)' : diff > 0 ? 'var(--team-b)' : '';
                const weight = diff !== 0 ? 'font-weight:700;' : '';
                return h('td', { style: `${weight}color:${color || 'inherit'};` }, String(s));
              })
            );
          }).filter(Boolean),
          // Totals row (raw gross — what was entered; X holes use the net-dbl cap)
          h('tr', { style: 'font-weight:700;background:var(--bg);' },
            h('td', null, ''),
            h('td', null, ''),
            ...allPlayers.map(p => {
              let total = 0;
              for (let i = 0; i < 18; i++) {
                const raw = p.scores[i];
                if (raw == null || raw === '') continue;
                if (raw === 'X' || raw === 'x') total += Scoring.cappedGross(liveRound, p, i);
                else total += raw;
              }
              return h('td', null, String(total));
            })
          )
        )
      )
    )
  ));

  // ====== LIVE CHAT ======
  // Auto-set chat name from profile if logged in
  if (!state.liveChatName && state.authProfile && state.authProfile.display_name) {
    state.liveChatName = state.authProfile.display_name.split(' ')[0];
  }
  const chatReady = !!state.liveChatName;

  function sendChat() {
    if (!state.liveChatInput.trim() || !state.liveChatHandle) return;
    const msg = { name: state.liveChatName, text: state.liveChatInput.trim(), ts: Date.now() };
    state.liveChatHandle.send(msg);
    state.liveChatMessages.push(msg);
    if (state.liveChatMessages.length > 100) state.liveChatMessages.shift();
    state.liveChatInput = '';
    render(true);
  }

  const chatCard = h('div', { class: 'card' },
    h('h2', null, '💬 Live Chat'),
    // Name prompt only if not logged in
    !chatReady ? h('div', { style: 'display:flex;gap:8px;margin-bottom:10px;' },
      h('input', {
        type: 'text',
        placeholder: 'Enter your name…',
        style: 'flex:1;',
        onkeydown: e => {
          if (e.key === 'Enter' && e.target.value.trim()) {
            state.liveChatName = e.target.value.trim();
            render(true);
          }
        }
      }),
      h('div', { style: 'font-size:11px;color:var(--muted);align-self:center;' }, 'Press Enter')
    ) : null,
    // Messages
    h('div', {
      id: 'chat-messages',
      style: 'max-height:250px;overflow-y:auto;border:1px solid var(--border-light);border-radius:8px;padding:8px;margin-bottom:10px;background:var(--bg);min-height:60px;'
    },
      state.liveChatMessages.length === 0
        ? h('div', { style: 'color:var(--muted);font-size:12px;text-align:center;padding:16px;' }, 'No messages yet. Be the first!')
        : h('div', null,
            ...state.liveChatMessages.map(msg => {
              const time = new Date(msg.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
              return h('div', { style: 'margin-bottom:6px;font-size:13px;line-height:1.4;' },
                h('span', { style: 'font-weight:700;color:var(--green-light);' }, msg.name),
                h('span', { style: 'color:var(--muted);font-size:10px;margin-left:6px;' }, time),
                h('div', { style: 'margin-left:2px;' }, msg.text)
              );
            })
          )
    ),
    // Input row
    chatReady ? h('div', { style: 'display:flex;gap:8px;align-items:stretch;' },
      h('input', {
        type: 'text',
        id: 'chat-input',
        placeholder: 'Type a message…',
        value: state.liveChatInput || '',
        style: 'flex:1;min-width:0;font-size:15px;padding:12px 14px;',
        oninput: e => { state.liveChatInput = e.target.value; },
        onkeydown: e => { if (e.key === 'Enter') sendChat(); }
      }),
      h('button', { class: 'btn', style: 'flex:0 0 auto;width:auto;min-width:64px;padding:0 18px;font-size:14px;margin:0;', onclick: sendChat }, 'Send')
    ) : null
  );
  root.appendChild(chatCard);

  // Auto-scroll chat to bottom
  requestAnimationFrame(() => {
    const el = document.getElementById('chat-messages');
    if (el) el.scrollTop = el.scrollHeight;
    // Restore focus to chat input after render
    if (state.liveChatName) {
      const inp = document.getElementById('chat-input');
      if (inp && document.activeElement?.tagName !== 'INPUT') inp.focus();
    }
  });

  root.appendChild(h('div', { style: 'text-align:center;padding:20px;color:var(--muted);font-size:12px;' },
    'Auto-updates every few seconds as scores are entered.'));
}

// ==================== PLAYER PICKER MODAL (round setup) ====================
// Debounced player search. The input re-renders on every keystroke, which
// previously killed focus — debouncing keeps the input responsive and only
// fires the API call after the user stops typing. Focus is restored in
// renderPlayerPickerModal after each render.
let _playerPickerSearchTimer = null;
let _playerPickerSearchSeq = 0;
function schedulePlayerPickerSearch(query) {
  state.playerPickerQuery = query || '';
  if (_playerPickerSearchTimer) clearTimeout(_playerPickerSearchTimer);
  _playerPickerSearchTimer = setTimeout(() => {
    runPlayerPickerSearch(state.playerPickerQuery);
  }, 220);
}
async function runPlayerPickerSearch(query) {
  state.playerPickerQuery = query || '';
  if (!SupabaseClient || !SupabaseClient.isConfigured()) return;
  const mySeq = ++_playerPickerSearchSeq;
  // Search all users (empty query returns all)
  const results = await SupabaseClient.searchUsersByName(query || '');
  // If a newer search has started, discard this stale result.
  if (mySeq !== _playerPickerSearchSeq) return;
  const myId = state.authUser ? state.authUser.id : null;
  const alreadyLinked = new Set(
    (newRoundDraft?.players || []).map(p => p.userId).filter(Boolean)
  );
  state.playerPickerResults = (results || []).filter(r => r.id !== myId && !alreadyLinked.has(r.id));
  render();
}

function renderPlayerPickerModal() {
  if (state.playerPickerIndex === null || state.playerPickerIndex === undefined) return null;
  const player = newRoundDraft.players[state.playerPickerIndex];
  if (!player) return null;

  const close = () => {
    state.playerPickerIndex = null;
    state.playerPickerQuery = '';
    state.playerPickerResults = null;
    state._pickerAutoLoaded = false;
    render();
  };

  const apply = (patch) => {
    Object.assign(player, patch);
    save();
    close();
  };

  const query = state.playerPickerQuery || '';

  // After the modal is mounted to the DOM, restore focus and caret position
  // so the user can keep typing without re-clicking the field on every render.
  requestAnimationFrame(() => {
    const inp = document.getElementById('player-picker-search');
    if (inp && document.activeElement !== inp) {
      inp.focus();
      const pos = state._pickerCaret != null ? state._pickerCaret : (inp.value ? inp.value.length : 0);
      try { inp.setSelectionRange(pos, pos); } catch (_) {}
    }
  });

  return h('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === e.currentTarget) close(); } },
    h('div', { class: 'modal-card' },
      h('div', { class: 'modal-header' },
        h('h2', null, `Player ${state.playerPickerIndex + 1}`),
        h('button', { class: 'modal-close', onclick: close }, '×')
      ),
      state.authUser
        ? h('div', null,
            h('div', { class: 'field' },
              h('label', null, 'Search by name or email'),
              h('input', {
                id: 'player-picker-search',
                type: 'text',
                value: query,
                placeholder: 'Type to filter…',
                oninput: e => {
                  // Remember caret so focus restoration can put it back.
                  state._pickerCaret = e.target.selectionStart;
                  schedulePlayerPickerSearch(e.target.value);
                }
              })
            ),
            // Auto-load all players on first open
            (() => {
              if (!state._pickerAutoLoaded) {
                state._pickerAutoLoaded = true;
                runPlayerPickerSearch('');
              }
              return null;
            })(),
            // Show all players
            state.playerPickerResults && state.playerPickerResults.length > 0
              ? h('div', null,
                  ...state.playerPickerResults.map(u => {
                    const label = u.display_name || u.email || '(no name)';
                    return h('div', { class: 'list-item',
                      onclick: () => apply({ name: label, userId: u.id, invitedEmail: null, handicap: u.handicap || 0 })
                    },
                      h('div', null,
                        h('div', { class: 'main' }, label),
                        h('div', { class: 'sub' }, `Hcp ${u.handicap ?? 0}${u.email && u.display_name ? ' · ' + u.email : ''}`)
                      ),
                      h('span', { class: 'tag a' }, 'Link')
                    );
                  })
                )
              : (state._pickerAutoLoaded ? h('div', { style: 'color:var(--muted);padding:12px;text-align:center;' }, 'No players found.') : null)
          )
        : h('div', { class: 'warning' }, 'Sign in to link players.'),
      h('h3', { style: 'margin-top:14px;' }, 'Or enter as Guest'),
      h('div', { class: 'field' },
        h('input', {
          type: 'text',
          value: player.name || '',
          placeholder: `Player ${state.playerPickerIndex + 1}`,
          oninput: e => { player.name = e.target.value; }
        })
      ),
      h('button', { class: 'btn secondary', onclick: () => {
        apply({ userId: null, invitedEmail: null });
      } }, 'Use as Guest')
    )
  );
}

// ---------- Init ----------
async function init() {
  load();
  if (!state.courses || state.courses.length === 0) {
    state.courses = COURSE_PRESETS.map(courseFromPreset);
  } else {
    // Auto-import any new presets that aren't in the user's list yet
    for (const preset of COURSE_PRESETS) {
      if (!state.courses.some(c => c.name === preset.name)) {
        state.courses.push(courseFromPreset(preset));
      }
    }
    // Sort alphabetically
    state.courses.sort((a, b) => a.name.localeCompare(b.name));
  }
  render();

  // Check for ?live=CODE in URL — open live viewer
  const urlParams = new URLSearchParams(window.location.search);
  const liveCode = urlParams.get('live');
  if (liveCode) {
    state.liveViewCode = liveCode;
    state.screen = 'liveView';
    render();
  }

  // Initialize Supabase if credentials are set
  if (typeof SupabaseClient !== 'undefined') {
    SupabaseClient.onAuthChange((user, profile) => {
      state.authUser = user;
      state.authProfile = profile;
      if (user && state.screen === 'login') {
        state.screen = 'account';
      }
      save();
      render();
    });
    try {
      const result = await SupabaseClient.init();
      if (result && result.hadAuthInUrl && result.session) {
        state.screen = 'account';
        render();
      }
      // Merge cloud courses with local presets
      try {
        const dbCourses = await SupabaseClient.loadCourses();
        if (dbCourses && dbCourses.length > 0) {
          for (const dc of dbCourses) {
            const existing = state.courses.find(c => c.name === dc.name);
            if (existing) {
              // Update pars and SI from DB
              if (dc.pars && dc.pars.length > 0) {
                existing.holes = dc.pars.map((par, i) => ({ par, si: dc.si ? dc.si[i] : (existing.holes[i]?.si || (i + 1)) }));
              }
              // Update tees from DB if they have ratings
              if (dc.tees && dc.tees.length > 0) {
                existing.tees = dc.tees.map(t => typeof t === 'string' ? { name: t, si: null, rating: null } : { name: t.name, si: t.si || null, rating: t.rating || null });
              }
            } else {
              // Add new course from DB
              const newCourse = {
                id: uid(),
                name: dc.name,
                holes: dc.pars ? dc.pars.map((par, i) => ({ par, si: dc.si ? dc.si[i] : (i + 1) })) : DEFAULT_PARS.map((par, i) => ({ par, si: DEFAULT_SI[i] })),
                tees: (dc.tees || []).map(t => typeof t === 'string' ? { name: t, si: null, rating: null } : { name: t.name, si: t.si || null, rating: t.rating || null })
              };
              if (newCourse.tees.length === 0) newCourse.tees = defaultTeesList();
              state.courses.push(newCourse);
            }
          }
          save();
          render();
        }
      } catch (e) { console.warn('Course sync failed:', e); }
      if (state.liveViewCode) {
        state.liveViewUnsubscribe = await SupabaseClient.subscribeToLiveShare(
          state.liveViewCode,
          (shareRow) => {
            if (shareRow && shareRow.data) {
              state.liveViewData = shareRow.data;
              render(true);
            }
          }
        );
        // Subscribe to live chat
        state.liveChatMessages = [];
        state.liveChatHandle = SupabaseClient.subscribeLiveChat(state.liveViewCode, (msg) => {
          state.liveChatMessages.push(msg);
          if (state.liveChatMessages.length > 100) state.liveChatMessages.shift();
          render(true);
        });
      }
    } catch (e) {
      console.warn('Supabase init failed:', e);
    }
  }
}

init();
return { state };
})();
