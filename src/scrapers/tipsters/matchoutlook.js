const cheerio = require('cheerio');
const { fetchHtml } = require('./fetchHtml');
const { inferTotalsPick } = require('./totalsHeuristics');

const URL = 'https://www.matchoutlook.com/todays-football-predictions/';

// MatchOutlook's today page is a list of `.match-section` blocks:
//   <div class="match-section">
//     <div class="match-title">Spain LaLiga <b class="float-right">15:15</b></div>
//     <div class="match-content">
//       <img><img> &nbsp; <b>Valencia</b> <b>vs</b> <b>Barcelona</b>
//       <b class="float-right">Result: <b>0-5</b></b>            (actual result, when settled)
//       <b class="float-right our-bet">Best Bet: <b>Away win</b></b>
//     </div>
//   </div>
// "Best Bet" is a single recommendation — a 1X2 outcome (Home/Away win,
// Draw), a double chance (1X / X2 / 12), or an over/under line. We take a
// clean 1X2 pick when it's one of the first kind, and an over/under
// totalsPick when it's the last; double chances give neither.
async function fetchMatchOutlookTips() {
  const html = await fetchHtml('matchoutlook', URL);
  const $ = cheerio.load(html);
  const tips = [];
  const seen = new Set();

  $('.match-section').each((_, el) => {
    const row = $(el);
    const content = row.find('.match-content').text().replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
    const teams = content.match(/^(.+?)\s+vs\s+(.+?)\s+(?:Result:|Best Bet:|$)/i);
    if (!teams) return;

    const home = teams[1].trim();
    const away = teams[2].trim();
    const key = `${home.toLowerCase()}|${away.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);

    const betRaw = row.find('.our-bet').text().replace(/\s+/g, ' ').trim();
    const bet = (betRaw.match(/best bet:\s*(.+)/i) || [, ''])[1].trim();

    let pick = null;
    if (/home win/i.test(bet)) pick = 'home';
    else if (/away win/i.test(bet)) pick = 'away';
    else if (/^draw\b/i.test(bet)) pick = 'draw';

    tips.push({
      site: 'matchoutlook',
      homeTeam: home,
      awayTeam: away,
      pick,
      totalsPick: inferTotalsPick(bet),
      rawText: bet || betRaw,
      sourceUrl: URL,
    });
  });

  return tips;
}

module.exports = { fetchMatchOutlookTips };
