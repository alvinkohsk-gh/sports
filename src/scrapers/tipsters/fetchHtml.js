const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const { withSharedPage, IS_SERVERLESS } = require('../browser');

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
  return /just a moment|cf-browser-verification|cloudflare/i.test(html.slice(0, 3000));
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

/**
 * Fetches a page as plain HTTP first (fast, works for sites with no bot
 * protection); if that comes back looking like a Cloudflare/JS challenge
 * page (or empty), retries by rendering with a headless browser, which
 * clears most JS-based challenges and client-rendered content alike.
 */
async function fetchHtml(site, url) {
  try {
    const { data: html } = await axios.get(url, { headers: HTTP_HEADERS, timeout: 15000 });
    if (html && html.length > 500 && !looksLikeChallengePage(html)) {
      dumpDebug(site, html);
      return html;
    }
    if (DEBUG) console.log(`[tipsters:${site}] plain fetch looked like a challenge/empty page, trying browser render`);
  } catch (err) {
    if (DEBUG) console.log(`[tipsters:${site}] plain fetch failed (${err.message}), trying browser render`);
  }

  return withSharedPage(
    async (page) => {
      // 'networkidle' reliably timed out here in production (30s exceeded)
      // since these are ad/tracker-heavy pages that never go fully idle; the
      // tables this scraper reads are server-rendered, so 'domcontentloaded'
      // plus a brief settle (same approach used for singaporePools.js) is
      // both faster and more reliable.
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(2000);
      const html = await page.content();
      dumpDebug(site, html);
      return html;
    },
    { userAgent: HTTP_HEADERS['User-Agent'] }
  );
}

module.exports = { fetchHtml, DEBUG };
