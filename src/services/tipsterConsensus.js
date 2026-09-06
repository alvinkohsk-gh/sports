const { teamsMatch } = require('./matcher');

/**
 * Attaches tipster picks to each match by fuzzy team-name matching
 * (`teamsMatch`). Tipster sites give a discrete pick (home/draw/away, and
 * separately over/under), not a probability, so this tallies "how many
 * tipsters agree" per match rather than blending picks into one number —
 * `tipsterRanking.js` then turns that tally into each match's top pick.
 */
function attachTipsterConsensus(matches, tips) {
  return matches.map((match) => {
    const picksForMatch = tips.filter(
      (t) =>
        (teamsMatch(t.homeTeam, match.homeTeam) && teamsMatch(t.awayTeam, match.awayTeam)) ||
        (teamsMatch(t.homeTeam, match.awayTeam) && teamsMatch(t.awayTeam, match.homeTeam))
    );

    return {
      ...match,
      tipsterConsensus: {
        picks: picksForMatch.map(({ site, pick, totalsPick, rawText, sourceUrl }) => ({
          site,
          pick,
          totalsPick,
          rawText,
          sourceUrl,
        })),
        ...tallyOneXTwo(picksForMatch),
        ...tallyTotals(picksForMatch),
      },
    };
  });
}

function tallyOneXTwo(picksForMatch) {
  const tally = { home: 0, draw: 0, away: 0, unclassified: 0 };
  for (const p of picksForMatch) {
    if (p.pick === 'home') tally.home += 1;
    else if (p.pick === 'draw') tally.draw += 1;
    else if (p.pick === 'away') tally.away += 1;
    else tally.unclassified += 1;
  }

  const classifiedTotal = tally.home + tally.draw + tally.away;
  const [majorityPick, majorityCount] = topOf(tally, ['home', 'draw', 'away']);

  return {
    tally,
    majorityPick: classifiedTotal > 0 ? majorityPick : null,
    majorityCount,
    totalTipsters: picksForMatch.length,
  };
}

function tallyTotals(picksForMatch) {
  const withTotals = picksForMatch.filter((p) => p.totalsPick);
  const totalsTally = { over: 0, under: 0 };
  for (const p of withTotals) {
    if (p.totalsPick.selection === 'over') totalsTally.over += 1;
    else if (p.totalsPick.selection === 'under') totalsTally.under += 1;
  }

  const [totalsMajorityPick, totalsMajorityCount] = topOf(totalsTally, ['over', 'under']);
  // Most tipster O/U content is about the 2.5 line; use whichever point
  // shows up most often among the picks that agreed with the majority.
  const majorityPoint = mostCommonPoint(withTotals, totalsMajorityPick);

  return {
    totalsTally,
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

function mostCommonPoint(picksWithTotals, selection) {
  if (!selection) return null;
  const points = picksWithTotals.filter((p) => p.totalsPick.selection === selection).map((p) => p.totalsPick.point);
  if (!points.length) return null;
  const counts = new Map();
  for (const pt of points) counts.set(pt, (counts.get(pt) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

module.exports = { attachTipsterConsensus };
