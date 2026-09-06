# SG Pools Tipster Predictions

Shows predictions from five prediction/tipster sites (1X2 and Over/Under
total goals), filtered to only the matches currently open for betting on
singaporepools.com.sg, with a live countdown to kickoff for each match.

## How it works

1. `src/scrapers/singaporePools.js` fetches Singapore Pools' open football
   fixtures (team names + kickoff time).
2. `src/scrapers/tipsters/` fetches picks from five prediction/tipster
   sites in parallel (Forebet, PredictZ, WinDrawWin, WhoScored, Sports
   Mole) — see "Tipster sources" below for per-site detail and how
   verified each one is.
3. `src/services/tipsterConsensus.js` attaches each match's tipster picks
   by fuzzy team-name matching (`src/services/matcher.js`).
4. `src/services/tipsterRanking.js` picks each match's strongest tipster
   vote (1X2 majority or O/U majority, whichever has the higher agreement
   ratio) as its `topPick`; the single strongest across all matches is
   exposed as `bestBet`.
5. `src/services/aggregator.js` refreshes both sources on a timer and
   caches the merged result in memory.
6. `src/server.js` serves the merged list at `GET /api/matches`.
7. `public/` is a static page that polls that endpoint every 15s and runs a
   client-side countdown clock per match, ticking every second.

## Tipster sources

