const cheerio = require('cheerio');
const { fetchHtml } = require('./fetchHtml');
const { totalsFromScoreline } = require('./totalsHeuristics');

const URL = 'https://www.windrawwin.com/predictions/today';

// Selectors ported from a verified real-world scraper for this exact site
// (github.com/999Samurai/predictions-scraper): each match is a .wttr row
// with two .wtmoblnk divs (home, away in order) and the pick in a .wtprd
// box whose text says "Home"/"Away"/(implicitly draw), e.g. "Home 2-0".
//
// Each row has a ".predscore" span with the predicted score ("2-0"), so
// Over/Under 2.5 comes off that — no separate O/U page needed.
async function fetchWinDrawWinTips() {
  const html = await fetchHtml('windrawwin', URL);
  const rows = extractRows(html);

  return rows.map((tip) => ({
    site: 'windrawwin',
    homeTeam: tip.home,
    awayTeam: tip.away,
    pick: /home/i.test(tip.predictionText) ? 'home' : /away/i.test(tip.predictionText) ? 'away' : 'draw',
    totalsPick: totalsFromScoreline(tip.predScore) || totalsFromScoreline(tip.predictionText),
    rawText: [tip.predictionText, tip.predScore].filter(Boolean).join(' '),
    sourceUrl: URL,
  }));
}

function extractRows(html) {
  const $ = cheerio.load(html);
  const rows = [];

  $('.wttr').each((_, el) => {
    const row = $(el);
    const teamEls = row.find('.wtmoblnk');
    if (teamEls.length < 2) return;

    const home = $(teamEls[0]).text().trim();
    const away = $(teamEls[1]).text().trim();
    if (!home || !away) return;

    const predictionText = row.find('.wtprd').first().text().trim();
    const predScore = row.find('.predscore').first().text().trim();
    rows.push({ home, away, predictionText, predScore });
  });

  return rows;
}

module.exports = { fetchWinDrawWinTips };
