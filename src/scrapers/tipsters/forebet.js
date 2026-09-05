const cheerio = require('cheerio');
const { fetchHtml } = require('./fetchHtml');
const { inferTotalsPick } = require('./totalsHeuristics');

const URL = 'https://www.forebet.com/en/football-tips-and-predictions-for-today';
const OU_URL = 'https://www.forebet.com/en/football-tips-and-predictions-for-today/predictions-under-over-goals';

// Selectors ported from a verified real-world scraper for this exact site
// (github.com/999Samurai/predictions-scraper), not guessed from scratch:
// each match row carries class "rcnt tr_1", team names live in a
// <meta itemprop="name"> tag, and the predicted outcome/percentage is in
// a span.forepr. Matched loosely on "rcnt" in case the site alternates a
// tr_2 class for other rows the reference scraper didn't need (a second,
// independently-found Forebet scraper confirms this site alternates row
// classes, e.g. tr_0/tr_1, on its other list pages).
async function fetchForebetTips() {
  const html = await fetchHtml('forebet', URL);
  const oneXTwoTips = extractRows(html, (predictionText) => ({ pick: inferPick(predictionText) }));

  // The Over/Under page reuses the same site template/row structure, just
  // filtered to O/U matches — team-name extraction is the same verified
  // pattern; the O/U pick itself is unverified (no reference scraper for
  // this specific page), so it's inferred from the same span's text via a
  // generic over/under heuristic instead of a confirmed selector.
  let totalsTips = [];
  try {
    const ouHtml = await fetchHtml('forebet-overunder', OU_URL);
    totalsTips = extractRows(ouHtml, (predictionText) => ({ totalsPick: inferTotalsPick(predictionText) }));
  } catch (err) {
    console.error('[tipsters:forebet] Over/Under page fetch failed:', err.message);
  }

  return mergeByTeams(oneXTwoTips, totalsTips);
}

function extractRows(html, extraFields) {
  const $ = cheerio.load(html);
  const rows = [];

  $('[class*="rcnt"]').each((_, el) => {
    const row = $(el);
    const nameContent = row.find('meta[itemprop="name"]').attr('content');
    if (!nameContent) return;

    const teams = nameContent.split(/\s+-\s+| vs /i);
    if (teams.length < 2) return;

    const predictionText = row.find('span.forepr').first().text().trim();

    rows.push({
      site: 'forebet',
      homeTeam: teams[0].trim(),
      awayTeam: teams[1].trim(),
      rawText: predictionText,
      sourceUrl: URL,
      ...extraFields(predictionText),
    });
  });

  return rows;
}

// Forebet's forepr span typically shows the predicted outcome as a
// percentage tied to 1/X/2; without the site's own color/position coding
// visible in raw text alone, fall back to treating a plain leading digit
// or "1"/"X"/"2" token as the pick, else leave it unclassified.
function inferPick(text) {
  const t = text.trim();
  if (/^1\b/.test(t)) return 'home';
  if (/^2\b/.test(t)) return 'away';
  if (/^x\b/i.test(t)) return 'draw';
  return null;
}

function mergeByTeams(oneXTwoTips, totalsTips) {
  return oneXTwoTips.map((tip) => {
    const match = totalsTips.find(
      (t) => t.homeTeam.toLowerCase() === tip.homeTeam.toLowerCase() && t.awayTeam.toLowerCase() === tip.awayTeam.toLowerCase()
    );
    return { ...tip, totalsPick: match?.totalsPick || null };
  });
}

module.exports = { fetchForebetTips, inferPick };
