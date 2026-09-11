const { teamsMatch } = require('../services/matcher');

const GRADE_MIN_AGE_MS = 2 * 60 * 60 * 1000; // kicked off >2h ago (finished)
const GRADE_MAX_AGE_MS = 60 * 60 * 60 * 1000; // but not more than 60h ago
const SAMPLE_KEEP_MS = 35 * 24 * 60 * 60 * 1000; // keep graded samples ~5 weeks (Results page date ranges)

function outcome1x2(h, a) {
  if (h > a) return 'home';
  if (a > h) return 'away';
  return 'draw';
}

function findResult(entry, results) {
  const day = (entry.kickoffISO || '').slice(0, 10);
  return results.find((r) => {
    if (r.dayISO && day && Math.abs(Date.parse(r.dayISO) - Date.parse(day)) > 24 * 60 * 60 * 1000) return false;
    return (
      (teamsMatch(entry.homeTeam, r.homeTeam) && teamsMatch(entry.awayTeam, r.awayTeam)) ||
      (teamsMatch(entry.homeTeam, r.awayTeam) && teamsMatch(entry.awayTeam, r.homeTeam))
    );
  });
}

// The SG Pools price on the entry's picked outcome as it stood at the
// moment the pick was captured (entry.capturedAt — the tipster's final
// pre-kickoff call keeps overwriting this right up until kickoff, so it's
// the closing-line-adjacent capture time, same spirit as valuePicks.js's
// CLV tracking) — not the current/closing price, which is a different
// question. Pulled from oddsHistory.js's rolling per-fixture price series;
// only ever looks at points at or before the capture time, so a fixture
// with no price recorded yet by then reads as unavailable (null) rather
// than showing a later, wrong-for-the-moment price.
function oddAtCapture(entry, oddsHistoryByKey) {
  const points = oddsHistoryByKey.get(entry.matchKey);
  if (!points || !points.length) return { oneX2: null, ou: null };
  const capturedMs = entry.capturedAt || Date.parse(entry.kickoffISO) || 0;
  let asOf = null;
  for (const p of points) {
    const t = Date.parse(p.capturedAtISO) || 0;
    if (t <= capturedMs) asOf = p;
    else break; // points are appended in chronological order
  }
  if (!asOf) return { oneX2: null, ou: null };

  const oneX2 = entry.pick && asOf.oneX2 ? asOf.oneX2[entry.pick] ?? null : null;
  const ou =
    entry.totalsPick && asOf.ou && asOf.ou.point === entry.totalsPick.point
      ? asOf.ou[entry.totalsPick.selection] ?? null
      : null;
  return { oneX2, ou };
}

/**
 * Grades any history entry that (a) has a matching Forebet result, (b)
 * kicked off 2-60h ago, and (c) isn't graded yet, then returns the full
 * rolling sample set (old + new, pruned to ~5 days) plus a per-site
 * accuracy summary over the last `windowHours`.
 */
function grade(history, results, prevSamples, { windowHours = 48, nowMs = Date.now(), oddsHistory = null } = {}) {
  const already = new Set((prevSamples || []).map((s) => `${s.matchKey}::${s.site}`));
  const fresh = [];
  const oddsHistoryByKey = new Map((oddsHistory?.entries || []).map((e) => [e.matchKey, e.points || []]));

  for (const e of history.entries || []) {
    const id = `${e.matchKey}::${e.site}`;
    if (already.has(id)) continue;
    const age = nowMs - (Date.parse(e.kickoffISO) || nowMs);
    if (age < GRADE_MIN_AGE_MS || age > GRADE_MAX_AGE_MS) continue;

    const r = findResult(e, results);
    if (!r) continue;

    const act = outcome1x2(r.homeGoals, r.awayGoals);
    const total = r.homeGoals + r.awayGoals;

    let oneX2Correct = null;
    if (e.pick) oneX2Correct = e.pick === act;

    let ouCorrect = null;
    if (e.totalsPick && Number.isFinite(e.totalsPick.point)) {
      const actualOver = total > e.totalsPick.point;
      ouCorrect = (e.totalsPick.selection === 'over') === actualOver;
    }
    if (oneX2Correct === null && ouCorrect === null) continue;

    const odds = oddsHistoryByKey.size ? oddAtCapture(e, oddsHistoryByKey) : { oneX2: null, ou: null };

    fresh.push({
      matchKey: e.matchKey,
      site: e.site,
      kickoffISO: e.kickoffISO,
      league: e.league || null,
      fixture: `${e.homeTeam} vs ${e.awayTeam}`,
      score: `${r.homeGoals}-${r.awayGoals}`,
      pick: e.pick || null,
      actual1x2: act,
      oneX2Correct,
      // SG Pools price on the pick at the moment it was captured (see
      // oddAtCapture) — null when the fixture had no recorded odds-
      // history point by then (e.g. graded from before that feature
      // existed, or Forebet-only coverage with no SG Pools price at all).
      oneX2Odd: odds.oneX2,
      ou: e.totalsPick ? `${e.totalsPick.selection} ${e.totalsPick.point}` : null,
      ouCorrect,
      ouOdd: odds.ou,
      gradedAt: new Date(nowMs).toISOString(),
    });
  }

  const samples = [...(prevSamples || []), ...fresh].filter(
    (s) => nowMs - (Date.parse(s.kickoffISO) || nowMs) < SAMPLE_KEEP_MS
  );

  return { samples, newlyGraded: fresh.length, summary: summarize(samples, windowHours, nowMs) };
}

function summarize(samples, windowHours, nowMs) {
  const cutoff = nowMs - windowHours * 60 * 60 * 1000;
  const perSite = {};
  let n = 0;
  for (const s of samples) {
    if ((Date.parse(s.kickoffISO) || 0) < cutoff) continue;
    n += 1;
    const b = (perSite[s.site] = perSite[s.site] || { oneX2Correct: 0, oneX2Total: 0, ouCorrect: 0, ouTotal: 0 });
    if (s.oneX2Correct !== null) {
      b.oneX2Total += 1;
      if (s.oneX2Correct) b.oneX2Correct += 1;
    }
    if (s.ouCorrect !== null) {
      b.ouTotal += 1;
      if (s.ouCorrect) b.ouCorrect += 1;
    }
  }
  for (const b of Object.values(perSite)) {
    b.oneX2Pct = b.oneX2Total ? Math.round((100 * b.oneX2Correct) / b.oneX2Total) : null;
    b.ouPct = b.ouTotal ? Math.round((100 * b.ouCorrect) / b.ouTotal) : null;
  }
  return { windowHours, gradedSamples: n, perSite, updatedAt: new Date(nowMs).toISOString() };
}

module.exports = { grade, summarize, findResult, outcome1x2, GRADE_MIN_AGE_MS, GRADE_MAX_AGE_MS };
