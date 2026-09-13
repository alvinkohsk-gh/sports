/*
 * THROWAWAY debug script — not part of the real pipeline. Probes every
 * football bet type SG Pools' own lookup table lists (fetched live via
 * https://online2.singaporepools.com/en/api/lov/football_bet_type on
 * 2026-09-13: WH, FS, MR, AH, H1, TG2, HF, MH, LS, CS, NGN, EG, OE, HL, BG)
 * beyond the three already scraped (MR/1X2, HL/O-U, AH) to see each
 * market's real shape (outcome count/names, handicapValue format) before
 * deciding which are actually feasible to show on a match card. Never
 * merged; run once via workflow dispatch on a debug branch, output read
 * back via git fetch of the debug-capture branch it publishes to.
 */
const axios = require('axios');
const fs = require('fs');

const BET_TYPES = ['WH', 'FS', 'H1', 'TG2', 'HF', 'MH', 'LS', 'CS', 'NGN', 'EG', 'OE', 'BG'];

async function fetchBetType(bt) {
  const url = `https://api.singaporepools.com/football/events/v1/upcoming-event?lang=en&betType=${encodeURIComponent(bt)}`;
  try {
    const res = await axios.get(url, { timeout: 15000, headers: { 'User-Agent': 'sg-pools-live-odds-debug' } });
    return { betType: bt, url, status: res.status, data: res.data };
  } catch (err) {
    return { betType: bt, url, error: err.message || String(err) };
  }
}

function summarizeMarkets(data) {
  if (!data || !Array.isArray(data.events)) return { eventCount: 0, markets: [] };
  const seen = new Map();
  for (const ev of data.events) {
    for (const m of ev.markets || []) {
      const key = `${m.name}::${m.minorCode || ''}::${m.handicapValue || ''}`;
      if (!seen.has(key)) {
        seen.set(key, {
          name: m.name,
          minorCode: m.minorCode,
          majorCode: m.majorCode,
          handicapValue: m.handicapValue,
          outcomeCount: (m.outcomes || []).length,
          outcomeNames: (m.outcomes || []).slice(0, 40).map((o) => o.name || o.minorCode),
        });
      }
    }
  }
  return { eventCount: data.events.length, markets: [...seen.values()] };
}

async function main() {
  const out = { probedAt: new Date().toISOString(), results: [] };
  for (const bt of BET_TYPES) {
    const r = await fetchBetType(bt);
    if (r.error) {
      out.results.push({ betType: r.betType, url: r.url, error: r.error });
      continue;
    }
    const summary = summarizeMarkets(r.data);
    const entry = { betType: r.betType, url: r.url, status: r.status, ...summary };
    // Keep one full sample event per bet type for exact outcome-shape
    // inspection (price fields, hcapValue, participant names for
    // player-prop markets).
    if (r.data && Array.isArray(r.data.events) && r.data.events.length) {
      entry.sampleEvent = r.data.events[0];
    }
    out.results.push(entry);
  }
  fs.mkdirSync('debug-tipsters', { recursive: true });
  fs.writeFileSync('debug-tipsters/sgpools-betTypes-probe.json', JSON.stringify(out, null, 2));
  console.log('wrote debug-tipsters/sgpools-betTypes-probe.json');
}

main();
