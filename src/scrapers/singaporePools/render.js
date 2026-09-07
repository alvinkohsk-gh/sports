const fs = require('fs');
const os = require('os');
const path = require('path');
const cheerio = require('cheerio');
const { withSharedPage, IS_SERVERLESS } = require('../browser');
const { summarizeEventShapes } = require('./parsers');

const DEBUG = String(process.env.SGPOOLS_DEBUG || 'false').toLowerCase() === 'true';
// Vercel's filesystem is read-only outside /tmp, so debug dumps go there
// when running serverless instead of the project directory used locally.
const DEBUG_DIR = IS_SERVERLESS ? os.tmpdir() : path.join(__dirname, '..', '..', '..');
const DEBUG_HTML_PATH = path.join(DEBUG_DIR, 'debug-sgpools-raw.html');
const DEBUG_SCREENSHOT_PATH = path.join(DEBUG_DIR, 'debug-sgpools-screenshot.png');

// Corrected twice now: first from www.singaporepools.com.sg (a different,
// older domain), then from /en/sports (confirmed 404 in production — a
// captured render of that path showed the real site's own "Page Not
// Found" page, title and all). The real route was found by pulling every
// internal nav link out of that 404 page's shared header, which listed
// /sports/football alongside /sports/motor-racing, /lottery/toto, etc.
// This is a modern single-page app — the fixture list is not present in
// the initial HTML, it's rendered client-side after data loads. A plain
// HTTP GET only sees the empty app shell, so this renders the page with a
// headless browser instead and reads the DOM after it settles.
const SPORTS_URL = 'https://online.singaporepools.com/sports/football';

// Vercel's /tmp (where DEBUG_HTML_PATH/DEBUG_SCREENSHOT_PATH write to) isn't
// reachable from outside the function, so the last render is also kept here
// in memory — /api/debug/sgpools-raw reads it via getLastCapture() to
// expose a real sample of the page for building actual selectors, without
// needing filesystem access to the serverless instance.
let lastCapture = null;

function getLastCapture() {
  return lastCapture;
}

/**
 * Renders the sports page with a headless browser (needed because this is
 * a client-side-rendered app) and captures JSON responses the page itself
 * makes along the way — if the site loads fixtures via its own XHR/fetch
 * calls, that's a far more robust source than scraping rendered text, so
 * we grab it opportunistically instead of guessing endpoint URLs upfront.
 */
