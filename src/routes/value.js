const express = require('express');
const { fetchBranchJson } = require('../snapshot');
const { SNAPSHOT_REFETCH_MS } = require('../config');

// GET /api/value-picks — the rolling log of VALUE-flagged picks, built by
// scripts/scrape-snapshot.js and published to the data-snapshot branch as
// value-picks.json. Splits open (not yet played) from settled (graded
// against a Forebet result) and returns a flat-1-unit-staking summary.
// `?hours=N` narrows the settled summary to a recent window.
const router = express.Router();

let cache = { data: null, fetchedAt: 0 };

router.get('/value-picks', async (req, res) => {
  let vp = cache.data;
  if (!vp || Date.now() - cache.fetchedAt > SNAPSHOT_REFETCH_MS) {
    try {
      vp = await fetchBranchJson('value-picks.json');
      cache = { data: vp, fetchedAt: Date.now() };
    } catch (err) {
      if (!vp) {
        res.status(503).json({ error: 'value-picks data not available yet', detail: err.message });
        return;
      }
    }
  }

  const picks = Array.isArray(vp.picks) ? vp.picks : [];
  const hours = Math.min(Math.max(Number(req.query.hours) || 0, 0), 720);
  const cutoff = hours ? Date.now() - hours * 60 * 60 * 1000 : 0;

  const open = picks
    .filter((p) => !p.settled)
    .sort((a, b) => b.ev - a.ev);
  const settled = picks
    .filter((p) => p.settled && (Date.parse(p.kickoffISO) || 0) >= cutoff)
    .sort((a, b) => Date.parse(b.kickoffISO) - Date.parse(a.kickoffISO));

  const won = settled.filter((p) => p.won).length;
  const staked = settled.length;
  const returned = settled.reduce((s, p) => s + (p.won ? p.odd : 0), 0);
  const profit = returned - staked;
  const byMarket = {};
  for (const p of settled) {
    const b = (byMarket[p.market] = byMarket[p.market] || { n: 0, won: 0, profitUnits: 0 });
    b.n += 1;
    if (p.won) b.won += 1;
    b.profitUnits = Number((b.profitUnits + p.profitUnits).toFixed(2));
  }

  res.json({
    updatedAt: vp.updatedAt || null,
    windowHours: hours || null,
    open,
    settled,
    summary: {
      openCount: open.length,
      settledCount: settled.length,
      won,
      winRate: staked ? Number((won / staked).toFixed(4)) : null,
      stakedUnits: staked,
      returnedUnits: Number(returned.toFixed(2)),
      profitUnits: Number(profit.toFixed(2)),
      roi: staked ? Number((profit / staked).toFixed(4)) : null,
      avgOdd: staked ? Number((settled.reduce((s, p) => s + p.odd, 0) / staked).toFixed(2)) : null,
      byMarket,
    },
  });
});

module.exports = router;
