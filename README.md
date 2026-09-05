# SG Pools Live Odds Board

Shows live 1X2 and Over/Under (total goals) odds, filtered to only the
matches currently open for betting on singaporepools.com.sg, with a live
countdown to kickoff for each match.

## How it works

1. `src/scrapers/singaporePools.js` fetches Singapore Pools' open football
   fixtures (team names + kickoff time).
2. `src/services/oddsApi.js` fetches 1X2 and totals odds from
   [The Odds API](https://the-odds-api.com/) across major soccer leagues.
3. `src/services/matcher.js` joins the two by team name (fuzzy, with a small
   alias table for common short names) and kickoff time (±90 min tolerance).
   **Only fixtures present on both sides are shown** — this is what enforces
   "must be open on Singapore Pools".
4. `src/services/aggregator.js` refreshes both sources on a timer and caches
   the merged result in memory.
5. `src/server.js` serves the merged list at `GET /api/matches`.
6. `public/` is a static page that polls that endpoint every 15s and runs a
   client-side countdown clock per match, ticking every second.

## Setup

```bash
npm install
cp .env.example .env
# edit .env and set ODDS_API_KEY (free tier at https://the-odds-api.com/)
npm start
```

Open http://localhost:3000.

## Try it without an API key or network access

```bash
npm run dev   # runs with MOCK_MODE=true, using data/sample-*.json
```

This exercises the full pipeline (merge logic, filtering, countdown UI) on
bundled sample data so you can see it working before wiring up live sources.

## Important: this was built without live access to either site

The sandbox this was developed in has network egress locked to an allowlist
(npm, GitHub, etc.) and could not reach `singaporepools.com.sg` or
`api.the-odds-api.com` to inspect them live. Concretely, that means:

- **Singapore Pools scraper** (`src/scrapers/singaporePools.js`): built from
  general knowledge of how the site has worked, not a verified live capture.
  It tries a couple of candidate JSON feed URLs first, then falls back to a
  generic regex-based HTML scrape ("Team A v Team B" + a nearby date/time).
  **Before relying on this**, open the football odds page in a browser,
  check DevTools → Network for the actual JSON endpoint it loads odds from,
  and update `CANDIDATE_JSON_FEEDS` — that will be far more robust than the
  HTML fallback. If you only get the HTML fallback, sanity check a few
  scraped fixtures against the page.
- **The Odds API service**: this one's contract is documented and stable, so
  it should work as-is once you supply a real key. Double check the
  `SOCCER_SPORT_KEYS` list covers the leagues you care about (see
  `GET /v4/sports?apiKey=...` for the full list) — Singapore Pools also
  carries some Asian leagues and cups that may need extra sport keys.

## Notes on matching

- Kickoff times from Singapore Pools are assumed to be Singapore time
  (UTC+8) with no explicit timezone in the source; adjust
  `coerceSgTimeToISO` if that's wrong for whatever feed/markup you end up
  scraping.
- Team-name matching normalizes case/punctuation and has a small alias list
  for common short forms (Man Utd, PSG, Spurs, etc.) plus a token-overlap
  fallback. Add more aliases in `src/services/matcher.js` (`ALIASES`) as you
  find mismatches.
- "Best price" odds shown are the highest 1X2/O-U price across whatever
  bookmakers The Odds API returned for that event; the full per-bookmaker
  breakdown is also included in the API response (`bookmakers[]`) if you
  want to show it in the UI later.

## Config (`.env`)

| Var | Purpose |
|---|---|
| `ODDS_API_KEY` | Your The Odds API key |
| `PORT` | Local server port (default 3000) |
| `SGPOOLS_POLL_MS` / `ODDS_POLL_MS` | Refresh intervals; the loop runs at the shorter of the two. Mind The Odds API's request quota on the free tier. |
| `MOCK_MODE` | `true` to run entirely on bundled sample data |
