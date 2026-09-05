const cheerio = require('cheerio');
const { fetchHtml } = require('./fetchHtml');

const URL = 'https://www.forebet.com/en/football-tips-and-predictions-for-today';

// Selectors ported from a verified real-world scraper for this exact site
// (github.com/999Samurai/predictions-scraper), not guessed from scratch:
// each match row carries class "rcnt tr_1", team names live in a
// <meta itemprop="name"> tag, and the predicted outcome/percentage is in
// a span.forepr. Matched loosely on "rcnt" in case the site alternates a
// tr_2 class for other rows the reference scraper didn't need.
async function fetchForebetTips() {
  const html = await fetchHtml('forebet', URL);
  const $ = cheerio.load(html);
  const tips = [];

  $('[class*="rcnt"]').each((_, el) => {
    const row = $(el);
    const nameContent = row.find('meta[itemprop="name"]').attr('content');
    if (!nameContent) return;

    const teams = nameContent.split(/\s+-\s+| vs /i);
    if (teams.length < 2) return;

    const predictionText = row.find('span.forepr').first().text().trim();

    tips.push({
      site: 'forebet',
      homeTeam: teams[0].trim(),
      awayTeam: teams[1].trim(),
      pick: inferPick(predictionText),
      rawText: predictionText,
      sourceUrl: URL,
    });
  });

  return tips;
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

module.exports = { fetchForebetTips };