async function renderWithBrowser() {
  const capturedJson = [];

  return withSharedPage(async (page) => {
    page.on('response', async (response) => {
      const contentType = response.headers()['content-type'] || '';
      if (!contentType.includes('json')) return;
      try {
        const body = await response.json();
        capturedJson.push({ url: response.url(), body });
      } catch {
        // not actually JSON or already consumed — ignore
      }
    });

    // 'networkidle' is unreliable here and was confirmed to fail two ways in
    // production: it can time out entirely (this app appears to keep some
    // background connection open, so "idle" never arrives) or resolve the
    // instant the initial HTML/JS/CSS finish downloading — before the
    // just-loaded bundle has even started executing, let alone fetching
    // match data. A captured render at that point showed only the app's own
    // loading spinner (`#general_loader_indicator`) with zero JSON responses
    // observed. 'domcontentloaded' is fast and reliable for getting past the
    // initial page load; waiting for that spinner to detach is then the real
    // signal that client-side data-fetching has finished, rather than a
    // fixed delay that's a guess at how long that takes on a cold instance.
    await page.goto(SPORTS_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    // Runtime timing logs showed this consistently burning its entire
    // timeout (the loader indicator never detaches within it, at least from
    // this environment) rather than resolving early — shortened from 20000ms
    // since every page in the refresh's serial queue (see browser.js: only
    // one shared page is allowed at a time) eats into the same 60s function
    // budget, and paying the full wait for a selector that never clears here
    // was consuming over a third of it for nothing.
    await page
      .waitForSelector('[data-testid="general_loader_indicator"]', { state: 'detached', timeout: 8000 })
      .catch(() => {
        if (DEBUG) console.log('[singaporePools] loader indicator never appeared/detached within 8s');
      });
    // Shortened from 2000ms — same reasoning as the timeout above.
    await page.waitForTimeout(500);

    // If the events payload came back thin (the GitHub runner IP gets
    // rate-limited by api.singaporepools.com and served a near-empty
    // fixture list), reload once after a pause — the throttle is a short
    // sliding window, so the retry often lands a full payload. Both
    // captures are kept; index.js takes the largest.
    const eventsSeen = () =>
      capturedJson.reduce(
        (n, c) => Math.max(n, Array.isArray(c.body && c.body.events) ? c.body.events.length : 0),
        0
      );
    if (eventsSeen() < 15) {
      if (DEBUG) console.log(`[singaporePools] only ${eventsSeen()} events seen — reloading once`);
      await page.waitForTimeout(6000);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      await page
        .waitForSelector('[data-testid="general_loader_indicator"]', { state: 'detached', timeout: 8000 })
        .catch(() => {});
      await page.waitForTimeout(800);
      if (DEBUG) console.log(`[singaporePools] after reload: ${eventsSeen()} events seen`);
    }

    const html = await page.content();

    // The page auto-loads the 1X2 (betType=MR) events but not the
    // Over/Under view. Fetch it from inside the page — the SPA already
    // calls api.singaporepools.com cross-origin, so CORS allows it, and
    // this keeps every SG Pools API hit inside the one legit render
    // session (a bare server-side request on top got the runner IP
    // throttled — see odds.js history).
    let ouEvents = null;
    try {
      ouEvents = await page.evaluate(async () => {
        const r = await fetch(
          'https://api.singaporepools.com/football/events/v1/upcoming-event?lang=en&betType=HL',
          { credentials: 'omit' }
        );
        if (!r.ok) return null;
        const d = await r.json();
        return Array.isArray(d.events) ? d.events : null;
      });
    } catch (err) {
      if (DEBUG) console.log('[singaporePools] in-page O/U fetch failed:', err.message);
    }

    // A capture against the wrong URL rendered the site's own 404 page
    // (title "Page Not Found | Singapore Pools") — confirmed SPORTS_URL is
    // wrong. The 404 page still carries the site's real shared nav/header,
    // so pulling every internal link out of it (rather than dumping more
    // raw HTML, which is mostly SVG icon paths before any nav text) is the
    // fastest way to find the actual sports/football route without
    // guessing at one.
    const $ = cheerio.load(html);
    const title = $('title').text();
    const navLinks = [
      ...new Set(
        $('a[href]')
          .map((_, el) => $(el).attr('href'))
          .get()
          .filter((href) => href && (href.startsWith('/') || href.includes('singaporepools')))
      ),
    ].sort();

    lastCapture = {
      capturedAt: new Date().toISOString(),
      pageTitle: title,
      htmlLength: html.length,
      htmlSample: html.slice(0, 20000),
      navLinks,
      capturedJson: capturedJson.map((c) => ({
        url: c.url,
        bodySample: JSON.stringify(c.body).slice(0, 2000),
        // The real fixture-events API found at /sports/football nests each
        // event's team/participant fields alongside a large "markets" array
        // of odds — JSON.stringify(body).slice(0, 5000) never reached them
        // in a capture, since "markets" alone ran past that cutoff. This
        // finds each object that looks like an event (has an id + a
        // markets-like key) and dumps just its own keys with nested
        // arrays/objects collapsed to a length/type marker, so the actual
        // team-name field names are visible without the odds payload noise.
        eventShapes: summarizeEventShapes(c.body),
      })),
    };

    if (DEBUG) {
      try {
        fs.writeFileSync(DEBUG_HTML_PATH, html);
        await page.screenshot({ path: DEBUG_SCREENSHOT_PATH, fullPage: true });
      } catch (err) {
        console.error('[singaporePools] could not write debug dump:', err.message);
      }
      console.log(
        `[singaporePools] rendered page: ${html.length} bytes of HTML -> ${DEBUG_HTML_PATH}, ` +
          `screenshot -> ${DEBUG_SCREENSHOT_PATH}, captured ${capturedJson.length} JSON responses`
      );
      capturedJson.forEach((c, i) => console.log(`[singaporePools]   JSON response #${i}: ${c.url}`));
    }

    return { html, capturedJson, ouEvents };
  });
}

module.exports = { renderWithBrowser, getLastCapture };
