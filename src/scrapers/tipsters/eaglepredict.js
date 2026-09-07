const cheerio = require('cheerio');
const { fetchHtml, DEBUG } = require('./fetchHtml');

const URL = 'https://eaglepredict.com/';

// EaglePredict is Cloudflare-gated (FlareSolverr clears it in the snapshot
// job). Homepage is a Tailwind card grid — each match card links to
// /predictions/match/<slug>, carries the two teams as `img[alt="X logo"]`,
// and shows one prediction in an `.italic` pill:
//   "Home Win" / "Away Win" / "Draw"     -> 1X2 pick
//   "Over 2.5 Goals" / "Under 3.5 Goals" -> totalsPick
//   "Double Chance: ...", "BTTS", a correct score -> neither
async function fetchEaglePredictTips() {
  const html = await fetchHtml('eaglepredict', URL);
  const $ = cheerio.load(html);
  const tips = [];
  const seen = new Set();

  $('a[href*="/predictions/match/"]').each((_, a) => {
    const href = $(a).attr('href') || '';
    if (!/-prediction-/i.test(href)) return;

    const scope = $(a).closest('.card').length ? $(a).closest('.card') : $(a).parent();
    const logos = scope.find('img[alt]').filter((__, im) => /logo\s*$/i.test($(im).attr('alt') || ''));
    if (logos.length < 2) return;

    const home = $(logos[0]).attr('alt').replace(/\s*logo\s*$/i, '').trim();
    const away = $(logos[1]).attr('alt').replace(/\s*logo\s*$/i, '').trim();
    if (!home || !away) return;
    const key = `${home.toLowerCase()}|${away.toLowerCase()}`;
    if (seen.has(key)) return;

    const pred = scope.find('.italic').first().text().replace(/\s+/g, ' ').trim();

    let pick = null;
    if (/\bhome win\b/i.test(pred)) pick = 'home';
    else if (/\baway win\b/i.test(pred)) pick = 'away';
    else if (/^draw$/i.test(pred) || /\bto draw\b/i.test(pred)) pick = 'draw';

    let totalsPick = null;
    const ou = pred.match(/\b(over|under)\s*(\d(?:\.5)?)\s*goals?\b/i);
    if (ou) totalsPick = { selection: ou[1].toLowerCase(), point: Number(ou[2]) };

    if (!pick && !totalsPick) return; // double chance / BTTS / correct score

    seen.add(key);
    tips.push({ site: 'eaglepredict', homeTeam: home, awayTeam: away, pick, totalsPick, rawText: pred, sourceUrl: href });
  });

  if (DEBUG) console.log(`[tipsters:eaglepredict] ${tips.length} usable tips`);
  return tips;
}

module.exports = { fetchEaglePredictTips };
