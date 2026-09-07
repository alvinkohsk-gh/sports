/*
 * One-off / on-demand back-fill for the accuracy dashboard.
 *
 * Scrapes the sites that keep a dated prediction archive (Forebet,
 * WinDrawWin, PredictZ "yesterday" pages + MatchOutlook's) where each row
 * carries the site's own past prediction AND the final score, grades them
 * directly, and merges the samples into the published accuracy.json.
 * Sites without a retrievable archive (WhoScored, Sports Mole, FootyStats,
 * EaglePredict) can't be back-filled — they'll only appear once forward
 * history accumulates.
 *
 * Runs in .github/workflows/backfill.yml (needs FlareSolverr). Writes
 * accuracy.json to the cwd for the workflow to publish.
 */
const fs = require('fs');
const path = require('path');
const { fetchArchivePredictions } = require('../src/results/archives');
const { summarize } = require('../src/results/accuracy');
const { matchKey } = require('../src/results/history');

const DIR = process.argv[2] || '.';
const REPO = process.env.SNAPSHOT_REPO || 'alvinkohsk-gh/sports';
const BRANCH = process.env.SNAPSHOT_BRANCH || 'data-snapshot';

const yesterdayISO = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

function outcome1x2(h, a) {
  return h > a ? 'home' : a > h ? 'away' : 'draw';
}

async function loadPublished(file, fallback) {
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${REPO}/${BRANCH}/${file}?t=${Date.now()}`, {
      cache: 'no-store',
    });
    if (res.ok) return await res.json();
  } catch (err) {
    console.error(`[backfill] load ${file}: ${err.message}`);
  }
  return fallback;
}

(async () => {
  const rows = await fetchArchivePredictions();
  console.error(`[backfill] archive rows with a result: ${rows.length}`);

  const bySrc = {};
  const samples = [];
  for (const r of rows) {
    const day = r.dayISO || yesterdayISO();
    const kickoffISO = `${day}T12:00:00.000Z`;
    const act = outcome1x2(r.homeGoals, r.awayGoals);
    const total = r.homeGoals + r.awayGoals;

    let oneX2Correct = null;
    if (r.pick) oneX2Correct = r.pick === act;
    let ouCorrect = null;
    if (r.totalsPick && Number.isFinite(r.totalsPick.point)) {
      ouCorrect = (r.totalsPick.selection === 'over') === total > r.totalsPick.point;
    }
    if (oneX2Correct === null && ouCorrect === null) continue;

    bySrc[r.site] = (bySrc[r.site] || 0) + 1;
    samples.push({
      matchKey: matchKey(r.homeTeam, r.awayTeam, kickoffISO),
      site: r.site,
      kickoffISO,
      league: null,
      fixture: `${r.homeTeam} vs ${r.awayTeam}`,
      score: `${r.homeGoals}-${r.awayGoals}`,
      pick: r.pick || null,
      actual1x2: act,
      oneX2Correct,
      ou: r.totalsPick ? `${r.totalsPick.selection} ${r.totalsPick.point}` : null,
      ouCorrect,
      gradedAt: new Date().toISOString(),
      backfilled: true,
    });
  }
  console.error(`[backfill] graded samples by site: ${JSON.stringify(bySrc)}`);

  const prev = await loadPublished('accuracy.json', { samples: [] });
  const merged = new Map();
  for (const s of prev.samples || []) merged.set(`${s.matchKey}::${s.site}`, s);
  for (const s of samples) {
    const k = `${s.matchKey}::${s.site}`;
    if (!merged.has(k)) merged.set(k, s); // don't clobber a real forward-graded sample
  }
  const all = [...merged.values()].filter(
    (s) => Date.now() - (Date.parse(s.kickoffISO) || Date.now()) < 5 * 24 * 60 * 60 * 1000
  );

  const accuracy = { ...summarize(all, 48, Date.now()), samples: all };
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, 'accuracy.json'), JSON.stringify(accuracy));
  console.error(
    `[backfill] wrote accuracy.json — ${all.length} total samples, ` +
      `${accuracy.gradedSamples} in the 48h window, sites: ${Object.keys(accuracy.perSite).join(', ') || 'none'}`
  );
  if (!samples.length) process.exit(1); // nothing scraped — let the workflow skip publish
  process.exit(0);
})().catch((err) => {
  console.error('[backfill] fatal:', err && err.stack ? err.stack : err);
  process.exit(1);
});
