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

// ---- the rest of SG Pools' football bet types (confirmed via a live
// capture of https://online2.singaporepools.com/en/api/lov/football_bet_type
// on 2026-09-13, which lists every betType code SG Pools offers) ----
//
// Two are deliberately NOT scraped: FS ("1st Goal Scorer") and LS ("Last
// Goal Scorer") are player-prop markets — one outcome per player on the
// roster, not a small fixed set — so there's no sane way to show them on a
// match card, and both returned 0 events in that capture regardless.
//
// Four more are scraped but intentionally left off the match card, not
// missing by oversight: TG2 (Halftime Total Goals, 4 outcomes), HF
// (Halftime-Fulltime, 9 outcomes), EG (exact Total Goals, 10 outcomes) and
// CS (Pick the Score, 36+ outcomes) all have too many outcomes to fit a
// compact card alongside seven other markets — see app.js's renderOdds,
// which only wires up the ones below plus AH.
//
// Every remaining market is either a small (2-3 outcome) simple-odds
// market — Halftime 1X2 (H1), Total Goals Odd/Even (OE), Both Teams to
// Score (BG), Team to Score 1st Goal (NGN) — parsed the same way as the
// 1X2/O-U markets above, or a home/away(/draw) handicap market — 1/2 Goal
// (WH) and Handicap 1X2 (MH) — parsed the same way as Asian Handicap
// above (reading the real line off `prices[0].hcapValue`, not the
// market's own top-level `handicapValue`, for the same reason AH does).

function makeUpcomingFetcher(betType, parseFn) {
  const url = `https://api.singaporepools.com/football/events/v1/upcoming-event?lang=en&betType=${betType}`;
  return async function fetchFn() {
    try {
      const res = await axios.get(url, { timeout: TIMEOUT_MS, headers: { 'User-Agent': 'sg-pools-live-odds' } });
      return parseFn(res.data && res.data.events);
    } catch (err) {
      console.error(`[sgpools-odds] ${betType} fetch failed:`, err.message || err);
      return new Map();
    }
  };
}

const H1_MARKET_RE = /^Halftime 1X2$/;
function parseH1(events) {
  const byId = new Map();
  for (const ev of events || []) {
    for (const mkt of ev.markets || []) {
      if (!H1_MARKET_RE.test(mkt.name || '')) continue;
      const o = {};
      for (const out of mkt.outcomes || []) {
        const price = priceOf(out);
        if (out.minorCode === 'H') o.home = price;
        else if (out.minorCode === 'D') o.draw = price;
        else if (out.minorCode === 'A') o.away = price;
      }
      if (o.home && o.draw && o.away) {
        byId.set(String(ev.id), o);
        break; // one halftime-1X2 market per event
      }
    }
  }
  return byId;
}
const fetchSgPoolsH1 = makeUpcomingFetcher('H1', parseH1);

const OE_MARKET_RE = /^Total Goals Odd\/Even$/;
function parseOe(events) {
  const byId = new Map();
  for (const ev of events || []) {
    for (const mkt of ev.markets || []) {
      if (!OE_MARKET_RE.test(mkt.name || '')) continue;
      const o = {};
      for (const out of mkt.outcomes || []) {
        const price = priceOf(out);
        const name = (out.name || '').toLowerCase();
        if (name === 'odd') o.odd = price;
        else if (name === 'even') o.even = price;
      }
      if (o.odd && o.even) {
        byId.set(String(ev.id), o);
        break; // one full-time odd/even market per event
      }
    }
  }
  return byId;
}
const fetchSgPoolsOe = makeUpcomingFetcher('OE', parseOe);

const BTTS_MARKET_RE = /^Will Both Teams Score$/;
function parseBtts(events) {
  const byId = new Map();
  for (const ev of events || []) {
    for (const mkt of ev.markets || []) {
      if (!BTTS_MARKET_RE.test(mkt.name || '')) continue;
      const o = {};
      for (const out of mkt.outcomes || []) {
        const price = priceOf(out);
        if (out.minorCode === 'Y') o.yes = price;
        else if (out.minorCode === 'N') o.no = price;
      }
      if (o.yes && o.no) {
        byId.set(String(ev.id), o);
        break; // one full-time BTTS market per event
      }
    }
  }
  return byId;
}
const fetchSgPoolsBtts = makeUpcomingFetcher('BG', parseBtts);

