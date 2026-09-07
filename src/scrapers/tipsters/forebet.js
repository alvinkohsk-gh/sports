const cheerio = require('cheerio');
const { fetchHtmlScrolled } = require('./fetchHtml');
const { totalsFromScoreline } = require('./totalsHeuristics');

// Forebet's today page lists ~130 matches but ships only the first ~44
// (earliest kickoffs — obscure leagues) in the initial HTML; the rest,
// including the big European fixtures that overlap the Singapore Pools
// board, load on scroll. fetchHtmlScrolled re-renders past the lazy load.
// The "tomorrow" page is fetched too since SG Pools lists multi-day
// fixtures and Forebet files anything after ~midnight UTC under tomorrow.
const URLS = [
  'https://www.forebet.com/en/football-tips-and-predictions-for-today',
  'https://www.forebet.com/en/football-tips-and-predictions-for-tomorrow',
];

// Selectors ported from a verified real-world scraper for this exact site
// (github.com/999Samurai/predictions-scraper), not guessed from scratch:
// each match row carries class "rcnt tr_1", team names live in a
// <meta itemprop="name"> tag, and the predicted outcome/percentage is in
// a span.forepr. Matched loosely on "rcnt" in case the site alternates a
// tr_2 class for other rows the reference scraper didn't need (a second,
// independently-found Forebet scraper confirms this site alternates row
// classes, e.g. tr_0/tr_1, on its other list pages).
//
// Over/Under 2.5 is derived from each row's predicted correct score
// (.ex_sc), so Forebet's separate Over/Under page isn't fetched.
async function fetchForebetTips() {
  const all = [];
  const seen = new Set();
  for (const url of URLS) {
    const site = url.endsWith('tomorrow') ? 'forebet-tomorrow' : 'forebet';
    let html;
    try {
      html = await fetchHtmlScrolled(site, url);
    } catch (err) {
      console.error(`[tipsters:forebet] ${url} failed:`, err.message || err);
      continue;
    }
    for (const r of extractRows(html, url)) {
      const key = `${r.homeTeam.toLowerCase()}|${r.awayTeam.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(r);
    }
  }
  return all;
}

function extractRows(html, sourceUrl) {
  const $ = cheerio.load(html);
  const rows = [];

  $('[class*="rcnt"]').each((_, el) => {
    const row = $(el);
    const nameContent = row.find('meta[itemprop="name"]').attr('content');
    if (!nameContent) return;

    const teams = nameContent.split(/\s+-\s+| vs /i);
    if (teams.length < 2) return;

    const predictionText = row.find('span.forepr').first().text().trim();
    // Forebet shows a predicted correct score per row in ".ex_sc", e.g.
    // "3 - 2  3.50" (score + its odds). Over/Under 2.5 is derived from it.
    const exScore = row.find('.ex_sc').first().text().replace(/\s+/g, ' ').trim();

    rows.push({
      site: 'forebet',
      homeTeam: teams[0].trim(),
      awayTeam: teams[1].trim(),
      rawText: [predictionText, exScore].filter(Boolean).join(' | '),
      sourceUrl,
      pick: inferPick(predictionText),
      totalsPick: totalsFromScoreline(exScore),
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

module.exports = { fetchForebetTips, inferPick };
