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
    return playwrightChromium.launch({
      ...launchOptions,
      args: chromium.args,
      executablePath: await chromium.executablePath(REMOTE_CHROMIUM_PACK),
      headless: true,
    });
  }

  const { chromium: playwrightChromium } = require('playwright');
  return playwrightChromium.launch(launchOptions);
}

module.exports = { launchBrowser, IS_SERVERLESS };
