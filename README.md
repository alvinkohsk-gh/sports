# SG Pools Tipster Predictions

Shows predictions from several prediction/tipster sites (1X2 and
Over/Under total goals), filtered to only the matches currently open for
betting on singaporepools.com.sg, with a live countdown to kickoff for
each match.

## How it works

1. `src/scrapers/singaporePools/` fetches Singapore Pools' open football
   fixtures (team names + kickoff time) plus the 1X2 and Over/Under 2.5
   prices (`odds.js`).
2. `src/scrapers/tipsters/` fetches picks from the prediction/tipster
   sites in parallel (Forebet, PredictZ, WinDrawWin, WhoScored, Sports
   Mole, MatchOutlook, EaglePredict, FootyStats, Statarea, FootballPredictions)
   — see "Tipster sources" below for per-site detail and how verified each one is.
3. `src/services/tipsterConsensus.js` attaches each match's tipster picks
   by fuzzy team-name matching (`src/services/matcher/`).
4. `src/services/tipsterRanking.js` picks each match's strongest tipster
   vote (1X2 majority or O/U majority, whichever has the higher agreement
   ratio) as its `topPick`; the single strongest across all matches is
   exposed as `bestBet`.
5. `src/services/value.js` de-vigs the SG Pools price and compares it to a
   tipster-consensus reference probability, flagging positive-EV outcomes;
   the strongest is exposed as `bestValue` (see "Odds & value detection").
6. `src/services/aggregator.js` refreshes both sources on a timer and
   caches the merged result in memory.
7. `src/server.js` serves the merged list at `GET /api/matches`.
8. `public/` is a static page that polls that endpoint every 15s and runs a
   client-side countdown clock per match, ticking every second.

**In production the scrape runs off the request path.** Scraping inside a
Vercel function is unreliable — `@sparticuz/chromium-min` runs
`--single-process` and crashes under load, and every tipster site except
Sports Mole's hub 403s any datacenter IP behind Cloudflare. So
`.github/workflows/snapshot.yml` runs `scripts/scrape-snapshot.js` every
~15 min on a GitHub Actions runner and force-pushes the result JSON to the
orphan `data-snapshot` branch. `src/app.js` fetches
`raw.githubusercontent.com/<repo>/data-snapshot/snapshot.json` and serves
that; it only falls back to an on-demand scrape when the snapshot is
missing or older than `SNAPSHOT_MAX_AGE_MS` (45 min). `GET /api/matches`
reports which path served it via a `source: "snapshot" | "live"` field.

**Accuracy dashboard.** Each scrape also folds the current picks into a
rolling prediction history (`history.json` on the `data-snapshot` branch,
~6 days), fetches Forebet's today + "for yesterday" results pages, and
grades any prediction whose match finished 2–60 h ago against the actual
score — 1X2 and Over/Under, scored separately. The rolling graded sample
set + a per-site summary go to `accuracy.json`; `GET /api/accuracy`
(`?hours=N`) serves it and `public/results.html` is the dashboard (linked
from the board header). Forebet is the results source because no key-free
API covers the leagues Singapore Pools lists; matches Forebet doesn't
cover stay ungraded. The dashboard is empty until ~48 h of history and
finished matches have accumulated.

The snapshot job runs a **FlareSolverr** service container and points
`FLARESOLVERR_URL` at it. `src/scrapers/tipsters/fetchHtml.js` sends any
page that plain HTTP can't get (Cloudflare challenge / 403) through
FlareSolverr, which returns solved HTML plus a `cf_clearance` cookie that
later same-domain fetches reuse over cheap plain axios. Without
`FLARESOLVERR_URL` set (local dev, Vercel fallback) it drops back to the
shared headless browser.

## Tipster sources

