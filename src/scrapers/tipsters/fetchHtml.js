const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const { withSharedPage, IS_SERVERLESS } = require('../browser');

// Forebet / PredictZ / WinDrawWin / WhoScored (and Sports Mole's individual
// article pages) all sit behind Cloudflare and 403 plain HTTP from any
// datacenter IP. When FLARESOLVERR_URL is set (the GitHub Actions snapshot
// job runs a FlareSolverr service container — see
// .github/workflows/snapshot.yml) requests go through it: FlareSolverr
// drives an undetected full Chromium that clears the challenge and returns
// the solved HTML plus a `cf_clearance` cookie, which we then reuse for
// cheap plain-axios fetches of the rest of that domain's pages.
//
// Without FlareSolverr (local dev, and the Vercel fallback path) it falls
// back to the shared headless browser and — off-serverless only, since the
// per-site wait would blow Vercel's 60s function limit — waits out the
// passive "Just a moment…" interstitial.
const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || '';
const WAIT_OUT_CLOUDFLARE = !IS_SERVERLESS;

const DEBUG = String(process.env.TIPSTERS_DEBUG || 'false').toLowerCase() === 'true';
// Vercel's filesystem is read-only outside /tmp, so debug dumps go there
// when running serverless (won't be visible without a way to read /tmp —
// fine, this is a local-development debugging aid) instead of the project
// directory used for local runs.
const DEBUG_DIR = IS_SERVERLESS
  ? path.join(os.tmpdir(), 'debug-tipsters')
  : path.join(__dirname, '..', '..', '..', 'debug-tipsters');

const HTTP_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

function looksLikeChallengePage(html) {
  // Deliberately specific — a bare "cloudflare" match false-positives on
  // real pages that just load a cdnjs.cloudflare.com asset.
  return /just a moment|cf-browser-verification|__cf_chl|_cf_chl_opt|cf_chl_|attention required!|checking your browser|challenge-platform/i.test(
    String(html).slice(0, 4000)
  );
}

function dumpDebug(site, html) {
  if (!DEBUG) return;
  try {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    fs.writeFileSync(path.join(DEBUG_DIR, `${site}.html`), html);
  } catch (err) {
    console.error(`[tipsters:${site}] could not write debug dump:`, err.message);
  }
}

// cf_clearance (+ matching UA) captured per host from a FlareSolverr solve,
// so only the first page of each domain pays the full challenge cost.
const clearanceByHost = new Map();

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

async function plainGet(url, extraHeaders) {
  const { data } = await axios.get(url, {
    timeout: 20000,
    headers: { ...HTTP_HEADERS, ...extraHeaders },
    // some CF error pages come back as 403 with a real body we can detect
    validateStatus: (s) => s >= 200 && s < 500,
  });
  return typeof data === 'string' ? data : '';
}

async function solveWithFlareSolverr(url) {
  const { data } = await axios.post(
    FLARESOLVERR_URL,
    { cmd: 'request.get', url, maxTimeout: 60000 },
    { timeout: 90000 }
  );
  if (data.status !== 'ok' || !data.solution || !data.solution.response) {
    throw new Error(`flaresolverr: ${data.message || data.status || 'no solution'}`);
  }
  const sol = data.solution;
  const cookieHeader = (sol.cookies || []).map((c) => `${c.name}=${c.value}`).join('; ');
  if (cookieHeader) {
    clearanceByHost.set(hostOf(url), {
      Cookie: cookieHeader,
      'User-Agent': sol.userAgent || HTTP_HEADERS['User-Agent'],
    });
  }
  return sol.response;
}

/**
 * Fetches a page, transparently handling Cloudflare:
 *  1. plain axios (works for un-protected pages and local dev);
 *  2. if that's a challenge/error and we already hold a cf_clearance for
 *     the host, plain axios with that cookie;
 *  3. FlareSolverr, if FLARESOLVERR_URL is set (captures a cf_clearance for
 *     step 2 on later pages);
 *  4. otherwise the shared headless browser (Vercel fallback / local dev).
 */
async function fetchHtml(site, url) {
  try {
    const html = await plainGet(url);
    if (html.length > 500 && !looksLikeChallengePage(html)) {
      dumpDebug(site, html);
      return html;
    }
    if (DEBUG) console.log(`[tipsters:${site}] plain fetch looked blocked/empty`);
  } catch (err) {
    if (DEBUG) console.log(`[tipsters:${site}] plain fetch failed (${err.message})`);
  }

  if (FLARESOLVERR_URL) {
    const held = clearanceByHost.get(hostOf(url));
    if (held) {
      try {
        const html = await plainGet(url, held);
        if (html.length > 500 && !looksLikeChallengePage(html)) {
          dumpDebug(site, html);
          return html;
        }
      } catch {
        /* clearance stale — re-solve below */
      }
    }
    if (DEBUG) console.log(`[tipsters:${site}] solving via FlareSolverr`);
    const solved = await solveWithFlareSolverr(url);
    dumpDebug(site, solved);
    return solved;
  }

  return withSharedPage(
    async (page) => {
      // 'networkidle' reliably timed out here in production (30s exceeded)
      // since these are ad/tracker-heavy pages that never go fully idle; the
      // tables this scraper reads are server-rendered, so 'domcontentloaded'
      // plus a brief settle (same approach used for singaporePools.js) is
      // both faster and more reliable.
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(500);
      let html = await page.content();

      if (WAIT_OUT_CLOUDFLARE && looksLikeChallengePage(html)) {
        if (DEBUG) console.log(`[tipsters:${site}] Cloudflare challenge — waiting for it to clear`);
        await page
          .waitForFunction(
            () =>
              !/just a moment|cf-browser-verification|challenge-platform/i.test(
                document.title + ' ' + (document.body ? document.body.innerText.slice(0, 400) : '')
              ),
            { timeout: 20000 }
          )
          .catch(() => {});
        await page.waitForTimeout(1500);
        html = await page.content();
      }

      dumpDebug(site, html);
      return html;
    },
    { userAgent: HTTP_HEADERS['User-Agent'] }
  );
}

module.exports = { fetchHtml, DEBUG };
