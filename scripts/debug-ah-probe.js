/*
 * THROWAWAY debug script — not part of the real pipeline. Probes the SG
 * Pools events API for the Asian Handicap market (which betType param
 * exposes it, and what its market/outcome shape looks like, especially for
 * quarter lines like -0.25/-0.75). Never merged; run once via workflow
 * dispatch on a debug branch, output captured via git fetch.
 */
const axios = require('axios');
const fs = require('fs');

const CANDIDATES = ['HL', 'MR', 'AH', 'HDP', 'HC', 'H', 'AHC', 'ASIAN_HANDICAP', 'HANDICAP', ''];

async function fetchBetType(bt) {
  const url = bt
    ? `https://api.singaporepools.com/football/events/v1/upcoming-event?lang=en&betType=${encodeURIComponent(bt)}`
    : 'https://api.singaporepools.com/football/events/v1/upcoming-event?lang=en';
  try {
    const res = await axios.get(url, { timeout: 15000, headers: { 'User-Agent': 'sg-pools-live-odds-debug' } });
    return { betType: bt || '(none)', url, status: res.status, data: res.data };
  } catch (err) {
    return { betType: bt || '(none)', url, error: err.message || String(err) };
  }
}

function summarizeMarkets(data) {
  if (!data || !Array.isArray(data.events)) return { eventCount: 0, marketNames: [] };
  const seen = new Map();
  for (const ev of data.events) {
    for (const m of ev.markets || []) {
      const key = `${m.name}::${m.minorCode || ''}::${m.code || ''}`;
      if (!seen.has(key)) {
        seen.set(key, { name: m.name, minorCode: m.minorCode, code: m.code, handicapValue: m.handicapValue, outcomeCount: (m.outcomes || []).length });
      }
    }
  }
  return { eventCount: data.events.length, markets: [...seen.values()] };
}

async function main() {
  const out = { probedAt: new Date().toISOString(), results: [] };
  for (const bt of CANDIDATES) {
    const r = await fetchBetType(bt);
    if (r.error) {
      out.results.push({ betType: r.betType, url: r.url, error: r.error });
      continue;
    }
    const summary = summarizeMarkets(r.data);
    out.results.push({ betType: r.betType, url: r.url, status: r.status, ...summary });
    // Also keep one full raw event (first) for any betType whose summary
    // mentions "handicap" (case-insensitive) in a market name, for exact
    // shape inspection (outcomes, handicapValue format for quarter lines).
    const hasHandicap = (summary.markets || []).some((m) => /handicap/i.test(m.name || ''));
    if (hasHandicap && r.data && Array.isArray(r.data.events)) {
      const withHandicap = r.data.events.find((ev) =>
        (ev.markets || []).some((m) => /handicap/i.test(m.name || ''))
      );
      if (withHandicap) out.results[out.results.length - 1].sampleEvent = withHandicap;
    }
  }
  fs.mkdirSync('debug-tipsters', { recursive: true });
  fs.writeFileSync('debug-tipsters/sgpools-ah-probe.json', JSON.stringify(out, null, 2));
  console.log('wrote debug-tipsters/sgpools-ah-probe.json');
}

main();
