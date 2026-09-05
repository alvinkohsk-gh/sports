const { fetchOpenFixtures } = require('../scrapers/singaporePools');
const { fetchAllSoccerOdds } = require('./oddsApi');
const { mergeFixturesWithOdds } = require('./matcher');
const { getMockSgpFixtures, getMockOddsEvents } = require('../mock/mockData');

const state = {
  matches: [],
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

    state.matches = mergeFixturesWithOdds(sgpFixtures, oddsEvents);
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
