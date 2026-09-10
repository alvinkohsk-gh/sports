/*
 * Runs the full scrape (Singapore Pools fixtures + all tipster sites +
 * consensus matching) once, then folds the picks into a rolling prediction
 * history and grades finished predictions against Forebet results. Writes:
 *   snapshot.json        — current board (src/app.js serves this)
 *   history.json         — rolling per-(fixture,site) picks, ~6 days
 *   accuracy.json        — graded samples + per-site accuracy summary
 *   value-picks.json     — rolling log of VALUE-flagged picks (full consensus)
 *   statarea-picks.json  — same, but scored on statarea's picks alone
 *   match-info.json      — cached Forebet H2H + recent form per fixture
 *   odds-history.json    — rolling per-fixture SG Pools price history
 *
 * Meant to run OUTSIDE the request path — in GitHub Actions on a schedule
 * (see .github/workflows/snapshot.yml). The Vercel app just serves these
 * files, falling back to an on-demand scrape only when the snapshot is
 * missing or stale.
 *
 * Usage: node scripts/scrape-snapshot.js [snapshotOut] [dir]
 */
const fs = require('fs');
const path = require('path');
const { refresh, getState } = require('../src/services/aggregator');
const { mergeHistory } = require('../src/results/history');
const { fetchFlashscoreResults, fetchFlashscoreLive } = require('../src/results/flashscoreResults');
const { fetchLivescoreLive } = require('../src/results/livescoreLive');
const { fetchForebetResults } = require('../src/results/forebetResults');
const { fetchArchivePredictions } = require('../src/results/archives');
const { grade } = require('../src/results/accuracy');
const { teamsMatch } = require('../src/services/matcher');
const { mergeValuePicks, gradeValuePicks, summarizeValuePicks } = require('../src/results/valuePicks');
const { assessStatareaValue } = require('../src/services/statareaValue');
const { attachMatchInfo } = require('../src/results/matchInfo');
const { mergeOddsHistory } = require('../src/results/oddsHistory');

const OUT = process.argv[2] || 'snapshot.json';
const DIR = process.argv[3] || path.dirname(OUT) || '.';
const REPO = process.env.SNAPSHOT_REPO || 'alvinkohsk-gh/sports';
const BRANCH = process.env.SNAPSHOT_BRANCH || 'data-snapshot';

