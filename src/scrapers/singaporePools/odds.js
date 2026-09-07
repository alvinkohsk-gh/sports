const axios = require('axios');

// The 1X2 prices are lifted from the events payload the page already
// fetches (see parsers.js oneX2OddsFromEvent), so this only needs the
// Over/Under lines, which the page does NOT auto-load:
//   .../upcoming-event?lang=en&betType=HL
// The full-time 2.5 market is name "Total Goals Over/Under 2.5",
// outcomes H = Over, L = Under. ~2/3 of fixtures carry a 2.5 line; the
// rest are priced at 1.5 or 3.5.
//
// Keeping this to a single extra request per scrape matters: the GitHub
// Actions runner's IP also drives the headless render's own calls to
// api.singaporepools.com, and doubling that rate got the runner throttled
// (fixtures list came back near-empty). A failed fetch here just leaves
// fixtures with 1X2 odds only.
const HL_URL = 'https://api.singaporepools.com/football/events/v1/upcoming-event?lang=en&betType=HL';
const TIMEOUT_MS = Number(process.env.SGPOOLS_ODDS_TIMEOUT_MS) || 15000;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 1 ? n : null;
};

function priceOf(outcome) {
  const p = (outcome && outcome.prices && outcome.prices[0]) || null;
  return p ? num(p.decimal) : null;
}

function parseOu25(events) {
  const byId = new Map();
  for (const ev of events || []) {
    const mkt = (ev.markets || []).find(
      (m) => m.name === 'Total Goals Over/Under 2.5' && !/halftime/i.test(m.name || '')
    );
    if (!mkt) continue;
    const o = {};
    for (const out of mkt.outcomes || []) {
      if (out.minorCode === 'H') o.over = priceOf(out);
      else if (out.minorCode === 'L') o.under = priceOf(out);
    }
    if (o.over && o.under) byId.set(String(ev.id), o);
  }
  return byId;
}

/**
 * Returns Map<sgpMatchId, { over, under }> for the fixtures that have a
 * full-time Over/Under 2.5 line. Never throws.
 */
async function fetchSgPoolsOu25() {
  try {
    const res = await axios.get(HL_URL, {
      timeout: TIMEOUT_MS,
      headers: { 'User-Agent': 'sg-pools-live-odds' },
    });
    return parseOu25(res.data && res.data.events);
  } catch (err) {
    console.error('[sgpools-odds] HL fetch failed:', err.message || err);
    return new Map();
  }
}

module.exports = { fetchSgPoolsOu25, parseOu25 };
