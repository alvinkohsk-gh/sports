const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const DEBUG = String(process.env.SGPOOLS_DEBUG || 'false').toLowerCase() === 'true';
const DEBUG_DUMP_PATH = path.join(__dirname, '..', '..', 'debug-sgpools-raw.html');

const FOOTBALL_PAGE_URL = 'https://www.singaporepools.com.sg/en/product/pages/football_home.aspx';

// Singapore Pools has historically served its live fixture/odds board from a
// JSON data feed rather than static HTML (the page itself is a JS app that
// hydrates from one of these). Endpoints have moved before, so we try a
// small list of candidates and fall back to HTML scraping if all miss.
// Verify the current path with your browser devtools (Network tab, filter
// "json" or "fixture") while this page loads, and update this list if it
// has changed.
const CANDIDATE_JSON_FEEDS = [
  'https://www.singaporepools.com.sg/DataFileArchive/Football/Fixtures/fixtures_en.json',
  'https://www.singaporepools.com.sg/DataFileArchive/Football/Format4/en/FootballMatchListv2_en.json',
];

const HTTP_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

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
    source: 'singaporepools.com.sg',
  };
}

async function tryJsonFeeds() {
  for (const url of CANDIDATE_JSON_FEEDS) {
    try {
      const { data } = await axios.get(url, { headers: HTTP_HEADERS, timeout: 10000 });
      const fixtures = parseJsonFeed(data);
      if (fixtures.length) return fixtures;
    } catch (err) {
      // try next candidate
    }
  }
  return [];
}

/**
 * Best-effort parser for the JSON feed shape. Singapore Pools' feed field
 * names are not publicly documented; this walks the payload looking for
 * objects that look like fixtures (two team names + a date/time) rather
 * than depending on one exact schema, so small field-name changes don't
 * break it outright.
 */
function parseJsonFeed(data) {
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

/**
 * Fallback HTML scrape. Singapore Pools' rendered markup changes over time
 * and much of the live board is client-side rendered, so this looks for
 * generic "Team A v Team B" text patterns plus a nearby date/time rather
 * than a brittle exact CSS selector. Treat this as a stopgap: if it comes
 * back empty, capture the page HTML (see fetchRawHtmlForDebugging below)
 * and adjust the selectors/regex to match what's actually served.
 */
function parseHtmlFallback(html) {
  const $ = cheerio.load(html);
  const results = [];
  const text = $('body').text();

  const matchPattern = /([A-Za-z .'-]{3,40})\s+v\s+([A-Za-z .'-]{3,40})/g;
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

async function fetchOpenFixtures() {
  const viaJson = await tryJsonFeeds();
  if (viaJson.length) {
    if (DEBUG) console.log(`[singaporePools] got ${viaJson.length} fixtures from a JSON feed`);
    return viaJson;
  }
  if (DEBUG) console.log('[singaporePools] no JSON feed candidate worked, falling back to HTML scrape');

  try {
    const { data: html } = await axios.get(FOOTBALL_PAGE_URL, { headers: HTTP_HEADERS, timeout: 15000 });
    if (DEBUG) {
      fs.writeFileSync(DEBUG_DUMP_PATH, html);
      console.log(
        `[singaporePools] fetched ${html.length} bytes of HTML, saved to ${DEBUG_DUMP_PATH} for inspection`
      );
    }
    const fixtures = parseHtmlFallback(html);
    if (DEBUG) console.log(`[singaporePools] HTML regex fallback extracted ${fixtures.length} fixtures`);
    if (fixtures.length === 0 && html.length < 20000) {
      console.warn(
        '[singaporePools] fetched page is small and likely just a JS app shell with no fixture data in it — ' +
          'the real fixtures are probably loaded client-side after page load, which this scraper cannot see. ' +
          'Inspect debug-sgpools-raw.html and your browser\'s Network tab to find the actual data endpoint.'
      );
    }
    return fixtures;
  } catch (err) {
    const body = err.response?.data;
    const isEgressBlock = typeof body === 'string' && body.includes('no rule or allowlist entry allows host');
    if (isEgressBlock) {
      console.error(
        '[singaporePools] blocked by the local network egress proxy before reaching the site — ' +
          'not a real site error. Run this outside the sandboxed environment.'
      );
    } else {
      console.error('[singaporePools] live fetch failed:', err.message);
    }
    return [];
  }
}

module.exports = { fetchOpenFixtures, parseJsonFeed, parseHtmlFallback, coerceSgTimeToISO };
