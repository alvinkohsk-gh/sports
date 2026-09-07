// Every environment variable the server reads, in one place.
//
// MOCK_MODE        serve canned data, skip all scraping (see src/mock)
// CACHE_TTL_MS     how stale the live on-demand scrape may be before a
//                  request triggers its own refresh (only the fallback
//                  path — the snapshot is the primary source)
// SNAPSHOT_*       the pre-built snapshot published to a GitHub branch
//                  every ~15 min by .github/workflows/snapshot.yml
//   REPO/BRANCH/FILE  where it lives
//   URL               full override for the snapshot fetch (skips REPO/BRANCH)
//   MAX_AGE_MS         older than this -> treat as stale, fall back to live
//   REFETCH_MS         a warm instance re-pulls the branch at most this often

const MOCK_MODE = String(process.env.MOCK_MODE || 'false').toLowerCase() === 'true';
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 60000);

const SNAPSHOT_REPO = process.env.SNAPSHOT_REPO || 'alvinkohsk-gh/sports';
const SNAPSHOT_BRANCH = process.env.SNAPSHOT_BRANCH || 'data-snapshot';
const SNAPSHOT_FILE = process.env.SNAPSHOT_FILE || 'snapshot.json';
const SNAPSHOT_URL = process.env.SNAPSHOT_URL || null;
const SNAPSHOT_MAX_AGE_MS = Number(process.env.SNAPSHOT_MAX_AGE_MS || 45 * 60 * 1000);
const SNAPSHOT_REFETCH_MS = Number(process.env.SNAPSHOT_REFETCH_MS || 90 * 1000);

module.exports = {
  MOCK_MODE,
  CACHE_TTL_MS,
  SNAPSHOT_REPO,
  SNAPSHOT_BRANCH,
  SNAPSHOT_FILE,
  SNAPSHOT_URL,
  SNAPSHOT_MAX_AGE_MS,
  SNAPSHOT_REFETCH_MS,
};
