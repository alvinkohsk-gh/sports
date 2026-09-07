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

// Primary data source in production: a pre-built snapshot published every
// ~15 min by GitHub Actions (see scripts/scrape-snapshot.js and
// .github/workflows/snapshot.yml). Scraping on the request path is
// unreliable on Vercel — @sparticuz/chromium-min runs --single-process and
// crashes under load, and the Cloudflare-protected tipster sites 403
// Vercel's datacenter IPs — so the live scrape below is only a fallback
// for when the snapshot is missing or stale.
const SNAPSHOT_URL =
  process.env.SNAPSHOT_URL ||
  'https://raw.githubusercontent.com/alvinkohsk-gh/sports/data-snapshot/snapshot.json';
const SNAPSHOT_MAX_AGE_MS = Number(process.env.SNAPSHOT_MAX_AGE_MS || 45 * 60 * 1000);
const SNAPSHOT_REFETCH_MS = Number(process.env.SNAPSHOT_REFETCH_MS || 60 * 1000);

let snapshotCache = { data: null, fetchedAt: 0 };

async function getSnapshot() {
  if (MOCK_MODE) return null;
  if (snapshotCache.data && Date.now() - snapshotCache.fetchedAt < SNAPSHOT_REFETCH_MS) {
    return snapshotCache.data;
  }
  try {
    const res = await fetch(SNAPSHOT_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    snapshotCache = { data, fetchedAt: Date.now() };
    return data;
  } catch (err) {
    console.error('[snapshot] fetch failed:', err.message);
    return snapshotCache.data; // last good copy, or null
  }
}

function snapshotAgeMs(snap) {
  const ts = Date.parse((snap && (snap.generatedAt || snap.lastUpdated)) || '');
  return Number.isFinite(ts) ? Date.now() - ts : Infinity;
}

function snapshotIsFresh(snap) {
  return snap && Array.isArray(snap.matches) && snapshotAgeMs(snap) < SNAPSHOT_MAX_AGE_MS;
}

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
  const snap = await getSnapshot();
  if (snapshotIsFresh(snap)) {
    res.json({
      matches: snap.matches,
      bestBet: snap.bestBet,
      lastUpdated: snap.lastUpdated,
      lastError: snap.lastError,
      mockMode: MOCK_MODE,
      counts: snap.counts,
      source: 'snapshot',
      snapshotAgeSec: Math.round(snapshotAgeMs(snap) / 1000),
    });
    return;
  }

  // Snapshot missing or stale — fall back to an on-demand scrape.
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
    source: 'live',
    staleSnapshotAgeSec: snap ? Math.round(snapshotAgeMs(snap) / 1000) : null,
  });
});

// Resolves the data the debug endpoints report on: the published snapshot
// when it's fresh, otherwise a live on-demand scrape. Normalizes the two
// shapes (snapshot has `counts`, live state has `sgpFixtureCount` etc.).
async function debugSource() {
  const snap = await getSnapshot();
  if (snapshotIsFresh(snap)) {
    return {
      source: 'snapshot',
      ageSec: Math.round(snapshotAgeMs(snap) / 1000),
      lastUpdated: snap.lastUpdated,
      lastError: snap.lastError,
      matches: snap.matches || [],
      rawSgpFixtures: snap.rawSgpFixtures || [],
      rawTipsterPicks: snap.rawTipsterPicks || [],
      tipsterPickCount: snap.counts?.tipsterPicks ?? (snap.rawTipsterPicks || []).length,
    };
  }
  const state = await ensureFreshState();
  return {
    source: 'live',
    ageSec: null,
    lastUpdated: state.lastUpdated,
    lastError: state.lastError,
    matches: state.matches || [],
    rawSgpFixtures: state.rawSgpFixtures || [],
    rawTipsterPicks: state.rawTipsterPicks || [],
    tipsterPickCount: state.tipsterPickCount ?? 0,
  };
}

// Diagnostic view for "why are there no matches": shows each stage of the
// pipeline separately (SG Pools fixtures found, tipster picks found) so a 0
// can be traced to the right stage without re-running anything or reading
// server logs.
app.get('/api/debug', async (req, res) => {
  const d = await debugSource();
  res.json({
    mockMode: MOCK_MODE,
    source: d.source,
    snapshotAgeSec: d.ageSec,
    lastUpdated: d.lastUpdated,
    lastError: d.lastError,
    stageCounts: {
      sgpFixturesFound: d.rawSgpFixtures.length,
      tipsterPicksFound: d.tipsterPickCount,
      matchesShown: d.matches.length,
    },
    sampleSgpFixtures: d.rawSgpFixtures.slice(0, 5),
  });
});

// Shows the tipster-matching stage directly: every raw pick each site
// returned, and for each Singapore Pools fixture which of those picks got
// attached. Use this to tell "no consensus" caused by a name-matching
// miss (picks exist for the fixture but 0 attached) apart from one caused
// by a scrape returning nothing (site has 0 picks) or by prose parsing
// leaving pick=null (attached but unclassified).
app.get('/api/debug/tipsters', async (req, res) => {
  const d = await debugSource();
  const bySite = {};
  for (const p of d.rawTipsterPicks) {
    (bySite[p.site] = bySite[p.site] || []).push({ homeTeam: p.homeTeam, awayTeam: p.awayTeam, pick: p.pick });
  }
  res.json({
    source: d.source,
    snapshotAgeSec: d.ageSec,
    lastUpdated: d.lastUpdated,
    rawPickCount: d.rawTipsterPicks.length,
    rawPicksBySite: bySite,
    fixtures: d.matches.map((m) => ({
      fixture: `${m.homeTeam} vs ${m.awayTeam}`,
      attachedPicks: m.tipsterConsensus.picks.map((p) => `${p.site}:${p.pick ?? '?'}`),
      majorityPick: m.tipsterConsensus.majorityPick,
      majorityCount: m.tipsterConsensus.majorityCount,
      totalTipsters: m.tipsterConsensus.totalTipsters,
    })),
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
