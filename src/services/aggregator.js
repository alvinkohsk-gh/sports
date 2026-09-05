const { fetchOpenFixtures } = require('../scrapers/singaporePools');
const { fetchAllSoccerOdds } = require('./oddsApi');
const { fetchAllTipsterPicks } = require('../scrapers/tipsters');
const { mergeFixturesWithOdds } = require('./matcher');
const { attachTipsterConsensus } = require('./tipsterConsensus');
const { attachConfidence, pickBestBetOverall } = require('./confidence');
const { getMockSgpFixtures, getMockOddsEvents, getMockTipsterPicks } = require('../mock/mockData');

const state = {
  matches: [],
  bestBet: null,
  lastUpdated: null,
  lastError: null,
};

function getState() {
  return state;
}

// Each source is fetched independently (allSettled, not all) so that one
// source failing (e.g. a missing ODDS_API_KEY) can't blank out the others'
// results — /api/debug exists specifically to let a 0 be traced back to
// the right stage, which a fail-fast Promise.all would defeat by aborting
// before the other two sources' results ever reach state.
async function refresh({ mockMode, oddsApiKey }) {
  const [sgpResult, oddsResult, tipsterResult] = await Promise.allSettled([
    mockMode ? Promise.resolve(getMockSgpFixtures()) : fetchOpenFixtures(),
    mockMode ? Promise.resolve(getMockOddsEvents()) : fetchAllSoccerOdds(oddsApiKey),
    mockMode ? Promise.resolve(getMockTipsterPicks()) : fetchAllTipsterPicks(),
  ]);

  const sgpFixtures = sgpResult.status === 'fulfilled' ? sgpResult.value : [];
  const oddsEvents = oddsResult.status === 'fulfilled' ? oddsResult.value : [];
  const tipsterPicks = tipsterResult.status === 'fulfilled' ? tipsterResult.value : [];

  const errors = [sgpResult, oddsResult, tipsterResult]
    .filter((r) => r.status === 'rejected')
    .map((r) => r.reason?.message || String(r.reason));
  if (errors.length) {
    console.error('[aggregator] refresh had errors:', errors.join(' | '));
  }

  const merged = mergeFixturesWithOdds(sgpFixtures, oddsEvents);
  const withTipsters = attachTipsterConsensus(merged, tipsterPicks);
  state.matches = attachConfidence(withTipsters);
  state.bestBet = pickBestBetOverall(state.matches);
  state.lastUpdated = new Date().toISOString();
  state.lastError = errors.length ? errors.join(' | ') : null;
  state.sgpFixtureCount = sgpFixtures.length;
  state.oddsEventCount = oddsEvents.length;
  state.tipsterPickCount = tipsterPicks.length;
  // Kept for /api/debug so a merge-count of 0 can be diagnosed without
  // re-running anything: was it SG Pools, the odds fetch, or the join
  // between the two that came up empty?
  state.rawSgpFixtures = sgpFixtures;
  state.rawOddsEvents = oddsEvents;
  return state;
}

module.exports = { refresh, getState };
