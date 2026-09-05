require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { refresh, getState } = require('./services/aggregator');

const PORT = Number(process.env.PORT || 3000);
const MOCK_MODE = String(process.env.MOCK_MODE || 'false').toLowerCase() === 'true';
const ODDS_API_KEY = process.env.ODDS_API_KEY;
const SGPOOLS_POLL_MS = Number(process.env.SGPOOLS_POLL_MS || 60000);
const ODDS_POLL_MS = Number(process.env.ODDS_POLL_MS || 60000);

if (!MOCK_MODE && !ODDS_API_KEY) {
  console.warn(
    '[server] ODDS_API_KEY is not set and MOCK_MODE is off — odds fetches will fail. ' +
      'Copy .env.example to .env and add your key, or set MOCK_MODE=true to try the UI with sample data.'
  );
}

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/matches', (req, res) => {
  const state = getState();
  res.json({
    matches: state.matches,
    bestBet: state.bestBet,
    lastUpdated: state.lastUpdated,
    lastError: state.lastError,
    mockMode: MOCK_MODE,
    counts: { sgpFixtures: state.sgpFixtureCount, oddsEvents: state.oddsEventCount },
  });
});

// Diagnostic view for "why are there no matches": shows each stage of the
// pipeline separately (SG Pools fixtures found, odds events found, final
// merged count) so a 0 can be traced to the right stage without re-running
// anything or reading server logs.
app.get('/api/debug', (req, res) => {
  const state = getState();
  res.json({
    mockMode: MOCK_MODE,
    lastUpdated: state.lastUpdated,
    lastError: state.lastError,
    stageCounts: {
      sgpFixturesFound: state.rawSgpFixtures?.length ?? 0,
      oddsEventsFound: state.rawOddsEvents?.length ?? 0,
      mergedMatches: state.matches?.length ?? 0,
    },
    sampleSgpFixtures: (state.rawSgpFixtures || []).slice(0, 5),
    sampleOddsEvents: (state.rawOddsEvents || []).slice(0, 5).map((e) => ({
      homeTeam: e.homeTeam,
      awayTeam: e.awayTeam,
      league: e.league,
      kickoffISO: e.kickoffISO,
    })),
  });
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

async function refreshLoop() {
  await refresh({ mockMode: MOCK_MODE, oddsApiKey: ODDS_API_KEY });
  const interval = Math.min(SGPOOLS_POLL_MS, ODDS_POLL_MS);
  setTimeout(refreshLoop, interval);
}

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT} (mock mode: ${MOCK_MODE})`);
  refreshLoop();
});
