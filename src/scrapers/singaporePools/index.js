const { renderWithBrowser, getLastCapture } = require('./render');
const {
  parseOu,
  fetchSgPoolsOu,
  parseAh,
  fetchSgPoolsAh,
  parseH1,
  fetchSgPoolsH1,
  parseOe,
  fetchSgPoolsOe,
  parseBtts,
  fetchSgPoolsBtts,
  parseFirstGoal,
  fetchSgPoolsFirstGoal,
  parseGoalHandicap,
  fetchSgPoolsGoalHandicap,
  parseHandicap1X2,
  fetchSgPoolsHandicap1X2,
} = require('./odds');
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
  let h1ById = rendered.h1Events ? parseH1(rendered.h1Events) : new Map();
  if (h1ById.size === 0) h1ById = await fetchSgPoolsH1();
  let oeById = rendered.oeEvents ? parseOe(rendered.oeEvents) : new Map();
  if (oeById.size === 0) oeById = await fetchSgPoolsOe();
  let bttsById = rendered.bttsEvents ? parseBtts(rendered.bttsEvents) : new Map();
  if (bttsById.size === 0) bttsById = await fetchSgPoolsBtts();
  let firstGoalById = rendered.firstGoalEvents ? parseFirstGoal(rendered.firstGoalEvents) : new Map();
  if (firstGoalById.size === 0) firstGoalById = await fetchSgPoolsFirstGoal();
  let goalHandicapById = rendered.goalHandicapEvents ? parseGoalHandicap(rendered.goalHandicapEvents) : new Map();
  if (goalHandicapById.size === 0) goalHandicapById = await fetchSgPoolsGoalHandicap();
  let handicap1x2ById = rendered.handicap1x2Events ? parseHandicap1X2(rendered.handicap1x2Events) : new Map();
  if (handicap1x2ById.size === 0) handicap1x2ById = await fetchSgPoolsHandicap1X2();

  // Attaches every {key: Map<sgpMatchId, odds>} entry in `maps` onto each
  // fixture's `odds`, tallying a per-key count. Shared between the
  // pre-match fixtures below and the in-play ones further down — same
  // shape, different source maps.
  function attachAllOdds(list, maps) {
    let x12 = 0;
    const counts = {};
    for (const key of Object.keys(maps)) counts[key] = 0;
    for (const f of list) {
      if (f.odds && f.odds.oneX2) x12 += 1;
      for (const [key, byId] of Object.entries(maps)) {
        const val = byId.get(String(f.sgpMatchId));
        if (val) {
          f.odds = { ...(f.odds || { oneX2: null, ou: null }), [key]: val };
          counts[key] += 1;
        }
      }
    }
    return { x12, counts };
  }

  const { x12, counts } = attachAllOdds(fixtures, {
    ou: ouById,
    ah: ahById,
    h1: h1ById,
    oe: oeById,
    btts: bttsById,
    firstGoal: firstGoalById,
    goalHandicap: goalHandicapById,
    handicap1x2: handicap1x2ById,
  });
  if (DEBUG)
    console.log(
      `[singaporePools] odds: 1X2 on ${x12}/${fixtures.length}, O/U on ${counts.ou}, AH on ${counts.ah}, ` +
        `H1 on ${counts.h1}, O/E on ${counts.oe}, BTTS on ${counts.btts}, 1st-goal on ${counts.firstGoal}, ` +
        `1/2-goal on ${counts.goalHandicap}, handicap-1X2 on ${counts.handicap1x2}`
    );

  lastInPlay = extractLiveFixtures(rendered.liveEvents);
  // Unlike the pre-match endpoint (one betType per request), SG Pools'
  // /live payload already carries every market for an in-play event in
  // its own `markets` array — the same odds.js parsers work against it
  // directly, no extra requests needed. (O/U is deliberately NOT
  // re-attached here — extractLiveFixtures already picked the live O/U
  // line it wants, the lowest still-open threshold, for `liveLine`/
  // `goalsSoFar`; re-parsing it here could disagree with that choice.)
  if (rendered.liveEvents) {
    const { counts: liveCounts } = attachAllOdds(lastInPlay, {
      ah: parseAh(rendered.liveEvents),
      h1: parseH1(rendered.liveEvents),
      oe: parseOe(rendered.liveEvents),
      btts: parseBtts(rendered.liveEvents),
      firstGoal: parseFirstGoal(rendered.liveEvents),
      goalHandicap: parseGoalHandicap(rendered.liveEvents),
      handicap1x2: parseHandicap1X2(rendered.liveEvents),
    });
    if (DEBUG)
      console.log(
        `[singaporePools] in-play: ${lastInPlay.length}, odds: AH on ${liveCounts.ah}, H1 on ${liveCounts.h1}, ` +
          `O/E on ${liveCounts.oe}, BTTS on ${liveCounts.btts}, 1st-goal on ${liveCounts.firstGoal}, ` +
          `1/2-goal on ${liveCounts.goalHandicap}, handicap-1X2 on ${liveCounts.handicap1x2}`
      );
  } else if (DEBUG) {
    console.log(`[singaporePools] in-play: ${lastInPlay.length}`);
  }

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
