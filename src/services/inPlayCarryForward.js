const { teamsMatch } = require('./matcher');

// Some tipster sites (Statarea most notably, but also any site whose
// "today's tips" page is upcoming-only) drop a fixture the moment it kicks
// off. Without help, a live match's tipster consensus would lose
// contributors minute by minute as each such site stops listing it.
//
// This re-hydrates an in-play fixture's pick list from the rolling
// prediction history (history.json — the same store that feeds accuracy
// grading): for any site that published a pre-match pick on the fixture
// but is missing from the current scrape, its last stored pick is added
// back, tagged `carriedForward` so the UI can mark it.
//
// Guardrails against pulling in the wrong match:
//   - the history entry's teams must match the live fixture (order-
//     insensitive, via teamsMatch), and
//   - its kickoff must be within CARRY_WINDOW_MS of the live fixture's, so
//     the two legs of a home/away tie don't cross-contaminate.

const CARRY_WINDOW_MS = 36 * 60 * 60 * 1000;

function carryForwardInPlayPicks(inPlayMatches, liveTips, history) {
  const entries = (history && history.entries) || [];
  if (!entries.length || !inPlayMatches || !inPlayMatches.length) return liveTips;

  const extra = [];
  for (const m of inPlayMatches) {
    const kickoffMs = Date.parse(m.kickoffISO) || 0;
    const haveSites = new Set(
      liveTips
        .filter(
          (t) =>
            (teamsMatch(t.homeTeam, m.homeTeam) && teamsMatch(t.awayTeam, m.awayTeam)) ||
            (teamsMatch(t.homeTeam, m.awayTeam) && teamsMatch(t.awayTeam, m.homeTeam))
        )
        .map((t) => t.site)
    );

    for (const e of entries) {
      if (!e.pick && !e.totalsPick) continue;
      if (haveSites.has(e.site)) continue;
      if (kickoffMs && Math.abs((Date.parse(e.kickoffISO) || 0) - kickoffMs) > CARRY_WINDOW_MS) continue;
      // Prefer the stored raw team names; fall back to the normalized pair
      // baked into the matchKey (`normHome|normAway|day`).
      const [kh, ka] = String(e.matchKey || '').split('|');
      const eh = e.homeTeam || kh;
      const ea = e.awayTeam || ka;
      if (!eh || !ea) continue;
      const same =
        (teamsMatch(eh, m.homeTeam) && teamsMatch(ea, m.awayTeam)) ||
        (teamsMatch(eh, m.awayTeam) && teamsMatch(ea, m.homeTeam));
      if (!same) continue;

      haveSites.add(e.site); // one carry-forward per site per fixture
      extra.push({
        site: e.site,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        pick: e.pick || null,
        totalsPick: e.totalsPick || null,
        rawText: 'pre-match pick (carried into live)',
        sourceUrl: null,
        carriedForward: true,
      });
    }
  }

  return extra.length ? liveTips.concat(extra) : liveTips;
}

module.exports = { carryForwardInPlayPicks, CARRY_WINDOW_MS };
