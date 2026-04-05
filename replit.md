# Scotch Golf Gambling Tracker

A mobile-first Progressive Web App (PWA) for tracking scores and gambling bets in the golf game "Scotch."

## Project Overview

- **Type:** Static frontend PWA (no backend)
- **Tech Stack:** Vanilla HTML, CSS, JavaScript (ES6+)
- **Storage:** localStorage (client-side)
- **PWA:** Service Worker (`sw.js`) + Web App Manifest (`manifest.json`)

## Project Structure

```
scotch-app/           # Main application directory (served as static site)
├── index.html        # App entry point
├── app.js            # UI logic and state management
├── scoring.js        # Golf scoring and bet calculation logic
├── style.css         # Application styles
├── sw.js             # Service Worker for offline support
├── manifest.json     # PWA manifest
├── serve.py          # Local dev server (port 5000, 0.0.0.0)
└── build.py          # Build script to bundle assets into index.html
README.md             # Project overview
```

## Running Locally

The workflow "Start application" runs `python3 scotch-app/serve.py` on port 5000.

## Deployment

Configured as a static site deployment serving the `scotch-app/` directory.
