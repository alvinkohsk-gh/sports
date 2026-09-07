/*
 * Runs the full scrape (Singapore Pools fixtures + all tipster sites +
 * consensus matching) once, then folds the picks into a rolling prediction
 * history and grades finished predictions against Forebet results. Writes:
 *   snapshot.json     — current board (src/app.js serves this)
 *   history.json      — rolling per-(fixture,site) picks, ~6 days
 *   accuracy.json     — graded samples + per-site accuracy summary
 *   value-picks.json  — rolling log of VALUE-flagged picks, graded once played
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
const { fetchForebetResults } = require('../src/results/forebetResults');
const { grade } = require('../src/results/accuracy');
const { mergeValuePicks, gradeValuePicks, summarizeValuePicks } = require('../src/results/valuePicks');

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
  await refresh({ mockMode: false });
  const s = getState();

  const nowISO = new Date().toISOString();
  const snapshot = {
    generatedAt: nowISO,
    matches: s.matches || [],
    bestBet: s.bestBet || null,
    bestValue: s.bestValue || null,
    lastUpdated: s.lastUpdated || null,
    lastError: s.lastError || null,
    counts: { sgpFixtures: s.sgpFixtureCount ?? 0, tipsterPicks: s.tipsterPickCount ?? 0 },
    rawSgpFixtures: s.rawSgpFixtures || [],
    rawTipsterPicks: s.rawTipsterPicks || [],
  };

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

  // ---- prediction history + accuracy grading + value-pick log ----
  const [prevHistory, prevAccuracy, prevValuePicks] = await Promise.all([
    loadPublished('history.json', { entries: [] }),
    loadPublished('accuracy.json', { samples: [] }),
    loadPublished('value-picks.json', { picks: [] }),
  ]);

  const history = mergeHistory(prevHistory, snapshot.matches, nowISO);

  let results = [];
  try {
    results = await fetchForebetResults();
  } catch (err) {
    console.error('[scrape-snapshot] forebet results failed:', err.message);
  }

  const graded = grade(history, results, prevAccuracy.samples || [], { windowHours: 48 });
  const accuracy = { ...graded.summary, samples: graded.samples };

  const vpMerged = mergeValuePicks(prevValuePicks, snapshot.matches, nowISO);
  const vpGraded = gradeValuePicks(vpMerged, results);
  const valuePicks = { ...vpGraded, summary: summarizeValuePicks(vpGraded) };

  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(snapshot, null, 1));
  fs.writeFileSync(path.join(DIR, 'history.json'), JSON.stringify(history));
  fs.writeFileSync(path.join(DIR, 'accuracy.json'), JSON.stringify(accuracy));
  fs.writeFileSync(path.join(DIR, 'value-picks.json'), JSON.stringify(valuePicks));

  console.error(
    `[scrape-snapshot] ${snapshot.matches.length} matches, ` +
      `${snapshot.counts.tipsterPicks} picks ${JSON.stringify(bySite)}, ` +
      `${withMajority} 1X2 maj, ${withOU} O/U maj | ` +
      `history ${history.entries.length} entries, forebet results ${results.length}, ` +
      `+${graded.newlyGraded} graded (${graded.summary.gradedSamples} in 48h window) | ` +
      `value picks: ${valuePicks.picks.length} logged, ${valuePicks.summary.open} open, ` +
      `${valuePicks.summary.settled} settled (+${vpGraded.newlyGraded} new), ` +
      `ROI ${valuePicks.summary.roi == null ? 'n/a' : (valuePicks.summary.roi * 100).toFixed(1) + '%'}`
  );
  process.exit(0);
})().catch((err) => {
  console.error('[scrape-snapshot] fatal:', err && err.stack ? err.stack : err);
  process.exit(1);
});
