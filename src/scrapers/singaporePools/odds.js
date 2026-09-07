const axios = require('axios');

// Singapore Pools' fixture-events API also serves the prices, one call per
// bet type (confirmed against production captures — plain HTTPS JSON, no
// Cloudflare):
//   .../upcoming-event?lang=en&betType=MR  -> 1X2   (outcomes H / D / A)
//   .../upcoming-event?lang=en&betType=HL  -> totals (many lines; the
//        full-time 2.5 market is name "Total Goals Over/Under 2.5",
//        outcomes H = Over, L = Under). Only ~2/3 of fixtures carry a 2.5
//        line — the rest are priced at 1.5 or 3.5.
const BASE = 'https://api.singaporepools.com/football/events/v1/upcoming-event?lang=en&betType=';
const TIMEOUT_MS = Number(process.env.SGPOOLS_ODDS_TIMEOUT_MS) || 15000;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 1 ? n : null;
};

function priceOf(outcome) {
  const p = (outcome && outcome.prices && outcome.prices[0]) || null;
  return p ? num(p.decimal) : null;
}

function parse1x2(events) {
  const byId = new Map();
  for (const ev of events || []) {
    const mkt = (ev.markets || []).find((m) => m.minorCode === 'MR');
    if (!mkt) continue;
    const o = {};
    for (const out of mkt.outcomes || []) {
      if (out.minorCode === 'H') o.home = priceOf(out);
      else if (out.minorCode === 'D') o.draw = priceOf(out);
      else if (out.minorCode === 'A') o.away = priceOf(out);
    }
    if (o.home && o.draw && o.away) byId.set(String(ev.id), o);
  }
  return byId;
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
 * Returns Map<sgpMatchId, { oneX2:{home,draw,away}, ou25:{over,under}|null }>.
 * A failed fetch of either bet type just leaves that part out rather than
 * throwing — odds are an enhancement, not required for the board.
 */
async function fetchSgPoolsOdds() {
  const get = (bt) =>
    axios
      .get(`${BASE}${bt}`, { timeout: TIMEOUT_MS, headers: { 'User-Agent': 'sg-pools-live-odds' } })
      .then((r) => r.data && r.data.events)
      .catch((err) => {
        console.error(`[sgpools-odds] ${bt} fetch failed:`, err.message || err);
        return [];
      });

  const [mrEvents, hlEvents] = await Promise.all([get('MR'), get('HL')]);
  const mr = parse1x2(mrEvents);
  const hl = parseOu25(hlEvents);

  const out = new Map();
  for (const [id, oneX2] of mr) out.set(id, { oneX2, ou25: hl.get(id) || null });
  return out;
}

module.exports = { fetchSgPoolsOdds, parse1x2, parseOu25 };
