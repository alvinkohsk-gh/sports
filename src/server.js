const { app, MOCK_MODE, ODDS_API_KEY } = require('./app');
const { refresh } = require('./services/aggregator');

const PORT = Number(process.env.PORT || 3000);
const SGPOOLS_POLL_MS = Number(process.env.SGPOOLS_POLL_MS || 60000);
const ODDS_POLL_MS = Number(process.env.ODDS_POLL_MS || 60000);

// Local/long-running process only: proactively refreshes in the background
// so requests are always served instantly, rather than relying on app.js's
// on-demand "refresh if stale" fallback (which is what Vercel's serverless
// functions use instead, since there's no persistent process to run this
// loop in).
async function refreshLoop() {
  await refresh({ mockMode: MOCK_MODE, oddsApiKey: ODDS_API_KEY });
  const interval = Math.min(SGPOOLS_POLL_MS, ODDS_POLL_MS);
  setTimeout(refreshLoop, interval);
}

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT} (mock mode: ${MOCK_MODE})`);
  refreshLoop();
});
