const cheerio = require('cheerio');
const { fetchHtml, DEBUG } = require('./fetchHtml');
const { inferTotalsPick, totalsFromScoreline } = require('./totalsHeuristics');

const URL = 'https://eaglepredict.com/';

// EaglePredict sits behind Cloudflare's terminal "Attention Required!"
// block (same profile as WhoScored) — FlareSolverr often can't clear that,
// so this may return nothing until it can. Structure isn't verified from a
// live capture, so this is a generic table/row extraction: for each
// table row (or prediction block), find "Home vs Away" text and a nearby
// tip token (1 / X / 2 / Home / Draw / Away / Over 2.5 / a correct score).
// Set TIPSTERS_DEBUG=true and inspect debug-tipsters/eaglepredict.html to
// tighten the selectors once a real capture exists.
async function fetchEaglePredictTips() {
  const html = await fetchHtml('eaglepredict', URL);
  const $ = cheerio.load(html);
  const tips = [];
  const seen = new Set();

  const rows = $('table tr, [class*="predict"], [class*="match"], [class*="fixture"], li');
  rows.each((_, el) => {
    const block = $(el);
    if (block.find('table tr, [class*="predict"], [class*="match"]').length) return; // only leaf rows
    const text = block.text().replace(/\s+/g, ' ').trim();
    if (text.length < 6 || text.length > 300) return;

    const teams = text.match(/([A-Za-z0-9.'&\- ]{3,32}?)\s+(?:vs?\.?|-|–)\s+([A-Za-z0-9.'&\- ]{3,32}?)(?=\s|$|\d)/i);
    if (!teams) return;
    const home = teams[1].trim();
    const away = teams[2].trim();
    if (!home || !away || /prediction|tips|odds|league|time|date/i.test(home)) return;
    const key = `${home.toLowerCase()}|${away.toLowerCase()}`;
    if (seen.has(key)) return;

    const after = text.slice(teams.index + teams[0].length);
    let pick = null;
    if (/\b(1|home)\b/i.test(after) && !/\b(x|draw|2|away)\b/i.test(after)) pick = 'home';
    else if (/\b(2|away)\b/i.test(after) && !/\b(x|draw|1|home)\b/i.test(after)) pick = 'away';
    else if (/\b(x|draw)\b/i.test(after) && !/\b(1|home|2|away)\b/i.test(after)) pick = 'draw';

    const totalsPick = totalsFromScoreline(after) || inferTotalsPick(after);

    seen.add(key);
    tips.push({
      site: 'eaglepredict',
      homeTeam: home,
      awayTeam: away,
      pick,
      totalsPick,
      rawText: text.slice(0, 160),
      sourceUrl: URL,
    });
  });

  if (DEBUG) console.log(`[tipsters:eaglepredict] extracted ${tips.length} rows`);
  return tips;
}

module.exports = { fetchEaglePredictTips };
