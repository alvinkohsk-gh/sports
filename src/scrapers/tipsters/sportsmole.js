const cheerio = require('cheerio');
const { fetchHtml } = require('./fetchHtml');
const { inferPickFromProse, inferTotalsPickFromProse } = require('./whoscored');

const URL = 'https://www.sportsmole.co.uk/football/preview/';

// Same situation as WhoScored: Sports Mole's preview hub is prose articles
// ("Preview: Team A vs Team B - prediction, team news, lineups"), not a
// structured predictions table, so this is generic best-effort extraction
// (see whoscored.js for the same approach and its caveats) rather than a
// verified selector.
async function fetchSportsMoleTips() {
  const html = await fetchHtml('sportsmole', URL);
  const $ = cheerio.load(html);
  const tips = [];
  const seen = new Set();

  $('a').each((_, el) => {
    const link = $(el);
    const text = link.text().trim();
    const teamsMatch = text.match(/^(?:Preview:\s*)?([A-Za-z .'-]{3,40})\s+v[s]?\.?\s+([A-Za-z .'-]{3,40})/i);
    if (!teamsMatch) return;

    const home = teamsMatch[1].trim();
    const away = teamsMatch[2].replace(/-.*$/, '').trim(); // strip a trailing " - prediction, team news..."
    const key = `${home.toLowerCase()}|${away.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);

    const contextText = link.closest('li, article, div').first().text().replace(/\s+/g, ' ').trim();
    const href = link.attr('href');

    tips.push({
      site: 'sportsmole',
      homeTeam: home,
      awayTeam: away,
      pick: inferPickFromProse(contextText),
      totalsPick: inferTotalsPickFromProse(contextText),
      rawText: contextText.slice(0, 200),
      sourceUrl: href ? new URL(href, URL).toString() : URL,
    });
  });

  return tips;
}

module.exports = { fetchSportsMoleTips };
