require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const { MOCK_MODE, CACHE_TTL_MS } = require('./config');
const { ensureFreshState } = require('./liveState');

// Route modules — one file per concern:
//   src/routes/matches.js   GET /api/matches      (fixtures + consensus)
//   src/routes/debug.js     GET /api/debug*       (pipeline diagnostics)
//   src/routes/accuracy.js  GET /api/accuracy     (per-site scorecard)
// Data sources they share: src/snapshot.js (published branch snapshot,
// primary) and src/liveState.js (on-demand scrape, fallback).
const matchesRoutes = require('./routes/matches');
const debugRoutes = require('./routes/debug');
const accuracyRoutes = require('./routes/accuracy');
const valueRoutes = require('./routes/value');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', matchesRoutes);
app.use('/api', debugRoutes);
app.use('/api', accuracyRoutes);
app.use('/api', valueRoutes);
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
