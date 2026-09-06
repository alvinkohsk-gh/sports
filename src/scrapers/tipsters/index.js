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

// All 5 sources share one browser page (see browser.js — only one page is
// allowed live at a time against the shared single-process Chromium
// instance), so they run one after another rather than truly in parallel.
// Runtime timing logs showed every site's plain HTTP fetch failing and
// falling back to a browser render, each taking close to its own full
// navigation timeout — five of those in a row can exceed what's left of
// Vercel's 60s function budget after Singapore Pools' own fetch. Racing
// the whole batch against an overall deadline means a slow request still
// returns whatever picks did complete in time, instead of the entire
// response timing out with nothing.
const OVERALL_DEADLINE_MS = 25000;

/**
 * Fetches all tipster sources, one site failing (site redesign, block,
 * timeout) never taking the others down with it — each source's result is
 * collected independently as it resolves. Whichever haven't finished by
 * OVERALL_DEADLINE_MS are left running in the background and excluded from
 * this call's result, rather than blocking the response on them.
 */
async function fetchAllTipsterPicks() {
  const allTips = [];
  const pending = SOURCES.map(({ site, fetch }) =>
    fetch()
      .then((tips) => allTips.push(...tips))
      .catch((err) => console.error(`[tipsters:${site}] failed:`, err.message || err))
  );

  await Promise.race([Promise.all(pending), new Promise((resolve) => setTimeout(resolve, OVERALL_DEADLINE_MS))]);

  return allTips;
}

module.exports = { fetchAllTipsterPicks, SOURCES };
