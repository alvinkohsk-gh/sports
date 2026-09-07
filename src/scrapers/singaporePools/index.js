const { renderWithBrowser, getLastCapture } = require('./render');
const {
  toFixture,
  extractFixturesFromEventsApi,
  extractFixturesFromJson,
  parseRenderedHtml,
  coerceSgTimeToISO,
} = require('./parsers');

// Scrapes the Singapore Pools football fixture list. Entry point:
// fetchOpenFixtures(). The pieces:
//   ./render.js    headless-browser render + JSON-response capture
//   ./parsers.js   pure parsers for each payload shape
// This file only decides which parser to trust, in order of reliability.

const DEBUG = String(process.env.SGPOOLS_DEBUG || 'false').toLowerCase() === 'true';

async function fetchOpenFixtures() {
  let rendered;
  try {
    rendered = await renderWithBrowser();
  } catch (err) {
    console.error('[singaporePools] browser render failed:', err.message);
    return [];
  }

  // The page's own JSON calls are the real source of truth — prefer them
  // over scraped/rendered text. Try the verified real API shape first
  // (api.singaporepools.com/football/events/v1/{upcoming-event,live} —
  // confirmed via production capture), then the generic key-matching walk
  // for any other shape, then fall back to rendered-text patterns.
  for (const { body } of rendered.capturedJson) {
    const fixtures = extractFixturesFromEventsApi(body);
    if (fixtures.length) {
      if (DEBUG) console.log(`[singaporePools] extracted ${fixtures.length} fixtures from the events API`);
      return fixtures;
    }
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

module.exports = {
  fetchOpenFixtures,
  getLastCapture,
  // re-exported for tests / callers that used the flat module
  extractFixturesFromJson,
  extractFixturesFromEventsApi,
  parseRenderedHtml,
  coerceSgTimeToISO,
  toFixture,
};
