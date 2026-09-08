const axios = require('axios');

// The 1X2 prices are lifted from the events payload the page already
// fetches (see parsers.js oneX2OddsFromEvent), so this only needs the
// Over/Under lines, which the page does NOT auto-load:
//   .../upcoming-event?lang=en&betType=HL
// Each fixture carries exactly one full-time O/U market, named
// "Total Goals Over/Under <point>" (outcomes H = Over, L = Under) — the
// point varies per match (1.5, 2.5, 3.5, ...), so this must read the point
// off the market name rather than assume 2.5; assessing a match against
// the wrong line would compare tipster/consensus opinion to a market that
// isn't actually on offer.
//
// Keeping this to a single extra request per scrape matters: the GitHub
// Actions runner's IP also drives the headless render's own calls to
// api.singaporepools.com, and doubling that rate got the runner throttled
// (fixtures list came back near-empty). A failed fetch here just leaves
// fixtures with 1X2 odds only.
const HL_URL = 'https://api.singaporepools.com/football/events/v1/upcoming-event?lang=en&betType=HL';
const TIMEOUT_MS = Number(process.env.SGPOOLS_ODDS_TIMEOUT_MS) || 15000;
const OU_MARKET_RE = /^Total Goals Over\/Under (\d+(?:\.5)?)$/;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 1 ? n : null;
};

function priceOf(outcome) {
  const p = (outcome && outcome.prices && outcome.prices[0]) || null;
  return p ? num(p.decimal) : null;
}

function parseOu(events) {
  const byId = new Map();
  for (const ev of events || []) {
    for (const mkt of ev.markets || []) {
      const name = mkt.name || '';
      if (/halftime/i.test(name)) continue;
      const m = name.match(OU_MARKET_RE);
      if (!m) continue;
      const o = {};
      for (const out of mkt.outcomes || []) {
        if (out.minorCode === 'H') o.over = priceOf(out);
        else if (out.minorCode === 'L') o.under = priceOf(out);
      }
      if (o.over && o.under) {
        byId.set(String(ev.id), { point: Number(m[1]), ...o });
        break; // one full-time O/U market per event
      }
    }
  }
  return byId;
}

/**
 * Returns Map<sgpMatchId, { point, over, under }> for the fixtures that
 * have a full-time Over/Under line, whatever point it's set at. Never
 * throws.
 */
async function fetchSgPoolsOu() {
  try {
    const res = await axios.get(HL_URL, {
      timeout: TIMEOUT_MS,
      headers: { 'User-Agent': 'sg-pools-live-odds' },
    });
    return parseOu(res.data && res.data.events);
  } catch (err) {
    console.error('[sgpools-odds] HL fetch failed:', err.message || err);
    return new Map();
  }
}

module.exports = { fetchSgPoolsOu, parseOu };
