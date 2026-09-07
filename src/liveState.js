const { refresh, getState } = require('./services/aggregator');
const { MOCK_MODE, CACHE_TTL_MS } = require('./config');

// The fallback data path: an on-demand scrape, used only when the
// published snapshot (src/snapshot.js) is missing or stale. On a
// long-running process (npm start) a background loop keeps this fresh
// proactively; on serverless there is no loop between invocations, so a
// request refreshes it itself when the warm-instance copy is older than
// CACHE_TTL_MS.
async function ensureFreshState() {
  const state = getState();
  const ageMs = state.lastUpdated ? Date.now() - new Date(state.lastUpdated).getTime() : Infinity;
  if (ageMs > CACHE_TTL_MS) {
    await refresh({ mockMode: MOCK_MODE });
  }
  return getState();
}

module.exports = { ensureFreshState };
