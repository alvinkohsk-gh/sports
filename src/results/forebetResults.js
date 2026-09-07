const cheerio = require('cheerio');
const { fetchHtml } = require('../scrapers/tipsters/fetchHtml');

// Forebet is a results/stats site as much as a tips site — its today and
// "for yesterday" pages carry the full-time score for played matches. Used
// as the actual-result source for the accuracy dashboard (a key-free
// results API with the league coverage Singapore Pools needs doesn't
// exist; Forebet covers hundreds).
const PAGES = [
  'https://www.forebet.com/en/football-tips-and-predictions-for-today',
  'https://www.forebet.com/en/football-predictions-for-yesterday',
];

const SCORE_RE = /^\s*(\d{1,2})\s*[-:]\s*(\d{1,2})\s*$/;

function extractResults(html) {
  const $ = cheerio.load(html);
  const out = [];

  $('[class*="rcnt"]').each((_, el) => {
    const row = $(el);
    const name = row.find('meta[itemprop="name"]').attr('content');
    if (!name) return;
    const teams = name.split(/\s+-\s+| vs /i);
    if (teams.length < 2) return;

    // Forebet marks the full-time score of a played match in its own
    // element (seen historically as .l_scr / .lscr_td / .rsFin). Only trust
    // those — deliberately NOT a broad scan, since a row also carries the
    // *predicted* correct score (.ex_sc "3 - 2") which must not be read as
    // a result. Rows without a real FT score are skipped (ungraded).
    let scoreText = '';
    row
      .find('.l_scr, .lscr_td, .rsFin, [class*="l_scr"]:not([class*="ex_"]):not([class*="avg_"])')
      .each((__, s) => {
        const t = $(s).text().trim();
        if (SCORE_RE.test(t)) {
          scoreText = t;
          return false;
        }
        return undefined;
      });
    const m = scoreText.match(SCORE_RE);
    if (!m) return;

    // kickoff date, for the match key — Forebet rows carry a date-time in
    // a .date_bah / [class*="date"] element ("07/09/2026 15:00")
    const dateText = row.find('[class*="date"]').first().text().trim();
    const d = dateText.match(/(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})/);
    let dayISO = null;
    if (d) {
      const yyyy = d[3].length === 2 ? `20${d[3]}` : d[3];
      dayISO = `${yyyy}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`;
    }

    out.push({
      homeTeam: teams[0].trim(),
      awayTeam: teams[1].trim(),
      dayISO,
      homeGoals: Number(m[1]),
      awayGoals: Number(m[2]),
    });
  });

  return out;
}

async function fetchForebetResults() {
  const all = [];
  for (const url of PAGES) {
    try {
      const html = await fetchHtml('forebet-results', url);
      all.push(...extractResults(html));
    } catch (err) {
      console.error(`[results:forebet] ${url} failed:`, err.message || err);
    }
  }
  // de-dupe on teams+day, last one wins
  const byKey = new Map();
  for (const r of all) byKey.set(`${r.homeTeam}|${r.awayTeam}|${r.dayISO}`, r);
  return [...byKey.values()];
}

module.exports = { fetchForebetResults, extractResults };
