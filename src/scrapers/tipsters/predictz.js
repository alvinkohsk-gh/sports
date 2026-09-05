const cheerio = require('cheerio');
const { fetchHtml } = require('./fetchHtml');
const { inferTotalsPick } = require('./totalsHeuristics');

const URL = 'https://www.predictz.com/predictions';
const OU_URL = 'https://www.predictz.com/predictions/today/over-under-25-goals/';

// Selectors ported from a verified real-world scraper for this exact site
// (github.com/999Samurai/predictions-scraper): each match is a .ptcnt
// block with home/away team names in .ptmobh / .ptmoba divs and the pick
// in a .ptpredboxsml box whose text says "Home"/"Away"/(implicitly draw).
// That reference scraper used cloudscraper for Cloudflare; here fetchHtml
// falls back to a headless browser render for the same purpose.
async function fetchPredictzTips() {
  const html = await fetchHtml('predictz', URL);
  const oneXTwoTips = extractRows(html);

  // Same site template, filtered to O/U matches — team-extraction is the
  // same verified pattern; the O/U pick text itself is unverified (no
  // reference scraper covers this page), inferred generically instead.
  let totalsTips = [];
  try {
    const ouHtml = await fetchHtml('predictz-overunder', OU_URL);
    totalsTips = extractRows(ouHtml);
  } catch (err) {
    console.error('[tipsters:predictz] Over/Under page fetch failed:', err.message);
  }

  return oneXTwoTips.map((tip) => {
    const match = totalsTips.find(
      (t) => t.home.toLowerCase() === tip.home.toLowerCase() && t.away.toLowerCase() === tip.away.toLowerCase()
    );
    return {
      site: 'predictz',
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
