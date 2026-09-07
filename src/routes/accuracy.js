const express = require('express');
const { fetchBranchJson } = require('../snapshot');
const { SNAPSHOT_REFETCH_MS } = require('../config');

// GET /api/accuracy?hours=N — per-site prediction accuracy, graded by
// scripts/scrape-snapshot.js (and seeded by scripts/backfill.js) against
// Forebet results and published to the data-snapshot branch as
// accuracy.json. `hours` recomputes the per-site summary over a custom
// window (1..240, default = the file's own windowHours or 48) from the raw
// graded samples.
const router = express.Router();

let accuracyCache = { data: null, fetchedAt: 0 };

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

  const samples = acc.samples || [];
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
    perSite,
    recent: samples
      .slice()
      .sort((a, b) => Date.parse(b.kickoffISO) - Date.parse(a.kickoffISO))
      .slice(0, 60),
  });
});

module.exports = router;
