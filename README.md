# SG Pools Live Odds Board

Shows live 1X2 and Over/Under (total goals) odds, filtered to only the
matches currently open for betting on singaporepools.com.sg, cross-checked
against picks from five prediction/tipster sites, with a live countdown to
kickoff for each match.

## How it works

1. `src/scrapers/singaporePools.js` fetches Singapore Pools' open football
   fixtures (team names + kickoff time).
2. `src/services/oddsApi.js` fetches 1X2 and totals odds from
   [The Odds API](https://the-odds-api.com/) across major soccer leagues.
3. `src/scrapers/tipsters/` fetches picks from five prediction/tipster
   sites in parallel (Forebet, PredictZ, WinDrawWin, WhoScored, Sports
   Mole) — see "Tipster sources" below for per-site detail and how
   verified each one is.
4. `src/services/matcher.js` joins the SG Pools list and the odds list by
   team name (fuzzy, with a small alias table for common short names) and
   kickoff time (±90 min tolerance). **Only fixtures present on both sides
   are shown** — this is what enforces "must be open on Singapore Pools".
   `src/services/tipsterConsensus.js` then attaches each match's tipster
   picks the same way (team-name fuzzy match, no kickoff-time needed).
5. `src/services/confidence.js` computes the market-consensus "confidence"
   score per candidate bet, then nudges the matching 1X2 candidate up when
   tipsters agree with it (see "Confidence" below).
6. `src/services/aggregator.js` refreshes all three sources on a timer and
   caches the merged result in memory.
7. `src/server.js` serves the merged list at `GET /api/matches`.
8. `public/` is a static page that polls that endpoint every 15s and runs a
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

**Over/Under picks**: all five sites also contribute a `totalsPick`
(`{ selection: 'over'|'under', point }`). Forebet/PredictZ/WinDrawWin each
have a dedicated O/U page — team-name extraction there reuses the same
verified row/team selectors as their 1X2 page, but **the O/U pick text
itself is unverified** (no reference scraper covers those pages), so it's
inferred with a generic "over"/"under" word/prefix heuristic
(`src/scrapers/tipsters/totalsHeuristics.js`). WhoScored/Sports Mole infer
it from their predicted scoreline directly (e.g. "2-1" → over 2.5) when
one is found, falling back to the same word heuristic otherwise.

**None of the five have been run against their live sites from this
environment** — build/mock-mode testing confirmed the pipeline mechanics
(fetching, fuzzy-matching, tallying, boosting) work correctly, but the
actual per-site selectors are only as good as the reference source above.
Set `TIPSTERS_DEBUG=true` and check `debug-tipsters/<site>.html` if a
site comes back with 0 picks.

## Setup

```bash
npm install
npx playwright install chromium   # one-time browser download for the SG Pools scraper
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

- **Singapore Pools scraper** (`src/scrapers/singaporePools.js`): points at
  `https://online.singaporepools.com/en/sports` (corrected from an earlier
  wrong domain guess — thanks to real user feedback for that). This is a
  modern single-page app, so the scraper renders it with a headless
  browser (Playwright) rather than a plain HTTP GET, and opportunistically
  captures any JSON responses the page's own network calls make while it
  loads (a real fixture feed, if the page calls one, beats scraped text).
  If nothing useful comes back from captured JSON, it falls back to a
  generic regex scan of the rendered page's text ("Team A v Team B" + a
  nearby date/time). **None of this has been run against the live site**
  — this sandbox's network policy blocks `singaporepools.com` entirely, so
  it's unverified. Run it yourself with `SGPOOLS_DEBUG=true` (see
  "Debugging" below) and adjust `parseRenderedHtml` / the JSON extraction
  to match what you actually see.
- **The Odds API service**: this one's contract is documented and stable, so
  it should work as-is once you supply a real key. Double check the
  `SOCCER_SPORT_KEYS` list covers the leagues you care about (see
  `GET /v4/sports?apiKey=...` for the full list) — Singapore Pools also
  carries some Asian leagues and cups that may need extra sport keys.

