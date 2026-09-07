const cheerio = require('cheerio');
const { fetchHtml } = require('./fetchHtml');
const { teamsMatch } = require('../../services/matcher');
const { inferTotalsPick } = require('./totalsHeuristics');

// footballpredictions.net publishes two per-day tip lists that already
// cover "today, tomorrow and this weekend" in one page each:
//   /win-draw-win-predictions-full-time-result-betting-tips   -> 1X2
//   /under-over-2-5-goals-betting-tips-predictions            -> O/U 2.5
// Same card markup on both:
//   <div class="match-card"><div class="card-body"><div class="match-preview">
//     <div class="home-team col-6">…<div class="team-label">Getafe</div></div>
//     <div class="away-team col-6">…<div class="team-label">Celta Vigo</div></div>
//   </div>
//   <div class="prediction-holder"><div class="prediction">👉 Getafe to win</div></div>
// The prediction text is "<Team> to win" / "Draw" on the WDW page and
// "Over 2.5" / "Under 2.5" on the totals page.
//
// Cloudflare sits in front but only as the passive JS-challenge script far
// down the page, not a blocking interstitial — fetchHtml's plain GET goes
// through, with FlareSolverr as the automatic fallback if that changes.
const WDW_URL = 'https://footballpredictions.net/win-draw-win-predictions-full-time-result-betting-tips';
const OU_URL = 'https://footballpredictions.net/under-over-2-5-goals-betting-tips-predictions';

function parseCards(html) {
  const $ = cheerio.load(html);
  const out = [];
  $('.match-card').each((_, el) => {
    const card = $(el);
    const home = card.find('.home-team .team-label').first().text().trim();
    const away = card.find('.away-team .team-label').first().text().trim();
    const prediction = card
      .find('.prediction-holder .prediction, .prediction')
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .replace(/👉/g, '')
      .trim();
    if (home && away) out.push({ home, away, prediction });
  });
  return out;
}

function pickFrom1x2(text, home, away) {
  if (!text) return null;
  if (/^draw$/i.test(text) || /\bdraw\b/i.test(text)) return 'draw';
  const team = text.replace(/\s+to win\b.*/i, '').trim();
  if (!team) return null;
  if (teamsMatch(team, home)) return 'home';
  if (teamsMatch(team, away)) return 'away';
  return null;
}

async function fetchFootballPredictionsTips() {
  const [wdwHtml, ouHtml] = await Promise.all([
    fetchHtml('footballpredictions', WDW_URL).catch((err) => {
      console.error('[tipsters:footballpredictions] WDW page failed:', err.message || err);
      return '';
    }),
    fetchHtml('footballpredictions-ou', OU_URL).catch((err) => {
      console.error('[tipsters:footballpredictions] O/U page failed:', err.message || err);
      return '';
    }),
  ]);

  // key each fixture by its two team names (lower-cased) so the 1X2 pick
  // and the O/U pick for the same match land on one tip object
  const byMatch = new Map();
  const keyFor = (h, a) => `${h.toLowerCase()}|${a.toLowerCase()}`;
  const get = (h, a) => {
    const k = keyFor(h, a);
    if (!byMatch.has(k)) {
      byMatch.set(k, {
        site: 'footballpredictions',
        homeTeam: h,
        awayTeam: a,
        pick: null,
        totalsPick: null,
        rawText: '',
        sourceUrl: WDW_URL,
      });
    }
    return byMatch.get(k);
  };

  for (const { home, away, prediction } of parseCards(wdwHtml)) {
    const t = get(home, away);
    t.pick = pickFrom1x2(prediction, home, away);
    t.rawText = `1X2: ${prediction}`;
  }
  for (const { home, away, prediction } of parseCards(ouHtml)) {
    const t = get(home, away);
    t.totalsPick = inferTotalsPick(prediction);
    t.rawText = `${t.rawText}${t.rawText ? ' · ' : ''}O/U: ${prediction}`;
  }

  return [...byMatch.values()].filter((t) => t.pick || t.totalsPick);
}

module.exports = { fetchFootballPredictionsTips, parseCards, pickFrom1x2 };
