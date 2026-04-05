# Scotch ⛳

A mobile-first golf gambling scorekeeper for the Scotch game — a 2v2 or 3v2 handicapped match with three simultaneous side games, individual net Nassau bets, and golf-fee tracking.

**Live app:** _add your GitHub Pages URL here after deploy_

## What it does

Tracks a handicapped golf gambling game with:

- **Middle (Points) game** — Low ball 3, Total 3, CTP 2, Birdie 4, Keep 1, Take 2, Pullie 1. Sweep doubling, auto H1 keep, take carries through ties, Roll (2× / 3×) multiplier.
- **Top game** — Low + Total match play with auto 4-down press chains. Front / Back / Overall segments.
- **Bottom game** — Net Nassau best-ball match play with auto 2-down press chains. Front / Back / Overall segments.
- **Individual net Nassau** — each pair of opponents plays front / back / total 18 at a flat stake. Back-9 press or 2-way / 3-way prompt at hole 10.
- **Per-player stakes** — Full ($100) or Half ($50). Mixed pairings use a weighted "X% game" so the math balances.
- **5-man mode** — 3-man team (with a swing player who plays both sub-games) vs 2-man team. Action split pools the 3-man team's winnings by stake shares (full = 2, half = 1).
- **Golf fees** — pick a host, enter each player's share; fees credit the host and debit the payers.
- **Copy summary to text** — one-tap plain-text summary for texting the group.

## How to use

1. Open the URL on your phone in Safari or Chrome
2. **Share** → **Add to Home Screen** — installs as a PWA, works offline
3. Tap **Start New Round**
4. Pick mode (4-Man / 5-Man), pick course, enter names / handicaps / stakes / tees
5. Play — step through each hole, tap +/− on scores, toggle CTP / Pullie / Roll
6. At hole 10 the app will prompt for individual-match back-9 presses
7. After hole 18, the settlement screen shows everything: cash per player, the math for every bet, per-hole running totals, golf fees, and a "Copy Summary" button for the group chat

## Preset courses (real scorecard data)

- **Bear Lakes CC — Lakes** (West Palm Beach, FL)
- **Panther National** (Palm Beach Gardens, FL — Nicklaus design)
- **Boca Rio GC** (Boca Raton, FL)
- **Mizner CC** (Delray Beach, FL)

All presets ship with Blue / White / Gold tees. Add, rename, or delete tees per course in the Courses screen.

## Technical

- Single-file vanilla HTML / CSS / JavaScript — no build step, no dependencies, no backend
- Data persists to `localStorage` on the device (no cloud sync — each phone has its own data)
- Works offline after first load via a lightweight service worker
- ~100 KB total, loads instantly

## Hosting

This repo is set up for **GitHub Pages**. Enable Pages in **Settings → Pages → Source: main branch / root**, wait a minute, and your live URL will be `https://<your-username>.github.io/<repo-name>/`.

## Updating

To push a new version, just replace `index.html` (via the GitHub web UI: click the file → pencil → paste → Commit). Pages will auto-rebuild in ~30 seconds.

## License

Personal use. Built for a specific golf group's house rules — your mileage may vary if your group plays different rules. Easy to fork and adapt.
