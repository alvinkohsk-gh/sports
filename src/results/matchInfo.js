const { matchKey } = require('./history');
const { teamsMatch } = require('../services/matcher');
const { fetchForebetMatchInfo } = require('../scrapers/tipsters/forebetMatchInfo');

// H2H/recent form barely change inside a day, so a match's info is
// refetched at most once per TTL_MS rather than every ~15-min snapshot
// cycle. Bounded to MAX_FETCHES_PER_RUN new fetches per run so one cycle
// can't blow the GitHub Actions job's time budget (each fetch may pay a
// Cloudflare solve); matches further out than MAX_LOOKAHEAD_MS are
// skipped for now — they'll still be fresh well before kickoff.
const TTL_MS = Number(process.env.MATCHINFO_TTL_MS_DEBUG) || 24 * 60 * 60 * 1000;
const MAX_FETCHES_PER_RUN = Number(process.env.FOREBET_MATCHINFO_MAX_PER_RUN) || 15;
const MAX_LOOKAHEAD_MS = 4 * 24 * 60 * 60 * 1000;
const KEEP_CACHE_MS = 10 * 24 * 60 * 60 * 1000;

// Bump whenever `headToHead`'s shape changes (a new field the UI now
// depends on, a renamed one, …). A cache entry stamped with an older
// version is never treated as "fresh" — it's retried on the next run
// instead of serving stale-shaped data for up to TTL_MS/KEEP_CACHE_MS.
// v2: h2h rows gained homeTeamName/awayTeamName/result; fixture rows
// gained result (PR #19).
// v3: fixture rows gained venue ('H'/'A' — which side the subject team
// played on in that past fixture).
const SCHEMA_VERSION = 3;

// Finds a match's Forebet detail-page URL from this cycle's raw Forebet
// rows (forebet.js's extractRows captures `matchUrl` per row).
function findForebetUrl(match, forebetRows) {
  const row = (forebetRows || []).find(
    (r) =>
      r.matchUrl &&
      ((teamsMatch(r.homeTeam, match.homeTeam) && teamsMatch(r.awayTeam, match.awayTeam)) ||
        (teamsMatch(r.homeTeam, match.awayTeam) && teamsMatch(r.awayTeam, match.homeTeam)))
  );
  return row ? row.matchUrl : null;
}

// Labels each H2H row with a `result` ('W'/'D'/'L') from the *current*
// match's home team's perspective, so the UI can color wins/losses. A past
// meeting's home/away side flips from row to row (whichever club hosted
// that particular fixture), so this can't just read homeGoals/awayGoals
// positionally — it has to work out, per row, which side was the current
// match's home team via its Forebet-page team name (captured by
// forebetMatchInfo.js's parseH2H as homeTeamName/awayTeamName). Left null
// when a row carries no team names (e.g. the fallback tr/li parse path)
// rather than guessing.
function annotateH2HResults(h2h, match) {
  return (h2h || []).map((r) => {
    let usGoals;
    let themGoals;
    if (r.homeTeamName && teamsMatch(r.homeTeamName, match.homeTeam)) {
      usGoals = r.homeGoals;
      themGoals = r.awayGoals;
    } else if (r.awayTeamName && teamsMatch(r.awayTeamName, match.homeTeam)) {
      usGoals = r.awayGoals;
      themGoals = r.homeGoals;
    } else {
      return { ...r, result: null };
    }
    const result = usGoals > themGoals ? 'W' : usGoals < themGoals ? 'L' : 'D';
    return { ...r, result };
  });
}

/**
 * Attaches `match.headToHead` (H2H + recent form, see
 * scrapers/tipsters/forebetMatchInfo.js) to each SG Pools fixture Forebet
 * also covers, using a rolling cache so most cycles serve cached data
 * instead of re-fetching. Mutates `matches` in place and returns the
 * updated cache to persist as match-info.json.
 *
 * @param fetchFn  injectable for tests; defaults to the real Forebet fetch
 */
async function attachMatchInfo(matches, forebetRows, prevCache, { nowMs = Date.now(), fetchFn = fetchForebetMatchInfo } = {}) {
  const byKey = new Map();
  for (const e of (prevCache && prevCache.entries) || []) byKey.set(e.matchKey, e);

  let fetches = 0;
  for (const m of matches || []) {
    const kickoff = Date.parse(m.kickoffISO);
    if (!Number.isFinite(kickoff)) continue;
    const alreadyStarted = kickoff < nowMs;
    if (!alreadyStarted && kickoff - nowMs > MAX_LOOKAHEAD_MS) continue;

    const key = matchKey(m.homeTeam, m.awayTeam, m.kickoffISO);
    const cached = byKey.get(key);
    // Only a cache entry that actually holds info AND was written under
    // the current SCHEMA_VERSION counts as "fresh" and skips a re-fetch —
    // a null result (fetch/parse failure, or a Forebet page whose markup
    // didn't match the selectors) or a stale-shaped entry from before a
    // schema bump is retried every run instead of being stuck for a full
    // TTL_MS, so a selector fix, a schema change, or a transient site
    // issue all recover on the next cycle rather than waiting up to 24h.
    const usable = cached && cached.info && cached.schemaVersion === SCHEMA_VERSION;

    // A match already in play (or finished) never gets a *new* fetch —
    // H2H/form/fixtures are pre-match data, Forebet's own page for it
    // doesn't change once the match starts, and fetch budget is better
    // spent on matches still to come. But if it was fetched before
    // kickoff, that cached data is still exactly right, and the live
    // match card is clickable to the same detail modal as any other card
    // — so it should still get served rather than silently dropped.
    if (alreadyStarted) {
      if (usable) m.headToHead = cached.info;
      continue;
    }

    const fresh = usable && nowMs - (Date.parse(cached.fetchedAtISO) || 0) < TTL_MS;

    if (fresh) {
      m.headToHead = cached.info;
      continue;
    }
    if (fetches >= MAX_FETCHES_PER_RUN) {
      if (usable) m.headToHead = cached.info; // serve stale-but-current-shape rather than nothing
      continue;
    }

    const url = findForebetUrl(m, forebetRows);
    if (!url) continue;

    fetches += 1;
    let info = null;
    try {
      info = await fetchFn(url);
      if (info && info.h2h) info = { ...info, h2h: annotateH2HResults(info.h2h, m) };
    } catch (err) {
      console.error('[matchInfo] fetch failed:', err.message || err);
    }
    byKey.set(key, { matchKey: key, fetchedAtISO: new Date(nowMs).toISOString(), schemaVersion: SCHEMA_VERSION, info });
    if (info) m.headToHead = info;
    else if (usable) m.headToHead = cached.info; // keep last-known-good (current shape only)
  }

  const entries = [...byKey.values()].filter(
    (e) => nowMs - (Date.parse(e.fetchedAtISO) || nowMs) < KEEP_CACHE_MS
  );
  return { entries, updatedAt: new Date(nowMs).toISOString() };
}

module.exports = { attachMatchInfo, findForebetUrl, annotateH2HResults, TTL_MS, MAX_FETCHES_PER_RUN, MAX_LOOKAHEAD_MS, SCHEMA_VERSION };
