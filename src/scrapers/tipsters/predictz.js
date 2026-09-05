const cheerio = require('cheerio');
const { fetchHtml } = require('./fetchHtml');

const URL = 'https://www.predictz.com/predictions';

// Selectors ported from a verified real-world scraper for this exact site
// (github.com/999Samurai/predictions-scraper): each match is a .ptcnt
// block with home/away team names in .ptmobh / .ptmoba divs and the pick
// in a .ptpredboxsml box whose text says "Home"/"Away"/(implicitly draw).
// That reference scraper used cloudscraper for Cloudflare; here fetchHtml
// falls back to a headless browser render for the same purpose.
async function fetchPredictzTips() {
  const html = await fetchHtml('predictz', URL);
  const $ = cheerio.load(html);
  const tips = [];

  $('.ptcnt').each((_, el) => {
    const row = $(el);
    const home = row.find('.ptmobh').first().text().trim();
    const away = row.find('.ptmoba').first().text().trim();
    if (!home || !away) return;

    const predictionText = row.find('.ptpredboxsml').first().text().trim();
    const pick = /home/i.test(predictionText) ? 'home' : /away/i.test(predictionText) ? 'away' : 'draw';

    tips.push({
      site: 'predictz',
      homeTeam: home,
      awayTeam: away,
      pick,
      rawText: predictionText,
      sourceUrl: URL,
    });
  });

  return tips;
}

module.exports = { fetchPredictzTips };
