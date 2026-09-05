const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const DEBUG = String(process.env.SGPOOLS_DEBUG || 'false').toLowerCase() === 'true';
const DEBUG_HTML_PATH = path.join(__dirname, '..', '..', 'debug-sgpools-raw.html');
const DEBUG_SCREENSHOT_PATH = path.join(__dirname, '..', '..', 'debug-sgpools-screenshot.png');

// Corrected from an earlier wrong guess (www.singaporepools.com.sg, which is
// a different, older domain). This is a modern single-page app — the
// fixture list is not present in the initial HTML, it's rendered
// client-side after data loads. A plain HTTP GET (what this file used to
// do) only sees the empty app shell, so this renders the page with a
// headless browser instead and reads the DOM after it settles.
const SPORTS_URL = 'https://online.singaporepools.com/en/sports';

/**
 * Normalizes one fixture into the shape the rest of the app expects.
 */
function toFixture({ homeTeam, awayTeam, kickoffISO, league, sgpMatchId }) {
  if (!homeTeam || !awayTeam || !kickoffISO) return null;
  return {
    sgpMatchId: sgpMatchId || `${homeTeam}-${awayTeam}-${kickoffISO}`,
    homeTeam: homeTeam.trim(),
    awayTeam: awayTeam.trim(),
    kickoffISO,
    league: league || null,
    source: 'online.singaporepools.com',
  };
}

/**
 * Best-effort parser for the rendered page. Real markup/selectors are not
 * yet verified against the live site (see README "Debugging" section), so
 * this looks for generic "Team A v Team B" (or "vs") text patterns plus a
 * nearby date/time rather than a brittle exact CSS selector. Treat this as
 * a starting point: once you have a real debug-sgpools-raw.html capture,
 * replace this with selectors/patterns matched to what's actually there.
 */
function parseRenderedHtml(html) {
  const $ = cheerio.load(html);
  const results = [];
  const text = $('body').text().replace(/\s+/g, ' ');

  const matchPattern = /([A-Za-z .'-]{3,40})\s+v[s]?\.?\s+([A-Za-z .'-]{3,40})/g;
  const datePattern = /(\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\s+\d{1,2}:\d{2})/;

  let m;
  while ((m = matchPattern.exec(text)) !== null) {
    const homeTeam = m[1].trim();
    const awayTeam = m[2].trim();
    const windowText = text.slice(m.index, m.index + 200);
    const dateMatch = windowText.match(datePattern);
    if (!dateMatch) continue;
    const kickoffISO = coerceSgTimeToISO(dateMatch[1]);
    const fixture = toFixture({ homeTeam, awayTeam, kickoffISO });
    if (fixture) results.push(fixture);
  }
  return results;
}

// Singapore Pools displays local (Asia/Singapore, UTC+8) times with no
// timezone marker. This assumes UTC+8; adjust if the source format differs.
function coerceSgTimeToISO(raw) {
  const now = new Date();
  const parts = raw.match(/(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\s+(\d{1,2}):(\d{2})/);
  if (!parts) return null;
  const [, d, mo, y, h, min] = parts;
  const year = y ? (y.length === 2 ? 2000 + Number(y) : Number(y)) : now.getUTCFullYear();
  // Construct as UTC+8 then convert to true UTC by subtracting 8 hours.
  const asUtc8 = Date.UTC(year, Number(mo) - 1, Number(d), Number(h), Number(min));
  return new Date(asUtc8 - 8 * 60 * 60 * 1000).toISOString();
}

/**
 * Renders the sports page with a headless browser (needed because this is
 * a client-side-rendered app) and captures JSON responses the page itself
 * makes along the way — if the site loads fixtures via its own XHR/fetch
 * calls, that's a far more robust source than scraping rendered text, so
 * we grab it opportunistically instead of guessing endpoint URLs upfront.
 */
async function renderWithBrowser() {
  const { chromium } = require('playwright');
  const launchOptions = process.env.PLAYWRIGHT_BROWSERS_PATH
    ? { executablePath: `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`.replace(/\/+/g, '/') }
    : {};

  const browser = await chromium.launch(launchOptions).catch(() => chromium.launch());
  const capturedJson = [];

  try {
    const page = await browser.newPage();
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

    await page.goto(SPORTS_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000); // let any client-side rendering settle

    const html = await page.content();

    if (DEBUG) {
      fs.writeFileSync(DEBUG_HTML_PATH, html);
      await page.screenshot({ path: DEBUG_SCREENSHOT_PATH, fullPage: true }).catch(() => {});
      console.log(
        `[singaporePools] rendered page: ${html.length} bytes of HTML -> ${DEBUG_HTML_PATH}, ` +
          `screenshot -> ${DEBUG_SCREENSHOT_PATH}, captured ${capturedJson.length} JSON responses`
      );
      capturedJson.forEach((c, i) => console.log(`[singaporePools]   JSON response #${i}: ${c.url}`));
    }

    return { html, capturedJson };
  } finally {
    await browser.close();
  }
}

async function fetchOpenFixtures() {
  let rendered;
  try {
    rendered = await renderWithBrowser();
  } catch (err) {
    console.error('[singaporePools] browser render failed:', err.message);
    return [];
  }

  // If the page's own JSON calls look like fixture data, prefer that —
  // it's the real source of truth rather than scraped/rendered text.
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
        '(or the captured-JSON handling) to match the site\'s real structure.'
    );
  }
  return fixtures;
}

/**
 * Same shape-agnostic walk as the old JSON-feed parser: looks for objects
 * that look like fixtures (two team-name fields + a date field) anywhere
 * in an arbitrary JSON payload, rather than depending on one exact schema.
 */
function extractFixturesFromJson(data) {
  const results = [];
  const seen = new Set();

  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const keys = Object.keys(node).reduce((acc, k) => {
      acc[k.toLowerCase()] = k;
      return acc;
    }, {});
    const homeKey = keys.hometeam || keys.home || keys.team1 || keys.hometeamname;
    const awayKey = keys.awayteam || keys.away || keys.team2 || keys.awayteamname;
    const dateKey = keys.kickoff || keys.matchdate || keys.eventdate || keys.datetime || keys.matchtime;
    if (homeKey && awayKey && node[homeKey] && node[awayKey]) {
      const kickoffRaw = dateKey ? node[dateKey] : null;
      const kickoffISO = kickoffRaw ? new Date(kickoffRaw).toISOString() : null;
      const fixture = toFixture({
        homeTeam: String(node[homeKey]),
        awayTeam: String(node[awayKey]),
        kickoffISO,
        league: node[keys.league] || node[keys.competition] || null,
        sgpMatchId: node[keys.matchid] || node[keys.eventid] || null,
      });
      if (fixture && kickoffISO && !seen.has(fixture.sgpMatchId)) {
        seen.add(fixture.sgpMatchId);
        results.push(fixture);
      }
    }
    Object.values(node).forEach(visit);
  }

  visit(data);
  return results;
}

module.exports = { fetchOpenFixtures, extractFixturesFromJson, parseRenderedHtml, coerceSgTimeToISO };
