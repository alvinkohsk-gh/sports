const cheerio = require('cheerio');
const { withSharedPage } = require('../scrapers/browser');
const { dumpDebug, DEBUG } = require('../scrapers/tipsters/fetchHtml');

// Fallback live-score source, consulted only for SG Pools live fixtures
// that fetchFlashscoreLive() (flashscoreResults.js) couldn't match —
// Flashscore stays the primary source; this never overrides a Flashscore
// hit, it only fills gaps (e.g. some Asian lower/mid-tier leagues have
// shown up missing from Flashscore's live feed).
//
// UNVERIFIED, more so than any other scraper in this repo: livescore.com
// is a heavy client-rendered SPA (React-style), and this sandbox has no
// network path to it at all, so there was no way to inspect its real DOM
// or internal API shape — unlike Flashscore's feed (a documented text
// format) or Forebet's list page (ported from a confirmed real scraper).
// parseLivescoreRows below is a conservative, structure-tolerant
// heuristic: any small leaf-ish element whose own text is just
// "<home> vs <away> N - N" (or "v"/"-"/"@" as the divider), with guards
// against matching a large ancestor or an unrelated trailing sentence.
// Rows that don't literally include one of those divider tokens between
// the two team names (plausible on a site that separates them via
// adjacent DOM elements rather than a text divider) won't be found by
// this version — under-matching, not false-matching, is the deliberate
// failure mode here. Treat "0 rows" as the expected outcome until this
// has been tuned against a debug capture (TIPSTERS_DEBUG=true ->
// debug-tipsters/livescore-live.html).

const URL = process.env.LIVESCORE_LIVE_URL || 'https://www.livescore.com/en/football/live/';
const NAV_TIMEOUT_MS = Number(process.env.LIVESCORE_TIMEOUT_MS) || 20000;

const SCORE_RE = /(?<!\d)(\d{1,2})\s*[-–:]\s*(\d{1,2})(?!\d)/;
const NAME_CHARS_RE = /^[A-Za-zÀ-ÖØ-öø-ÿ0-9 .'&-]{2,42}$/;

function looksLikeTeamName(s) {
  const t = (s || '').trim();
  return t.length >= 2 && t.length <= 42 && NAME_CHARS_RE.test(t) && !SCORE_RE.test(t);
}

function parseLivescoreRows(html) {
  const $ = cheerio.load(html);
  const rows = [];
  const seen = new Set();

  $('body *').each((_, el) => {
    const $el = $(el);
    if ($el.children().length > 8) return; // skip large containers early
    const text = $el.text().replace(/\s+/g, ' ').trim();
    if (!text || text.length > 120) return;
    const scoreMatch = text.match(SCORE_RE);
    if (!scoreMatch) return;

    // Only consider elements whose own text IS the row (the score sits at
    // or near the end) — filters out ancestor elements that also "match"
    // by containing this row plus its siblings.
    const before = text.slice(0, scoreMatch.index).trim();
    const after = text.slice(scoreMatch.index + scoreMatch[0].length).trim();
    if (after && (after.split(/\s+/).length > 3 || !NAME_CHARS_RE.test(after))) return;

    const dividerMatch = before.match(/^(.{2,40}?)\s+(?:vs\.?|v\.?|-|–|@)\s+(.{2,40})$/i);
    if (!dividerMatch) return;
    const home = dividerMatch[1].trim();
    const away = dividerMatch[2].trim();
    if (!looksLikeTeamName(home) || !looksLikeTeamName(away)) return;

    const key = `${home.toLowerCase()}|${away.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);

    rows.push({
      homeTeam: home,
      awayTeam: away,
      homeGoals: Number(scoreMatch[1]),
      awayGoals: Number(scoreMatch[2]),
      league: null,
    });
  });

  return rows;
}

/**
 * Returns [{ homeTeam, awayTeam, homeGoals, awayGoals, league }] for
 * whatever live matches this parses off livescore.com's live page. Never
 * throws — a failed fetch or a markup change parseLivescoreRows can't
 * handle just yields an empty array (callers already treat "no fallback
 * data" as normal).
 */
async function fetchLivescoreLive() {
  try {
    const html = await withSharedPage(async (page) => {
      await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      await page.waitForTimeout(2500); // let the SPA hydrate/render match rows
      return page.content();
    });
    if (DEBUG) dumpDebug('livescore-live', html);
    return parseLivescoreRows(html);
  } catch (err) {
    console.error('[livescoreLive] fetch failed:', err.message || err);
    return [];
  }
}

module.exports = { fetchLivescoreLive, parseLivescoreRows };
