const { teamsMatch } = require('./matcher');

/**
 * Attaches tipster picks to each match by fuzzy team-name matching (same
 * technique as the SG Pools <-> odds join). This is a separate, plainly
 * labeled signal from the market-consensus "confidence" score: tipster
 * sites give a discrete pick (home/draw/away), not a probability, so
 * tallying "how many tipsters agree" rather than blending it into one
 * number keeps the two kinds of evidence honest and distinguishable.
 */
function attachTipsterConsensus(matches, tips) {
  return matches.map((match) => {
    const picksForMatch = tips.filter(
      (t) =>
        (teamsMatch(t.homeTeam, match.homeTeam) && teamsMatch(t.awayTeam, match.awayTeam)) ||
        (teamsMatch(t.homeTeam, match.awayTeam) && teamsMatch(t.awayTeam, match.homeTeam))
    );

    const tally = { home: 0, draw: 0, away: 0, unclassified: 0 };
    for (const p of picksForMatch) {
      if (p.pick === 'home') tally.home += 1;
      else if (p.pick === 'draw') tally.draw += 1;
      else if (p.pick === 'away') tally.away += 1;
      else tally.unclassified += 1;
    }

    const classifiedTotal = tally.home + tally.draw + tally.away;
    let majorityPick = null;
    let majorityCount = 0;
    for (const key of ['home', 'draw', 'away']) {
      if (tally[key] > majorityCount) {
        majorityCount = tally[key];
        majorityPick = key;
      }
    }

    return {
      ...match,
      tipsterConsensus: {
        picks: picksForMatch.map(({ site, pick, rawText, sourceUrl }) => ({ site, pick, rawText, sourceUrl })),
        tally,
        majorityPick: classifiedTotal > 0 ? majorityPick : null,
        majorityCount,
        totalTipsters: picksForMatch.length,
      },
    };
  });
}

module.exports = { attachTipsterConsensus };
