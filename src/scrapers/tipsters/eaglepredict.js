const cheerio = require('cheerio');
const { fetchHtml, DEBUG } = require('./fetchHtml');

const URL = 'https://eaglepredict.com/';

// EaglePredict is Cloudflare-gated (FlareSolverr clears it in the snapshot
// job). Its homepage fully renders only a few "prediction today" cards —
// each has the two teams as `img[alt="X logo"]` and exactly one prediction
// pill styled `.italic` ("Under 2.5 Goals", "Home Win", "Draw", "Double
// Chance: …"). The match URL is in an Alpine `:class` binding, not an
// href, and the card wrapper has no stable class, so anchor on the
// `.italic` pill and walk up to the nearest ancestor holding two logos.
async function fetchEaglePredictTips() {
  const html = await fetchHtml('eaglepredict', URL);
  const $ = cheerio.load(html);
  const tips = [];
  const seen = new Set();

  $('.italic').each((_, el) => {
    const pill = $(el);
    const pred = pill.text().replace(/\s+/g, ' ').trim();
    if (!pred) return;

    // The card wrapper is a `.p-4` div holding both the teams grid and this
    // pill; fall back to walking up if that class ever changes.
    let logos = pill.closest('.p-4').find('img[alt$="logo"], img[alt$="logo "]');
    if (logos.length < 2) {
      let box = pill;
      for (let up = 0; up < 6 && box.length; up += 1) {
        box = box.parent();
        logos = box.find('img[alt$="logo"], img[alt$="logo "]');
        if (logos.length >= 2) break;
      }
    }
    if (logos.length < 2) return;

    const home = $(logos[0]).attr('alt').replace(/\s*logo\s*$/i, '').trim();
    const away = $(logos[1]).attr('alt').replace(/\s*logo\s*$/i, '').trim();
    if (!home || !away) return;
    const key = `${home.toLowerCase()}|${away.toLowerCase()}`;
    if (seen.has(key)) return;

    let pick = null;
    if (/\bhome win\b/i.test(pred)) pick = 'home';
    else if (/\baway win\b/i.test(pred)) pick = 'away';
    else if (/^draw$/i.test(pred) || /\bto draw\b/i.test(pred)) pick = 'draw';

    let totalsPick = null;
    const ou = pred.match(/\b(over|under)\s*(\d(?:\.5)?)\s*goals?\b/i);
    if (ou) totalsPick = { selection: ou[1].toLowerCase(), point: Number(ou[2]) };

    if (!pick && !totalsPick) return; // double chance / BTTS / correct score

    seen.add(key);
    tips.push({ site: 'eaglepredict', homeTeam: home, awayTeam: away, pick, totalsPick, rawText: pred, sourceUrl: URL });
  });

  if (DEBUG) console.log(`[tipsters:eaglepredict] ${tips.length} usable tips`);
  return tips;
}

module.exports = { fetchEaglePredictTips };
