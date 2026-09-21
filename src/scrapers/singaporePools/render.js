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

// See the throttle-history comment where this is called (inside
// renderWithBrowser) for why these 6 markets rotate instead of all being
// fetched every scrape. Pure/deterministic off wall-clock time (not
// persisted state — each scrape is a fresh process) so two batches
// naturally alternate across scrapes without any run needing to know
// what the previous one picked.
const ROTATE_BATCHES = [
  ['h1', 'oe', 'btts'],
  ['firstGoal', 'goalHandicap', 'handicap1x2'],
];
const ROTATE_WINDOW_MS = 15 * 60 * 1000;
function pickRotateBatch(nowMs) {
  return ROTATE_BATCHES[Math.floor(nowMs / ROTATE_WINDOW_MS) % ROTATE_BATCHES.length];
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
    // Over/Under view or the in-play list. Fetch both from inside the page
    // — the SPA already calls api.singaporepools.com cross-origin, so CORS
    // allows it, and this keeps every SG Pools API hit inside the one
    // legit render session (a bare server-side request on top got the
    // runner IP throttled — see odds.js history).
    let ouEvents = null;
    let ahEvents = null;
    let liveEvents = null;
    let h1Events = null;
    let oeEvents = null;
    let bttsEvents = null;
    let firstGoalEvents = null;
    let goalHandicapEvents = null;
    let handicap1x2Events = null;
    // Growing this to 8 parallel bet-type calls (on top of OU/AH/live,
    // added 2026-09-12/13) reintroduced — worse than before — the exact
    // throttling that "SG Pools: stop the extra API calls that got the
    // runner throttled" (2026-09-08) fixed: runs from ~2026-09-20T19:00Z
    // onward got a stuck near-empty fixture payload on every single scrape
    // for 11+ hours straight, never recovering the way the "short sliding
    // window" throttle this file used to assume would. OU/AH/live are the
    // proven-safe core (fetched every scrape, matching the pre-regression
    // baseline plus AH, which real settlement logic elsewhere depends on);
    // the other 6 markets are split into two batches and alternated by a
    // 15-minute wall-clock bucket (pickRotateBatch), so any one scrape
    // fetches at most 6 in-page calls total (down from 9) and a given
    // market refreshes on roughly every other scrape instead of every one
    // — a market can go briefly unpriced on its "off" cycle rather than
    // for good. Each fetch is still made from inside the page
    // (same-origin to the SPA's own calls), never a bare server-side
    // request — see odds.js's header for why a bare call is worse.
    const rotateBatch = pickRotateBatch(Date.now());
    const attempted = ['ou', 'ah', ...rotateBatch];
    if (DEBUG) console.log(`[singaporePools] this scrape's extra-market batch: ${rotateBatch.join(', ')}`);
    try {
      const res = await page.evaluate(async (batch) => {
        const grab = async (url) => {
          try {
            const r = await fetch(url, { credentials: 'omit' });
            if (!r.ok) return null;
            const d = await r.json();
            return Array.isArray(d.events) ? d.events : null;
          } catch {
            return null;
          }
        };
        const base = 'https://api.singaporepools.com/football/events/v1/';
        const upcoming = (betType) => grab(`${base}upcoming-event?lang=en&betType=${betType}`);
        const want = (name) => batch.includes(name);
        const [ou, ah, live, h1, oe, btts, firstGoal, goalHandicap, handicap1x2] = await Promise.all([
          upcoming('HL'),
          // Asian Handicap — betType=AH confirmed via a live capture
          // (2026-09-12): a plain "Asian Handicap" market per event
          // (there's also a "Half Time Asian Handicap" one, filtered out
          // in odds.js) whose outcomes carry the real settlement line(s)
          // in `prices[0].hcapValue`, not the market's own top-level
          // `handicapValue` (seen stale/unrelated in that capture).
          upcoming('AH'),
          grab(`${base}live?lang=en`),
          want('h1') ? upcoming('H1') : Promise.resolve(null),
          want('oe') ? upcoming('OE') : Promise.resolve(null),
          want('btts') ? upcoming('BG') : Promise.resolve(null),
          want('firstGoal') ? upcoming('NGN') : Promise.resolve(null),
          want('goalHandicap') ? upcoming('WH') : Promise.resolve(null),
          want('handicap1x2') ? upcoming('MH') : Promise.resolve(null),
        ]);
        return { ou, ah, live, h1, oe, btts, firstGoal, goalHandicap, handicap1x2 };
      }, rotateBatch);
      ouEvents = res.ou;
      ahEvents = res.ah;
      liveEvents = res.live;
      h1Events = res.h1;
      oeEvents = res.oe;
      bttsEvents = res.btts;
      firstGoalEvents = res.firstGoal;
      goalHandicapEvents = res.goalHandicap;
      handicap1x2Events = res.handicap1x2;
    } catch (err) {
      if (DEBUG) console.log('[singaporePools] in-page odds fetch failed:', err.message);
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

    return {
      html,
      capturedJson,
      ouEvents,
      ahEvents,
      liveEvents,
      h1Events,
      oeEvents,
      bttsEvents,
      firstGoalEvents,
      goalHandicapEvents,
      handicap1x2Events,
      // which of the rotating extra markets this scrape actually fetched
      // in-page — see the throttling-history comment above. index.js uses
      // this to only bare-call-fallback a market it genuinely tried and
      // got nothing for, never one deliberately skipped this cycle.
      attempted,
    };
  });
}

module.exports = { renderWithBrowser, getLastCapture, pickRotateBatch };
