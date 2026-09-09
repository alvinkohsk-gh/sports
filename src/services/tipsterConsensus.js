const { teamsMatch } = require('./matcher');
const { siteWeight } = require('./tipsterWeights');

/**
 * Attaches tipster picks to each match by fuzzy team-name matching
 * (`teamsMatch`). Tipster sites give a discrete pick (home/draw/away, and
 * separately over/under), not a probability, so this tallies "how many
 * tipsters agree" per match rather than blending picks into one number —
 * `tipsterRanking.js` then turns that tally into each match's top pick.
 *
 * `siteWeights` (from tipsterWeights.computeSiteWeights, keyed by site with
 * a per-market weight) additionally produces a *weighted* tally alongside
 * the raw one — value.js uses the weighted numbers to shape its consensus
 * probability, while the raw `tally`/`totalsTally` stay plain integer vote
 * counts so the UI's "X/Y tipsters agree" chips stay legible.
 */
function attachTipsterConsensus(matches, tips, siteWeights = {}) {
  return matches.map((match) => {
    const picksForMatch = tips.filter(
      (t) =>
        (teamsMatch(t.homeTeam, match.homeTeam) && teamsMatch(t.awayTeam, match.awayTeam)) ||
        (teamsMatch(t.homeTeam, match.awayTeam) && teamsMatch(t.awayTeam, match.homeTeam))
    );

    const sgLinePoint = match.odds && match.odds.ou ? match.odds.ou.point : null;

    return {
      ...match,
      tipsterConsensus: {
        picks: picksForMatch.map(({ site, pick, totalsPick, rawText, sourceUrl, carriedForward }) => ({
          site,
          pick,
          totalsPick,
          rawText,
          sourceUrl,
          ...(carriedForward ? { carriedForward: true } : {}),
        })),
        ...tallyOneXTwo(picksForMatch, siteWeights),
        ...tallyTotals(picksForMatch, sgLinePoint, siteWeights),
      },
    };
  });
}

function tallyOneXTwo(picksForMatch, siteWeights) {
  const tally = { home: 0, draw: 0, away: 0, unclassified: 0 };
  const weightedTally = { home: 0, draw: 0, away: 0 };
  for (const p of picksForMatch) {
    const w = siteWeight(siteWeights, p.site, 'oneX2');
    if (p.pick === 'home') {
      tally.home += 1;
      weightedTally.home += w;
    } else if (p.pick === 'draw') {
      tally.draw += 1;
      weightedTally.draw += w;
    } else if (p.pick === 'away') {
      tally.away += 1;
      weightedTally.away += w;
    } else {
      tally.unclassified += 1;
    }
  }

  const classifiedTotal = tally.home + tally.draw + tally.away;
  const [majorityPick, majorityCount] = topOf(tally, ['home', 'draw', 'away']);

  return {
    tally,
    weightedTally,
    majorityPick: classifiedTotal > 0 ? majorityPick : null,
    majorityCount,
    totalTipsters: picksForMatch.length,
  };
}

// Resolves one tipster's totals pick against `linePoint` — the point SG
// Pools is actually offering for this match (may be 1.5, 2.5, 3.5, ...).
// A pick derived from a predicted scoreline (`total` = the actual goal
// count) can be re-evaluated against any point. A pick that only states an
// explicit line (e.g. "Over 2.5") is a real opinion on that specific
// market and isn't comparable to a different line, so it's excluded unless
// its point matches. When `linePoint` isn't known yet, fall back to the
// pick's own point/selection as before.
function resolveTotalsPickAtPoint(totalsPick, linePoint) {
  if (!totalsPick) return null;
  if (!Number.isFinite(linePoint)) return totalsPick.selection;
  if (Number.isFinite(totalsPick.total)) return totalsPick.total > linePoint ? 'over' : 'under';
  return totalsPick.point === linePoint ? totalsPick.selection : null;
}

function tallyTotals(picksForMatch, linePoint, siteWeights) {
  const withTotals = picksForMatch
    .map((p) => ({ p, selection: resolveTotalsPickAtPoint(p.totalsPick, linePoint) }))
    .filter((x) => x.selection);

  const totalsTally = { over: 0, under: 0 };
  const weightedTotalsTally = { over: 0, under: 0 };
  for (const { p, selection } of withTotals) {
    totalsTally[selection] += 1;
    weightedTotalsTally[selection] += siteWeight(siteWeights, p.site, 'totals');
  }

  const [totalsMajorityPick, totalsMajorityCount] = topOf(totalsTally, ['over', 'under']);
  const majorityPoint = Number.isFinite(linePoint) ? linePoint : mostCommonPoint(withTotals, totalsMajorityPick);

  return {
    totalsTally,
    weightedTotalsTally,
    totalsMajorityPick: withTotals.length > 0 ? totalsMajorityPick : null,
    totalsMajorityCount,
    totalsMajorityPoint: majorityPoint,
    totalTotalsTipsters: withTotals.length,
  };
}

function topOf(tally, keys) {
  let bestKey = null;
  let bestCount = 0;
  for (const key of keys) {
    if (tally[key] > bestCount) {
      bestCount = tally[key];
      bestKey = key;
    }
  }
  return [bestKey, bestCount];
}

// Fallback for when the SG Pools line isn't known yet: whichever point
// shows up most often among the picks that agreed with the majority.
function mostCommonPoint(resolvedWithTotals, selection) {
  if (!selection) return null;
  const points = resolvedWithTotals.filter((x) => x.selection === selection).map((x) => x.p.totalsPick.point);
  if (!points.length) return null;
  const counts = new Map();
  for (const pt of points) counts.set(pt, (counts.get(pt) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

module.exports = { attachTipsterConsensus, resolveTotalsPickAtPoint };
