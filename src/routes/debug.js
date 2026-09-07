const express = require('express');
const { getSnapshot, snapshotAgeMs, snapshotIsFresh } = require('../snapshot');
const { ensureFreshState } = require('../liveState');
const { getLastCapture } = require('../scrapers/singaporePools');
const { MOCK_MODE } = require('../config');

// Diagnostic endpoints for "why are there no matches". Each traces a
// pipeline stage (SG Pools fixtures found -> tipster picks found -> picks
// attached -> consensus) so a 0 can be pinned to the right stage without
// re-running anything or reading server logs.
const router = express.Router();

// Resolves the data the debug endpoints report on: the published snapshot
// when it's fresh, otherwise a live on-demand scrape. Normalizes the two
// shapes (snapshot has `counts`, live state has `sgpFixtureCount` etc.).
async function debugSource() {
  const snap = await getSnapshot();
  if (snapshotIsFresh(snap)) {
    return {
      source: 'snapshot',
      ageSec: Math.round(snapshotAgeMs(snap) / 1000),
      lastUpdated: snap.lastUpdated,
      lastError: snap.lastError,
      matches: snap.matches || [],
      rawSgpFixtures: snap.rawSgpFixtures || [],
      rawTipsterPicks: snap.rawTipsterPicks || [],
      tipsterPickCount: snap.counts?.tipsterPicks ?? (snap.rawTipsterPicks || []).length,
    };
  }
  const state = await ensureFreshState();
  return {
    source: 'live',
    ageSec: null,
    lastUpdated: state.lastUpdated,
    lastError: state.lastError,
    matches: state.matches || [],
    rawSgpFixtures: state.rawSgpFixtures || [],
    rawTipsterPicks: state.rawTipsterPicks || [],
    tipsterPickCount: state.tipsterPickCount ?? 0,
  };
}

// Stage counts: SG Pools fixtures found, tipster picks found, matches shown.
router.get('/debug', async (req, res) => {
  const d = await debugSource();
  res.json({
    mockMode: MOCK_MODE,
    source: d.source,
    snapshotAgeSec: d.ageSec,
    lastUpdated: d.lastUpdated,
    lastError: d.lastError,
    stageCounts: {
      sgpFixturesFound: d.rawSgpFixtures.length,
      tipsterPicksFound: d.tipsterPickCount,
      matchesShown: d.matches.length,
    },
    sampleSgpFixtures: d.rawSgpFixtures.slice(0, 5),
  });
});

// The tipster-matching stage directly: every raw pick each site returned,
// and for each SG Pools fixture which picks got attached. Tells "no
// consensus from a name-matching miss" (picks exist, 0 attached) apart
// from "scrape returned nothing" (site has 0 picks) and "prose parsing
// left pick=null" (attached but unclassified).
router.get('/debug/tipsters', async (req, res) => {
  const d = await debugSource();
  const bySite = {};
  for (const p of d.rawTipsterPicks) {
    (bySite[p.site] = bySite[p.site] || []).push({ homeTeam: p.homeTeam, awayTeam: p.awayTeam, pick: p.pick });
  }
  res.json({
    source: d.source,
    snapshotAgeSec: d.ageSec,
    lastUpdated: d.lastUpdated,
    rawPickCount: d.rawTipsterPicks.length,
    rawPicksBySite: bySite,
    fixtures: d.matches.map((m) => ({
      fixture: `${m.homeTeam} vs ${m.awayTeam}`,
      attachedPicks: m.tipsterConsensus.picks.map((p) => `${p.site}:${p.pick ?? '?'}`),
      majorityPick: m.tipsterConsensus.majorityPick,
      majorityCount: m.tipsterConsensus.majorityCount,
      totalTipsters: m.tipsterConsensus.totalTipsters,
    })),
  });
});

// The last Singapore Pools page render this instance captured — separate
// from /api/debug since it can be tens of KB — so real selectors can be
// written from what the site actually returns, without filesystem access
// to Vercel's /tmp (where the DEBUG-mode dump otherwise goes unreachable).
router.get('/debug/sgpools-raw', async (req, res) => {
  await ensureFreshState();
  const capture = getLastCapture();
  if (!capture) {
    res.status(404).json({ error: 'No capture yet — the SG Pools scraper has not run in this instance.' });
    return;
  }
  res.json(capture);
});

module.exports = router;
