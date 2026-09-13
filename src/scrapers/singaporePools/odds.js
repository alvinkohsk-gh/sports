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

// Asian Handicap — betType=AH confirmed via a live capture (2026-09-12):
// each event carries a plain "Asian Handicap" market (minorCode 'AH') plus
// a "Half Time Asian Handicap" one at the same minorCode, so this has to
// filter by the exact market name, not just minorCode, or the two get
// conflated. Two outcomes, minorCode 'H'/'A' (home/away, same convention
// as the 1X2 market) — deliberately NOT using the outcome's own `name`
// ("Columbus Crew -0.75") for the line, since parsing a team name out of
// free text is fragile; instead the line is read out of
// `prices[0].hcapValue`, a comma-separated list of the actual settlement
// line(s) for that outcome ("-0.50,-1.00," for a -0.75 quarter line, which
// splits into a same-stake bet on each of -0.50 and -1.00 — see
// src/services/asianHandicap.js). Its average is the displayed line
// regardless of whether it's a whole/half/quarter line, and the market's
// own top-level `handicapValue` was seen stale/unrelated to the real line
// in that capture, so it's ignored entirely.
const AH_MARKET_RE = /^Asian Handicap$/;

function parseHcapValue(raw) {
  const parts = String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter(Number.isFinite);
  if (!parts.length) return null;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

function parseAh(events) {
  const byId = new Map();
  for (const ev of events || []) {
    for (const mkt of ev.markets || []) {
      if (mkt.minorCode !== 'AH' || !AH_MARKET_RE.test(mkt.name || '')) continue;
      let point = null;
      const o = {};
      for (const out of mkt.outcomes || []) {
        const hcap = out.prices && out.prices[0] && parseHcapValue(out.prices[0].hcapValue);
        const price = priceOf(out);
        if (out.minorCode === 'H') {
          o.home = price;
          if (Number.isFinite(hcap)) point = hcap;
        } else if (out.minorCode === 'A') {
          o.away = price;
        }
      }
      if (o.home && o.away && Number.isFinite(point)) {
        byId.set(String(ev.id), { point, home: o.home, away: o.away });
        break; // one full-time AH market per event
      }
    }
  }
  return byId;
}

/**
 * Returns Map<sgpMatchId, { point, home, away }> for the fixtures that have
 * a full-time Asian Handicap line — `point` is the home side's handicap
 * (negative when the home team is favored); the away side's is its
 * negation. Never throws.
 */
async function fetchSgPoolsAh() {
  try {
    const res = await axios.get(
      'https://api.singaporepools.com/football/events/v1/upcoming-event?lang=en&betType=AH',
      { timeout: TIMEOUT_MS, headers: { 'User-Agent': 'sg-pools-live-odds' } }
    );
    return parseAh(res.data && res.data.events);
  } catch (err) {
    console.error('[sgpools-odds] AH fetch failed:', err.message || err);
    return new Map();
  }
}

module.exports = { fetchSgPoolsOu, parseOu, fetchSgPoolsAh, parseAh, parseHcapValue };
