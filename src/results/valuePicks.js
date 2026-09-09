const { matchKey } = require('./history');
const { findResult, outcome1x2, GRADE_MIN_AGE_MS, GRADE_MAX_AGE_MS } = require('./accuracy');

// A rolling log of every VALUE-flagged pick the board has shown, so the
// Value Picks page can display each one's outcome once the match finishes.
// Keyed by fixture + market + selection; the odd/EV kept are the last ones
// seen before kickoff (the pick as it stood when it was actually bettable).
const PRUNE_AFTER_MS = 6 * 24 * 60 * 60 * 1000;
// Settled picks are kept ~5 weeks so the Value Picks page can show a
// record over an arbitrary date range.
const KEEP_SETTLED_MS = 35 * 24 * 60 * 60 * 1000;

function flaggedOutcomes(match, valueKey = 'value') {
  const v = match[valueKey];
  if (!v) return [];
  const out = [];
  const ouPoint = match.odds && match.odds.ou ? match.odds.ou.point : null;
  const markets = [
    ['1X2', v.oneX2, null],
    [ouPoint != null ? `O/U ${ouPoint}` : null, v.ou, ouPoint],
  ];
  for (const [market, a, point] of markets) {
    if (!a || !Array.isArray(a.outcomes)) continue;
    for (const o of a.outcomes) {
      if (o.value) out.push({ market, point, ...o });
    }
  }
  return out;
}

/**
 * Fold the current board's value picks into the rolling log. A pick seen
 * before kickoff has its odd/EV refreshed; once kickoff passes we stop
 * updating it so the recorded price is the last pre-kickoff one.
 *
 * `valueKey` selects which per-match assessment to read — `'value'` (the
 * default, full tipster-consensus EV) or `'statareaValue'` (a single
 * site's own picks scored the same way, see statareaValue.js) — so this
 * one merge/grade/summarize pipeline can back more than one rolling log.
 */
function mergeValuePicks(existing, matches, capturedAtISO, valueKey = 'value') {
  const now = Date.parse(capturedAtISO) || Date.now();
  const byKey = new Map();
  for (const p of existing.picks || []) byKey.set(p.key, p);

  for (const m of matches || []) {
    const mk = matchKey(m.homeTeam, m.awayTeam, m.kickoffISO);
    const kickoff = Date.parse(m.kickoffISO);
    for (const o of flaggedOutcomes(m, valueKey)) {
      const key = `${mk}::${o.market}::${o.key}`;
      const prev = byKey.get(key);
      const preKickoff = !Number.isFinite(kickoff) || now < kickoff;
      if (prev && !preKickoff) continue; // locked at kickoff

      byKey.set(key, {
        key,
        matchKey: mk,
        fixture: `${m.homeTeam} vs ${m.awayTeam}`,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        league: m.league || null,
        kickoffISO: m.kickoffISO,
        market: o.market,
        point: o.point, // the O/U line this pick was priced against; null for 1X2
        selection: o.key, // home|draw|away|over|under
        label: o.label,
        odd: o.odd,
        ev: o.ev,
        refProb: o.refProb,
        impliedProb: o.impliedProb,
        quarterKelly: o.quarterKelly,
        firstSeenISO: prev ? prev.firstSeenISO : capturedAtISO,
        lastSeenISO: capturedAtISO,
        // carry any grading already done
        settled: prev ? prev.settled : false,
        score: prev ? prev.score : null,
        won: prev ? prev.won : null,
        profitUnits: prev ? prev.profitUnits : null,
        gradedAtISO: prev ? prev.gradedAtISO : null,
      });
    }
  }

  const picks = [...byKey.values()].filter((p) => {
    const age = now - (Date.parse(p.kickoffISO) || now);
    return age < (p.settled ? KEEP_SETTLED_MS : PRUNE_AFTER_MS);
  });
  return { picks, updatedAt: capturedAtISO };
}

function outcomeHit(pick, homeGoals, awayGoals) {
  const total = homeGoals + awayGoals;
  if (pick.market === '1X2') return pick.selection === outcome1x2(homeGoals, awayGoals);
  if (typeof pick.market === 'string' && pick.market.startsWith('O/U') && Number.isFinite(pick.point)) {
    return (pick.selection === 'over') === total > pick.point;
  }
  return null;
}

/**
 * Grade any pick whose match finished 2–60h ago against a Forebet result.
 * Flat 1-unit staking: profitUnits = won ? odd − 1 : −1.
 */
function gradeValuePicks(log, results, { nowMs = Date.now() } = {}) {
  let newlyGraded = 0;
  for (const p of log.picks || []) {
    if (p.settled) continue;
    const age = nowMs - (Date.parse(p.kickoffISO) || nowMs);
    if (age < GRADE_MIN_AGE_MS || age > GRADE_MAX_AGE_MS) continue;

    const r = findResult(p, results);
    if (!r) continue;
    const hit = outcomeHit(p, r.homeGoals, r.awayGoals);
    if (hit === null) continue;

    p.settled = true;
    p.score = `${r.homeGoals}-${r.awayGoals}`;
    p.won = hit;
    p.profitUnits = hit ? p.odd - 1 : -1;
    p.gradedAtISO = new Date(nowMs).toISOString();
    newlyGraded += 1;
  }
  return { ...log, newlyGraded };
}

function summarizeValuePicks(log, { windowHours = 0, nowMs = Date.now() } = {}) {
  const cutoff = windowHours ? nowMs - windowHours * 60 * 60 * 1000 : 0;
  const settled = (log.picks || []).filter(
    (p) => p.settled && (Date.parse(p.kickoffISO) || 0) >= cutoff
  );
  const won = settled.filter((p) => p.won).length;
  const staked = settled.length; // flat 1u
  const returned = settled.reduce((s, p) => s + (p.won ? p.odd : 0), 0);
  const profit = returned - staked;

  const byMarket = {};
  for (const p of settled) {
    const b = (byMarket[p.market] = byMarket[p.market] || { n: 0, won: 0, profit: 0 });
    b.n += 1;
    if (p.won) b.won += 1;
    b.profit += p.profitUnits;
  }

  return {
    open: (log.picks || []).filter((p) => !p.settled).length,
    settled: settled.length,
    won,
    winRate: settled.length ? won / settled.length : null,
    stakedUnits: staked,
    returnedUnits: Number(returned.toFixed(2)),
    profitUnits: Number(profit.toFixed(2)),
    roi: staked ? Number((profit / staked).toFixed(4)) : null,
    avgOdd: settled.length
      ? Number((settled.reduce((s, p) => s + p.odd, 0) / settled.length).toFixed(2))
      : null,
    byMarket,
    windowHours: windowHours || null,
    updatedAt: new Date(nowMs).toISOString(),
  };
}

module.exports = { mergeValuePicks, gradeValuePicks, summarizeValuePicks };
