const express = require('express');
const { getSnapshot, snapshotAgeMs, snapshotIsFresh } = require('../snapshot');
const { ensureFreshState } = require('../liveState');
const { MOCK_MODE } = require('../config');

// GET /api/matches — the fixture list with tipster consensus + best bet.
// Serves the published snapshot when it's fresh; falls back to a live
// on-demand scrape when it's missing or stale. `source` says which.
const router = express.Router();

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

  const state = await ensureFreshState();
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