## Debugging "no matches show up"

Matches require three things to all succeed: SG Pools fixtures found, odds
events found, and a successful join between them. Check `GET /api/debug`
first — it reports each stage separately:

```bash
curl -sS http://localhost:3000/api/debug | python3 -m json.tool
```

- `stageCounts.sgpFixturesFound === 0` → the Singapore Pools scraper isn't
  finding fixtures. Set `SGPOOLS_DEBUG=true` in `.env` and restart; it
  renders the page with a headless browser and logs each JSON response the
  page itself loads, then saves `debug-sgpools-raw.html` (the rendered DOM)
  and `debug-sgpools-screenshot.png` (what it actually looked like) for you
  to inspect. If a captured JSON response looks like real fixture data,
  point `extractFixturesFromJson` at it directly instead of relying on the
  text-pattern fallback; if the screenshot shows the real match list but
  `parseRenderedHtml`'s regex isn't picking it up, adjust that pattern to
  match the actual text (e.g. if it says "vs." differently, or the date
  format differs from `d/m h:mm`).
- `stageCounts.oddsEventsFound === 0` → The Odds API isn't returning
  anything. Check `lastError` in the same response — a bad/missing
  `ODDS_API_KEY` or exhausted quota shows up there. Also try the raw curl
  from the setup section to see the actual API response.
- `stageCounts.tipsterPicksFound === 0` (or low) → one or more tipster
  scrapers came back empty. Set `TIPSTERS_DEBUG=true`, restart, and check
  `debug-tipsters/<site>.html` for whichever site(s) return nothing —
  most likely a selector needs updating (Forebet/PredictZ/WinDrawWin) or
  the heuristic regex needs tuning to the actual article text
  (WhoScored/Sports Mole). This doesn't block matches from showing — it
  just means no tipster chips/boost for those matches.
- Both `sgpFixturesFound` and `oddsEventsFound` are non-zero but `mergedMatches` is 0 → the two sources
  aren't matching. Compare `sampleSgpFixtures` and `sampleOddsEvents` in
  the debug response by eye — team names that don't share enough tokens
  (see `ALIASES` in `src/services/matcher.js`) or kickoff times more than
  90 minutes apart won't join. Add the missing alias or relax
  `KICKOFF_TOLERANCE_MS` as needed.

## Confidence / "best bet" analysis

Rather than scraping tipster/prediction sites (more unverified scrapers,
ToS risk, and the same egress problems as the Singapore Pools scrape), the
"confidence" score is a **market-consensus estimate** computed from the
bookmaker odds already fetched from The Odds API:

1. For each bookmaker quoting a match, devig their 1X2 and totals prices
   (strip the overround) to get that bookmaker's implied probability.
2. Average those probabilities across bookmakers into a consensus
   probability per candidate bet (home/draw/away, and over/under per line).
3. Weight by **agreement** (how tightly bookmakers cluster — low spread =
   higher confidence) and by **how many bookmakers** quoted it.
4. If the tipster sites' majority pick agrees with a candidate's
   selection — either the 1X2 winner, or an over/under pick at the same
   goal line the tipsters were talking about — that candidate's score
   gets a small boost (up to +15%, scaled by how many of the tipsters
   agree) — recorded as `tipsterBoost` so it's visible, not silently
   folded into one number. Tipster picks are a discrete vote, not a
   probability, so they nudge the market-derived score rather than being
   averaged into it.
5. Each match's highest-scoring candidate becomes its `topPick`; the single
   highest-scoring pick across all matches is exposed as `bestBet`.

See `src/services/confidence.js` and `src/services/tipsterConsensus.js`.
This is a standard "wisdom of the market" technique — it is not a
guarantee of outcome, just what the market and tipster sites currently
imply. Displayed with a disclaimer in the UI.

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
