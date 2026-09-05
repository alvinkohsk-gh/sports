const { fetchForebetTips } = require('./forebet');
const { fetchPredictzTips } = require('./predictz');
const { fetchWinDrawWinTips } = require('./windrawwin');
const { fetchWhoScoredTips } = require('./whoscored');
const { fetchSportsMoleTips } = require('./sportsmole');

const SOURCES = [
  { site: 'forebet', fetch: fetchForebetTips },
  { site: 'predictz', fetch: fetchPredictzTips },
  { site: 'windrawwin', fetch: fetchWinDrawWinTips },
  { site: 'whoscored', fetch: fetchWhoScoredTips },
  { site: 'sportsmole', fetch: fetchSportsMoleTips },
];

/**
 * Fetches all tipster sources in parallel. One site failing (site
 * redesign, block, timeout) never takes the others down with it — each
 * result is independently settled and failures are just logged.
 */
async function fetchAllTipsterPicks() {
  const settled = await Promise.allSettled(SOURCES.map((s) => s.fetch()));
  const allTips = [];
  settled.forEach((result, i) => {
    const { site } = SOURCES[i];
    if (result.status === 'fulfilled') {
      allTips.push(...result.value);
    } else {
      console.error(`[tipsters:${site}] failed:`, result.reason?.message || result.reason);
    }
  });
  return allTips;
}

module.exports = { fetchAllTipsterPicks, SOURCES };
