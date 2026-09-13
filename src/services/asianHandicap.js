// Asian Handicap pick derivation + settlement.
//
// No tipster site we scrape publishes an explicit Asian Handicap pick, so
// (like Over/Under's `totalsFromScoreline`) a pick is derived from a site's
// predicted correct score where one's available: whichever side the
// predicted goal margin implies would cover SG Pools' actual handicap line.
// Only Forebet and PredictZ currently carry a real predicted scoreline
// (`totalsPick.homeGoals`/`awayGoals` — see totalsHeuristics.js); every
// other site's totalsPick lacks those fields and so never produces an AH
// pick here, which is an honest reflection of what data exists rather than
// a gap to paper over.
//
// Settlement follows real money-line rules, confirmed against a live SG
// Pools capture (2026-09-12, betType=AH): a whole-number line (e.g. -1) can
// push (stake fully returned) when the adjusted scoreline ties exactly; a
// half line (e.g. -0.5) never pushes; a quarter line (e.g. -0.75, +0.25) is
// really two equal-stake bets at the adjacent whole/half lines (SG Pools'
// own outcome data encodes this explicitly via a comma-separated
// `hcapValue`, e.g. "-0.50,-1.00," for a -0.75 line — see odds.js's
// parseHcapValue) — each settled independently, then averaged. That
// produces one of five outcomes per bet: win, half-win, push, half-loss,
// loss — not just a binary win/lose.

const AH_RESULTS = ['win', 'half-win', 'push', 'half-loss', 'loss'];

// Result label -> settlement fraction of stake: +1 full win, +0.5 half win
// (win half the stake, push the other half), 0 full push, -0.5 half loss,
// -1 full loss.
const AH_VALUE = { win: 1, 'half-win': 0.5, push: 0, 'half-loss': -0.5, loss: -1 };

function resultForValue(value) {
  if (value === 1) return 'win';
  if (value === 0.5) return 'half-win';
  if (value === 0) return 'push';
  if (value === -0.5) return 'half-loss';
  return 'loss';
}

// Settles a single whole/half line: `line` added to `marginForSide` (the
// actual goal margin from the picked side's own perspective — positive
// means that side won by that many goals). A tie at exactly 0 is only
// possible when `line` is a whole number (a half line can never land on
// exactly 0 this way).
function settleWholeOrHalfLine(line, marginForSide) {
  const adjusted = marginForSide + line;
  if (adjusted > 0) return 1;
  if (adjusted < 0) return -1;
  return 0;
}

// Settles any line — whole, half, or quarter — for the picked side, given
// the actual goal margin *for that side* (positive = that side won by that
// many goals, negative = lost by that many, 0 = draw).
function settleLine(line, marginForSide) {
  if (!Number.isFinite(line) || !Number.isFinite(marginForSide)) return null;
  // A quarter line's fractional part is exactly ±0.25/±0.75 once reduced
  // mod 1 to [0, 1) — anything else is a whole (0) or half (0.5) line.
  const frac = ((line % 1) + 1) % 1;
  const isQuarter = Math.abs(frac - 0.25) < 1e-9 || Math.abs(frac - 0.75) < 1e-9;
  if (!isQuarter) return settleWholeOrHalfLine(line, marginForSide);
  const lo = line - 0.25;
  const hi = line + 0.25;
  return (settleWholeOrHalfLine(lo, marginForSide) + settleWholeOrHalfLine(hi, marginForSide)) / 2;
}

/**
 * Settles a graded Asian Handicap pick against the actual final score.
 * `homeLine` is always the home side's handicap (negative when the home
 * team is favored; the away side's is its negation — matches how SG Pools
 * itself pairs the two outcomes). Returns `{ result, value }` or null when
 * inputs are incomplete.
 */
function settleAh(pick, homeLine, homeGoals, awayGoals) {
  if ((pick !== 'home' && pick !== 'away') || !Number.isFinite(homeLine)) return null;
  if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return null;
  const line = pick === 'home' ? homeLine : -homeLine;
  const marginForSide = pick === 'home' ? homeGoals - awayGoals : awayGoals - homeGoals;
  const value = settleLine(line, marginForSide);
  if (value === null) return null;
  return { result: resultForValue(value), value };
}

// P/L in stake units for a flat 1-unit bet at decimal odds `odd`: a full or
// half win pays out its fraction of (odd - 1); a push is 0; a half/full
// loss is just that fraction of the stake (already negative).
function ahProfit(value, odd) {
  if (!Number.isFinite(value) || !Number.isFinite(odd)) return null;
  return value > 0 ? value * (odd - 1) : value;
}

// Derives the implied AH side from a totalsPick carrying a predicted
// scoreline (`homeGoals`/`awayGoals` — only forebet.js/predictz.js's
// totalsFromScoreline produces these). `homeLine` is SG Pools' actual
// home-side line for this match. Returns null when there's no scoreline to
// work from, no line to compare against, or the predicted margin implies
// an exact push (no real opinion on either side covering).
function resolveAhPick(totalsPick, homeLine) {
  if (!totalsPick || !Number.isFinite(totalsPick.homeGoals) || !Number.isFinite(totalsPick.awayGoals)) return null;
  if (!Number.isFinite(homeLine)) return null;
  const adjusted = totalsPick.homeGoals - totalsPick.awayGoals + homeLine;
  if (adjusted > 0) return 'home';
  if (adjusted < 0) return 'away';
  return null;
}

module.exports = { AH_RESULTS, AH_VALUE, settleLine, settleAh, ahProfit, resolveAhPick };
