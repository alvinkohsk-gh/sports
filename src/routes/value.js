const express = require('express');
const { fetchBranchJson } = require('../snapshot');
const { SNAPSHOT_REFETCH_MS } = require('../config');

// GET /api/value-picks — the rolling log of VALUE-flagged picks, built by
// scripts/scrape-snapshot.js and published to the data-snapshot branch as
// value-picks.json. Splits open (not yet played) from settled (graded
// against a Forebet result) and returns a flat-1-unit-staking summary.
//
// Optional `from` / `to` (YYYY-MM-DD) filter both lists by the pick's
// kickoff calendar day (UTC). Omit both for everything. The Value Picks
// page also does its own local-date filtering for the range picker; this
// is here for direct API use.
const router = express.Router();

let cache = { data: null, fetchedAt: 0 };
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayOf = (iso) => String(iso || '').slice(0, 10);

function summarize(settled) {
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
  return {
    settledCount: staked,
    won,
    winRate: staked ? Number((won / staked).toFixed(4)) : null,
    stakedUnits: staked,
    returnedUnits: Number(returned.toFixed(2)),
    profitUnits: Number(profit.toFixed(2)),
    roi: staked ? Number((profit / staked).toFixed(4)) : null,
    avgOdd: staked ? Number((settled.reduce((s, p) => s + p.odd, 0) / staked).toFixed(2)) : null,
    byMarket,
  };
}

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

  const all = Array.isArray(vp.picks) ? vp.picks : [];
  const from = DAY_RE.test(req.query.from) ? req.query.from : null;
  const to = DAY_RE.test(req.query.to) ? req.query.to : null;
  const inRange = (p) => {
    const d = dayOf(p.kickoffISO);
    return (!from || d >= from) && (!to || d <= to);
  };
  const picks = from || to ? all.filter(inRange) : all;

  const open = picks.filter((p) => !p.settled).sort((a, b) => b.ev - a.ev);
  const settled = picks
    .filter((p) => p.settled)
    .sort((a, b) => Date.parse(b.kickoffISO) - Date.parse(a.kickoffISO));

  const days = all.map((p) => dayOf(p.kickoffISO)).filter((d) => DAY_RE.test(d)).sort();

  res.json({
    updatedAt: vp.updatedAt || null,
    range: { from, to },
    availableDates: days.length ? { min: days[0], max: days[days.length - 1] } : null,
    open,
    settled,
    summary: { openCount: open.length, ...summarize(settled) },
  });
});

module.exports = router;