const NGN_MARKET_RE = /^Team to Score 1st Goal$/;
function parseFirstGoal(events) {
  const byId = new Map();
  for (const ev of events || []) {
    for (const mkt of ev.markets || []) {
      if (!NGN_MARKET_RE.test(mkt.name || '')) continue;
      const o = {};
      for (const out of mkt.outcomes || []) {
        const price = priceOf(out);
        if (out.minorCode === 'H') o.home = price;
        else if (out.minorCode === 'A') o.away = price;
        else if (out.minorCode === 'N') o.none = price;
      }
      if (o.home && o.away && o.none) {
        byId.set(String(ev.id), o);
        break; // one full-time "1st to score" market per event
      }
    }
  }
  return byId;
}
const fetchSgPoolsFirstGoal = makeUpcomingFetcher('NGN', parseFirstGoal);

// "1/2 Goal" — a plain goal-margin handicap, distinct from Asian Handicap
// (WH's lines only ever seen as whole/half numbers, never quarters, in the
// capture this was confirmed against). Filtered by minorCode AND exact
// name for the same reason AH is: there's also a "Half Time 1/2 Goal"
// market at the same minorCode.
const WH_MARKET_RE = /^1\/2 Goal$/;
function parseGoalHandicap(events) {
  const byId = new Map();
  for (const ev of events || []) {
    for (const mkt of ev.markets || []) {
      if (mkt.minorCode !== 'WH' || !WH_MARKET_RE.test(mkt.name || '')) continue;
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
        break; // one full-time 1/2-Goal market per event
      }
    }
  }
  return byId;
}
const fetchSgPoolsGoalHandicap = makeUpcomingFetcher('WH', parseGoalHandicap);

// "Handicap 1X2" — a 3-way (home/draw/away) match on top of a goal
// handicap, rather than the 2-way Asian Handicap. Only offered on a small
// minority of fixtures in the capture this was confirmed against (2/97).
// The draw outcome's minorCode is 'L', not 'D' (unlike Halftime 1X2 above)
// — SG Pools' own inconsistency, not a typo here.
const MH_MARKET_RE = /^Handicap 1X2$/;
function parseHandicap1X2(events) {
  const byId = new Map();
  for (const ev of events || []) {
    for (const mkt of ev.markets || []) {
      if (mkt.minorCode !== 'MH' || !MH_MARKET_RE.test(mkt.name || '')) continue;
      let point = null;
      const o = {};
      for (const out of mkt.outcomes || []) {
        const hcap = out.prices && out.prices[0] && parseHcapValue(out.prices[0].hcapValue);
        const price = priceOf(out);
        if (out.minorCode === 'H') {
          o.home = price;
          if (Number.isFinite(hcap)) point = hcap;
        } else if (out.minorCode === 'L') {
          o.draw = price;
        } else if (out.minorCode === 'A') {
          o.away = price;
        }
      }
      if (o.home && o.draw && o.away && Number.isFinite(point)) {
        byId.set(String(ev.id), { point, home: o.home, draw: o.draw, away: o.away });
        break; // one full-time Handicap-1X2 market per event
      }
    }
  }
  return byId;
}
const fetchSgPoolsHandicap1X2 = makeUpcomingFetcher('MH', parseHandicap1X2);

module.exports = {
  fetchSgPoolsOu,
  parseOu,
  fetchSgPoolsAh,
  parseAh,
  parseHcapValue,
  fetchSgPoolsH1,
  parseH1,
  fetchSgPoolsOe,
  parseOe,
  fetchSgPoolsBtts,
  parseBtts,
  fetchSgPoolsFirstGoal,
  parseFirstGoal,
  fetchSgPoolsGoalHandicap,
  parseGoalHandicap,
  fetchSgPoolsHandicap1X2,
  parseHandicap1X2,
};
