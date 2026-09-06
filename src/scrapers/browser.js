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
// Sharing one browser process across a whole refresh — and across warm
// invocations, same idea as the executablePath cache above — fixes the
// process-count problem.
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

// Sharing the browser process alone wasn't enough: @sparticuz/chromium-min
// launches with --single-process (visible in the actual launch args in
// production logs), meaning every tab runs inside one OS process with no
// per-tab isolation. With up to ~11 tabs opened concurrently, one tab
// crashing (or the process hitting a resource ceiling) took the whole
// browser down mid-navigation for every other concurrent caller too —
// confirmed via runtime logs showing "Target page, context or browser has
// been closed" simultaneously across SG Pools and multiple tipster sites
// in the same request. Serializing page usage through a single queue (only
// one page open/navigating at a time against the shared browser) avoids
// that correlated crash, at the cost of scraping sequentially instead of
// concurrently — still well within maxDuration: 60s for ~11 page loads.
let pageQueue = Promise.resolve();

async function withSharedPage(fn, pageOptions = {}) {
  const run = async () => {
    const browser = await getSharedBrowser();
    const page = await browser.newPage(pageOptions);
    try {
      return await fn(page);
    } finally {
      await page.close().catch(() => {});
    }
  };
  const result = pageQueue.then(run, run);
  pageQueue = result.then(
    () => {},
    () => {}
  );
  return result;
}

module.exports = { launchBrowser, getSharedBrowser, withSharedPage, IS_SERVERLESS };
