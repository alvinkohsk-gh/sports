const { launchBrowser, IS_SERVERLESS } = require('./launch');
const { blockHeavyRequests } = require('./blocking');

// One shared Chromium process for the whole refresh, with tab usage
// serialized to exactly one at a time. The pieces:
//   ./launch.js    serverless (@sparticuz/chromium-min) vs local boot
//   ./blocking.js  per-tab image/media/font + ad-host request blocking
//
// Why one shared browser + 1 tab at a time. aggregator.js fires the SG
// Pools scraper and all tipster scrapers (each fetching up to 2 pages)
// concurrently. Each used to call launchBrowser() independently — up to
// ~11 separate Chromium processes at once on Vercel, confirmed via runtime
// logs to blow past the function's resources ("net::ERR_INSUFFICIENT_
// RESOURCES", then "Target page, context or browser has been closed" as
// processes got killed), leaving /api/matches at 0 matches or timing out.
//
// A dedicated browser per page made memory pressure worse: even 3
// concurrent full --single-process Chromium instances (each a whole
// browser, not a tab) hit net::ERR_INSUFFICIENT_RESOURCES at launch faster
// than one shared instance with 3 tabs.
//
// One shared browser with >1 concurrent tab failed differently:
// @sparticuz/chromium-min launches with --single-process (visible in the
// production launch args), so every tab shares one OS process with no
// per-tab isolation. Even at 3009MB with image/media/font/ad blocking, 3
// concurrent tabs took the single process down outright.
//
// So: one shared browser (least total memory), tabs serialized to 1. A
// fully-serial run without resource blocking was tried too and blew past
// maxDuration (summing ~9 pages' worst-case navigation timeouts); the
// blocking in ./blocking.js cuts enough per-page load time to bring the
// serialized total back under 60s.
const MAX_CONCURRENT_PAGES = 1;
let activePages = 0;
const pageWaiters = [];

function acquirePageSlot() {
  if (activePages < MAX_CONCURRENT_PAGES) {
    activePages += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => pageWaiters.push(resolve));
}

function releasePageSlot() {
  const next = pageWaiters.shift();
  if (next) {
    next();
  } else {
    activePages -= 1;
  }
}

let cachedBrowserPromise = null;

async function getSharedBrowser() {
  if (cachedBrowserPromise) {
    const browser = await cachedBrowserPromise.catch(() => null);
    if (browser && browser.isConnected()) return browser;
    cachedBrowserPromise = null;
  }
  cachedBrowserPromise = launchBrowser();
  return cachedBrowserPromise;
}

async function withSharedPage(fn, pageOptions = {}) {
  await acquirePageSlot();
  try {
    const browser = await getSharedBrowser();
    const page = await browser.newPage(pageOptions);
    try {
      await blockHeavyRequests(page);
      return await fn(page);
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    releasePageSlot();
  }
}

module.exports = { launchBrowser, withSharedPage, IS_SERVERLESS };
