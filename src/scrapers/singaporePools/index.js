const { renderWithBrowser, getLastCapture } = require('./render');
const { parseOu, fetchSgPoolsOu, parseAh, fetchSgPoolsAh } = require('./odds');
const {
  toFixture,
  extractFixturesFromEventsApi,
  extractLiveFixtures,
  extractFixturesFromJson,
  parseRenderedHtml,
  coerceSgTimeToISO,
} = require('./parsers');

// Scrapes the Singapore Pools football fixture list. Entry point:
// fetchOpenFixtures(). The pieces:
//   ./render.js    headless-browser render + JSON-response capture
//   ./parsers.js   pure parsers (also lifts the 1X2 prices from the payload)
//   ./odds.js      one extra call for the O/U prices (whatever line SG Pools has posted)
// This file decides which parser to trust, then attaches the O/U odds.

const DEBUG = String(process.env.SGPOOLS_DEBUG || 'false').toLowerCase() === 'true';

// In-play fixtures from the render's live-endpoint capture. Populated by
// fetchOpenFixtures (one render serves both); read by the aggregator.
let lastInPlay = [];
function getInPlayFixtures() {
  return lastInPlay;
}

function extractFixtures(rendered) {
  // The page's own JSON calls are the real source of truth — prefer them
  // over scraped/rendered text. Try the verified real API shape first
  // (api.singaporepools.com/football/events/v1/{upcoming-event,live} —
  // confirmed via production capture), then the generic key-matching walk
  // for any other shape, then fall back to rendered-text patterns.
  //
  // Take the *largest* result across all captured responses, not the first
  // non-empty one: a throttled runner sometimes gets a near-empty
  // upcoming-event payload alongside (or before) a full one on reload.
  let best = [];
  for (const { body } of rendered.capturedJson) {
    const fixtures = extractFixturesFromEventsApi(body);
    if (fixtures.length > best.length) best = fixtures;
  }
  if (best.length) {
    if (DEBUG) console.log(`[singaporePools] extracted ${best.length} fixtures from the events API`);
    return best;
  }
  for (const { body } of rendered.capturedJson) {
    const fixtures = extractFixturesFromJson(body);
    if (fixtures.length) {
      if (DEBUG) console.log(`[singaporePools] extracted ${fixtures.length} fixtures from a captured JSON response`);
      return fixtures;
    }
  }

  const fixtures = parseRenderedHtml(rendered.html);
  if (DEBUG) console.log(`[singaporePools] rendered-HTML pattern match extracted ${fixtures.length} fixtures`);
  if (fixtures.length === 0) {
    console.warn(
      '[singaporePools] found 0 fixtures. Set SGPOOLS_DEBUG=true and inspect debug-sgpools-raw.html / ' +
        'debug-sgpools-screenshot.png to see what the scraper actually saw, then adjust parseRenderedHtml ' +
        "(or the captured-JSON handling) in ./parsers.js to match the site's real structure."
    );
  }
  return fixtures;
}

async function fetchOpenFixtures() {
  let rendered;
  try {
    rendered = await renderWithBrowser();
  } catch (err) {
    console.error('[singaporePools] browser render failed:', err.message);
    return [];
  }

  const fixtures = extractFixtures(rendered);
  // fixtures may already carry `odds: { oneX2, ou: null }` from the events
  // payload (parsers.js). Add the O/U line — whatever point it's set at
  // (1.5, 2.5, 3.5, ...) — from the in-page fetch (render.js); only if
  // that came back empty do we make a bare server-side call as a fallback.
  let ouById = rendered.ouEvents ? parseOu(rendered.ouEvents) : new Map();
  if (ouById.size === 0) ouById = await fetchSgPoolsOu();
  let ahById = rendered.ahEvents ? parseAh(rendered.ahEvents) : new Map();
  if (ahById.size === 0) ahById = await fetchSgPoolsAh();
  let x12 = 0;
  let ouCount = 0;
  let ahCount = 0;
  for (const f of fixtures) {
    if (f.odds && f.odds.oneX2) x12 += 1;
    const o = ouById.get(String(f.sgpMatchId));
    if (o) {
      f.odds = { ...(f.odds || { oneX2: null }), ou: o };
      ouCount += 1;
    }
    const ah = ahById.get(String(f.sgpMatchId));
    if (ah) {
      f.odds = { ...(f.odds || { oneX2: null, ou: null }), ah };
      ahCount += 1;
    }
  }
  if (DEBUG) console.log(`[singaporePools] odds: 1X2 on ${x12}/${fixtures.length}, O/U on ${ouCount}, AH on ${ahCount}`);

  lastInPlay = extractLiveFixtures(rendered.liveEvents);
  if (DEBUG) console.log(`[singaporePools] in-play: ${lastInPlay.length}`);

  return fixtures;
}

module.exports = {
  fetchOpenFixtures,
  getInPlayFixtures,
  getLastCapture,
  // re-exported for tests / callers that used the flat module
  extractFixturesFromJson,
  extractFixturesFromEventsApi,
  extractLiveFixtures,
  parseRenderedHtml,
  coerceSgTimeToISO,
  toFixture,
};
