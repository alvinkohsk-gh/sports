const cheerio = require('cheerio');
const { fetchHtml, DEBUG } = require('./fetchHtml');
const { inferPickFromProse, inferTotalsPickFromProse } = require('./whoscored');

// Named PAGE_URL, not URL — a module-level `const URL = '...'` shadows the
// global URL constructor, breaking `new URL(href, ...)` below (confirmed
// in production runtime logs: "URL is not a constructor").
const PAGE_URL = 'https://www.sportsmole.co.uk/football/preview/';

// The hub page lists fixtures with links to per-match preview articles;
// only the articles carry the actual prediction ("Sports Mole predicts:
// Team A 1-2 Team B"). Fetch each article and parse that. Capped so one
// run can't fan out to hundreds of requests.
const MAX_ARTICLES = Number(process.env.SPORTSMOLE_MAX_ARTICLES || 40);

const ARTICLE_HREF = /\/preview\/[^"']*prediction[^"']*\.html/i;
// Sports Mole's verdict line: "<h2 class="sm_center">We say: Home 2-1 Away</h2>"
// (older articles used "Sports Mole predicts: ...").
const PREDICTS_RE = /(?:we say|sports\s*mole\s*predict[s]?)\s*:?\s*([^.\n<]{3,140})/i;

async function fetchSportsMoleTips() {
  const html = await fetchHtml('sportsmole', PAGE_URL);
  const $ = cheerio.load(html);

  const fixtures = [];
  const seen = new Set();
  $('a').each((_, el) => {
    const link = $(el);
    const text = link.text().trim();
    const href = link.attr('href') || '';
    const m = text.match(/^(?:Preview:\s*)?([A-Za-z .'-]{3,40})\s+v[s]?\.?\s+([A-Za-z .'-]{3,40})/i);
    if (!m || !ARTICLE_HREF.test(href)) return;

    const home = m[1].trim();
    const away = m[2].replace(/-.*$/, '').trim(); // strip a trailing " - prediction, team news..."
    const key = `${home.toLowerCase()}|${away.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    fixtures.push({ home, away, url: new URL(href, PAGE_URL).toString() });
  });

  const tips = [];
  for (const { home, away, url } of fixtures.slice(0, MAX_ARTICLES)) {
    let pick = null;
    let totalsPick = null;
    let rawText = `${home} vs ${away}`;

    try {
      const articleHtml = await fetchHtml('sportsmole-article', url);
      const $$ = cheerio.load(articleHtml);

      // Prefer the dedicated verdict heading; fall back to a regex over the
      // article body, then to the body's closing paragraphs.
      const verdict = $$('h2.sm_center, .sm_center').first().text().replace(/\s+/g, ' ').trim();
      const body = (
        $$('.sm-article-body, #article_body, article, [itemprop="articleBody"], main').first().text() ||
        $$('body').text()
      )
        .replace(/\s+/g, ' ')
        .trim();

      const m = (verdict.match(PREDICTS_RE) || body.match(PREDICTS_RE));
      const chunk = m ? m[1] : body.slice(-800);
      pick = inferPickFromProse(chunk, home, away);
      totalsPick = inferTotalsPickFromProse(chunk);
      rawText = (m ? `We say:${m[1]}` : chunk).trim().slice(0, 200);
    } catch (err) {
      if (DEBUG) console.log(`[tipsters:sportsmole] article fetch failed for ${url}: ${err.message}`);
    }

    tips.push({ site: 'sportsmole', homeTeam: home, awayTeam: away, pick, totalsPick, rawText, sourceUrl: url });
  }

  return tips;
}

module.exports = { fetchSportsMoleTips };
