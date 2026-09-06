const cheerio = require('cheerio');
const { fetchHtml } = require('./fetchHtml');

const URL = 'https://www.predictz.com/predictions';

// Selectors ported from a verified real-world scraper for this exact site
// (github.com/999Samurai/predictions-scraper): each match is a .ptcnt
// block with home/away team names in .ptmobh / .ptmoba divs and the pick
// in a .ptpredboxsml box whose text says "Home"/"Away"/(implicitly draw).
// That reference scraper used cloudscraper for Cloudflare; here fetchHtml
// falls back to a headless browser render for the same purpose.
//
// No longer also fetches PredictZ's separate Over/Under page — see
// forebet.js for why (the shared headless browser can only hold one page
// at a time, so every extra page tightens the whole refresh's 60s budget).
async function fetchPredictzTips() {
  const html = await fetchHtml('predictz', URL);
  const rows = extractRows(html);

  return rows.map((tip) => ({
    site: 'predictz',
    homeTeam: tip.home,
    awayTeam: tip.away,
    pick: /home/i.test(tip.predictionText) ? 'home' : /away/i.test(tip.predictionText) ? 'away' : 'draw',
    totalsPick: null,
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
