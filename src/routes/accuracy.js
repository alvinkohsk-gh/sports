const express = require('express');
const { fetchBranchJson, getSnapshot } = require('../snapshot');
const { normalizeTeamName } = require('../services/matcher');
const { SNAPSHOT_REFETCH_MS } = require('../config');

// GET /api/accuracy?hours=N — per-site prediction accuracy, graded by
// scripts/scrape-snapshot.js (and seeded by scripts/backfill.js) against
// Forebet results and published to the data-snapshot branch as
// accuracy.json. `hours` recomputes the per-site summary over a custom
// window (1..240, default = the file's own windowHours or 48) from the raw
// graded samples.
//
// Only fixtures Singapore Pools offers are shown. The graded set is
// filtered against the SG Pools board — every fixture in the current
// snapshot plus every fixture in the rolling prediction history
// (history.json, ~6 days, itself built only from SG Pools fixtures) —
// matched on the normalized team pair, order-insensitive. Samples for
// matches SG Pools never listed (the backfill pulls a site's whole
// results page) are dropped. If neither the snapshot nor the history is
// available the filter is skipped rather than blanking the page.
const router = express.Router();

let accuracyCache = { data: null, fetchedAt: 0 };
let historyCache = { data: null, fetchedAt: 0 };

function teamPair(homeRaw, awayRaw) {
  const h = normalizeTeamName(homeRaw);
  const a = normalizeTeamName(awayRaw);
  return h && a ? `${h}|${a}` : null;
}

// key already normalized: "home|away|day" -> "home|away"
function pairFromMatchKey(matchKey) {
  const parts = String(matchKey || '').split('|');
  return parts.length >= 2 ? `${parts[0]}|${parts[1]}` : null;
}

async function sgPoolsPairs() {
  if (!historyCache.data || Date.now() - historyCache.fetchedAt > SNAPSHOT_REFETCH_MS) {
    try {
      historyCache = { data: await fetchBranchJson('history.json'), fetchedAt: Date.now() };
    } catch {
      historyCache = { data: historyCache.data, fetchedAt: Date.now() };
    }
  }

  const pairs = new Set();
  const add = (p) => {
    if (!p) return;
    const [h, a] = p.split('|');
    pairs.add(`${h}|${a}`);
    pairs.add(`${a}|${h}`);
  };

  for (const e of historyCache.data?.entries || []) add(pairFromMatchKey(e.matchKey));

  try {
    const snap = await getSnapshot();
    for (const m of snap?.matches || []) add(teamPair(m.homeTeam, m.awayTeam));
    for (const f of snap?.rawSgpFixtures || []) add(teamPair(f.homeTeam, f.awayTeam));
  } catch {
    /* snapshot unavailable — history alone still filters */
  }

  return pairs;
}

router.get('/accuracy', async (req, res) => {
  let acc = accuracyCache.data;
  if (!acc || Date.now() - accuracyCache.fetchedAt > SNAPSHOT_REFETCH_MS) {
    try {
      acc = await fetchBranchJson('accuracy.json');
      accuracyCache = { data: acc, fetchedAt: Date.now() };
    } catch (err) {
      if (!acc) {
        res.status(503).json({ error: 'accuracy data not available yet', detail: err.message });
        return;
      }
    }
  }

  const allSamples = acc.samples || [];
  const pairs = await sgPoolsPairs();
  // Fail open: if we couldn't build any allowlist, don't hide everything.
  const samples = pairs.size
    ? allSamples.filter((s) => pairs.has(pairFromMatchKey(s.matchKey)))
    : allSamples;

  const hours = Math.min(Math.max(Number(req.query.hours) || acc.windowHours || 48, 1), 240);
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const perSite = {};
  let graded = 0;
  for (const s of samples) {
    if ((Date.parse(s.kickoffISO) || 0) < cutoff) continue;
    graded += 1;
    const b = (perSite[s.site] = perSite[s.site] || { oneX2Correct: 0, oneX2Total: 0, ouCorrect: 0, ouTotal: 0 });
    if (s.oneX2Correct !== null && s.oneX2Correct !== undefined) {
      b.oneX2Total += 1;
      if (s.oneX2Correct) b.oneX2Correct += 1;
    }
    if (s.ouCorrect !== null && s.ouCorrect !== undefined) {
      b.ouTotal += 1;
      if (s.ouCorrect) b.ouCorrect += 1;
    }
  }
  for (const b of Object.values(perSite)) {
    b.oneX2Pct = b.oneX2Total ? Math.round((100 * b.oneX2Correct) / b.oneX2Total) : null;
    b.ouPct = b.ouTotal ? Math.round((100 * b.ouCorrect) / b.ouTotal) : null;
  }

  res.json({
    windowHours: hours,
    updatedAt: acc.updatedAt || null,
    gradedSamples: graded,
    sgPoolsOnly: pairs.size > 0,
    totalGradedSamples: allSamples.length,
    perSite,
    recent: samples
      .slice()
      .sort((a, b) => Date.parse(b.kickoffISO) - Date.parse(a.kickoffISO))
      .slice(0, 60),
  });
});

module.exports = router;
