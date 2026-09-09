const express = require('express');
const { fetchBranchJson, getSnapshot } = require('../snapshot');
const { normalizeTeamName } = require('../services/matcher');
const { SNAPSHOT_REFETCH_MS } = require('../config');

// GET /api/accuracy — per-site prediction accuracy, graded by
// scripts/scrape-snapshot.js (and seeded by scripts/backfill.js) against
// Forebet results and published to the data-snapshot branch as
// accuracy.json. `?from=YYYY-MM-DD&to=YYYY-MM-DD` restricts the per-site
// summary to samples whose match kicked off in that day range (UTC);
// `?hours=N` is the older recent-window form, used when no from/to is
// given. The full SG-Pools-filtered `samples` array is returned so the
// Results page can re-filter by the viewer's local date.
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
  const sgSamples = pairs.size
    ? allSamples.filter((s) => pairs.has(pairFromMatchKey(s.matchKey)))
    : allSamples;

  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  const dayOf = (iso) => String(iso || '').slice(0, 10);
  // SG Pools tags in-play events "… (Live)"; strip it so a league doesn't
  // split into two entries.
  const cleanLeague = (l) => (l ? String(l).replace(/\s*\(live\)\s*$/i, '').trim() || null : null);
  const from = DAY_RE.test(req.query.from) ? req.query.from : null;
  const to = DAY_RE.test(req.query.to) ? req.query.to : null;

  let scoped;
  if (from || to) {
    scoped = sgSamples.filter((s) => {
      const d = dayOf(s.kickoffISO);
      return (!from || d >= from) && (!to || d <= to);
    });
  } else {
    const hours = Math.min(Math.max(Number(req.query.hours) || acc.windowHours || 48, 1), 240);
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    scoped = sgSamples.filter((s) => (Date.parse(s.kickoffISO) || 0) >= cutoff);
  }

  const perSite = {};
  for (const s of scoped) {
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

  const days = sgSamples.map((s) => dayOf(s.kickoffISO)).filter((d) => DAY_RE.test(d)).sort();

  // Finished SG Pools matches we have picks for but couldn't grade (no
  // matching Forebet result). Emitted as `pending` rows so the Results
  // table shows every finished game, not just the graded subset — they
  // don't count toward the per-site accuracy.
  const gradedKeys = new Set(sgSamples.map((s) => `${s.matchKey}::${s.site}`));
  const nowMs = Date.now();
  const pending = [];
  for (const e of historyCache.data?.entries || []) {
    const ageH = (nowMs - (Date.parse(e.kickoffISO) || nowMs)) / 3600000;
    if (ageH < 2 || ageH > 24 * 40) continue; // finished, within retention
    if (gradedKeys.has(`${e.matchKey}::${e.site}`)) continue;
    if (!e.pick && !e.totalsPick) continue;
    pending.push({
      matchKey: e.matchKey,
      site: e.site,
      kickoffISO: e.kickoffISO,
      league: cleanLeague(e.league),
      fixture: `${e.homeTeam} vs ${e.awayTeam}`,
      score: null,
      pick: e.pick || null,
      oneX2Correct: null,
      ou: e.totalsPick ? `${e.totalsPick.selection} ${e.totalsPick.point}` : null,
      ouCorrect: null,
      pending: true,
    });
  }

  res.json({
    updatedAt: acc.updatedAt || null,
    range: { from, to },
    availableDates: days.length ? { min: days[0], max: days[days.length - 1] } : null,
    gradedSamples: scoped.length,
    sgPoolsOnly: pairs.size > 0,
    totalGradedSamples: allSamples.length,
    perSite,
    // full SG-Pools-filtered set (newest first, capped) so the page can
    // re-scope by local date without another request
    samples: sgSamples
      .slice()
      .sort((a, b) => Date.parse(b.kickoffISO) - Date.parse(a.kickoffISO))
      .slice(0, 6000)
      .map((s) => ({
        matchKey: s.matchKey,
        site: s.site,
        kickoffISO: s.kickoffISO,
        league: cleanLeague(s.league),
        fixture: s.fixture,
        score: s.score,
        pick: s.pick || null,
        oneX2Correct: s.oneX2Correct ?? null,
        ou: s.ou || null,
        ouCorrect: s.ouCorrect ?? null,
      })),
    pending: pending.slice(0, 3000),
  });
});

module.exports = router;
