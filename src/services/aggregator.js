const { fetchOpenFixtures } = require('../scrapers/singaporePools');
const { fetchAllSoccerOdds } = require('./oddsApi');
const { mergeFixturesWithOdds } = require('./matcher');
const { attachConfidence, pickBestBetOverall } = require('./confidence');
const { getMockSgpFixtures, getMockOddsEvents } = require('../mock/mockData');

const state = {
  matches: [],
  bestBet: null,
  lastUpdated: null,
  lastError: null,
};

function getState() {
  return state;
}

async function refresh({ mockMode, oddsApiKey }) {
  try {
    const [sgpFixtures, oddsEvents] = await Promise.all([
      mockMode ? Promise.resolve(getMockSgpFixtures()) : fetchOpenFixtures(),
      mockMode ? Promise.resolve(getMockOddsEvents()) : fetchAllSoccerOdds(oddsApiKey),
    ]);

    const merged = mergeFixturesWithOdds(sgpFixtures, oddsEvents);
    state.matches = attachConfidence(merged);
    state.bestBet = pickBestBetOverall(state.matches);
    state.lastUpdated = new Date().toISOString();
    state.lastError = null;
    state.sgpFixtureCount = sgpFixtures.length;
    state.oddsEventCount = oddsEvents.length;
  } catch (err) {
    state.lastError = err.message;
    console.error('[aggregator] refresh failed:', err.message);
  }
  return state;
}

module.exports = { refresh, getState };
