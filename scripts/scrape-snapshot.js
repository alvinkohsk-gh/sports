/*
 * Runs the full scrape (Singapore Pools fixtures + all 5 tipster sites +
 * consensus matching) once and writes the result to a JSON snapshot.
 *
 * Meant to run OUTSIDE the request path — in GitHub Actions on a schedule
 * (see .github/workflows/snapshot.yml) — where there's a real Chromium
 * (not @sparticuz/chromium-min's fragile --single-process build), no 60s
 * function limit, and an IP that Cloudflare-protected tipster sites don't
 * blanket-403 the way they do Vercel's. The Vercel app then just serves
 * this snapshot (src/app.js), falling back to an on-demand scrape only
 * when the snapshot is missing or stale.
 *
 * Usage: node scripts/scrape-snapshot.js [outfile]   (default: snapshot.json)
 */
const fs = require('fs');
const { refresh, getState } = require('../src/services/aggregator');

const OUT = process.argv[2] || 'snapshot.json';

(async () => {
  await refresh({ mockMode: false });
  const s = getState();

  const snapshot = {
    generatedAt: new Date().toISOString(),
    matches: s.matches || [],
    bestBet: s.bestBet || null,
    lastUpdated: s.lastUpdated || null,
    lastError: s.lastError || null,
    counts: {
      sgpFixtures: s.sgpFixtureCount ?? 0,
      tipsterPicks: s.tipsterPickCount ?? 0,
    },
    // kept so /api/debug and /api/debug/tipsters can serve from the snapshot too
    rawSgpFixtures: s.rawSgpFixtures || [],
    rawTipsterPicks: s.rawTipsterPicks || [],
  };

  const bySite = {};
  for (const p of snapshot.rawTipsterPicks) {
    const b = (bySite[p.site] = bySite[p.site] || { picks: 0, classified: 0 });
    b.picks += 1;
    if (p.pick) b.classified += 1;
  }
  const withMajority = snapshot.matches.filter((m) => m.tipsterConsensus?.majorityPick).length;
  console.error(
    `[scrape-snapshot] ${snapshot.matches.length} matches, ` +
      `${snapshot.counts.tipsterPicks} tipster picks ${JSON.stringify(bySite)}, ` +
      `${withMajority} matches with a majority, err=${snapshot.lastError || 'none'}`
  );

  // Total failure (both stages empty) — don't write, so the workflow's
  // publish step is skipped and the last good snapshot stays live. A
  // partial scrape (some sites blocked/slow, or a genuinely empty fixture
  // board while the tipster sites are up) still publishes.
  if (snapshot.matches.length === 0 && snapshot.counts.tipsterPicks === 0) {
    console.error('[scrape-snapshot] nothing scraped — not writing snapshot');
    process.exit(1);
  }

  fs.writeFileSync(OUT, JSON.stringify(snapshot, null, 1));
  console.error(`[scrape-snapshot] wrote ${OUT}`);
  process.exit(0);
})().catch((err) => {
  console.error('[scrape-snapshot] fatal:', err && err.stack ? err.stack : err);
  process.exit(1);
});
