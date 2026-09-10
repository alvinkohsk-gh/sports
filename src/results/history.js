const { normalizeTeamName } = require('../services/matcher');

// A stable-ish key for a fixture: normalized team names + the kickoff
// calendar day (UTC). Good enough to line a stored pick up with a result
// even if kickoff times drift a little between sources.
function matchKey(homeTeam, awayTeam, kickoffISO) {
  const day = (kickoffISO || '').slice(0, 10);
  return `${normalizeTeamName(homeTeam)}|${normalizeTeamName(awayTeam)}|${day}`;
}

const PRUNE_AFTER_MS = 6 * 24 * 60 * 60 * 1000;

/**
 * Folds the current scrape's tipster picks into the rolling history.
 * Entry key is `${matchKey}::${site}`; we keep the pick captured latest
 * but still before kickoff (that's the site's final call). Entries whose
 * kickoff is more than 6 days old are dropped.
 */
function mergeHistory(existing, matches, capturedAtISO) {
  const now = Date.parse(capturedAtISO) || Date.now();
  const byKey = new Map();
  for (const e of existing.entries || []) byKey.set(`${e.matchKey}::${e.site}`, e);

  for (const m of matches) {
    const key = matchKey(m.homeTeam, m.awayTeam, m.kickoffISO);
    const kickoff = Date.parse(m.kickoffISO);
    for (const p of m.tipsterConsensus?.picks || []) {
      if (!p.pick && !p.totalsPick && !p.bttsPick) continue;
      const id = `${key}::${p.site}`;
      const prev = byKey.get(id);
      // don't overwrite a pick that was captured before kickoff with a
      // later (post-kickoff) capture
      if (prev && Number.isFinite(kickoff) && (prev.capturedAt || 0) >= kickoff && now >= kickoff) continue;
      byKey.set(id, {
        matchKey: key,
        site: p.site,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        kickoffISO: m.kickoffISO,
        league: m.league || null,
        pick: p.pick || null,
        totalsPick: p.totalsPick || null,
        bttsPick: p.bttsPick || null,
        capturedAt: now,
      });
    }
  }

  const entries = [...byKey.values()].filter(
    (e) => now - (Date.parse(e.kickoffISO) || now) < PRUNE_AFTER_MS
  );
  return { entries, updatedAt: capturedAtISO };
}

module.exports = { mergeHistory, matchKey };
