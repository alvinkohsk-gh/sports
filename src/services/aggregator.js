const { fetchOpenFixtures, getInPlayFixtures } = require('../scrapers/singaporePools');
const { fetchAllTipsterPicks } = require('../scrapers/tipsters');
const { attachTipsterConsensus } = require('./tipsterConsensus');
const { attachTopPick, pickBestBetOverall } = require('./tipsterRanking');
const { assessValue } = require('./value');
const { computeSiteWeights } = require('./tipsterWeights');
const { carryForwardInPlayPicks } = require('./inPlayCarryForward');
const { fetchBranchJson } = require('../snapshot');
const { getMockSgpFixtures, getMockTipsterPicks } = require('../mock/mockData');

// Per-site accuracy weighting (tipsterWeights.js) needs each tipster's
// graded track record, published as accuracy.json alongside the snapshot.
// Best-effort and cheap to re-fetch: a failure just leaves every site at
// the neutral weight of 1, same as before this existed.
async function getSiteWeights(mockMode) {
  if (mockMode) return {};
  try {
    const accuracy = await fetchBranchJson('accuracy.json');
    return computeSiteWeights(accuracy);
  } catch (err) {
    console.error('[aggregator] accuracy.json fetch failed, using neutral tipster weights:', err.message);
    return {};
  }
}

// Rolling prediction history — used only to carry a site's last pre-match
// pick into the in-play consensus for fixtures that site has since dropped
// (see inPlayCarryForward.js). Best-effort: a failure just means the live
// consensus reflects whatever's still being scraped, same as before.
async function getHistory(mockMode) {
  if (mockMode) return { entries: [] };
  try {
    return await fetchBranchJson('history.json');
  } catch (err) {
    console.error('[aggregator] history.json fetch failed, no in-play carry-forward:', err.message);
    return { entries: [] };
  }
}

const state = {
  matches: [],
  inPlay: [],
  bestBet: null,
  bestValue: null,
  lastUpdated: null,
  lastError: null,
};

function getState() {
  return state;
}

function toMatch(fixture) {
  return {
    id: fixture.sgpMatchId,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    league: fixture.league,
    kickoffISO: fixture.kickoffISO,
    sgPoolsOpen: !fixture.live,
    live: !!fixture.live,
    odds: fixture.odds || null,
    // rough goals-so-far from the lowest live Over/Under line still open
    liveLine: fixture.liveLine || null,
    goalsSoFar: fixture.liveLine ? Math.max(0, Math.round(fixture.liveLine.point - 0.5)) : null,
  };
}

// Highest-EV flagged value bet across the board (separate from `bestBet`,
// which is the strongest tipster-agreement pick regardless of price).
function pickBestValue(matches) {
  let best = null;
  for (const m of matches) {
    const b = m.value && m.value.best;
    if (b && (!best || b.ev > best.ev)) {
      best = {
        ...b,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        league: m.league,
        kickoffISO: m.kickoffISO,
      };
    }
  }
  return best;
}

// Each source is fetched independently (allSettled, not all) so that one
// source failing can't blank out the other's results. Site weights are
// fetched alongside them, best-effort — a failure there just falls back to
// neutral weights, same as a missing/stale accuracy.json.
async function refresh({ mockMode }) {
  const [sgpResult, tipsterResult, siteWeightsResult, historyResult] = await Promise.allSettled([
    mockMode ? Promise.resolve(getMockSgpFixtures()) : fetchOpenFixtures(),
    mockMode ? Promise.resolve(getMockTipsterPicks()) : fetchAllTipsterPicks(),
    getSiteWeights(mockMode),
    getHistory(mockMode),
  ]);

  const sgpFixtures = sgpResult.status === 'fulfilled' ? sgpResult.value : [];
  const tipsterPicks = tipsterResult.status === 'fulfilled' ? tipsterResult.value : [];
  const siteWeights = siteWeightsResult.status === 'fulfilled' ? siteWeightsResult.value : {};
  const history = historyResult.status === 'fulfilled' ? historyResult.value : { entries: [] };

  const errors = [sgpResult, tipsterResult]
    .filter((r) => r.status === 'rejected')
    .map((r) => r.reason?.message || String(r.reason));
  if (errors.length) {
    console.error('[aggregator] refresh had errors:', errors.join(' | '));
  }

  const matches = sgpFixtures.map(toMatch).sort((a, b) => new Date(a.kickoffISO) - new Date(b.kickoffISO));
  // Some tipster sites drop a fixture from their listing shortly before
  // kickoff, not just once it's live (see inPlayCarryForward.js) — so this
  // re-hydration runs for the main board too, not just state.inPlay below.
  const preMatchTips = carryForwardInPlayPicks(matches, tipsterPicks, history);
  const withTipsters = attachTipsterConsensus(matches, preMatchTips, siteWeights);
  for (const m of withTipsters) {
    m.value = m.odds ? assessValue(m.odds, m.tipsterConsensus) : null;
  }
  state.matches = attachTopPick(withTipsters);
  state.bestBet = pickBestBetOverall(state.matches);
  state.bestValue = pickBestValue(state.matches);
  // Exposed so callers (e.g. scripts/scrape-snapshot.js building a
  // single-site value log) can reuse this cycle's weights instead of
  // re-fetching accuracy.json.
  state.siteWeights = siteWeights;

  // In-play: the same tipster consensus (made pre-match) attached to the
  // matches SG Pools currently has live. No value assessment — the odds
  // here have already moved with the run of play. Sites that stop listing
  // a fixture once it kicks off (Statarea et al.) are re-hydrated from
  // history.json so the live consensus doesn't thin out mid-match.
  const inPlayMatches = (mockMode ? [] : getInPlayFixtures())
    .map(toMatch)
    .sort((a, b) => new Date(a.kickoffISO) - new Date(b.kickoffISO));
  const inPlayTips = carryForwardInPlayPicks(inPlayMatches, tipsterPicks, history);
  const inPlay = attachTipsterConsensus(inPlayMatches, inPlayTips, siteWeights);
  state.inPlay = attachTopPick(inPlay);

  state.lastUpdated = new Date().toISOString();
  state.lastError = errors.length ? errors.join(' | ') : null;
  state.sgpFixtureCount = sgpFixtures.length;
  state.tipsterPickCount = tipsterPicks.length;
  // Kept for /api/debug so a stage can be diagnosed without re-running anything.
  state.rawSgpFixtures = sgpFixtures;
  state.rawTipsterPicks = tipsterPicks;
  return state;
}

module.exports = { refresh, getState };
