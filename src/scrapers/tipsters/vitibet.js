const cheerio = require('cheerio');
const { fetchHtml } = require('./fetchHtml');

const SITE_URL = 'https://www.vitibet.com/';

// Vitibet's homepage is a real server-rendered "today's predictions" list
// (`.viti-v6-card` rows grouped under `.viti-v6-l-title` league headers),
// wide lower-league coverage similar to Statarea/FootyStats. Each row:
//   <a class="viti-v6-card">
//     <div class="viti-v6-team-home">Fenerbahçe</div>
//     <span class="viti-v6-m-score">1 : 1</span>
//     <div class="viti-v6-team-away">AS Roma</div>
//     <span class="viti-v6-badge viti-v6-bg-02">02</span>
//   </a>
// The badge is Vitibet's own outcome code: "1"/"2" (occasionally "0") for a
// straight home/draw/away pick, or a two-digit double-chance lean ("10" =
// home-or-draw, "02" = draw-or-away, "12" = home-or-away) when the model
// isn't confident enough for a single outcome — those aren't a `pick` any
// existing site here reports either (see eaglepredict.js/footystats.js
// skipping double chances), so they're left unclassified rather than guessed.
// totalsPick/bttsPick are both derived from the predicted correct score
// itself (the same scoreline→totals approach forebet.js/predictz.js/
// windrawwin.js use via totalsHeuristics.js) — Vitibet doesn't separately
// publish an O/U or BTTS market, but its own scoreline prediction already
// implies both.
const PICK_FROM_BADGE = { 1: 'home', 2: 'away', 0: 'draw' };

function parseDay(html) {
  const $ = cheerio.load(html);
  const out = [];

  $('a.viti-v6-card').each((_, el) => {
    const card = $(el);
    const home = card.find('.viti-v6-team-home').text().trim();
    const away = card.find('.viti-v6-team-away').text().trim();
    if (!home || !away) return;

    const scoreText = card.find('.viti-v6-m-score').text().trim();
    const scoreMatch = scoreText.match(/(\d+)\s*:\s*(\d+)/);
    const homeGoals = scoreMatch ? Number(scoreMatch[1]) : null;
    const awayGoals = scoreMatch ? Number(scoreMatch[2]) : null;
    const haveScore = Number.isFinite(homeGoals) && Number.isFinite(awayGoals);

    const badge = card.find('.viti-v6-badge').text().trim();
    const pick = PICK_FROM_BADGE[badge] || null;

    const total = haveScore ? homeGoals + awayGoals : null;
    const totalsPick = Number.isFinite(total) ? { selection: total > 2.5 ? 'over' : 'under', point: 2.5, total } : null;
    const bttsPick = haveScore ? (homeGoals > 0 && awayGoals > 0 ? 'yes' : 'no') : null;

    const href = card.attr('href');
    const sourceUrl = href ? new URL(href, SITE_URL).toString() : SITE_URL;

    out.push({
      site: 'vitibet',
      homeTeam: home,
      awayTeam: away,
      pick,
      totalsPick,
      bttsPick,
      rawText: `predicted ${haveScore ? `${homeGoals}-${awayGoals}` : '?'} (tip ${badge || '?'})`,
      sourceUrl,
    });
  });

  return out;
}

async function fetchVitibetTips() {
  const html = await fetchHtml('vitibet', SITE_URL);
  return parseDay(html);
}

module.exports = { fetchVitibetTips, parseDay };