| Site | Data shape | Verification |
|---|---|---|
| Forebet | Structured table | Selectors ported from a real, working open-source scraper ([999Samurai/predictions-scraper](https://github.com/999Samurai/predictions-scraper)) — not guessed |
| PredictZ | Structured table | Same source as above |
| WinDrawWin | Structured table | Same source as above |
| WhoScored | Prose preview articles | No reference scraper found — generic heuristic extraction (regex for "Team A vs Team B" + a scoreline, a draw phrase, or win/lose phrasing tied to one of the two team names in nearby text) |
| Sports Mole | Prose preview articles | Reads the hub for fixture links, then fetches each per-match article and parses its "We say: A x-y B" verdict (falls back to "Sports Mole predicts:" / the closing paragraphs). Capped at `SPORTSMOLE_MAX_ARTICLES` (default 40). |
| MatchOutlook | Structured `.match-section` list | One "Best Bet" per match — a 1X2 outcome (→ pick) or an over/under line (→ totalsPick); double chances (1X/X2/12) give neither. Plain HTTP, no FlareSolverr needed. |
| EaglePredict | Tailwind card grid | Cloudflare-gated (FlareSolverr clears it). Per-match card: teams from `img[alt="X logo"]`, one prediction pill — "Home/Away Win"/"Draw" → `pick`, "Over/Under N Goals" → `totalsPick`, double-chance/BTTS/correct-score ignored. |
| FootyStats | `.betWrapper` tip list | One market per block ("Home Win", "Over 2.5 Goals", "BTTS Yes", …); 1X2 outcomes → `pick`, over/under lines → `totalsPick`, everything else ignored. A fixture can appear in several blocks. Plain HTTP. |
| Statarea | `div.match` blocks, per-day `/predictions/date/<YYYY-MM-DD>/starttime` | Mathematical model. Reads the `.inforow .coefrow` probability row (`1 X 2 … 1.5 2.5 3.5 BTS OTS`): headline `.tip` text "1"/"X"/"2" → `pick` (double chances "1X"/"X2"/"12" and no-tip fall back to the most likely of P1/PX/P2); P(over 2.5) > 50 → `totalsPick` over/under 2.5. Fetches `STATAREA_DAYS` days (default 3). Plain HTTP, no Cloudflare. Wide lower-league coverage. |
| FootballPredictions | `.match-card` cards on two section pages (`/win-draw-win-predictions-…` and `/under-over-2-5-goals-…`) | Model tips, one page each for 1X2 and O/U 2.5, both already covering today + the weekend. `.home-team`/`.away-team .team-label` for teams, `.prediction` text for the tip ("`<Team>` to win"/"Draw" → `pick`; "Over/Under 2.5" → `totalsPick`); the two pages are merged per fixture. Behind Cloudflare's passive JS challenge only — plain GET works, FlareSolverr is the fallback. |

The first three give a clean discrete pick (home/draw/away) reliably; the
last two are best-effort. `inferPickFromProse` (`src/scrapers/tipsters/
whoscored.js`) tries, in order: an explicit scoreline ("2-1" → home),
draw phrasing ("honours even", "share the spoils"), then win/lose
phrasing anchored to a team name ("Getafe to edge past…", "comfortable
win for Getafe", "too strong for Elche" → Elche loses). It only returns a
pick when exactly one side is implicated; contradictory or absent
phrasing leaves `pick: null` and the preview link is still shown, just
without a vote counted.

**Over/Under (2.5 goals) picks**: every site contributes a `totalsPick`
(`{ selection: 'over'|'under', point: 2.5 }`), derived from the predicted
correct score it already shows on the same page — Forebet `.ex_sc`
("3 - 2"), PredictZ `.ptpredboxsml` ("Draw 1-1"), WinDrawWin `.predscore`
("2-0"), and WhoScored / Sports Mole from the prose scoreline. Sum the two
goals, compare to 2.5. `src/scrapers/tipsters/totalsHeuristics.js` holds
`totalsFromScoreline` plus a fallback that reads an explicit
"over"/"under" word when no scoreline is present. (No separate O/U page is
fetched — that was dropped when scraping had to fit Vercel's 60s function
limit, and isn't needed since the score is on the main page.)

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
60` and `memory: 2048` on the function (both Vercel Hobby's ceilings —
the git-integration deploy path hard-rejects a higher `memory`, and the
CLI path silently ignores it), since fitting Singapore
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
- `match-info.json` not populating (see below) → set `TIPSTERS_DEBUG=true`
  and check `debug-tipsters/forebet-match.html` against
  `src/scrapers/tipsters/forebetMatchInfo.js`'s `parseH2H`/`parseForm`.

## Match details: H2H, form + recent fixtures (click a card)

Each match card on the board is clickable, opening a panel with the two
teams' last 5 results (form), their recent head-to-head meetings, and each
team's own recent fixtures (home team's recent matches, away team's recent
matches — separate from the H2H list, which is only meetings between these
two teams), all scraped from that match's own Forebet prediction page (not
the list page forebet.js otherwise reads).

- Each H2H row names both sides ("Team A v Team B") and colors the score
  green (win) / yellow (draw) / red (loss) from the perspective of *this*
  match's home team — `src/results/matchInfo.js`'s `annotateH2HResults`
  works out, per row, which side was the home team in that past meeting
  (it flips fixture to fixture) via the team names `forebetMatchInfo.js`
  captures per row, using the same fuzzy `teamsMatch` already used to pair
  SG Pools fixtures to Forebet rows.
- Each recent-fixtures row is colored the same way (green/yellow/red),
  from that row's own subject team's perspective —
  `forebetMatchInfo.js`'s `rowResult` reads it directly off the row's
  `.active-team` marker (reliable within a "Last N matches" panel, unlike
  H2H rows), no fuzzy matching needed.
- Both leave a row uncolored (`result: null`) when its perspective
  couldn't be determined, rather than guessing.
- `src/scrapers/tipsters/forebet.js` now also captures each row's
  Forebet match-page URL (`matchUrl`).
- `src/scrapers/tipsters/forebetMatchInfo.js` fetches that page and parses
  H2H/form/fixtures. The selectors were verified 2026-09-09 against a real
  match-page capture (`debug-tipsters/forebet-match.html`, pulled via the
  `debug-capture` branch — see `.github/workflows/snapshot.yml`'s opt-in
  `publish_debug` input, for a sandbox with no direct network path to
  forebet.com): H2H and each team's recent fixtures render as `.st_row`
  divs (not `<tr>`/`<li>` as first guessed), and form badges are
  `.form_w`/`.form_d`/`.form_l` spans inside two `.prformcont` widgets. Row
  lookups also still accept `<tr>`/`<li>`, and `parseForm` falls back to a
  generic badge scan, so a future markup change degrades to "no data"
  rather than throwing.
- `src/results/matchInfo.js` attaches the result to each match as
  `match.headToHead`, from a rolling cache (`match-info.json`, ~10 days)
  refreshed at most once a day per match (H2H/form barely change inside a
  day) and capped to `FOREBET_MATCHINFO_MAX_PER_RUN` (default 15) new
  fetches per snapshot cycle, so one run can't blow the GitHub Actions job's
  time budget or hammer Forebet. Matches more than 4 days out are skipped
  for now — they'll be fetched once closer to kickoff. Each cache entry is
  stamped with a `SCHEMA_VERSION` — bump it whenever `headToHead`'s shape
  changes (a new field the UI now depends on, a renamed one, …) so an
  entry written under an older version is retried on the next run instead
  of serving stale-shaped data for up to the ~1 day TTL.
- No separate API route: `headToHead` rides along on each match object in
  `GET /api/matches`, same as `odds`/`value`/`tipsterConsensus`. Only
  populated via the published snapshot (the periodic GitHub Actions job) —
  like `statareaValue`, it's not computed on the live on-demand-scrape
  fallback path.
- `public/app.js`'s `openMatchDetail`/`renderMatchDetail` render the panel
  client-side from data already in the fetched match — no extra request on
  click. A match Forebet doesn't cover, or hasn't been scraped yet, shows a
  plain "no data yet" message instead of an empty panel.

## Top pick / "best bet"

Each match's `topPick` is whichever of its two tipster votes (1X2 majority
or O/U majority) has the strongest agreement ratio — most tipsters
agreeing, as a fraction of how many covered that match — ties broken by
how many tipsters weighed in at all. The single strongest pick across all
matches is exposed as `bestBet`. See `src/services/tipsterRanking.js`.
This is a straightforward majority vote, not a probability estimate — it
reflects what those five sites currently predict, not a guarantee of
outcome. Displayed with a disclaimer in the UI.

## Odds & value detection

Singapore Pools' fixture-events API also serves the prices — `src/scrapers/singaporePools/odds.js`
pulls the **1X2** (`betType=MR`) and **Over/Under** (`betType=HL`, market
`Total Goals Over/Under <point>`) decimal odds and attaches them to each
fixture as `match.odds`, reading whatever point SG Pools actually posted
for that match (most are 2.5, some are 1.5 or 3.5) rather than assuming
2.5. The tipster consensus and value assessment for the O/U market are
then computed against that same point — a tipster's "over/under 2.5"
opinion derived from a predicted scoreline is re-evaluated against the
real line; an explicit "over/under 2.5" opinion is only counted when the
real line is actually 2.5.

`src/services/value.js` then assesses each priced market:

1. **implied prob** = `1 / decimal_odd`
2. **margin / overround** = `Σ implied − 1` — the bookmaker's built-in edge
3. **no-vig prob** = `implied / (1 + overround)` — SG Pools' own fair line
4. **consensus prob** = smoothed tipster vote share, weighted by each
   site's own graded accuracy on that market (`src/services/
   tipsterWeights.js` — a site that's actually beaten chance on 1X2 or
   O/U, per `accuracy.json`, counts for more than a site that hasn't;
   thin track records shrink toward a neutral weight of 1). Needs ≥
   `VALUE_MIN_VOTES` raw votes on that market — unweighted — else the
   market is left unassessed. The board's "X/Y tipsters agree" chips
   always show the raw, unweighted count; only the EV math behind them
   uses the weighted score.
5. **reference prob** = `(1 − w)·no-vig + w·consensus`, `w = VALUE_CONSENSUS_WEIGHT`
6. **EV per unit** = `reference · odd − 1`; **Kelly fraction** =
   `(reference·odd − 1) / (odd − 1)` (the UI shows ¼-Kelly)

An outcome is flagged **VALUE** when its EV clears `VALUE_MIN_EV` (default
+5%). The single highest-EV flagged outcome across the board is exposed as
`bestValue` on `GET /api/matches`, alongside `bestBet`.

The reference is the tipster consensus, which is **softer than a true
sharp line** (Pinnacle / Betfair), so a VALUE flag means "the crowd
implies a higher win probability than the price does", not a guaranteed
edge. SG Pools juices 1X2 markets far more than O/U (often ~13% vs ~9%
margin), so value surfaces on totals more often.

Every flagged pick is logged (`src/results/valuePicks.js`, ~5 weeks
retention) and graded against the full-time score once its match
finishes. Scores come from Flashscore's data feed
(`src/results/flashscoreResults.js` — near-total league coverage), with
Forebet's results pages and WinDrawWin's results table as fallbacks.

"In play now" running scores (`m.liveScore` on `GET /api/matches`) use the
same Flashscore feed. When a live SG Pools fixture has no Flashscore match
(seen on some Asian lower/mid-tier leagues), `scripts/scrape-snapshot.js`
falls back to `src/results/livescoreLive.js`, a livescore.com scraper —
consulted only for fixtures Flashscore left unmatched, never racing or
overriding a Flashscore hit. **This fallback is UNVERIFIED against real
livescore.com markup**: the sandbox this was built in has no network path
to livescore.com, so `parseLivescoreRows` is a conservative,
structure-tolerant heuristic tested only against synthetic fixtures, not
real page HTML. Expect it to return zero extra matches until tuned against
a `TIPSTERS_DEBUG=true` capture (`debug-tipsters/livescore-live.html`).
`GET /api/value-picks` returns the open + settled picks and a
flat-1-unit record (win rate, ROI, P/L); `?from=YYYY-MM-DD&to=YYYY-MM-DD`
filters by kickoff day. `public/value-picks.html` is a page for it with a
date-range picker (a single day gives just that day's record).

### Single-site value: `public/statarea-picks.html`

Same method, scoped to one tipster site instead of the full consensus.
`src/services/statareaValue.js` reuses `assessMarket` verbatim, but the
"vote tally" it feeds in is just statarea's own pick for that match,
scaled by statarea's own graded-accuracy weight (`tipsterWeights.js`)
instead of a multi-site vote count — there's no `VALUE_MIN_VOTES` gate,
since with one possible vote "enough opinions weighed in" isn't a
meaningful check. `scripts/scrape-snapshot.js` computes this per match as
`match.statareaValue` and logs flagged picks to `statarea-picks.json`
through the same `mergeValuePicks`/`gradeValuePicks`/`summarizeValuePicks`
pipeline (now parameterized by which per-match field to read), served at
`GET /api/statarea-picks` with the same query params and response shape
as `/api/value-picks`. Swapping in another site only needs a new
`assess<Site>Value` wrapper — the merge/grade/summarize/route/page layers
are all generic.

`public/value-picks.html` also surfaces the statarea log inline, as a
second "Statarea Only" section below the main "All Tipsters" one, sharing
the page's one date-range picker — so a reader who trusts statarea's own
picks more than the blended consensus doesn't have to leave the page to
compare the two records side by side. `public/statarea-picks.html` stays
as a dedicated deep link to the same data.

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
| `SNAPSHOT_URL` | Override the snapshot source (default: the GitHub contents API for `<SNAPSHOT_REPO>`'s `<SNAPSHOT_BRANCH>`/`snapshot.json`, with raw.githubusercontent.com as fallback) |
| `SNAPSHOT_REPO` / `SNAPSHOT_BRANCH` | Repo (`owner/name`) and branch the snapshot job publishes to (defaults `alvinkohsk-gh/sports` / `data-snapshot`) |
| `SNAPSHOT_MAX_AGE_MS` | Max snapshot age before `/api/matches` falls back to an on-demand scrape (default 45 min) |
| `FLARESOLVERR_URL` | If set (e.g. `http://localhost:8191/v1`), route Cloudflare-blocked tipster pages through FlareSolverr instead of the headless browser. Set by the snapshot workflow. |
| `TIPSTERS_DEADLINE_MS` | Overall cap on the tipster-fetch phase (default 25 s; the snapshot job raises it since FlareSolverr solves take longer) |
| `SPORTSMOLE_MAX_ARTICLES` | Max Sports Mole preview articles to fetch per run (default 40) |
| `STATAREA_DAYS` | How many days of Statarea predictions to fetch, starting today (default 3) |
| `FOREBET_MATCHINFO_MAX_PER_RUN` | Max new Forebet match-page (H2H/form) fetches per snapshot cycle (default 15) |
| `SGPOOLS_ODDS_TIMEOUT_MS` | Timeout for each SG Pools odds API call (default 15 s) |
| `LIVESCORE_LIVE_URL` | Override the livescore.com live-scores page URL used as the in-play fallback source (default `https://www.livescore.com/en/football/live/`) |
| `LIVESCORE_TIMEOUT_MS` | Navigation timeout for the livescore.com fallback fetch (default 20 s) |
| `VALUE_CONSENSUS_WEIGHT` | How much the tipster consensus pulls the reference probability off SG Pools' no-vig line, 0–1 (default 0.35) |
| `VALUE_MIN_EV` | EV threshold for the VALUE flag (default 0.05 = +5%) |
| `VALUE_MIN_VOTES` | Minimum tipster picks on a market before it's assessed for value (default 4) |
| `MOCK_MODE` | `true` to run entirely on bundled sample data |
| `SGPOOLS_DEBUG` | `true` for verbose SG Pools scraper logs + HTML/screenshot dump |
| `TIPSTERS_DEBUG` | `true` to save each tipster site's fetched HTML for inspection |
