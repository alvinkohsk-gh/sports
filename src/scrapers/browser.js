// Playwright's bundled Chromium (used locally, and in this dev sandbox via
// PLAYWRIGHT_BROWSERS_PATH) doesn't fit Vercel's serverless function size
// limits. On Vercel we instead use @sparticuz/chromium-min — a Chromium
// build made for AWS Lambda / Vercel's Node runtime — fetched at cold
// start from a hosted release tar, driven via playwright-core (the same
// Playwright API, just without the bundled browser download).
const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

// Must match the installed @sparticuz/chromium-min version (see
// package.json) — the package doesn't ship a default remote pack URL for
// the -min variant, so this points at that exact version's GitHub release
// asset. Verified reachable: confirmed with a live HTTP request during
// development (see README's Deploying to Vercel section) that this exact
// filename pattern (chromium-vVERSION-pack.x64.tar, not chromium-pack.tar)
// exists on that release.
const CHROMIUM_MIN_VERSION = '149.0.0';
const REMOTE_CHROMIUM_PACK = `https://github.com/Sparticuz/chromium/releases/download/v${CHROMIUM_MIN_VERSION}/chromium-v${CHROMIUM_MIN_VERSION}-pack.x64.tar`;

// aggregator.js fires the SG Pools scraper and all 5 tipster scrapers
// concurrently, and each independently calls launchBrowser() — on Vercel
// that means several concurrent calls to chromium.executablePath(), which
// extracts the binary to /tmp/chromium. Racing that extraction produced
// "spawn ETXTBSY" in production (confirmed via runtime logs): one call
// execs the file while another is still mid-write to it. Caching the
// promise means the extraction happens once per warm instance and every
// caller (concurrent or not) awaits the same result before launching its
// own browser process against the now-stable binary.
let cachedExecutablePathPromise = null;

async function launchBrowser(launchOptions = {}) {
  if (IS_SERVERLESS) {
    // @sparticuz/chromium-min's build/index.js is a genuine ES Module —
    // require() throws "require() of ES Module ... not supported" on
    // Vercel's Node runtime (confirmed via its actual runtime error logs
    // after deploying; a local sandbox test with an older/looser Node
    // setup didn't catch this). Dynamic import() works in both CJS and
    // ESM contexts, which is Node's own recommended fix for this error.
    // The real object with args/executablePath lands under `.default`
    // once awaited (also confirmed against the real package contents).
    const chromiumModule = await import('@sparticuz/chromium-min');
    const chromium =
      typeof chromiumModule.executablePath === 'function' ? chromiumModule : chromiumModule.default;
    const { chromium: playwrightChromium } = require('playwright-core');
    if (!cachedExecutablePathPromise) {
      cachedExecutablePathPromise = chromium.executablePath(REMOTE_CHROMIUM_PACK);
    }
    return playwrightChromium.launch({
      ...launchOptions,
      args: chromium.args,
      executablePath: await cachedExecutablePathPromise,
      headless: true,
    });
  }

  const { chromium: playwrightChromium } = require('playwright');
  return playwrightChromium.launch(launchOptions);
}

// aggregator.js fires the SG Pools scraper and all 5 tipster scrapers (each
// of which fetches up to 2 pages) concurrently. Each used to call
// launchBrowser() independently, meaning up to ~11 separate Chromium
// processes running at once on Vercel — confirmed via runtime logs to blow
// past the function's resources ("net::ERR_INSUFFICIENT_RESOURCES", then
// "Target page, context or browser has been closed" as processes got
// killed), which left /api/matches returning 0 matches or timing out.
//
// Giving each page its own dedicated browser process (not shared) was
// tried and made memory pressure worse, not better: confirmed via runtime
// logs that running even 3 concurrent full --single-process Chromium
// instances (each a whole browser, not just a tab) hits
// net::ERR_INSUFFICIENT_RESOURCES at launch time faster than one shared
// instance with 3 tabs did — a full browser process costs more than a tab.
//
// Sharing one browser process across the whole refresh (with a concurrency
// cap on tabs) was tried too and failed a different way: @sparticuz/
// chromium-min launches with --single-process (visible in the actual
// launch args in production logs), so every tab runs inside one OS process
// with no per-tab isolation. Confirmed via runtime logs — even after
// raising function memory to 3009MB and blocking images/media/fonts/ad
// hosts to cut each tab's footprint — that 3 concurrent tabs still took
// the single process down outright ("Target page, context or browser has
// been closed" across SG Pools and multiple tipster sites simultaneously
// in the same request). A single --single-process instance is too fragile
// to hold up more than one tab at a time here.
//
// So this keeps one shared browser (least total memory) but serializes
// tab usage down to exactly 1 at a time — the only concurrency level that
// doesn't crash the shared single process. A fully-serial run without any
// resource blocking was tried earlier and blew past maxDuration (summing
// ~9 pages' worst-case navigation timeouts guarantees "Task timed out
// after 60 seconds" even though each page alone fits comfortably); the
// image/media/font/ad blocking below cuts enough per-page load time to
// bring the serialized total back under maxDuration.
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

// Raising the function's memory to 3009MB (Vercel's practical ceiling for
// this runtime) on top of the concurrency-3 cap still wasn't enough —
// confirmed via runtime logs to keep producing the same
// net::ERR_INSUFFICIENT_RESOURCES / "Target page, context or browser has
// been closed" failures. These are ad/tracker-heavy tipster sites (see
// fetchHtml.js/singaporePools.js comments), so the actual fix is cutting
// what each tab costs rather than raising the ceiling further: block image/
// media/font loads and known ad-serving hosts, since none of the scrapers
// read images, play media, or need ad content — they only read text/DOM
// (fetchHtml.js) or JSON XHR responses (singaporePools.js).
const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font']);
const BLOCKED_HOSTNAME_PATTERNS = [
  /(^|\.)doubleclick\.net$/,
  /(^|\.)googlesyndication\.com$/,
  /(^|\.)google-analytics\.com$/,
  /(^|\.)googletagmanager\.com$/,
  /(^|\.)googletagservices\.com$/,
  /(^|\.)adservice\.google\.com$/,
  /(^|\.)facebook\.net$/,
  /(^|\.)connect\.facebook\.com$/,
  /(^|\.)amazon-adsystem\.com$/,
  /(^|\.)taboola\.com$/,
  /(^|\.)outbrain\.com$/,
  /(^|\.)criteo\.com$/,
  /(^|\.)adnxs\.com$/,
  /(^|\.)pubmatic\.com$/,
  /(^|\.)rubiconproject\.com$/,
  /(^|\.)moatads\.com$/,
  /(^|\.)scorecardresearch\.com$/,
  /(^|\.)quantserve\.com$/,
  /(^|\.)hotjar\.com$/,
];

function isBlockedHostname(hostname) {
  return BLOCKED_HOSTNAME_PATTERNS.some((pattern) => pattern.test(hostname));
}

async function blockHeavyRequests(page) {
  await page.route('**/*', (route) => {
    const request = route.request();
    if (BLOCKED_RESOURCE_TYPES.has(request.resourceType())) {
      return route.abort();
    }
    try {
      if (isBlockedHostname(new URL(request.url()).hostname)) {
        return route.abort();
      }
    } catch {
      // unparseable URL — let it through rather than risk blocking something needed
    }
    return route.continue();
  });
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
