// ==================== SCOTCH APP UI ====================
const App = (() => {

const STORAGE_KEY = 'scotch_v1';
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
  // Friends state
  friendsList: null,          // cached friends
  friendsSearchQuery: '',
  friendsSearchResults: null,
  // Player picker modal
  playerPickerIndex: null,    // index into newRoundDraft.players currently being edited
  playerPickerQuery: '',
  playerPickerResults: null,
  // Live share
  liveShareCode: null,
  liveShareUrl: null,
  liveViewData: null,
  liveViewCode: null,
  liveViewUnsubscribe: null
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
}

// Look up a tee by name on a course. Returns { name, si } or null.
function findTee(course, teeName) {
  if (!course || !Array.isArray(course.tees)) return null;
  return course.tees.find(t => t.name === teeName) || null;
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
    name: 'Panther National',
    pars: [4,3,5,4,4,4,5,3,4, 4,5,4,3,4,4,3,4,5],
    si:   [15,11,9,1,5,13,7,17,3, 10,4,8,16,2,14,18,12,6]
  },
  {
    name: 'Boca Rio GC',
    pars: [5,4,3,4,4,3,4,5,4, 5,4,4,3,4,4,5,3,4],
    si:   [11,3,17,13,7,15,1,5,9, 10,4,14,18,6,2,12,16,8]
  },
  {
    name: 'Mizner CC',
    pars: [4,4,5,4,3,4,5,4,3, 4,4,4,3,4,5,5,3,4],
    si:   [7,1,11,15,9,3,5,17,13, 16,2,4,18,8,14,10,6,12]
  },
  {
    name: 'Boca Grove',
    pars: [4,5,3,4,4,4,5,3,4, 4,4,5,3,4,3,3,4,5],
    si:   [13,5,15,1,9,17,7,11,3, 4,12,6,14,2,18,16,8,10]
  },
  {
    name: 'Delaire CC — Lakes/Hills',
    pars: [4,5,4,3,4,5,3,4,4, 5,3,5,4,3,4,4,4,4],
    si:   [11,7,3,15,9,1,17,13,5, 10,16,4,14,18,2,6,12,8]
  },
  {
    name: 'Delaire CC — Hills/Woods',
    pars: [5,3,5,4,3,4,4,4,4, 4,5,3,4,5,4,3,4,4],
    si:   [9,15,3,13,17,1,5,11,7, 4,8,16,2,12,14,18,10,6]
  },
  {
    name: 'Delaire CC — Woods/Lakes',
    pars: [4,5,3,4,5,4,3,4,4, 4,5,4,3,4,5,3,4,4],
    si:   [3,7,15,1,11,13,17,9,5, 12,8,4,16,10,2,18,14,6]
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
      scores: pars.slice(),
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
// Returns first names joined by "/" for display, e.g. "Kyle/Jordan"
function teamLabel(players) {
  if (!players || players.length === 0) return '?';
  return players.map(p => (p.name || '?').split(' ')[0]).join('/');
}
function teamLabels(round) {
  return {
    a: teamLabel(round.teamA),
    b: teamLabel(round.teamB)
  };
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
  else if (state.screen === 'round') renderRound();
  else if (state.screen === 'summary') renderSummary();
  else if (state.screen === 'login') renderLogin();
  else if (state.screen === 'account') renderAccount();
  else if (state.screen === 'history') renderHistory();
  else if (state.screen === 'stats') renderStats();
  else if (state.screen === 'friends') renderFriends();
  else if (state.screen === 'liveView') renderLiveView();
  // Restore scroll position when re-rendering the same screen
  if (preserveScroll) requestAnimationFrame(() => window.scrollTo(0, scrollY));
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
  root.appendChild(h('div', { class: 'header' },
    h('div', { class: 'header-row' },
      h('button', { class: 'back-btn', onclick: () => { newRoundDraft = null; state.screen = 'home'; render(); } }, '← Back'),
      h('h1', null, 'New Round'),
      h('span', { style: 'width:50px;' })
    )
  ));

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
          onchange: e => { newRoundDraft.courseId = e.target.value; }
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
          suggestions = state._allProfiles
            .filter(pr => pr.display_name.toLowerCase().includes(nameVal.toLowerCase()) && !alreadyLinked.has(pr.id))
            .slice(0, 5);
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
                      oninput: e => { p.name = e.target.value; render(true); }
                    }),
                    suggestions.length > 0
                      ? h('div', { style: 'position:absolute;left:0;right:0;top:100%;z-index:50;background:white;border:1px solid var(--border);border-radius:0 0 var(--radius) var(--radius);box-shadow:var(--shadow-md);max-height:200px;overflow-y:auto;' },
                          ...suggestions.map(s => h('div', {
                            style: 'padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border-light);font-size:14px;',
                            onclick: () => {
                              p.name = s.display_name;
                              p.userId = s.id;
                              p.handicap = s.handicap || 0;
                              render(true);
                            }
                          },
                            h('strong', null, s.display_name),
                            h('span', { style: 'color:var(--muted);margin-left:8px;font-size:12px;' }, `Hcp ${s.handicap ?? 0}`)
                          ))
                        )
                      : null
                  )
            ),
          h('div', { class: 'field-row' },
            h('div', { class: 'field', style: 'flex:0 0 70px;' },
              h('label', null, 'Handicap'),
              h('input', { type: 'number', value: p.handicap === '' || p.handicap == null ? '' : p.handicap,
                min: 0, max: 54, placeholder: '0',
                oninput: e => {
                  const v = e.target.value;
                  p.handicap = v === '' ? '' : (parseInt(v) || 0);
                } })
            ),
            h('div', { class: 'field', style: 'flex:1;min-width:0;' },
              h('label', null, 'Team'),
              h('select', { style: 'width:100%;', onchange: e => { p.team = e.target.value; render(); } },
                h('option', { value: 'A', ...(p.team === 'A' ? { selected: 'selected' } : {}) }, 'Team A'),
                h('option', { value: 'B', ...(p.team === 'B' ? { selected: 'selected' } : {}) }, 'Team B')
              )
            ),
            h('div', { class: 'field', style: 'flex:1.3;min-width:0;' },
              h('label', null, 'Stake'),
              h('select', { style: 'width:100%;', onchange: e => { p.stake = e.target.value; } },
                h('option', { value: 'full', ...(p.stake === 'full' ? { selected: 'selected' } : {}) }, 'Full ($100)'),
                h('option', { value: 'half', ...(p.stake === 'half' ? { selected: 'selected' } : {}) }, 'Half ($50)')
              )
            )
          ),
          h('div', { class: 'field', style: 'margin-top:6px;' },
            h('label', null, 'Tees'),
            (() => {
              const course = state.courses.find(c => c.id === newRoundDraft.courseId);
              const tees = (course && course.tees) || [];
              // Default this player's tees to first option if not set
              if (!p.tees && tees.length > 0) p.tees = tees[0].name;
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

  // Start button
  root.appendChild(h('div', { class: 'card' },
    h('button', { class: 'btn gold', onclick: () => {
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
      state.currentHoleIdx = newRoundDraft.startNine === 'back' ? 9 : 0;
      state.screen = 'round';
      newRoundDraft = null;
      render();
    }}, 'Start Round')
  ));

  // Player picker modal (only renders when playerPickerIndex is set)
  const modal = renderPlayerPickerModal();
  if (modal) root.appendChild(modal);
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
          const share = await SupabaseClient.createLiveShare(r.id);
          if (share) {
            state.liveShareCode = share.code;
            state.liveShareUrl = `${location.origin}${location.pathname}?live=${share.code}`;
            // Push initial state
            await SupabaseClient.updateLiveShare(share.code, r);
            render();
          }
        }
      }, state.liveShareCode ? '📡 Copy Link' : '📡 Share')
    : null;

  root.appendChild(h('div', { class: 'header' },
    h('div', { class: 'header-row' },
      h('button', { class: 'back-btn', onclick: () => { state.screen = 'home'; render(); } }, '← Home'),
      h('div', null,
        h('h1', null, r.course.name),
        h('div', { class: 'sub' }, `${r.teamA.map(p=>p.name).join(' / ')} vs ${r.teamB.map(p=>p.name).join(' / ')}`)
      ),
      h('div', { style: 'display:flex;gap:4px;' },
        liveBtn,
        h('button', { class: 'back-btn', onclick: () => { state.screen = 'summary'; render(); } }, 'Σ')
      )
    )
  ));

  // Compute running tally — only count holes up to current one in play order
  const playedHoles = (r.startNine === 'back'
    ? [9,10,11,12,13,14,15,16,17, 0,1,2,3,4,5,6,7,8]
    : [0,1,2,3,4,5,6,7,8, 9,10,11,12,13,14,15,16,17]
  ).slice(0, (r.startNine === 'back'
    ? [9,10,11,12,13,14,15,16,17,0,1,2,3,4,5,6,7,8]
    : [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17]
  ).indexOf(hIdx) + 1);
  function sumPlayedPoints(pts) {
    let a = 0, b = 0;
    for (const hi of playedHoles) {
      const p = pts.points[hi];
      if (p) { a += p.a; b += p.b; }
    }
    return { a, b };
  }
  const runTotals = result.mode === '5man'
    ? { a: sumPlayedPoints(result.game1).a + sumPlayedPoints(result.game2).a,
        b: sumPlayedPoints(result.game1).b + sumPlayedPoints(result.game2).b }
    : sumPlayedPoints(result);
  const runA = runTotals.a;
  const runB = runTotals.b;
  const tally = teamLabels(r);
  const tallyText = runA === runB ? 'Even'
    : runA > runB ? `${tally.a} +${runA - runB}`
    : `${tally.b} +${runB - runA}`;
  const tallyColor = runA > runB ? 'var(--team-a)' : runB > runA ? 'var(--team-b)' : 'rgba(255,255,255,0.7)';

  // Hole header
  root.appendChild(h('div', { class: 'hole-header' },
    h('div', { class: 'hole-number' }, String(hIdx + 1)),
    h('div', { style: 'font-size:13px;font-weight:700;color:rgba(255,255,255,0.85);margin-top:4px;letter-spacing:0.5px;' },
      `${runA} – ${runB}`),
    h('div', { class: 'hole-info' },
      h('span', null, 'PAR ', h('strong', null, String(hole.par))),
      h('span', null, 'HCP ', h('strong', null, String(hole.si)))
    )
  ));

  // Turn prompt: for each indy pairing, ask for back-9-bet choice when starting second nine
  // front-first: shows on H10 (hIdx === 9); back-first: shows on H1 (hIdx === 0)
  const turnHoleIdx = r.startNine === 'back' ? 0 : 9;
  if (hIdx === turnHoleIdx) {
    const prompts = buildIndyBackPrompts(r);
    if (prompts.length > 0) {
      root.appendChild(h('div', { class: 'card', style: 'border:2px solid var(--gold);' },
        h('h2', null, 'Back 9 — Individual Matches'),
        h('div', { style: 'font-size:12px;color:var(--muted);margin-bottom:10px;' },
          'Set the back-9 choice for each individual match.'),
        ...prompts.map(pr => {
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
    if (bd.keepTake) chips.push(bd.keepTake);
    if (bd.blitz) chips.push(`BLITZ ×2 →${bd.blitz}`);
    if (bd.roll && bd.roll > 1) chips.push(`ROLL ×${bd.roll}`);
    if (bd.playhoused) chips.push(`PLAYHOUSE ×2`);

    // Top / Bottom per-hole results
    const topEntry    = holePointsIn(g.sub.top, hIdx);
    const bottomEntry = holePointsIn(g.sub.bottom, hIdx);

    // In 5-man, show only the 2 players actually in this sub-game
    const tl = g.subRound ? teamLabels(g.subRound) : teamLabels(r);
    root.appendChild(h('div', { class: 'card' },
      h('h2', null, g.label ? `${g.label} — Hole Points` : 'Hole Points'),
      h('div', { style: 'display:flex;justify-content:space-around;text-align:center;padding:8px 0;' },
        h('div', null,
          h('div', { style: 'font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;font-weight:700;' }, tl.a),
          h('div', { style: `font-size:36px;font-weight:900;color:${winner==='A'?'var(--team-a)':'var(--muted)'};font-feature-settings:"tnum";` }, String(hp.a))
        ),
        h('div', null,
          h('div', { style: 'font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;font-weight:700;' }, tl.b),
          h('div', { style: `font-size:36px;font-weight:900;color:${winner==='B'?'var(--team-b)':'var(--muted)'};font-feature-settings:"tnum";` }, String(hp.b))
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

  // Running game tally
  root.appendChild(h('div', { style: 'text-align:center;padding:8px 14px;margin:0 14px;background:var(--card);border-radius:var(--radius);border:1px solid var(--border-light);font-size:13px;font-weight:700;' },
    h('span', { style: `color:${tallyColor};` }, `Middle: ${runA} – ${runB}`),
    h('span', { style: 'color:var(--muted);margin:0 8px;' }, '·'),
    h('span', { style: 'color:var(--muted);' }, tallyText)
  ));

  // Bottom nav — respects startNine play order
  // Play order: front-first = 0..17 normal; back-first = 9..17 then 0..8
  const playOrder = r.startNine === 'back'
    ? [9,10,11,12,13,14,15,16,17, 0,1,2,3,4,5,6,7,8]
    : [0,1,2,3,4,5,6,7,8, 9,10,11,12,13,14,15,16,17];
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
  return h('div', { class: 'score-grid' },
    h('div', null,
      h('div', { class: 'pname' }, player.name),
      h('div', null,
        h('span', { class: 'pteam' }, `Team ${team}`),
        strokes > 0 ? h('span', { class: 'strokes' }, ` • ${'●'.repeat(strokes)}`) : null
      )
    ),
    h('div', { class: 'stepper' },
      h('button', { onclick: () => {
        const par = round.course.holes[hIdx].par;
        const cur = player.scores[hIdx] == null ? par : player.scores[hIdx];
        player.scores[hIdx] = Math.max(1, cur - 1);
        render(true);
      }}, '−'),
      h('div', { class: 'val' }, String(val == null ? round.course.holes[hIdx].par : val)),
      h('button', { onclick: () => {
        const par = round.course.holes[hIdx].par;
        const cur = player.scores[hIdx] == null ? par : player.scores[hIdx];
        player.scores[hIdx] = cur + 1;
        render(true);
      }}, '+')
    )
  );
}

// ---------- Summary / Settlement ----------
function renderSummary() {
  const r = state.round;
  if (!r) { state.screen = 'home'; return render(); }
  const result = Scoring.computeRound(r);
  const settlement = Scoring.settle(r, result);

  // Cloud sync: only save when round is complete (came from Finish button, not mid-round Σ)
  if (!r.cloudSavedId && r.roundComplete && typeof SupabaseClient !== 'undefined' && SupabaseClient.isConfigured() && state.authUser) {
    r.cloudSavedId = 'pending';
    SupabaseClient.saveRound(r, { ...settlement, perPlayer: settlement.perPlayer })
      .then(row => {
        if (row) {
          r.cloudSavedId = row.id;
          // Invalidate caches so next visit reloads
          historyCache = null;
          statsCache = null;
          save();
        }
      })
      .catch(err => {
        console.warn('Round save failed:', err);
        r.cloudSavedId = null;
      });
  }

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
      badges.push(p.stake === 'full' ? 'Full' : 'Half');
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
    root.appendChild(h('div', { class: 'card' },
      h('h2', null, 'Individual Matches'),
      h('div', { style: 'font-size:12px;color:var(--muted);margin-bottom:8px;' },
        'Net Nassau front/back/total. Flat $100 per segment (full) or $50 (half). No presses.'),
      h('table', { class: 'totals-table' },
        h('thead', null,
          h('tr', null,
            h('th', null, 'Matchup'),
            h('th', null, 'F'),
            h('th', null, 'B'),
            h('th', null, 'Tot'),
            h('th', null, '$')
          )
        ),
        h('tbody', null,
          ...settlement.indy.map(m => {
            const sign = (d) => d > 0 ? 'A' : d < 0 ? 'B' : '—';
            const amt = m.aAmount;
            const txt = amt === 0 ? '—' : (amt > 0 ? `+$${amt} A` : `+$${Math.abs(amt)} B`);
            return h('tr', null,
              h('td', { style: 'font-size:11px;' }, `${m.aName} vs ${m.bName}`),
              h('td', { class: m.frontDiff > 0 ? 'team-a' : m.frontDiff < 0 ? 'team-b' : '' }, sign(m.frontDiff)),
              h('td', { class: m.backDiff  > 0 ? 'team-a' : m.backDiff  < 0 ? 'team-b' : '' }, sign(m.backDiff)),
              h('td', { class: m.totalDiff > 0 ? 'team-a' : m.totalDiff < 0 ? 'team-b' : '' }, sign(m.totalDiff)),
              h('td', { style: 'font-size:11px;' }, txt)
            );
          })
        )
      )
    ));
  }

  // Team totals banner (using adjusted numbers that include golf fees)
  const stl = teamLabels(r);
  const teamA$ = r.teamA.reduce((s, p) => s + (adjustedPerPlayer[p.id] || 0), 0);
  root.appendChild(h('div', { class: 'card', style: 'background:var(--green);color:white;' },
    h('h2', { style: 'color:white;' }, 'Team Totals'),
    h('div', { style: 'text-align:center;padding:12px 0;' },
      h('div', { style: 'font-size:36px;font-weight:800;' },
        teamA$ === 0 ? 'Even' : (teamA$ > 0 ? `${stl.a} +$${teamA$}` : `${stl.b} +$${Math.abs(teamA$)}`)
      )
    )
  ));

  // Player scores card (gross + net totals for each player)
  root.appendChild(h('div', { class: 'card' },
    h('h2', null, 'Player Scores'),
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
          const scored = p.scores.filter(s => s != null);
          const gross = scored.reduce((a, b) => a + b, 0);
          let netTotal = 0;
          for (let i = 0; i < 18; i++) {
            if (p.scores[i] == null) continue;
            const si = r.course.holes[i].si;
            netTotal += p.scores[i] - Scoring.strokesOnHole(r.baseStrokes[p.id] || 0, si);
          }
          const amt = adjustedPerPlayer[p.id] || 0;
          const cls = amt > 0 ? 'team-a' : amt < 0 ? 'team-b' : '';
          const txt = amt === 0 ? '$0' : (amt > 0 ? `+$${amt}` : `−$${Math.abs(amt)}`);
          return h('tr', null,
            h('td', { style: 'font-weight:600;font-size:13px;' }, p.name),
            h('td', null, String(gross)),
            h('td', null, String(netTotal)),
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
    h('button', { class: 'btn danger', style: 'margin-top:10px;', onclick: () => {
      if (confirm('End round and clear?')) {
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
    const gross = p.scores.reduce((a, b) => a + (b || 0), 0);
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
function buildIndyBackPrompts(round) {
  const prompts = [];
  // Determine the "first nine" in play order — that's what we check for scoring complete.
  const firstNineIdxs = round.startNine === 'back'
    ? [9,10,11,12,13,14,15,16,17]
    : [0,1,2,3,4,5,6,7,8];
  for (const pa of round.teamA) {
    for (const pb of round.teamB) {
      const firstNineDone = firstNineIdxs.every(i => pa.scores[i] != null && pb.scores[i] != null);
      if (!firstNineDone) continue;
      const match = Scoring.computeIndyMatch(round, pa, pb);
      // "front diff" in this context = diff after the FIRST nine played
      const diff = round.startNine === 'back' ? match.backDiff : match.frontDiff;
      const state = diff === 0 ? 'tied' : 'decided';
      const leaderName = diff > 0 ? pa.name : diff < 0 ? pb.name : null;
      const trailingName = diff > 0 ? pb.name : diff < 0 ? pa.name : null;
      prompts.push({
        key: Scoring.indyKey(pa.id, pb.id),
        aName: pa.name,
        bName: pb.name,
        state,
        frontDiff: diff,
        leaderName,
        trailingName
      });
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
            oninput: e => {
              const v = e.target.value;
              if (v === '') delete r.golfFees[p.id];
              else r.golfFees[p.id] = Number(v) || 0;
              save();
              render();
            }
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
          if (p.breakdown.keepTake) notes.push(p.breakdown.keepTake);
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
  const summary = h('div', { class: 'games-summary' },
    h('span', { class: 'team-a-color' }, `A ${wins.aWins}`),
    h('span', { class: 'dash' }, '·'),
    h('span', { class: 'team-b-color' }, `B ${wins.bWins}`),
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
  const summary = h('div', { class: 'games-summary' },
    h('span', { class: 'team-a-color' }, `A ${wins.aWins}`),
    h('span', { class: 'dash' }, '·'),
    h('span', { class: 'team-b-color' }, `B ${wins.bWins}`),
    h('span', { class: 'muted' }, `of ${wins.total} segments`)
  );
  return collapsibleCard('bottom', 'Bottom Game — Net Nassau', summary, () => {
    const frontMain = pts.bottom.segments.find(s => s.name === 'Front');
    const backMain = pts.bottom.segments.find(s => s.name === 'Back');
    const overall = pts.bottom.segments.find(s => s.name === 'Overall');
    const frontPresses = pts.bottom.presses.filter(p => p.endHole === 8);
    const backPresses = pts.bottom.presses.filter(p => p.endHole === 17);
    return [
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

  root.appendChild(h('div', { class: 'card' },
    h('h2', null, 'Profile'),
    h('div', { style: 'font-size:16px;font-weight:700;' }, profile?.display_name || user.email),
    h('div', { style: 'font-size:13px;color:var(--muted);margin-top:2px;' }, user.email),
    h('div', { style: 'font-size:12px;color:var(--muted);margin-top:6px;' }, `Handicap: ${profile?.handicap ?? 0}`),
    h('button', { class: 'btn secondary', style: 'margin-top:16px;',
      onclick: () => { state.screen = 'history'; render(); } }, 'Round History'),
    h('button', { class: 'btn secondary', style: 'margin-top:8px;',
      onclick: () => { state.screen = 'stats'; render(); } }, 'Lifetime Stats'),
    h('button', { class: 'btn danger', style: 'margin-top:16px;', onclick: async () => {
      await SupabaseClient.signOut();
      state.screen = 'home';
      render();
    }}, 'Sign Out')
  ));
}

// ==================== HISTORY SCREEN ====================
let historyCache = null;
async function loadHistory() {
  if (!SupabaseClient || !SupabaseClient.isConfigured() || !state.authUser) return [];
  historyCache = await SupabaseClient.listMyRounds();
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
  statsCache = await SupabaseClient.getMyStats();
  h2hCache = await SupabaseClient.getHeadToHead();
  render();
}
function renderStats() {
  root.appendChild(h('div', { class: 'header' },
    h('div', { class: 'header-row' },
      h('button', { class: 'back-btn', onclick: () => { state.screen = 'account'; render(); } }, '← Back'),
      h('h1', null, 'LIFETIME STATS'),
      h('span', { style: 'width:50px;' })
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
  const s = statsCache;
  const netColor = s.netTotal > 0 ? 'var(--green-light)' : s.netTotal < 0 ? 'var(--team-b)' : 'var(--muted)';
  root.appendChild(h('div', { class: 'result-banner' },
    h('div', { class: 'label' }, 'Lifetime Net'),
    h('div', { class: 'amount', style: `color:${s.netTotal < 0 ? '#ffb3ad' : 'white'};` },
      s.netTotal === 0 ? 'Even' : s.netTotal > 0 ? `+$${s.netTotal}` : `−$${Math.abs(s.netTotal)}`
    )
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

  // Show a simplified live view: player scores, current hole, running points
  const allPlayers = [...liveRound.teamA, ...liveRound.teamB];
  const completedHoles = allPlayers[0] ? allPlayers[0].scores.filter(s => s != null && s !== liveRound.course?.holes?.[0]?.par).length : 0;
  const ptsA = result.mode === '5man'
    ? (result.game1.pointsTotal.a + result.game2.pointsTotal.a)
    : result.pointsTotal.a;
  const ptsB = result.mode === '5man'
    ? (result.game1.pointsTotal.b + result.game2.pointsTotal.b)
    : result.pointsTotal.b;

  root.appendChild(h('div', { class: 'result-banner' },
    h('div', { class: 'label' }, liveRound.course?.name || 'Live Round'),
    h('div', { class: 'amount' },
      `${ptsA} – ${ptsB}`)
  ));

  root.appendChild(h('div', { class: 'card' },
    h('h2', null, 'Players'),
    ...allPlayers.map(p => {
      const amt = settlement.perPlayer?.[p.id] || 0;
      const gross = p.scores.reduce((a, b) => a + (b || 0), 0);
      const color = amt > 0 ? 'var(--green-light)' : amt < 0 ? 'var(--team-b)' : 'var(--muted)';
      return h('div', { class: `player-card team-${p.team.toLowerCase()}` },
        h('div', { class: 'info' },
          h('div', { class: 'name' }, p.name),
          h('div', { class: 'hcp' }, `Team ${p.team} · Gross ${gross}`)
        ),
        h('div', { style: `font-size:20px;font-weight:900;color:${color};` },
          amt === 0 ? '$0' : (amt > 0 ? `+$${amt}` : `−$${Math.abs(amt)}`))
      );
    })
  ));

  root.appendChild(h('div', { style: 'text-align:center;padding:20px;color:var(--muted);font-size:12px;' },
    'Auto-updates every few seconds as scores are entered.'));
}

// ==================== FRIENDS SCREEN ====================
async function loadFriends() {
  if (!SupabaseClient || !SupabaseClient.isConfigured() || !state.authUser) return;
  state.friendsList = await SupabaseClient.getFriends();
  render();
}

async function runFriendsSearch(query) {
  state.friendsSearchQuery = query;
  if (!query || query.trim().length < 2) {
    state.friendsSearchResults = null;
    render();
    return;
  }
  const results = await SupabaseClient.searchUsersByName(query.trim());
  // Filter out self and existing friends
  const myId = state.authUser.id;
  const friendIds = new Set((state.friendsList || []).map(f => f.id));
  state.friendsSearchResults = results.filter(r => r.id !== myId && !friendIds.has(r.id));
  render();
}

function renderFriends() {
  root.appendChild(h('div', { class: 'header' },
    h('div', { class: 'header-row' },
      h('button', { class: 'back-btn', onclick: () => {
        state.friendsSearchQuery = '';
        state.friendsSearchResults = null;
        state.screen = 'account';
        render();
      } }, '← Back'),
      h('h1', null, 'FRIENDS'),
      h('span', { style: 'width:50px;' })
    )
  ));

  if (!state.authUser) {
    root.appendChild(h('div', { class: 'card' },
      h('div', { class: 'empty' }, 'Sign in to manage friends.')
    ));
    return;
  }

  if (state.friendsList === null) {
    root.appendChild(h('div', { class: 'card' }, h('div', { class: 'empty' }, 'Loading…')));
    loadFriends();
    return;
  }

  // Search box
  root.appendChild(h('div', { class: 'card' },
    h('h2', null, 'Add a Friend'),
    h('div', { style: 'font-size:12px;color:var(--muted);margin-bottom:10px;' },
      'Search for other registered users by name.'),
    h('div', { class: 'field' },
      h('input', {
        type: 'text',
        value: state.friendsSearchQuery,
        placeholder: 'Type a name…',
        oninput: e => { runFriendsSearch(e.target.value); }
      })
    ),
    state.friendsSearchResults && state.friendsSearchResults.length > 0
      ? h('div', null,
          ...state.friendsSearchResults.map(u => h('div', { class: 'list-item' },
            h('div', null,
              h('div', { class: 'main' }, u.display_name),
              h('div', { class: 'sub' }, `Hcp ${u.handicap ?? 0}`)
            ),
            h('button', { class: 'btn btn-sm', style: 'width:auto;', onclick: async () => {
              await SupabaseClient.addFriend(u.id);
              state.friendsList = null;
              state.friendsSearchQuery = '';
              state.friendsSearchResults = null;
              await loadFriends();
            }}, '+ Add')
          ))
        )
      : (state.friendsSearchQuery && state.friendsSearchQuery.length >= 2
          ? h('div', { class: 'empty', style: 'padding:20px;' }, 'No users found.')
          : null)
  ));

  // Friends list
  root.appendChild(h('div', { class: 'card' },
    h('h2', null, `My Friends (${state.friendsList.length})`),
    state.friendsList.length === 0
      ? h('div', { class: 'empty' },
          h('div', { class: 'icon' }, '👥'),
          'No friends yet. Search above to add one.')
      : h('div', null,
          ...state.friendsList.map(f => h('div', { class: 'list-item' },
            h('div', null,
              h('div', { class: 'main' }, f.display_name),
              h('div', { class: 'sub' }, `Hcp ${f.handicap ?? 0} · ${f.email || ''}`)
            )
          ))
        )
  ));
}

// ==================== PLAYER PICKER MODAL (round setup) ====================
async function runPlayerPickerSearch(query) {
  state.playerPickerQuery = query || '';
  if (!SupabaseClient || !SupabaseClient.isConfigured()) return;
  // Search all users (empty query returns all)
  const results = await SupabaseClient.searchUsersByName(query || '');
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
                type: 'text',
                value: query,
                placeholder: 'Type to filter…',
                oninput: e => {
                  state.playerPickerQuery = e.target.value;
                  runPlayerPickerSearch(e.target.value);
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
                  ...state.playerPickerResults.map(u => h('div', { class: 'list-item',
                    onclick: () => apply({ name: u.display_name, userId: u.id, invitedEmail: null, handicap: u.handicap || 0 })
                  },
                    h('div', null,
                      h('div', { class: 'main' }, u.display_name),
                      h('div', { class: 'sub' }, `Hcp ${u.handicap ?? 0}`)
                    ),
                    h('span', { class: 'tag a' }, 'Link')
                  ))
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
              render();
            }
          }
        );
      }
    } catch (e) {
      console.warn('Supabase init failed:', e);
    }
  }
}

init();
return { state };
})();