| Site | Data shape | Verification |
|---|---|---|
| Forebet | Structured table | Selectors ported from a real, working open-source scraper ([999Samurai/predictions-scraper](https://github.com/999Samurai/predictions-scraper)) — not guessed |
| PredictZ | Structured table | Same source as above |
| WinDrawWin | Structured table | Same source as above |
| WhoScored | Prose preview articles | No reference scraper found — generic heuristic extraction (regex for "Team A vs Team B" + a scoreline/"to draw" in nearby text) |
| Sports Mole | Prose preview articles | Same heuristic approach as WhoScored |

The first three give a clean discrete pick (home/draw/away) reliably; the
last two are best-effort and may return `pick: null` for matches where no
scoreline or clear phrase was found nearby — they're still shown as a
preview link in that case, just without a vote counted.

**Over/Under picks**: only WhoScored and Sports Mole currently contribute a
`totalsPick` (`{ selection: 'over'|'under', point }`), inferred from their
predicted scoreline directly (e.g. "2-1" → over 2.5) when one is found,
falling back to a generic "over"/"under" word/prefix heuristic
(`src/scrapers/tipsters/totalsHeuristics.js`) otherwise. Forebet/PredictZ/
WinDrawWin each used to also fetch a dedicated O/U page, but with only one
shared headless-browser page allowed at a time (see "Deploying to Vercel"
below), every extra page tightened the whole refresh's time budget — those
three sites' `totalsPick` is now always `null`.

Set `TIPSTERS_DEBUG=true` and check `debug-tipsters/<site>.html` if a site
comes back with 0 picks.

## Setup

```bash
npm install
npx playwright install chromium   # one-time browser download for the SG Pools scraper
npm start
```

Open http://localhost:3000.

## Deploying to Vercel

`src/app.js` holds the Express app (routes + static file serving);
`api/index.js` re-exports it as a single Vercel serverless function, and
`vercel.json` rewrites every request to it (the function serves static
assets itself via `express.static`, same as local dev).

Two things had to change for serverless specifically:

- **No persistent background loop.** Locally, `src/server.js` proactively
  refreshes on a timer (`SGPOOLS_POLL_MS`) so requests are always instant.
  Serverless functions don't keep a process running between invocations,
  so `src/app.js` instead refreshes on-demand: each request checks if the
  cached data (which persists only as long as that particular function
  instance stays warm) is older than `CACHE_TTL_MS` (default 60s) and
  re-fetches if so. Worst case is one slow request per cold start / cache
  expiry, not a correctness issue.
- **Playwright's bundled Chromium doesn't fit serverless.** Locally (and
  via `npx playwright install chromium`), Playwright downloads and drives
  its own full Chromium build — too large for Vercel's function size
  limits. `src/scrapers/browser.js` detects `process.env.VERCEL` and
  switches to `@sparticuz/chromium-min` (a Chromium build made for
  serverless, fetched at cold start from a hosted release archive) driven
  via `playwright-core`. That build launches with `--single-process`, so
  it can't safely hold more than one page open at a time — `browser.js`
  shares one browser instance across the whole refresh and serializes page
  usage down to exactly one page at once (see the comments there for the
  crash/timeout tradeoffs that landed on that number).

If you ever bump `@sparticuz/chromium-min` in `package.json`, update the
matching `CHROMIUM_MIN_VERSION` constant in `src/scrapers/browser.js` to
the same version — they must stay in lockstep, since that constant builds
the download URL for that exact release's binary.

**Environment variables to set in the Vercel project** (Project Settings →
Environment Variables): optionally `MOCK_MODE`, `CACHE_TTL_MS`,
`SGPOOLS_DEBUG`, `TIPSTERS_DEBUG` — same meanings as below. None are
required; the app works out of the box against the live sites.

Deploy with `vercel --prod`, or connect the GitHub repo in the Vercel
dashboard for automatic deploys on push. `vercel.json` sets `maxDuration:
60` (Vercel Hobby's ceiling for this runtime — it can't be raised further
on that plan) and `memory: 3009` on the function, since fitting Singapore
Pools' render plus all 5 tipster fetches through the single shared page
above needs both the time and the memory headroom. `src/scrapers/tipsters/
index.js` also caps the whole tipster-fetching phase at a 25s deadline, so
one slow/hanging site can't push the response past `maxDuration` — it just
returns whichever picks finished in time.

## Try it without network access

```bash
npm run dev   # runs with MOCK_MODE=true, using data/sample-*.json
```

This exercises the full pipeline (fetch, fuzzy-match, tally, countdown UI)
on bundled sample data so you can see it working before wiring up live
sources.

## Debugging "no matches show up"

Matches require two things: SG Pools fixtures found, and a fixture list
that isn't empty (there's no second source to join against, so every open
SG Pools fixture becomes a match). Check `GET /api/debug` first — it
reports each stage separately:

```bash
curl -sS http://localhost:3000/api/debug | python3 -m json.tool
```

- `stageCounts.sgpFixturesFound === 0` → the Singapore Pools scraper isn't
  finding fixtures. Set `SGPOOLS_DEBUG=true` in `.env` and restart; it
  renders the page with a headless browser and logs each JSON response the
  page itself loads, then saves `debug-sgpools-raw.html` (the rendered DOM)
  and `debug-sgpools-screenshot.png` (what it actually looked like) for you
  to inspect.
- `stageCounts.tipsterPicksFound === 0` (or low) → one or more tipster
  scrapers came back empty. Set `TIPSTERS_DEBUG=true`, restart, and check
  `debug-tipsters/<site>.html` for whichever site(s) return nothing —
  most likely a selector needs updating (Forebet/PredictZ/WinDrawWin) or
  the heuristic regex needs tuning to the actual article text
  (WhoScored/Sports Mole). This doesn't block matches from showing — it
  just means no tipster chips/pick for those matches.

## Top pick / "best bet"

Each match's `topPick` is whichever of its two tipster votes (1X2 majority
or O/U majority) has the strongest agreement ratio — most tipsters
agreeing, as a fraction of how many covered that match — ties broken by
how many tipsters weighed in at all. The single strongest pick across all
matches is exposed as `bestBet`. See `src/services/tipsterRanking.js`.
This is a straightforward majority vote, not a probability estimate — it
reflects what those five sites currently predict, not a guarantee of
outcome. Displayed with a disclaimer in the UI.

## Notes on matching

- Kickoff times from Singapore Pools are assumed to be Singapore time
  (UTC+8) with no explicit timezone in the source; adjust
  `coerceSgTimeToISO` if that's wrong for whatever feed/markup you end up
  scraping.
- Team-name matching normalizes case/punctuation and has a small alias list
  for common short forms (Man Utd, PSG, Spurs, etc.) plus a token-overlap
  fallback. Add more aliases in `src/services/matcher.js` (`ALIASES`) as you
  find mismatches.

## Config (`.env`)

| Var | Purpose |
|---|---|
| `PORT` | Local server port (default 3000) |
| `SGPOOLS_POLL_MS` | Refresh interval for the background loop (local/long-running only) |
| `CACHE_TTL_MS` | On-demand refresh staleness threshold (serverless) |
| `MOCK_MODE` | `true` to run entirely on bundled sample data |
| `SGPOOLS_DEBUG` | `true` for verbose SG Pools scraper logs + HTML/screenshot dump |
| `TIPSTERS_DEBUG` | `true` to save each tipster site's fetched HTML for inspection |
