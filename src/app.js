require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { refresh, getState } = require('./services/aggregator');
const { getLastCapture } = require('./scrapers/singaporePools');

const MOCK_MODE = String(process.env.MOCK_MODE || 'false').toLowerCase() === 'true';
// On a long-running process (npm start) a background loop keeps this fresh
// proactively; on serverless (Vercel) there is no background loop between
// invocations, so each request refreshes itself if the cached copy (which
// persists only for as long as the function instance stays warm) is older
// than this.
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 60000);

async function ensureFreshState() {
  const state = getState();
  const ageMs = state.lastUpdated ? Date.now() - new Date(state.lastUpdated).getTime() : Infinity;
  if (ageMs > CACHE_TTL_MS) {
    await refresh({ mockMode: MOCK_MODE });
  }
  return getState();
}

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/matches', async (req, res) => {
  const state = await ensureFreshState();
  res.json({
    matches: state.matches,
    bestBet: state.bestBet,
    lastUpdated: state.lastUpdated,
    lastError: state.lastError,
    mockMode: MOCK_MODE,
    counts: {
      sgpFixtures: state.sgpFixtureCount,
      tipsterPicks: state.tipsterPickCount,
    },
  });
});

// Diagnostic view for "why are there no matches": shows each stage of the
// pipeline separately (SG Pools fixtures found, tipster picks found) so a 0
// can be traced to the right stage without re-running anything or reading
// server logs.
app.get('/api/debug', async (req, res) => {
  const state = await ensureFreshState();
  res.json({
    mockMode: MOCK_MODE,
    lastUpdated: state.lastUpdated,
    lastError: state.lastError,
    stageCounts: {
      sgpFixturesFound: state.rawSgpFixtures?.length ?? 0,
      tipsterPicksFound: state.tipsterPickCount ?? 0,
      matchesShown: state.matches?.length ?? 0,
    },
    sampleSgpFixtures: (state.rawSgpFixtures || []).slice(0, 5),
  });
});

// Serves the last Singapore Pools page render this instance captured —
// separate from /api/debug since it can be tens of KB — so real selectors
// can be written from what the site actually returns, without needing
// filesystem access to Vercel's /tmp (where the DEBUG-mode dump otherwise
// goes and stays unreachable from outside the function).
app.get('/api/debug/sgpools-raw', async (req, res) => {
  await ensureFreshState();
  const capture = getLastCapture();
  if (!capture) {
    res.status(404).json({ error: 'No capture yet — the SG Pools scraper has not run in this instance.' });
    return;
  }
  res.json(capture);
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Export `app` itself as the module's value (an Express app is callable,
// i.e. a valid Vercel Function export), with the extra bits attached as
// properties — not a plain { app, ... } object. Vercel's zero-config
// "Express" framework detection scans for and independently wraps files
// like this one as their own function; a plain object export fails that
// wrapping with "the default export must be a function or server" (seen
// in production runtime logs). Attaching properties to the function
// keeps `require('./app').app` working for existing callers (api/index.js,
// server.js) either way.
app.ensureFreshState = ensureFreshState;
app.MOCK_MODE = MOCK_MODE;
app.CACHE_TTL_MS = CACHE_TTL_MS;
module.exports = app;
module.exports.app = app;