async function loadPublished(file, fallback) {
  const url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${file}?t=${Date.now()}`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch (err) {
    console.error(`[scrape-snapshot] could not load published ${file}:`, err.message);
  }
  return fallback;
}

(async () => {
  // TEMPORARY: capture candidate new tipster sites' raw markup via the
  // existing TIPSTERS_DEBUG dump + debug-capture branch mechanism (this
  // sandbox has no direct network path to these sites) so a real scraper
  // can be written against actual markup instead of guessed selectors.
  // Remove once a decision is made.
  if (String(process.env.TIPSTERS_DEBUG || 'false').toLowerCase() === 'true') {
    const { fetchHtml } = require('../src/scrapers/tipsters/fetchHtml');
    for (const [site, url] of [
      ['vitibet', 'https://www.vitibet.com/'],
      ['adibet', 'https://www.adibet.com/'],
    ]) {
      try {
        await fetchHtml(site, url);
      } catch (err) {
        console.error(`[scrape-snapshot] ${site} debug fetch failed:`, err.message);
      }
    }
  }

  await refresh({ mockMode: false });
  const s = getState();

  // In-play = only fixtures Singapore Pools itself currently has live
  // (odds still on offer), enriched with the real running score from
  // Flashscore (SG Pools' own live feed carries no score/clock).
  const inPlay = s.inPlay || [];
  const sameFixture = (a, b) =>
    (teamsMatch(a.homeTeam, b.homeTeam) && teamsMatch(a.awayTeam, b.awayTeam)) ||
    (teamsMatch(a.homeTeam, b.awayTeam) && teamsMatch(a.awayTeam, b.homeTeam));
  try {
    const fsLive = await fetchFlashscoreLive();
    let matched = 0;
    for (const m of inPlay) {
      const fx = fsLive.find((r) => sameFixture(m, r));
      if (fx) {
        m.liveScore = `${fx.homeGoals}-${fx.awayGoals}`;
        m.liveStage = fx.stage;
        // Flashscore's own recorded kickoff timestamp for this match —
        // more trustworthy than SG Pools' listed kickoff for computing
        // elapsed match time, since SG Pools' can be off by minutes
        // (an early/late actual kickoff, a delay) while this is what
        // Flashscore itself timestamped the match starting.
        if (fx.kickoffISO) m.liveKickoffISO = fx.kickoffISO;
        matched += 1;
      }
    }
    console.error(`[scrape-snapshot] in-play: ${inPlay.length} (${matched} w/ FS score)`);

    // Fallback source (livescore.com) — only consulted, and only fetched at
    // all, when Flashscore left at least one in-play fixture without a
    // score; never races or overrides a Flashscore hit. UNVERIFIED (see
    // src/results/livescoreLive.js) so a fetch/parse failure or a markup
    // change this can't handle just yields [] and leaves those fixtures
    // exactly as they were.
    const stillUnmatched = inPlay.filter((m) => !m.liveScore);
    if (stillUnmatched.length) {
      try {
        const lsLive = await fetchLivescoreLive();
        let lsMatched = 0;
        for (const m of stillUnmatched) {
          const fx = lsLive.find((r) => sameFixture(m, r));
          if (fx) {
            m.liveScore = `${fx.homeGoals}-${fx.awayGoals}`;
            lsMatched += 1;
          }
        }
        console.error(`[scrape-snapshot] in-play fallback (livescore.com): ${lsMatched}/${stillUnmatched.length} filled`);
      } catch (err) {
        console.error('[scrape-snapshot] livescore.com fallback failed:', err.message);
      }
    }
  } catch (err) {
    console.error('[scrape-snapshot] flashscore live failed:', err.message);
  }

  const nowISO = new Date().toISOString();
  const snapshot = {
    generatedAt: nowISO,
    matches: s.matches || [],
    bestBet: s.bestBet || null,
    bestValue: s.bestValue || null,
    inPlay,
    lastUpdated: s.lastUpdated || null,
    lastError: s.lastError || null,
    counts: { sgpFixtures: s.sgpFixtureCount ?? 0, tipsterPicks: s.tipsterPickCount ?? 0 },
    rawSgpFixtures: s.rawSgpFixtures || [],
    rawTipsterPicks: s.rawTipsterPicks || [],
  };

  // Same EV method as the board's value picks, scored on statarea's own
  // pick alone rather than the full tipster consensus — see
  // src/services/statareaValue.js.
  for (const m of snapshot.matches) {
    const statareaTip = (m.tipsterConsensus && m.tipsterConsensus.picks || []).find((p) => p.site === 'statarea');
    m.statareaValue = m.odds && statareaTip ? assessStatareaValue(m.odds, statareaTip, s.siteWeights) : null;
  }

  const bySite = {};
  for (const p of snapshot.rawTipsterPicks) {
    const b = (bySite[p.site] = bySite[p.site] || { picks: 0, classified: 0, totals: 0 });
    b.picks += 1;
    if (p.pick) b.classified += 1;
    if (p.totalsPick) b.totals += 1;
  }
  const withMajority = snapshot.matches.filter((m) => m.tipsterConsensus?.majorityPick).length;
  const withOU = snapshot.matches.filter((m) => m.tipsterConsensus?.totalsMajorityPick).length;

  if (snapshot.matches.length === 0 && snapshot.counts.tipsterPicks === 0) {
    console.error('[scrape-snapshot] nothing scraped — not writing anything');
    process.exit(1);
  }
  // Guard against a transient Singapore Pools failure (render throttled /
  // served a near-empty fixture list) nuking a healthy live board: if the
  // fixture count collapsed while the tipster scrape is clearly fine, keep
  // the previous snapshot rather than publishing the broken one.
  if (snapshot.matches.length < 15 && snapshot.counts.tipsterPicks > 50) {
    console.error(
      `[scrape-snapshot] only ${snapshot.matches.length} SG Pools fixtures but ` +
        `${snapshot.counts.tipsterPicks} tipster picks — treating as a transient SG Pools failure, not publishing`
    );
    process.exit(1);
  }

  // ---- prediction history + accuracy grading + value-pick log(s) ----
  const [prevHistory, prevAccuracy, prevValuePicks, prevStatareaPicks, prevMatchInfo, prevOddsHistory] = await Promise.all([
    loadPublished('history.json', { entries: [] }),
    loadPublished('accuracy.json', { samples: [] }),
    loadPublished('value-picks.json', { picks: [] }),
    loadPublished('statarea-picks.json', { picks: [] }),
    loadPublished('match-info.json', { entries: [] }),
    loadPublished('odds-history.json', { entries: [] }),
  ]);

  const history = mergeHistory(prevHistory, snapshot.matches, nowISO);

  // Rolling per-fixture price history (src/results/oddsHistory.js) — only
  // appends a new point when SG Pools' price actually moved since the last
  // one recorded, so most cycles are a no-op. Covers both boards: a
  // fixture's line can keep drifting once it's live too.
  const oddsHistory = mergeOddsHistory(prevOddsHistory, [...snapshot.matches, ...snapshot.inPlay], nowISO);

  // H2H + recent form (Forebet) for each SG Pools fixture Forebet also
  // covers — see src/results/matchInfo.js. Mutates snapshot.matches,
  // attaching `headToHead` where available; cached/rate-limited so most
  // cycles serve stored data instead of re-fetching every match.
  const forebetRows = snapshot.rawTipsterPicks.filter((p) => p.site === 'forebet');
  let matchInfoCache;
  try {
    matchInfoCache = await attachMatchInfo(snapshot.matches, forebetRows, prevMatchInfo);
  } catch (err) {
    console.error('[scrape-snapshot] match-info attach failed:', err.message || err);
    matchInfoCache = prevMatchInfo;
  }

  // In-play fixtures are a separate array (built fresh from SG Pools' live
  // feed, not carried over from snapshot.matches — see aggregator.js), so
  // without this they'd never get `headToHead` at all: the moment a match
  // kicks off it'd silently lose the H2H/recent-form it already had cached
  // from before kickoff. Every in-play fixture's kickoff is necessarily in
  // the past, so attachMatchInfo's alreadyStarted path just serves the
  // cache here — this never triggers a new fetch.
  try {
    matchInfoCache = await attachMatchInfo(snapshot.inPlay, forebetRows, matchInfoCache);
  } catch (err) {
    console.error('[scrape-snapshot] match-info attach (in-play) failed:', err.message || err);
  }

  // Actual FT scores. Flashscore's feed is the primary source (near-total
  // league coverage); Forebet's results pages and WinDrawWin's "yesterday
  // results" table (archives.js) are kept as fallbacks in case the
  // Flashscore feed's fsign rotates.
  let results = [];
  let fsCount = 0;
  try {
    const fs = await fetchFlashscoreResults();
    fsCount = fs.length;
    results.push(...fs);
  } catch (err) {
    console.error('[scrape-snapshot] flashscore results failed:', err.message);
  }
  try {
    results.push(...(await fetchForebetResults()));
  } catch (err) {
    console.error('[scrape-snapshot] forebet results failed:', err.message);
  }
  try {
    for (const r of await fetchArchivePredictions()) {
      if (Number.isFinite(r.homeGoals) && Number.isFinite(r.awayGoals)) {
        results.push({ homeTeam: r.homeTeam, awayTeam: r.awayTeam, dayISO: r.dayISO || null, homeGoals: r.homeGoals, awayGoals: r.awayGoals });
      }
    }
  } catch (err) {
    console.error('[scrape-snapshot] archive results failed:', err.message);
  }
  console.error(`[scrape-snapshot] FT-score rows: ${results.length} (flashscore ${fsCount})`);

  const graded = grade(history, results, prevAccuracy.samples || [], { windowHours: 48 });
  const accuracy = { ...graded.summary, samples: graded.samples };

  const vpMerged = mergeValuePicks(prevValuePicks, snapshot.matches, nowISO);
  const vpGraded = gradeValuePicks(vpMerged, results);
  const valuePicks = { ...vpGraded, summary: summarizeValuePicks(vpGraded) };

  const spMerged = mergeValuePicks(prevStatareaPicks, snapshot.matches, nowISO, 'statareaValue');
  const spGraded = gradeValuePicks(spMerged, results);
  const statareaPicks = { ...spGraded, summary: summarizeValuePicks(spGraded) };

  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(snapshot, null, 1));
  fs.writeFileSync(path.join(DIR, 'history.json'), JSON.stringify(history));
  fs.writeFileSync(path.join(DIR, 'accuracy.json'), JSON.stringify(accuracy));
  fs.writeFileSync(path.join(DIR, 'value-picks.json'), JSON.stringify(valuePicks));
  fs.writeFileSync(path.join(DIR, 'statarea-picks.json'), JSON.stringify(statareaPicks));
  fs.writeFileSync(path.join(DIR, 'match-info.json'), JSON.stringify(matchInfoCache));
  fs.writeFileSync(path.join(DIR, 'odds-history.json'), JSON.stringify(oddsHistory));

  const withMatchInfo = snapshot.matches.filter((m) => m.headToHead).length;

  console.error(
    `[scrape-snapshot] ${snapshot.matches.length} matches, ` +
      `${snapshot.counts.tipsterPicks} picks ${JSON.stringify(bySite)}, ` +
      `${withMajority} 1X2 maj, ${withOU} O/U maj | ` +
      `history ${history.entries.length} entries, forebet results ${results.length}, ` +
      `+${graded.newlyGraded} graded (${graded.summary.gradedSamples} in 48h window) | ` +
      `value picks: ${valuePicks.picks.length} logged, ${valuePicks.summary.open} open, ` +
      `${valuePicks.summary.settled} settled (+${vpGraded.newlyGraded} new), ` +
      `ROI ${valuePicks.summary.roi == null ? 'n/a' : (valuePicks.summary.roi * 100).toFixed(1) + '%'} | ` +
      `statarea picks: ${statareaPicks.picks.length} logged, ${statareaPicks.summary.open} open, ` +
      `${statareaPicks.summary.settled} settled (+${spGraded.newlyGraded} new), ` +
      `ROI ${statareaPicks.summary.roi == null ? 'n/a' : (statareaPicks.summary.roi * 100).toFixed(1) + '%'} | ` +
      `match info: ${withMatchInfo}/${snapshot.matches.length} matches w/ H2H+form (${matchInfoCache.entries.length} cached)`
  );
  process.exit(0);
})().catch((err) => {
  console.error('[scrape-snapshot] fatal:', err && err.stack ? err.stack : err);
  process.exit(1);
});
