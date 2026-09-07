const cheerio = require('cheerio');
const { fetchHtml } = require('./fetchHtml');
const { totalsFromScoreline } = require('./totalsHeuristics');

const URL = 'https://www.predictz.com/predictions';

// Selectors ported from a verified real-world scraper for this exact site
// (github.com/999Samurai/predictions-scraper): each match is a .ptcnt
// block with home/away team names in .ptmobh / .ptmoba divs and the pick
// in a .ptpredboxsml box whose text says "Home"/"Away"/(implicitly draw).
// That reference scraper used cloudscraper for Cloudflare; here fetchHtml
// falls back to a headless browser render for the same purpose.
//
// The .ptpredboxsml box carries the predicted score too ("Draw 1-1",
// "Away 0-1"), so Over/Under 2.5 comes straight off that — no separate O/U
// page needed.
async function fetchPredictzTips() {
  const html = await fetchHtml('predictz', URL);
  const rows = extractRows(html);

  return rows.map((tip) => ({
    site: 'predictz',
    homeTeam: tip.home,
    awayTeam: tip.away,
    pick: /home/i.test(tip.predictionText) ? 'home' : /away/i.test(tip.predictionText) ? 'away' : 'draw',
    totalsPick: totalsFromScoreline(tip.predictionText),
    rawText: tip.predictionText,
    sourceUrl: URL,
  }));
}

function extractRows(html) {
  const $ = cheerio.load(html);
  const rows = [];

  $('.ptcnt').each((_, el) => {
    const row = $(el);
    const home = row.find('.ptmobh').first().text().trim();
    const away = row.find('.ptmoba').first().text().trim();
    if (!home || !away) return;

    const predictionText = row.find('.ptpredboxsml').first().text().trim();
    rows.push({ home, away, predictionText });
  });

  return rows;
}

module.exports = { fetchPredictzTips };
