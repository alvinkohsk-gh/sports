const express = require('express');
const { getSnapshot, snapshotAgeMs, snapshotIsFresh } = require('../snapshot');
const { ensureFreshState } = require('../liveState');
const { MOCK_MODE } = require('../config');

// GET /api/matches — the fixture list with tipster consensus + best bet.
// Serves the published snapshot when it's fresh; falls back to a live
// on-demand scrape when it's missing or stale. `source` says which.
const router = express.Router();

const LIVE_SCRAPE_BUDGET_MS = 40000;

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

router.get('/matches', async (req, res) => {
  const snap = await getSnapshot();
  if (snapshotIsFresh(snap)) {
    res.json({
      matches: snap.matches,
      inPlay: snap.inPlay || [],
      bestBet: snap.bestBet,
      bestValue: snap.bestValue || null,
      lastUpdated: snap.lastUpdated,
      lastError: snap.lastError,
      mockMode: MOCK_MODE,
      counts: snap.counts,
      source: 'snapshot',
      snapshotAgeSec: Math.round(snapshotAgeMs(snap) / 1000),
    });
    return;
  }

  // The live scrape can outlast Vercel's 60s function limit (which returns a
  // non-JSON 504 page). Cap it, and prefer a stale snapshot over an error.
  let state;
  try {
    state = await withTimeout(ensureFreshState(), LIVE_SCRAPE_BUDGET_MS);
  } catch (err) {
    console.error('[matches] live fallback failed:', err.message);
    if (snap && Array.isArray(snap.matches)) {
      res.json({
        matches: snap.matches,
        inPlay: snap.inPlay || [],
        bestBet: snap.bestBet,
        bestValue: snap.bestValue || null,
        lastUpdated: snap.lastUpdated || snap.generatedAt,
        lastError: `live scrape failed (${err.message}); showing stale snapshot`,
        mockMode: MOCK_MODE,
        counts: snap.counts,
        source: 'stale-snapshot',
        snapshotAgeSec: Math.round(snapshotAgeMs(snap) / 1000),
      });
      return;
    }
    res.status(503).json({ error: `no data available: ${err.message}` });
    return;
  }
  res.json({
    matches: state.matches,
    inPlay: state.inPlay || [],
    bestBet: state.bestBet,
    bestValue: state.bestValue || null,
    lastUpdated: state.lastUpdated,
    lastError: state.lastError,
    mockMode: MOCK_MODE,
    counts: {
      sgpFixtures: state.sgpFixtureCount,
      tipsterPicks: state.tipsterPickCount,
    },
    source: 'live',
    staleSnapshotAgeSec: snap ? Math.round(snapshotAgeMs(snap) / 1000) : null,
  });
});

module.exports = router;
