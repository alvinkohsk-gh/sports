const cheerio = require('cheerio');
const { fetchHtml } = require('./fetchHtml');

const URL = 'https://www.whoscored.com/previews';

// Unlike Forebet/PredictZ/WinDrawWin, WhoScored doesn't publish predictions
// as a structured table — its "previews" page is a list of prose preview
// articles per match ("Team A vs Team B Preview: ..."). There's no verified
// selector for this (no reference scraper found for it), so this is a
// best-effort generic extraction: find links whose text looks like
// "Team A vs Team B", and scan nearby teaser text for a plain scoreline
// (e.g. "2-1") or a "to win"/"draw" phrase to infer a pick. When neither is
// found, the tip is still returned with pick: null (still shown as a
// preview link) rather than dropped.
async function fetchWhoScoredTips() {
  const html = await fetchHtml('whoscored', URL);
  const $ = cheerio.load(html);
  const tips = [];

  $('a').each((_, el) => {
    const link = $(el);
    const text = link.text().trim();
    const teamsMatch = text.match(/^([A-Za-z .'-]{3,40})\s+v[s]?\.?\s+([A-Za-z .'-]{3,40})/i);
    if (!teamsMatch) return;

    const contextText = link.closest('li, article, div').first().text().replace(/\s+/g, ' ').trim();
    const href = link.attr('href');

    tips.push({
      site: 'whoscored',
      homeTeam: teamsMatch[1].trim(),
      awayTeam: teamsMatch[2].trim(),
      pick: inferPickFromProse(contextText),
      rawText: contextText.slice(0, 200),
      sourceUrl: href ? new URL(href, URL).toString() : URL,
    });
  });

  return dedupeByTeams(tips);
}

function inferPickFromProse(text) {
  const scoreline = text.match(/\b(\d)\s*-\s*(\d)\b/);
  if (scoreline) {
    const [, home, away] = scoreline;
    if (home > away) return 'home';
    if (away > home) return 'away';
    return 'draw';
  }
  if (/\bto draw\b/i.test(text)) return 'draw';
  return null;
}

function dedupeByTeams(tips) {
  const seen = new Set();
  return tips.filter((t) => {
    const key = `${t.homeTeam.toLowerCase()}|${t.awayTeam.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { fetchWhoScoredTips, inferPickFromProse };
