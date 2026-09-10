const express = require('express');
const { fetchBranchJson } = require('../snapshot');
const { SNAPSHOT_REFETCH_MS } = require('../config');

// GET /api/odds-history?matchKey=<key> — one fixture's SG Pools price
// history (src/results/oddsHistory.js), fetched on demand rather than
// embedded in /api/matches: with a price point recorded on every real
// move for every open fixture, inlining it on the main board payload
// would bloat every poll of GET /api/matches for a feature only looked at
// per-match. `matchKey` comes from the `matchKey` field the board already
// attaches to each match object (src/services/aggregator.js).
const router = express.Router();

let cache = { data: null, fetchedAt: 0 };

router.get('/odds-history', async (req, res) => {
  let oh = cache.data;
  if (!oh || Date.now() - cache.fetchedAt > SNAPSHOT_REFETCH_MS) {
    try {
      oh = await fetchBranchJson('odds-history.json');
      cache = { data: oh, fetchedAt: Date.now() };
    } catch (err) {
      if (!oh) {
        res.status(503).json({ error: 'odds-history data not available yet', detail: err.message });
        return;
      }
    }
  }

  const key = req.query.matchKey;
  if (!key) {
    res.status(400).json({ error: 'matchKey query param is required' });
    return;
  }

  const entry = (oh.entries || []).find((e) => e.matchKey === key);
  res.json({
    updatedAt: oh.updatedAt || null,
    matchKey: key,
    points: entry ? entry.points : [],
  });
});

module.exports = router;
