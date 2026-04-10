// ==================== SCOTCH SCORING ENGINE ====================
// Pure functions. Takes round state, returns computed totals.

const Scoring = (() => {

  // ---------- Handicap allocation (full hcp off lowest) ----------
  // strokesForPlayer: given a player's course handicap minus the lowest,
  // allocate strokes across holes by stroke index (SI 1 = hardest).
  function strokesOnHole(playerStrokes, holeSI) {
    if (playerStrokes <= 0) return 0;
    let s = 0;
    if (holeSI <= playerStrokes) s += 1;
    if (holeSI <= playerStrokes - 18) s += 1; // doubles for >18 hcp diffs
    return s;
  }

  function netScore(gross, strokes) {
    if (gross == null || gross === '') return null;
    return gross - strokes;
  }

  // ---------- Net Double Bogey cap ----------
  // USGA rule: the maximum gross score for scoring purposes is net double bogey
  // — par + 2 + handicap strokes received on that hole. Anything above the cap
  // gets adjusted down. We use this cap everywhere scores feed the game
  // (middle / top / bottom / indy matches) and also when we report the player's
  // gross totals so the reported number always matches what the bet used.
  function cappedGross(round, player, holeIdx) {
    const g = player.scores[holeIdx];
    if (g == null || g === '') return null;
    const par = round.course.holes[holeIdx].par;
    const si  = playerSI(round, player, holeIdx);
    const strokes = strokesOnHole(round.baseStrokes[player.id] || 0, si);
    const cap = par + 2 + strokes;
    return Math.min(g, cap);
  }

  // ---------- Individual Net Nassau (front/back/total) ----------
  // Each pair of opponents plays a flat 3-segment Nassau. No presses.
  // Diff is positive when player A is ahead (lower net is better).
  // Return the SI for a player on a given hole, respecting their tee set.
  function playerSI(round, player, holeIdx) {
    if (player.siArray && player.siArray[holeIdx] != null) return player.siArray[holeIdx];
    return round.course.holes[holeIdx].si;
  }

  function computeIndyMatch(round, playerA, playerB) {
    const strokesA = round.baseStrokes[playerA.id] || 0;
    const strokesB = round.baseStrokes[playerB.id] || 0;
    let frontA = 0, frontB = 0, backA = 0, backB = 0;
    let anyFront = false, anyBack = false;
    for (let h = 0; h < 18; h++) {
      const gA = cappedGross(round, playerA, h);
      const gB = cappedGross(round, playerB, h);
      if (gA == null || gB == null) continue;
      const netA = gA - strokesOnHole(strokesA, playerSI(round, playerA, h));
      const netB = gB - strokesOnHole(strokesB, playerSI(round, playerB, h));
      if (h < 9) { frontA += netA; frontB += netB; anyFront = true; }
      else { backA += netA; backB += netB; anyBack = true; }
    }
    const totalA = frontA + backA, totalB = frontB + backB;
    return {
      frontDiff: anyFront ? (frontB - frontA) : 0, // + means A won
      backDiff:  anyBack  ? (backB  - backA)  : 0,
      totalDiff: (totalB - totalA),
      frontA, frontB, backA, backB, totalA, totalB
    };
  }

  // ---------- 2-Down Auto-Press Individual Nassau ----------
  // Same base structure as the 3-way Nassau (Front + Back + Total) but whenever a
  // player falls 2 strokes DOWN within the current chain of a segment, an extra
  // press automatically opens from the next hole to the end of that segment. Each
  // press is worth one stake. Only the most recently opened press in a segment can
  // spawn another, and a chained press only fires when the deficit continues in
  // the same direction as its parent (prevents oscillation spam).
  function computeIndyMatchAutoPress(round, playerA, playerB) {
    const strokesA = round.baseStrokes[playerA.id] || 0;
    const strokesB = round.baseStrokes[playerB.id] || 0;

    // Per-hole diff: netB - netA  (positive = A ahead on this hole)
    const holeDiffs = [];
    for (let h = 0; h < 18; h++) {
      const gA = cappedGross(round, playerA, h);
      const gB = cappedGross(round, playerB, h);
      if (gA == null || gB == null) { holeDiffs.push(null); continue; }
      const netA = gA - strokesOnHole(strokesA, playerSI(round, playerA, h));
      const netB = gB - strokesOnHole(strokesB, playerSI(round, playerB, h));
      holeDiffs.push(netB - netA);
    }

    const frontMain = { startHole: 0, endHole: 8,  name: 'Front',   diff: 0, spawned: false };
    const backMain  = { startHole: 9, endHole: 17, name: 'Back',    diff: 0, spawned: false };
    const overall   = { startHole: 0, endHole: 17, name: 'Overall', diff: 0 };
    const presses = [];

    for (let h = 0; h < 18; h++) {
      const d = holeDiffs[h];
      if (d == null) continue;

      const nineMain = h <= 8 ? frontMain : backMain;
      const active = [nineMain, overall];
      for (const p of presses) {
        if (h >= p.startHole && h <= p.endHole) active.push(p);
      }
      for (const seg of active) seg.diff += d;

      // Chain press: only the most recent press in this nine can spawn another.
      // `spawned` bounds oscillation; either direction of a ±2 swing is valid.
      const pressesInNine = presses.filter(p => p.endHole === nineMain.endHole);
      const trigger = pressesInNine.length > 0
        ? pressesInNine[pressesInNine.length - 1]
        : nineMain;

      if (!trigger.spawned && h < trigger.endHole) {
        if (Math.abs(trigger.diff) >= 2) {
          trigger.spawned = true;
          presses.push({
            startHole: h + 1,
            endHole: trigger.endHole,
            name: `Press @${h + 2}`,
            diff: 0,
            spawned: false
          });
        }
      }
    }

    return {
      frontMain, backMain, overall, presses,
      // Parity with computeIndyMatch for UI display of the base 3 bets
      frontDiff: frontMain.diff,
      backDiff:  backMain.diff,
      totalDiff: overall.diff
    };
  }

  // Settle an auto-press indy match into $ for player A.
  // Every segment (Front, Back, Overall) and every spawned press each pay one stake.
  // If opts.backDouble is true, ONLY the "second nine played" base segment pays
  // 2× (e.g. Back = $200). All spawned presses — even those that open on the
  // back — still pay the normal 1× stake ($100). Overall (1-18) is never
  // doubled.
  function indyAutoPressDollars(apResult, stake, opts) {
    opts = opts || {};
    const perSeg = stake.game;
    const startBack = opts.startNine === 'back';
    // When "back doubled" is on, the SECOND nine played base bet gets 2×.
    // Front-first → second nine ends at hole index 17 (back). Back-first → ends at 8 (front).
    const secondNineEndHole = startBack ? 8 : 17;
    const baseMult = (seg) => opts.backDouble && seg.endHole === secondNineEndHole ? 2 : 1;
    const addSeg = (diff, mult) => diff > 0 ? perSeg * mult : diff < 0 ? -perSeg * mult : 0;
    let aAmt = 0;
    aAmt += addSeg(apResult.frontMain.diff, baseMult(apResult.frontMain));
    aAmt += addSeg(apResult.backMain.diff,  baseMult(apResult.backMain));
    aAmt += addSeg(apResult.overall.diff,   1);
    // Presses always pay 1× — the back-double only applies to the base segment.
    for (const p of apResult.presses) {
      aAmt += addSeg(p.diff, 1);
    }
    return aAmt;
  }

  // Settle one indy match into $ for player A (negative = A lost)
  // backMult: 1 (default) or 2 (press when trailing, or 3-way when tied on first nine)
  // The multiplier applies to the SECOND nine played. If starting front, that's back 9.
  // If starting back, that's front 9.
  function indyDollars(match, stake, backMult, startNine) {
    const perSeg = stake.game;
    const bm = backMult || 1;
    const startBack = startNine === 'back';
    // First nine played (no multiplier)
    const firstDiff  = startBack ? match.backDiff  : match.frontDiff;
    // Second nine played (gets multiplier if pressed/3-way)
    const secondDiff = startBack ? match.frontDiff : match.backDiff;
    let aAmt = 0;
    if (firstDiff > 0) aAmt += perSeg;
    else if (firstDiff < 0) aAmt -= perSeg;
    if (secondDiff > 0) aAmt += perSeg * bm;
    else if (secondDiff < 0) aAmt -= perSeg * bm;
    if (match.totalDiff > 0) aAmt += perSeg;
    else if (match.totalDiff < 0) aAmt -= perSeg;
    return aAmt;
  }

  // ---------- Team best ball / total net ----------
  // Both helpers accept an optional `round` argument so they can apply the
  // net-double-bogey cap via cappedGross. If round is omitted (legacy callers),
  // the raw gross is used — but all internal callers now pass it.
  function teamLowNet(teamPlayers, holeIdx, course, baseStrokes, round) {
    const nets = teamPlayers.map(p => {
      const g = round ? cappedGross(round, p, holeIdx) : p.scores[holeIdx];
      if (g == null) return null;
      const si = (p.siArray && p.siArray[holeIdx] != null) ? p.siArray[holeIdx] : course.holes[holeIdx].si;
      return netScore(g, strokesOnHole(baseStrokes[p.id], si));
    }).filter(n => n != null);
    if (nets.length === 0) return null;
    return Math.min(...nets);
  }

  function teamTotalNet(teamPlayers, holeIdx, course, baseStrokes, round) {
    const nets = teamPlayers.map(p => {
      const g = round ? cappedGross(round, p, holeIdx) : p.scores[holeIdx];
      if (g == null) return null;
      const si = (p.siArray && p.siArray[holeIdx] != null) ? p.siArray[holeIdx] : course.holes[holeIdx].si;
      return netScore(g, strokesOnHole(baseStrokes[p.id], si));
    });
    if (nets.some(n => n == null)) return null;
    return nets.reduce((a, b) => a + b, 0);
  }

  // Returns 'A', 'B', or 'T'
  function compareLow(round, holeIdx) {
    const aLow = teamLowNet(round.teamA, holeIdx, round.course, round.baseStrokes, round);
    const bLow = teamLowNet(round.teamB, holeIdx, round.course, round.baseStrokes, round);
    if (aLow == null || bLow == null) return null;
    if (aLow < bLow) return 'A';
    if (bLow < aLow) return 'B';
    return 'T';
  }
  function compareTotal(round, holeIdx) {
    const aTot = teamTotalNet(round.teamA, holeIdx, round.course, round.baseStrokes, round);
    const bTot = teamTotalNet(round.teamB, holeIdx, round.course, round.baseStrokes, round);
    if (aTot == null || bTot == null) return null;
    if (aTot < bTot) return 'A';
    if (bTot < aTot) return 'B';
    return 'T';
  }

  // ---------- Birdie detection ----------
  // Birdie detection uses RAW score on purpose: an actual par-minus-1 hit
  // earns the birdie even if the cap would have brought someone else's score
  // down. (In practice, the cap only lowers already-high scores, so raw or
  // capped give the same answer for birdie logic — we keep raw to make intent
  // obvious.)
  function teamHasBirdie(teamPlayers, holeIdx, course) {
    const par = course.holes[holeIdx].par;
    return teamPlayers.some(p => p.scores[holeIdx] != null && p.scores[holeIdx] <= par - 1);
  }

  // Highest gross score on a team for a hole (used in 9-point high-ball scoring).
  // The team with the LARGER high score LOSES the high-ball point (other team gets 3).
  // The net-double-bogey cap applies here too — a hack-out 10 is treated as
  // par + 2 + strokes, which is the reported score.
  function teamHighGross(teamPlayers, holeIdx, round) {
    const scores = teamPlayers
      .map(p => round ? cappedGross(round, p, holeIdx) : p.scores[holeIdx])
      .filter(s => s != null);
    if (scores.length === 0) return null;
    return Math.max(...scores);
  }
  function compareHighBall(round, holeIdx) {
    const aHi = teamHighGross(round.teamA, holeIdx, round);
    const bHi = teamHighGross(round.teamB, holeIdx, round);
    if (aHi == null || bHi == null) return null;
    // LOWER max is better — team with higher max loses high ball
    if (aHi < bHi) return 'A'; // A wins (B had higher)
    if (bHi < aHi) return 'B';
    return 'T';
  }

  // ---------- Points game per hole ----------
  // Handles both 'scotch' (default) and '9point' game types.
  function pointsForHole(round, holeIdx) {
    const hole = round.holes[holeIdx];
    const low = compareLow(round, holeIdx);
    const tot = compareTotal(round, holeIdx);
    if (low == null || tot == null) return null;

    // Resolve effective game type: round-level or per-sub-round (5-man)
    const gameType = round.gameType === '9point' ? '9point' : 'scotch';

    let a = 0, b = 0;
    const bd = { gameType };

    // Low ball (3)
    if (low === 'A') { a += 3; bd.low = 'A'; }
    else if (low === 'B') { b += 3; bd.low = 'B'; }
    else bd.low = 'T';

    // Total (3)
    if (tot === 'A') { a += 3; bd.total = 'A'; }
    else if (tot === 'B') { b += 3; bd.total = 'B'; }
    else bd.total = 'T';

    // BLITZ is the unified name for the double-points event in both game types.
    // In Scotch: low + total + CTP + birdie to same team (birdie reduced 4→1 first)
    // In 9-Point: low + total + high ball to same team
    let blitz = false;
    let blitzTeam = null;
    let birdieWinner = null;

    if (gameType === '9point') {
      const hi = compareHighBall(round, holeIdx);
      if (hi === 'A') { a += 3; bd.highBall = 'A'; }
      else if (hi === 'B') { b += 3; bd.highBall = 'B'; }
      else bd.highBall = 'T';

      if (low === 'A' && tot === 'A' && hi === 'A') { blitzTeam = 'A'; blitz = true; }
      else if (low === 'B' && tot === 'B' && hi === 'B') { blitzTeam = 'B'; blitz = true; }
    } else {
      // SCOTCH
      const aBirdie = teamHasBirdie(round.teamA, holeIdx, round.course);
      const bBirdie = teamHasBirdie(round.teamB, holeIdx, round.course);

      if (hole.ctp === 'A') { a += 2; bd.ctp = 'A'; }
      else if (hole.ctp === 'B') { b += 2; bd.ctp = 'B'; }
      else bd.ctp = null;

      if (aBirdie && !bBirdie) { a += 4; birdieWinner = 'A'; }
      else if (bBirdie && !aBirdie) { b += 4; birdieWinner = 'B'; }
      else if (aBirdie && bBirdie) birdieWinner = 'T';
      bd.birdie = birdieWinner;

      if (hole.polie === 'A') { a += 1; bd.polie = 'A'; }
      else if (hole.polie === 'B') { b += 1; bd.polie = 'B'; }

      blitzTeam = (low === 'A' && tot === 'A' && hole.ctp === 'A' && birdieWinner === 'A')
        ? 'A'
        : (low === 'B' && tot === 'B' && hole.ctp === 'B' && birdieWinner === 'B')
          ? 'B'
          : null;
      if (blitzTeam) {
        blitz = true;
        if (blitzTeam === 'A') { a -= 3; /* birdie 4 -> 1 */ }
        else { b -= 3; }
      }
    }

    // KEEP / TAKE: look at previous hole result
    // Keep (1): prior winner wins or ties again -> +1
    // Take (2): prior loser wins this hole -> +2
    // Special: Hole 1 is ALWAYS a keep for whoever wins H1 on points.
    //   If H1 is tied on points, no keep awarded.
    let keepTakeA = 0, keepTakeB = 0, keepTake = null;

    if (holeIdx === 0) {
      if (a > b) { keepTakeA += 1; keepTake = 'KeepA'; }
      else if (b > a) { keepTakeB += 1; keepTake = 'KeepB'; }
      a += keepTakeA;
      b += keepTakeB;
      if (blitz) {
        if (blitzTeam === 'A') a = a * 2;
        else b = b * 2;
      }
      const roll0 = hole.roll || 1;
      const ph0 = !!hole.playhoused && !!round.playhouse;
      // On a playhouse hole: 2x base, 3x on press, 4x on reroll
      // Normal (non-playhouse): roll multiplier is 1, 2, or 3
      const mult0 = ph0 ? (roll0 === 1 ? 2 : roll0 === 2 ? 3 : 4) : roll0;
      if (mult0 > 1) { a *= mult0; b *= mult0; }
      bd.blitz = blitz ? blitzTeam : null;
      bd.keepTake = keepTake;
      bd.roll = roll0;
      bd.playhoused = ph0;
      return { a, b, breakdown: bd };
    }

    const prev = round.pointsHistory[holeIdx - 1]; // previous computed points
    if (prev && (prev.a !== prev.b)) {
      const prevWinner = prev.a > prev.b ? 'A' : 'B';
      const thisWinner = a > b ? 'A' : (b > a ? 'B' : 'T');
      if (thisWinner === 'T') {
        // tie -> prior winner gets keep
        if (prevWinner === 'A') { keepTakeA += 1; keepTake = 'KeepA'; }
        else { keepTakeB += 1; keepTake = 'KeepB'; }
      } else if (thisWinner === prevWinner) {
        // same team wins -> keep
        if (prevWinner === 'A') { keepTakeA += 1; keepTake = 'KeepA'; }
        else { keepTakeB += 1; keepTake = 'KeepB'; }
      } else {
        // opposite team wins -> take (2 points AND doubles this hole for them)
        if (thisWinner === 'A') { keepTakeA += 2; keepTake = 'TakeA'; }
        else { keepTakeB += 2; keepTake = 'TakeB'; }
      }
    } else if (prev && prev.a === prev.b) {
      // Previous hole tied — keep carries through ties (user rule).
      // Look further back for last decisive hole.
      for (let k = holeIdx - 2; k >= 0; k--) {
        const older = round.pointsHistory[k];
        if (older && older.a !== older.b) {
          const prevWinner = older.a > older.b ? 'A' : 'B';
          const thisWinner = a > b ? 'A' : (b > a ? 'B' : 'T');
          if (thisWinner === 'T') {
            if (prevWinner === 'A') { keepTakeA += 1; keepTake = 'KeepA'; }
            else { keepTakeB += 1; keepTake = 'KeepB'; }
          } else if (thisWinner === prevWinner) {
            if (prevWinner === 'A') { keepTakeA += 1; keepTake = 'KeepA'; }
            else { keepTakeB += 1; keepTake = 'KeepB'; }
          } else {
            if (thisWinner === 'A') { keepTakeA += 2; keepTake = 'TakeA'; }
            else { keepTakeB += 2; keepTake = 'TakeB'; }
          }
          break;
        }
      }
    }

    // Take is a flat +2, never doubles anything.
    // Keep is a flat +1.
    a += keepTakeA;
    b += keepTakeB;

    // Blitz doubles the entire hole total (after adding keep/take/polie).
    // In Scotch, birdie was already reduced from 4 → 1 above.
    if (blitz) {
      if (blitzTeam === 'A') a = a * 2;
      else b = b * 2;
    }

    // Roll + Playhouse combined multiplier.
    // Normal (non-playhouse): 1x = no roll, 2x = press, 3x = reroll
    // Playhouse: 2x = no roll, 3x = press, 4x = reroll
    const roll = hole.roll || 1;
    const playhoused = !!hole.playhoused && !!round.playhouse;
    const combinedMult = playhoused
      ? (roll === 1 ? 2 : roll === 2 ? 3 : 4)
      : roll;
    if (combinedMult > 1) {
      a = a * combinedMult;
      b = b * combinedMult;
    }

    bd.blitz = blitz ? blitzTeam : null;
    bd.keepTake = keepTake;
    bd.roll = roll;
    bd.playhoused = playhoused;

    return { a, b, breakdown: bd };
  }

  // ---------- Top game: Low + Total match play with 4-down presses ----------
  // Each hole: team wins low (1 pt), wins total (1 pt).
  // Press rule: each segment (main or press) can spawn AT MOST ONE child press.
  // A press fires whenever the current trigger (main, or the most recently opened
  // press in that nine) reaches ±4 in either direction. Because each segment can
  // only spawn once, oscillation is bounded — the chain walks forward through
  // whichever swing reaches ±4 next, in either direction.
  function computeTopGame(round) {
    const frontMain = { startHole: 0, endHole: 8, name: 'Front', points: [], spawned: false };
    const backMain  = { startHole: 9, endHole: 17, name: 'Back',  points: [], spawned: false };
    const overall   = { startHole: 0, endHole: 17, name: 'Overall', points: [] };
    const segments = [frontMain, backMain, overall];
    const presses = [];

    for (let h = 0; h < 18; h++) {
      const low = compareLow(round, h);
      const tot = compareTotal(round, h);
      if (low == null || tot == null) continue;
      let aPts = 0, bPts = 0;
      if (low === 'A') aPts++; else if (low === 'B') bPts++;
      if (tot === 'A') aPts++; else if (tot === 'B') bPts++;

      const active = [];
      if (h <= 8) active.push(frontMain);
      if (h >= 9) active.push(backMain);
      active.push(overall);
      for (const p of presses) {
        if (h >= p.startHole && h <= p.endHole) active.push(p);
      }
      for (const seg of active) {
        seg.points.push({ h, a: aPts, b: bPts });
      }

      // Only check the MOST RECENTLY opened press in the current nine for chain-triggering.
      // If no presses in this nine yet, check the main segment.
      const nineMain = h <= 8 ? frontMain : backMain;
      const pressesInNine = presses.filter(p => p.endHole === nineMain.endHole);
      const trigger = pressesInNine.length > 0
        ? pressesInNine[pressesInNine.length - 1]
        : nineMain;

      if (!trigger.spawned && h < trigger.endHole) {
        const d = segTotal(trigger);
        const diff = d.a - d.b;
        // A press spawns whenever the current trigger (main or most recent press)
        // reaches ±4. The `spawned` flag guarantees each press can spawn at most
        // one child, so runaway oscillation is impossible.
        if (Math.abs(diff) >= 4) {
          trigger.spawned = true;
          presses.push({
            startHole: h + 1,
            endHole: trigger.endHole,
            name: `Press @${h+2}`,
            points: [],
            spawned: false
          });
        }
      }
    }

    return { segments, presses };
  }

  function segTotal(seg) {
    return seg.points.reduce((acc, p) => ({ a: acc.a + p.a, b: acc.b + p.b }), { a: 0, b: 0 });
  }

  // ---------- Bottom game: Net Nassau with auto 2-down presses ----------
  // Same chain rule as top game: each segment can spawn ONE press, then the newest press chains.
  // Front/Back each track their own press chain. Overall (18-hole) does not spawn presses.
  function computeBottomGame(round) {
    const frontMain = { startHole: 0, endHole: 8,  name: 'Front',   points: [], spawned: false };
    const backMain  = { startHole: 9, endHole: 17, name: 'Back',    points: [], spawned: false, multiplier: 2 }; // back 9 pays double
    const overall   = { startHole: 0, endHole: 17, name: 'Overall', points: [] };
    const segments = [frontMain, backMain, overall];
    const presses = [];

    for (let h = 0; h < 18; h++) {
      const low = compareLow(round, h);
      if (low == null) continue;
      let aPts = 0, bPts = 0;
      if (low === 'A') aPts = 1;
      else if (low === 'B') bPts = 1;

      const active = [];
      if (h <= 8) active.push(frontMain);
      if (h >= 9) active.push(backMain);
      active.push(overall);
      for (const p of presses) {
        if (h >= p.startHole && h <= p.endHole) active.push(p);
      }
      for (const seg of active) {
        seg.points.push({ h, a: aPts, b: bPts });
      }

      // Chained press: only the most recent press in this nine can spawn another.
      // The `spawned` flag guarantees each press spawns at most one child, which
      // bounds runaway oscillation. Either direction of a ±2 swing is valid.
      const nineMain = h <= 8 ? frontMain : backMain;
      const pressesInNine = presses.filter(p => p.endHole === nineMain.endHole);
      const trigger = pressesInNine.length > 0
        ? pressesInNine[pressesInNine.length - 1]
        : nineMain;

      if (!trigger.spawned && h < trigger.endHole) {
        const d = segTotal(trigger);
        const diff = d.a - d.b;
        if (Math.abs(diff) >= 2) {
          trigger.spawned = true;
          presses.push({
            startHole: h + 1,
            endHole: trigger.endHole,
            name: `Press @${h+2}`,
            points: [],
            spawned: false
          });
        }
      }
    }

    return { segments, presses };
  }

  // ---------- Full computation ----------
  function computeSingleRound(round) {
    // Build points history hole-by-hole (needed for keep/take)
    round.pointsHistory = [];
    for (let h = 0; h < 18; h++) {
      const pts = pointsForHole(round, h);
      round.pointsHistory.push(pts);
    }

    const pointsTotal = round.pointsHistory.reduce((acc, p) => {
      if (!p) return acc;
      return { a: acc.a + p.a, b: acc.b + p.b };
    }, { a: 0, b: 0 });

    const top = computeTopGame(round);
    const bottom = computeBottomGame(round);

    return {
      points: round.pointsHistory,
      pointsTotal,
      top,
      bottom
    };
  }

  // Build a synthetic 4-man subround for a specific game in a 5-man round.
  // gameNum = 1 or 2. The swing player is in both games.
  // bigTeamKey = 'A' or 'B' (which team has 3 players).
  function build5manSubround(round, gameNum) {
    const bigTeam = round.teamA.length === 3 ? round.teamA : round.teamB;
    const smallTeam = round.teamA.length === 3 ? round.teamB : round.teamA;
    const bigIsA = round.teamA.length === 3;
    const swing = bigTeam.find(p => p.swing);
    const nonSwings = bigTeam.filter(p => !p.swing);
    const gamePlayer = nonSwings[gameNum - 1]; // 0-indexed into [nonSwing1, nonSwing2]

    const subBig = [gamePlayer, swing];
    // Per-game type override (5-man can have one sub-round scotch, one 9-point)
    const subGameType = gameNum === 1
      ? (round.gameType1 || round.gameType || 'scotch')
      : (round.gameType2 || round.gameType || 'scotch');
    const sub = {
      course: round.course,
      playhouse: round.playhouse,
      gameType: subGameType,
      startNine: round.startNine,
      teamA: bigIsA ? subBig : smallTeam,
      teamB: bigIsA ? smallTeam : subBig,
      holes: round.holes.map(hf => ({
        ctp:    gameNum === 1 ? hf.ctp    : hf.ctp2,
        polie: gameNum === 1 ? hf.polie : hf.polie2,
        roll:   gameNum === 1 ? (hf.roll || 1) : (hf.roll2 || 1),
        playhoused: !!hf.playhoused
      }))
    };
    sub.baseStrokes = computeBaseStrokes([...sub.teamA, ...sub.teamB]);
    return sub;
  }

  function computeRound(round) {
    if (round.mode === '5man') {
      const sub1 = build5manSubround(round, 1);
      const sub2 = build5manSubround(round, 2);
      const r1 = computeSingleRound(sub1);
      const r2 = computeSingleRound(sub2);
      return { mode: '5man', game1: r1, game2: r2, sub1, sub2 };
    }
    const single = computeSingleRound(round);
    return { mode: '4man', ...single };
  }

  // ---------- Settlement ----------
  // Stakes (per-player factor):
  //   full = 1 unit, half = 0.5 unit
  // Team games (middle, top, bottom) are a SINGLE bet per player (not per-opponent).
  // Effective factor = own_factor × min(teamSumA, teamSumB) / own_team_sum
  // So a full player against avg-0.75 opponents plays a 75% game.
  //
  // Base dollar values (at full stake, 1 unit):
  //   Middle game: $20 × |points diff|   (NO game fee)
  //   Top game:    $100 flat per segment won (no per-point)
  //   Bottom game: $100 flat per segment won (no per-point)
  //
  // Individual Nassau: per-pair at lower stake, $100 per segment (full) or $50 (half).
  function stakeFactor(p) {
    if (p.stake === 'half') return 0.5;
    if (p.stake === '1.25x') return 1.25;
    if (p.stake === '0.75x') return 0.75;
    return 1; // full
  }
  function stakeFor(p) {
    if (p.stake === 'half') return { game: 50, perPoint: 10 };
    if (p.stake === '1.25x') return { game: 125, perPoint: 25 };
    if (p.stake === '0.75x') return { game: 75, perPoint: 15 };
    return { game: 100, perPoint: 20 }; // full
  }
  function lowerStake(a, b) {
    const sa = stakeFor(a), sb = stakeFor(b);
    return sa.game <= sb.game ? sa : sb;
  }

  // Compute base team-game dollars at full stake from team A's perspective.
  // Returns { total, lines: [{label, amount}] }
  function teamGameBaseA(result) {
    const lines = [];
    let total = 0;
    // Middle game: $20 per point diff
    const pDiff = result.pointsTotal.a - result.pointsTotal.b;
    if (pDiff !== 0) {
      const amt = 20 * pDiff; // signed
      total += amt;
      lines.push({
        label: `Middle (${pDiff > 0 ? 'A' : 'B'} +${Math.abs(pDiff)} pts)`,
        calc: `${Math.abs(pDiff)} × $20`,
        amountA: amt
      });
    }
    // Top game: $100 flat per segment
    for (const seg of [...result.top.segments, ...result.top.presses]) {
      const t = segTotal(seg);
      const d = t.a - t.b;
      if (d === 0) continue;
      const amt = d > 0 ? 100 : -100;
      total += amt;
      lines.push({
        label: `Top ${seg.name} (${d > 0 ? 'A' : 'B'} +${Math.abs(d)})`,
        calc: `$100 flat`,
        amountA: amt
      });
    }
    // Bottom game: $100 flat per segment (back 9 pays 2x)
    for (const seg of [...result.bottom.segments, ...result.bottom.presses]) {
      const t = segTotal(seg);
      const d = t.a - t.b;
      if (d === 0) continue;
      const mult = seg.multiplier || 1;
      const base = 100 * mult;
      const amt = d > 0 ? base : -base;
      total += amt;
      lines.push({
        label: `Bottom ${seg.name} (${d > 0 ? 'A' : 'B'} +${Math.abs(d)})`,
        calc: mult > 1 ? `$100 × ${mult}` : `$100 flat`,
        amountA: amt
      });
    }
    return { total, lines };
  }

  // Settle a single 4-man sub-round using the new per-player effective-factor model.
  // Returns per-player team-game $ plus line-item breakdown for display.
  function settleSingle(subround, result, label) {
    const base = teamGameBaseA(result); // base $ at full stake, from A's perspective
    const sumA = subround.teamA.reduce((s, p) => s + stakeFactor(p), 0);
    const sumB = subround.teamB.reduce((s, p) => s + stakeFactor(p), 0);
    const match = Math.min(sumA, sumB);

    const perPlayer = {};
    const playerBreakdown = {}; // id -> { effectiveFactor, lines, subtotal }

    for (const pa of subround.teamA) {
      const eff = sumA > 0 ? stakeFactor(pa) * (match / sumA) : 0;
      const mine = Math.round(base.total * eff);
      perPlayer[pa.id] = (perPlayer[pa.id] || 0) + mine;
      playerBreakdown[pa.id] = {
        game: label,
        isA: true,
        effectiveFactor: eff,
        lines: base.lines.map(l => ({
          label: l.label,
          calc: `${l.calc}${eff !== 1 ? ` × ${Math.round(eff * 100)}%` : ''}`,
          amount: Math.round(l.amountA * eff)
        })),
        subtotal: mine
      };
    }
    for (const pb of subround.teamB) {
      const eff = sumB > 0 ? stakeFactor(pb) * (match / sumB) : 0;
      const mine = Math.round(-base.total * eff);
      perPlayer[pb.id] = (perPlayer[pb.id] || 0) + mine;
      playerBreakdown[pb.id] = {
        game: label,
        isA: false,
        effectiveFactor: eff,
        lines: base.lines.map(l => ({
          label: l.label,
          calc: `${l.calc}${eff !== 1 ? ` × ${Math.round(eff * 100)}%` : ''}`,
          amount: Math.round(-l.amountA * eff)
        })),
        subtotal: mine
      };
    }
    return { perPlayer, playerBreakdown, baseTotal: base.total, factors: { sumA, sumB, match } };
  }

  // Compute all individual net Nassau matches for a round.
  // Returns { details: [...], perPlayerIndy: { id: $ } }
  // Uses teamA × teamB (the actual assigned teams), works for 4-man and 5-man.
  function computeAllIndyMatches(round) {
    const details = [];
    const perPlayerIndy = {};
    for (const p of [...round.teamA, ...round.teamB]) perPlayerIndy[p.id] = 0;
    const formats = round.indyMatchFormats || {};

    for (const pa of round.teamA) {
      for (const pb of round.teamB) {
        const stake = lowerStake(pa, pb);
        const stakeLabel = stake.game === 125 ? '1.25×' : stake.game === 100 ? 'full' : stake.game === 75 ? '¾' : 'half';
        const key = indyKey(pa.id, pb.id);
        const entry = formats[key] || { format: '3way', backDouble: false };
        const isAuto = entry.format === 'auto2down';

        if (isAuto) {
          const ap = computeIndyMatchAutoPress(round, pa, pb);
          const aAmt = indyAutoPressDollars(ap, stake, {
            backDouble: !!entry.backDouble,
            startNine: round.startNine
          });
          perPlayerIndy[pa.id] += aAmt;
          perPlayerIndy[pb.id] -= aAmt;
          details.push({
            aId: pa.id, aName: pa.name,
            bId: pb.id, bName: pb.name,
            stake: stakeLabel,
            perSeg: stake.game,
            frontDiff: ap.frontDiff,
            backDiff:  ap.backDiff,
            totalDiff: ap.totalDiff,
            format: 'auto2down',
            backDouble: !!entry.backDouble,
            pressCount: ap.presses.length,
            pressSegments: ap.presses.map(p => ({
              startHole: p.startHole + 1,
              endHole:   p.endHole + 1,
              diff:      p.diff
            })),
            aAmount: aAmt
          });
        } else {
          const match = computeIndyMatch(round, pa, pb);
          const choice = (round.indyBackChoice && round.indyBackChoice[key]) || null;
          const backMult = (choice === 'press' || choice === '3way') ? 2 : 1;
          const aAmt = indyDollars(match, stake, backMult, round.startNine);
          perPlayerIndy[pa.id] += aAmt;
          perPlayerIndy[pb.id] -= aAmt;
          details.push({
            aId: pa.id, aName: pa.name,
            bId: pb.id, bName: pb.name,
            stake: stakeLabel,
            perSeg: stake.game,
            frontDiff: match.frontDiff,
            backDiff:  match.backDiff,
            totalDiff: match.totalDiff,
            backMult,
            choice,
            format: '3way',
            aAmount: aAmt
          });
        }
      }
    }
    return { details, perPlayerIndy };
  }

  function indyKey(aId, bId) { return `${aId}__${bId}`; }

  function settle(round, result) {
    if (round.mode === '5man') {
      return settle5man(round, result);
    }
    const single = settleSingle(round, result, 'main');
    const indy = computeAllIndyMatches(round);

    // Merge indy $ into perPlayer
    const perPlayer = { ...single.perPlayer };
    for (const id in indy.perPlayerIndy) {
      perPlayer[id] = (perPlayer[id] || 0) + indy.perPlayerIndy[id];
    }

    const teamA = round.teamA.reduce((s, p) => s + (perPlayer[p.id] || 0), 0);
    const teamB = round.teamB.reduce((s, p) => s + (perPlayer[p.id] || 0), 0);
    return {
      mode: '4man',
      perPlayer,
      playerBreakdown: single.playerBreakdown, // team-game lines per player
      indy: indy.details,
      teamTotals: { a: teamA, b: teamB },
      factors: single.factors,
      baseTotal: single.baseTotal
    };
  }

  function settle5man(round, result) {
    const s1 = settleSingle(result.sub1, result.game1, 'G1');
    const s2 = settleSingle(result.sub2, result.game2, 'G2');

    // Merge per-player (swing player appears in both)
    const perPlayer = {};
    const allPlayers = [...round.teamA, ...round.teamB];
    for (const p of allPlayers) perPlayer[p.id] = 0;
    for (const id in s1.perPlayer) perPlayer[id] = (perPlayer[id] || 0) + s1.perPlayer[id];
    for (const id in s2.perPlayer) perPlayer[id] = (perPlayer[id] || 0) + s2.perPlayer[id];

    // Identify big (3-man) team and small (2-man) team
    const bigTeam  = round.teamA.length === 3 ? round.teamA : round.teamB;
    const smallTeam = round.teamA.length === 3 ? round.teamB : round.teamA;

    // Apply action split on the big team based on stake factor.
    const shares = bigTeam.map(p => stakeFactor(p) * 2);
    const totalShares = shares.reduce((a, b) => a + b, 0);
    const pool = bigTeam.reduce((s, p) => s + perPlayer[p.id], 0);

    // Snapshot pre-split for display
    const preSplit = {};
    for (const p of bigTeam) preSplit[p.id] = perPlayer[p.id];

    // Split the pool
    bigTeam.forEach((p, i) => {
      perPlayer[p.id] = Math.round(pool * (shares[i] / totalShares));
    });

    // Rounding correction: ensure sum of bigTeam still equals pool
    const newSum = bigTeam.reduce((s, p) => s + perPlayer[p.id], 0);
    const diff = pool - newSum;
    if (diff !== 0 && bigTeam.length > 0) {
      // Apply correction to the highest-stake player (largest share)
      const fullPlayer = bigTeam.reduce((best, p) => stakeFactor(p) > stakeFactor(best) ? p : best, bigTeam[0]);
      perPlayer[fullPlayer.id] += diff;
    }

    const teamABigIsA = round.teamA.length === 3;

    // Individual net Nassau matches — NOT pooled, stay with the individual player.
    // Added AFTER action split.
    const indy = computeAllIndyMatches(round);
    for (const id in indy.perPlayerIndy) {
      perPlayer[id] = (perPlayer[id] || 0) + indy.perPlayerIndy[id];
    }

    const teamA$ = round.teamA.reduce((s, p) => s + perPlayer[p.id], 0);
    const teamB$ = round.teamB.reduce((s, p) => s + perPlayer[p.id], 0);

    return {
      mode: '5man',
      perPlayer,
      playerBreakdownG1: s1.playerBreakdown,
      playerBreakdownG2: s2.playerBreakdown,
      indy: indy.details,
      teamTotals: { a: teamA$, b: teamB$ },
      actionSplit: {
        bigTeamIsA: teamABigIsA,
        pool,
        shares: bigTeam.map((p, i) => ({ id: p.id, name: p.name, stake: p.stake, shares: shares[i], pct: Math.round(1000 * shares[i] / totalShares) / 10 })),
        preSplit
      }
    };
  }

  // ---------- Handicap base (full off lowest) ----------
  function computeBaseStrokes(players) {
    const low = Math.min(...players.map(p => p.handicap || 0));
    const base = {};
    for (const p of players) base[p.id] = (p.handicap || 0) - low;
    return base;
  }

  return {
    strokesOnHole,
    computeBaseStrokes,
    cappedGross,
    computeRound,
    computeIndyMatch,
    indyKey,
    settle,
    segTotal,
    teamLowNet,
    teamTotalNet,
    compareLow,
    compareTotal
  };
})();
