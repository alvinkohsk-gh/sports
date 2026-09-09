const { matchKey } = require('./history');
const { teamsMatch } = require('../services/matcher');
const { fetchForebetMatchInfo } = require('../scrapers/tipsters/forebetMatchInfo');

// H2H/recent form barely change inside a day, so a match's info is
// refetched at most once per TTL_MS rather than every ~15-min snapshot
// cycle. Bounded to MAX_FETCHES_PER_RUN new fetches per run so one cycle
// can't blow the GitHub Actions job's time budget (each fetch may pay a
// Cloudflare solve); matches further out than MAX_LOOKAHEAD_MS are
// skipped for now — they'll still be fresh well before kickoff.
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_FETCHES_PER_RUN = Number(process.env.FOREBET_MATCHINFO_MAX_PER_RUN) || 15;
const MAX_LOOKAHEAD_MS = 4 * 24 * 60 * 60 * 1000;
const KEEP_CACHE_MS = 10 * 24 * 60 * 60 * 1000;

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
    if (!Number.isFinite(kickoff) || kickoff < nowMs || kickoff - nowMs > MAX_LOOKAHEAD_MS) continue;

    const key = matchKey(m.homeTeam, m.awayTeam, m.kickoffISO);
    const cached = byKey.get(key);
    // Only a cache entry that actually holds info counts as "fresh" and
    // skips a re-fetch — a null result (fetch/parse failure, or a Forebet
    // page whose markup didn't match the selectors) is retried every run
    // instead of being stuck for a full TTL_MS, so a selector fix (or a
    // transient site issue) recovers on the next cycle rather than
    // waiting up to 24h.
    const fresh = cached && cached.info && nowMs - (Date.parse(cached.fetchedAtISO) || 0) < TTL_MS;

    if (fresh) {
      if (cached.info) m.headToHead = cached.info;
      continue;
    }
    if (fetches >= MAX_FETCHES_PER_RUN) {
      if (cached && cached.info) m.headToHead = cached.info; // serve stale rather than nothing
      continue;
    }

    const url = findForebetUrl(m, forebetRows);
    if (!url) continue;

    fetches += 1;
    let info = null;
    try {
      info = await fetchFn(url);
    } catch (err) {
      console.error('[matchInfo] fetch failed:', err.message || err);
    }
    byKey.set(key, { matchKey: key, fetchedAtISO: new Date(nowMs).toISOString(), info });
    if (info) m.headToHead = info;
    else if (cached && cached.info) m.headToHead = cached.info; // keep last-known-good
  }

  const entries = [...byKey.values()].filter(
    (e) => nowMs - (Date.parse(e.fetchedAtISO) || nowMs) < KEEP_CACHE_MS
  );
  return { entries, updatedAt: new Date(nowMs).toISOString() };
}

module.exports = { attachMatchInfo, findForebetUrl, TTL_MS, MAX_FETCHES_PER_RUN, MAX_LOOKAHEAD_MS };
