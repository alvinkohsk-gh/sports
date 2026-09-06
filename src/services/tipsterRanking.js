// Replaces the old bookmaker-odds-derived "confidence" score now that the
// app shows tipster predictions only. A match's top pick is whichever of
// its two tipster votes (1X2 majority, O/U majority) has the strongest
// agreement ratio (most tipsters agreeing, as a fraction of how many
// covered that match) — ties broken by how many tipsters weighed in at all.
function pickTopPick(match) {
  const tc = match.tipsterConsensus;
  if (!tc) return null;

  const candidates = [];

  if (tc.majorityPick && tc.totalTipsters > 0) {
    const label =
      tc.majorityPick === 'home'
        ? `${match.homeTeam} to win`
        : tc.majorityPick === 'away'
          ? `${match.awayTeam} to win`
          : 'Draw';
    candidates.push({
      market: '1X2',
      selection: tc.majorityPick,
      label,
      tipsterCount: tc.majorityCount,
      totalTipsters: tc.totalTipsters,
      agreement: tc.majorityCount / tc.totalTipsters,
    });
  }

  if (tc.totalsMajorityPick && tc.totalTotalsTipsters > 0) {
    candidates.push({
      market: 'totals',
      selection: tc.totalsMajorityPick,
      point: tc.totalsMajorityPoint,
      label: `${tc.totalsMajorityPick === 'over' ? 'Over' : 'Under'} ${tc.totalsMajorityPoint} goals`,
      tipsterCount: tc.totalsMajorityCount,
      totalTipsters: tc.totalTotalsTipsters,
      agreement: tc.totalsMajorityCount / tc.totalTotalsTipsters,
    });
  }

  candidates.sort((a, b) => b.agreement - a.agreement || b.totalTipsters - a.totalTipsters);
  return candidates[0] || null;
}

function attachTopPick(matches) {
  return matches.map((match) => ({ ...match, topPick: pickTopPick(match) }));
}

function pickBestBetOverall(matchesWithTopPick) {
  let best = null;
  for (const match of matchesWithTopPick) {
    if (!match.topPick) continue;
    if (
      !best ||
      match.topPick.agreement > best.topPick.agreement ||
      (match.topPick.agreement === best.topPick.agreement && match.topPick.totalTipsters > best.topPick.totalTipsters)
    ) {
      best = match;
    }
  }
  if (!best) return null;
  return {
    homeTeam: best.homeTeam,
    awayTeam: best.awayTeam,
    league: best.league,
    kickoffISO: best.kickoffISO,
    tipsterConsensus: best.tipsterConsensus,
    ...best.topPick,
  };
}

module.exports = { pickTopPick, attachTopPick, pickBestBetOverall };
