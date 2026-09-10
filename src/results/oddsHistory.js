const { matchKey } = require('./history');

// A rolling per-fixture time series of Singapore Pools' own prices, so a
// punter can see how a line moved rather than only its current value —
// steam moves, drift, when a line actually settled. One entry per fixture
// (keyed the same way as history.js/valuePicks.js), holding an array of
// snapshot points. A point is only appended when the price actually
// changed since the last point — most 15-min scrape cycles see no
// movement, and recording those would bloat the log for no signal.
const PRUNE_AFTER_MS = 3 * 24 * 60 * 60 * 1000; // matches are rarely useful to chart long after kickoff
const MAX_POINTS_PER_MATCH = 80; // generous for how often a line actually moves before kickoff

function oddsSnapshot(m) {
  const o = m.odds;
  if (!o) return null;
  const oneX2 = o.oneX2 ? { home: o.oneX2.home, draw: o.oneX2.draw, away: o.oneX2.away } : null;
  const ou = o.ou ? { point: o.ou.point, over: o.ou.over, under: o.ou.under } : null;
  if (!oneX2 && !ou) return null;
  return { oneX2, ou };
}

function samePrice(a, b) {
  if (!a || !b) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Folds the current scrape's odds into the rolling history. Mutates
 * nothing — returns the updated store to persist as odds-history.json.
 */
function mergeOddsHistory(existing, matches, capturedAtISO) {
  const now = Date.parse(capturedAtISO) || Date.now();
  const byKey = new Map();
  for (const e of existing.entries || []) byKey.set(e.matchKey, e);

  for (const m of matches || []) {
    const snap = oddsSnapshot(m);
    if (!snap) continue;
    const key = matchKey(m.homeTeam, m.awayTeam, m.kickoffISO);
    const prev = byKey.get(key);
    const lastPoint = prev && prev.points.length ? prev.points[prev.points.length - 1] : null;
    if (lastPoint && samePrice(lastPoint.oneX2, snap.oneX2) && samePrice(lastPoint.ou, snap.ou)) {
      continue; // no movement since the last recorded point
    }

    const entry = prev || {
      matchKey: key,
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      league: m.league || null,
      kickoffISO: m.kickoffISO,
      points: [],
    };
    entry.points = [...entry.points, { capturedAtISO, ...snap }].slice(-MAX_POINTS_PER_MATCH);
    byKey.set(key, entry);
  }

  const entries = [...byKey.values()].filter(
    (e) => now - (Date.parse(e.kickoffISO) || now) < PRUNE_AFTER_MS
  );
  return { entries, updatedAt: capturedAtISO };
}

module.exports = { mergeOddsHistory, PRUNE_AFTER_MS, MAX_POINTS_PER_MATCH };
