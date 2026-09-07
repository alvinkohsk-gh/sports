const { fetchOpenFixtures } = require('../scrapers/singaporePools');
const { fetchAllTipsterPicks } = require('../scrapers/tipsters');
const { attachTipsterConsensus } = require('./tipsterConsensus');
const { attachTopPick, pickBestBetOverall } = require('./tipsterRanking');
const { getMockSgpFixtures, getMockTipsterPicks } = require('../mock/mockData');

const state = {
  matches: [],
  bestBet: null,
  lastUpdated: null,
  lastError: null,
};

function getState() {
  return state;
}

function toMatch(fixture) {
  return {
    id: fixture.sgpMatchId,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    league: fixture.league,
    kickoffISO: fixture.kickoffISO,
    sgPoolsOpen: true,
  };
}

// Each source is fetched independently (allSettled, not all) so that one
// source failing can't blank out the other's results.
async function refresh({ mockMode }) {
  const [sgpResult, tipsterResult] = await Promise.allSettled([
    mockMode ? Promise.resolve(getMockSgpFixtures()) : fetchOpenFixtures(),
    mockMode ? Promise.resolve(getMockTipsterPicks()) : fetchAllTipsterPicks(),
  ]);

  const sgpFixtures = sgpResult.status === 'fulfilled' ? sgpResult.value : [];
  const tipsterPicks = tipsterResult.status === 'fulfilled' ? tipsterResult.value : [];

  const errors = [sgpResult, tipsterResult]
    .filter((r) => r.status === 'rejected')
    .map((r) => r.reason?.message || String(r.reason));
  if (errors.length) {
    console.error('[aggregator] refresh had errors:', errors.join(' | '));
  }

  const matches = sgpFixtures.map(toMatch).sort((a, b) => new Date(a.kickoffISO) - new Date(b.kickoffISO));
  const withTipsters = attachTipsterConsensus(matches, tipsterPicks);
  state.matches = attachTopPick(withTipsters);
  state.bestBet = pickBestBetOverall(state.matches);
  state.lastUpdated = new Date().toISOString();
  state.lastError = errors.length ? errors.join(' | ') : null;
  state.sgpFixtureCount = sgpFixtures.length;
  state.tipsterPickCount = tipsterPicks.length;
  // Kept for /api/debug so a stage can be diagnosed without re-running anything.
  state.rawSgpFixtures = sgpFixtures;
  state.rawTipsterPicks = tipsterPicks;
  return state;
}

module.exports = { refresh, getState };
