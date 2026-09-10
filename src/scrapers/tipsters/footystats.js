const cheerio = require('cheerio');
const { fetchHtml } = require('./fetchHtml');

const URL = 'https://footystats.org/predictions/';

// FootyStats' /predictions/ page is a list of `.betWrapper` tip blocks,
// each one market + fixture:
//   <div class="betWrapper">
//     <div class="betHeader">... <span class="market">Home Win Palestino vs Univ. Concepcion</span> ...</div>
//     <div class="betData hidden">... <span class="data">Palestino vs Univ. Concepcion</span> ...</div>
//   </div>
// One tip per market, so a fixture can appear in several blocks (e.g. a
// "Home Win" block and an "Over 2.5 Goals" block, or a "BTTS Yes" block).
// We keep 1X2 outcomes, over/under lines, and BTTS yes/no; clean-sheet /
// correct-score markets give none of the three and are skipped. Plain
// HTTP — not Cloudflare-gated.
async function fetchFootyStatsTips() {
  const html = await fetchHtml('footystats', URL);
  return parseFootyStats(html);
}

function parseFootyStats(html) {
  const $ = cheerio.load(html);
  const tips = [];
  const seen = new Set();

  $('.betWrapper').each((_, el) => {
    const row = $(el);

    let fixture = '';
    row.find('.betData .data, .data').each((__, d) => {
      const t = $(d).text().replace(/\s+/g, ' ').trim();
      if (!fixture && / vs /i.test(t)) fixture = t;
    });
    if (!fixture) return;

    const parts = fixture.split(/\s+vs\s+/i);
    if (parts.length !== 2) return;
    const home = parts[0].trim();
    const away = parts[1].trim();

    const marketText = row.find('.market').first().text().replace(/\s+/g, ' ').trim();
    const tip = marketText.replace(fixture, '').replace(/\s+/g, ' ').trim();

    let pick = null;
    if (/^home win\b/i.test(tip)) pick = 'home';
    else if (/^away win\b/i.test(tip)) pick = 'away';
    else if (/^draw\b/i.test(tip)) pick = 'draw';

    let totalsPick = null;
    const ou = tip.match(/\b(over|under)\s*(\d(?:\.5)?)\s*goals?\b/i);
    if (ou) totalsPick = { selection: ou[1].toLowerCase(), point: Number(ou[2]) };

    let bttsPick = null;
    const btts = tip.match(/\bbtts\s*(yes|no)\b/i);
    if (btts) bttsPick = btts[1].toLowerCase();

    if (!pick && !totalsPick && !bttsPick) return; // clean sheet / correct score / etc

    const key = `${home.toLowerCase()}|${away.toLowerCase()}|${tip.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);

    tips.push({ site: 'footystats', homeTeam: home, awayTeam: away, pick, totalsPick, bttsPick, rawText: tip, sourceUrl: URL });
  });

  return tips;
}

module.exports = { fetchFootyStatsTips, parseFootyStats };
