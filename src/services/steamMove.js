// Steam-move detection: flags a sudden, sizeable Singapore Pools price
// move as a signal that sharp/informed money may have just come in on
// that side. Built on top of src/results/oddsHistory.js's per-fixture
// price series — a point is only recorded there when the price actually
// changes, so "the last two points" is always the most recent real move,
// whenever it happened.
//
// A move only counts as "steam" when it's both big (>= THRESHOLD_PCT
// relative change on one outcome) and fast (the two points it's between
// are <= WINDOW_MIN apart) — a large move that drifted over many hours is
// just the market settling, not a steam move.
const THRESHOLD_PCT = 0.08; // >= 8% relative price change
const WINDOW_MIN = 20; // the two points must be this close together

function pctChange(from, to) {
  if (!(from > 0) || !(to > 0)) return null;
  return (to - from) / from;
}

function marketMoves(prevSnap, curSnap, marketLabel, keys) {
  if (!prevSnap || !curSnap) return [];
  const moves = [];
  for (const k of keys) {
    const chg = pctChange(prevSnap[k], curSnap[k]);
    if (chg == null) continue;
    moves.push({ market: marketLabel, outcome: k, fromOdd: prevSnap[k], toOdd: curSnap[k], pctChange: chg });
  }
  return moves;
}

/**
 * Looks only at the most recent two recorded price points — a steam move
 * is "just happened", not something from days ago. Returns the single
 * largest-magnitude qualifying move across the 1X2 and O/U markets, or
 * null when there aren't two points yet or the last move doesn't qualify.
 *
 * `points` is the array oddsHistory.js records per fixture: each point
 * `{ capturedAtISO, oneX2: {home,draw,away}|null, ou: {point,over,under}|null }`.
 */
function detectSteamMove(points, opts = {}) {
  const thresholdPct = opts.thresholdPct ?? THRESHOLD_PCT;
  const windowMin = opts.windowMin ?? WINDOW_MIN;
  if (!Array.isArray(points) || points.length < 2) return null;

  const prev = points[points.length - 2];
  const cur = points[points.length - 1];
  const prevAt = Date.parse(prev.capturedAtISO);
  const curAt = Date.parse(cur.capturedAtISO);
  if (!Number.isFinite(prevAt) || !Number.isFinite(curAt)) return null;

  const minutesApart = (curAt - prevAt) / 60000;
  if (minutesApart < 0 || minutesApart > windowMin) return null;

  let moves = marketMoves(prev.oneX2, cur.oneX2, '1X2', ['home', 'draw', 'away']);
  // A changed O/U point (e.g. 2.5 -> 1.5) isn't a price move on the same
  // market, so only compare over/under prices when the point held steady.
  if (prev.ou && cur.ou && prev.ou.point === cur.ou.point) {
    moves = moves.concat(marketMoves(prev.ou, cur.ou, `O/U ${cur.ou.point}`, ['over', 'under']));
  }

  const qualifying = moves.filter((m) => Math.abs(m.pctChange) >= thresholdPct);
  if (!qualifying.length) return null;
  qualifying.sort((a, b) => Math.abs(b.pctChange) - Math.abs(a.pctChange));
  const best = qualifying[0];
  return {
    market: best.market,
    outcome: best.outcome,
    fromOdd: best.fromOdd,
    toOdd: best.toOdd,
    pctChange: best.pctChange,
    minutesApart: Math.round(minutesApart),
    // 'shortening' = price came down (that side is being backed);
    // 'drifting' = price went up (money moving away from that side).
    direction: best.pctChange < 0 ? 'shortening' : 'drifting',
    atISO: cur.capturedAtISO,
  };
}

module.exports = { detectSteamMove, THRESHOLD_PCT, WINDOW_MIN };
