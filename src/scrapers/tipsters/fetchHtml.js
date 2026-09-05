const fs = require('fs');
const path = require('path');
const axios = require('axios');

const DEBUG = String(process.env.TIPSTERS_DEBUG || 'false').toLowerCase() === 'true';
const DEBUG_DIR = path.join(__dirname, '..', '..', '..', 'debug-tipsters');

const HTTP_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

function looksLikeChallengePage(html) {
  return /just a moment|cf-browser-verification|cloudflare/i.test(html.slice(0, 3000));
}

function dumpDebug(site, html) {
  if (!DEBUG) return;
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  fs.writeFileSync(path.join(DEBUG_DIR, `${site}.html`), html);
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

  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ userAgent: HTTP_HEADERS['User-Agent'] });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    const html = await page.content();
    dumpDebug(site, html);
    return html;
  } finally {
    await browser.close();
  }
}

module.exports = { fetchHtml, DEBUG };
