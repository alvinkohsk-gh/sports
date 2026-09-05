const cheerio = require('cheerio');
const { fetchHtml } = require('./fetchHtml');

const URL = 'https://www.windrawwin.com/predictions/today';

// Selectors ported from a verified real-world scraper for this exact site
// (github.com/999Samurai/predictions-scraper): each match is a .wttr row
// with two .wtmoblnk divs (home, away in order) and the pick in a .wtprd
// box whose text says "Home"/"Away"/(implicitly draw), e.g. "Home 2-0".
async function fetchWinDrawWinTips() {
  const html = await fetchHtml('windrawwin', URL);
  const $ = cheerio.load(html);
  const tips = [];

  $('.wttr').each((_, el) => {
    const row = $(el);
    const teamEls = row.find('.wtmoblnk');
    if (teamEls.length < 2) return;

    const home = $(teamEls[0]).text().trim();
    const away = $(teamEls[1]).text().trim();
    if (!home || !away) return;

    const predictionText = row.find('.wtprd').first().text().trim();
    const pick = /home/i.test(predictionText) ? 'home' : /away/i.test(predictionText) ? 'away' : 'draw';

    tips.push({
      site: 'windrawwin',
      homeTeam: home,
      awayTeam: away,
      pick,
      rawText: predictionText,
      sourceUrl: URL,
    });
  });

  return tips;
}

module.exports = { fetchWinDrawWinTips };
