const cheerio = require('cheerio');
const { fetchHtml } = require('./fetchHtml');
const { inferTotalsPick } = require('./totalsHeuristics');

const URL = 'https://www.windrawwin.com/predictions/today';
const OU_URL = 'https://www.windrawwin.com/predictions/today/all-games/all-stakes/over-25-goals/';

// Selectors ported from a verified real-world scraper for this exact site
// (github.com/999Samurai/predictions-scraper): each match is a .wttr row
// with two .wtmoblnk divs (home, away in order) and the pick in a .wtprd
// box whose text says "Home"/"Away"/(implicitly draw), e.g. "Home 2-0".
async function fetchWinDrawWinTips() {
  const html = await fetchHtml('windrawwin', URL);
  const oneXTwoTips = extractRows(html);

  // Same site template, filtered to O/U matches — team-extraction is the
  // same verified pattern; the O/U pick text itself is unverified (no
  // reference scraper covers this page), inferred generically instead.
  let totalsTips = [];
  try {
    const ouHtml = await fetchHtml('windrawwin-overunder', OU_URL);
    totalsTips = extractRows(ouHtml);
  } catch (err) {
    console.error('[tipsters:windrawwin] Over/Under page fetch failed:', err.message);
  }

  return oneXTwoTips.map((tip) => {
    const match = totalsTips.find(
      (t) => t.home.toLowerCase() === tip.home.toLowerCase() && t.away.toLowerCase() === tip.away.toLowerCase()
    );
    return {
      site: 'windrawwin',
      homeTeam: tip.home,
      awayTeam: tip.away,
      pick: /home/i.test(tip.predictionText) ? 'home' : /away/i.test(tip.predictionText) ? 'away' : 'draw',
      totalsPick: match ? inferTotalsPick(match.predictionText) : null,
      rawText: tip.predictionText,
      sourceUrl: URL,
    };
  });
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
    rows.push({ home, away, predictionText });
  });

  return rows;
}

module.exports = { fetchWinDrawWinTips };
