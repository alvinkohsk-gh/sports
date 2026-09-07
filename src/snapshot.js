const {
  MOCK_MODE,
  SNAPSHOT_REPO,
  SNAPSHOT_BRANCH,
  SNAPSHOT_FILE,
  SNAPSHOT_URL,
  SNAPSHOT_MAX_AGE_MS,
  SNAPSHOT_REFETCH_MS,
} = require('./config');

// The app's primary data source in production: a snapshot published every
// ~15 min by GitHub Actions (scripts/scrape-snapshot.js +
// .github/workflows/snapshot.yml). Scraping on the request path is
// unreliable on Vercel — @sparticuz/chromium-min runs --single-process and
// crashes under load, and the Cloudflare-protected tipster sites 403
// Vercel's datacenter IPs — so the live scrape is only a fallback for when
// the snapshot is missing or stale (see src/liveState.js).

// Fetch a JSON file from the data-snapshot branch. Prefer the GitHub
// contents API — it serves the branch tip with no CDN lag, unlike
// raw.githubusercontent.com which caches per-edge for minutes (that showed
// up as the app serving a snapshot one scrape-cycle stale). raw is the
// fallback for when the (unauthenticated, 60/hr/IP) contents API is
// rate-limited.
async function fetchBranchJson(file) {
  const custom = file === SNAPSHOT_FILE ? SNAPSHOT_URL : null;
  const apiUrl =
    custom || `https://api.github.com/repos/${SNAPSHOT_REPO}/contents/${file}?ref=${SNAPSHOT_BRANCH}`;
  try {
    const res = await fetch(apiUrl, {
      cache: 'no-store',
      headers: { Accept: 'application/vnd.github.raw+json', 'User-Agent': 'sg-pools-live-odds' },
    });
    if (res.ok) return await res.json();
    if (res.status !== 403 && res.status !== 429) throw new Error(`contents API HTTP ${res.status}`);
  } catch (err) {
    console.error(`[branch] ${file} contents API failed:`, err.message);
  }
  const raw = await fetch(
    `https://raw.githubusercontent.com/${SNAPSHOT_REPO}/${SNAPSHOT_BRANCH}/${file}`,
    { cache: 'no-store', headers: { 'User-Agent': 'sg-pools-live-odds' } }
  );
  if (!raw.ok) throw new Error(`raw HTTP ${raw.status}`);
  return await raw.json();
}

let snapshotCache = { data: null, fetchedAt: 0 };

async function getSnapshot() {
  if (MOCK_MODE) return null;
  if (snapshotCache.data && Date.now() - snapshotCache.fetchedAt < SNAPSHOT_REFETCH_MS) {
    return snapshotCache.data;
  }
  try {
    const data = await fetchBranchJson(SNAPSHOT_FILE);
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

module.exports = { fetchBranchJson, getSnapshot, snapshotAgeMs, snapshotIsFresh };
