const cheerio = require('cheerio');
const { fetchHtml } = require('../scrapers/tipsters/fetchHtml');
const { totalsFromScoreline, inferTotalsPick } = require('../scrapers/tipsters/totalsHeuristics');

// Back-fill sources: pages where a site shows its own PAST prediction and
// the final score in the same row, so a prediction can be graded with no
// stored history and no cross-site result matching.
//
// Only two sites keep a usable archive:
//   WinDrawWin   /predictions/yesterday  -> "Football Results Yesterday"
//                a results table: result "Arsenal 2 Chelsea 1", stake,
//                prediction "Away Win", predicted score "0-2", ✓/✗ gif
//   MatchOutlook /yesterdays-football-predictions/  (open, no Cloudflare)
//                the rolling list with "Result: X-Y" filled in for played
//                matches
// Forebet's /…-for-yesterday is a 404 and PredictZ's "yesterday" view
// carries no final score, so neither can be back-filled.

const RESULT_LINE_RE = /^(.+?)\s+(\d{1,2})\s+(.+?)\s+(\d{1,2})$/;

function outcome1x2FromWord(text) {
  if (/home/i.test(text)) return 'home';
  if (/away/i.test(text)) return 'away';
  if (/draw/i.test(text)) return 'draw';
  return null;
}

async function winDrawWinArchive() {
  let html;
  try {
    html = await fetchHtml('windrawwin-archive', 'https://www.windrawwin.com/predictions/yesterday');
  } catch (err) {
    console.error(`[archive:windrawwin] ${err.message}`);
    return [];
  }
  const $ = cheerio.load(html);
  const out = [];

  $('tr.altrow, tr.predresult').each((_, el) => {
    const cells = $(el)
      .find('td')
      .map((__, td) => $(td).text().replace(/\s+/g, ' ').trim())
      .get();
    if (cells.length < 3) return;

    const rm = cells[0].match(RESULT_LINE_RE);
    if (!rm) return;
    const homeTeam = rm[1].trim();
    const homeGoals = Number(rm[2]);
    const awayTeam = rm[3].trim();
    const awayGoals = Number(rm[4]);

    const predWord = cells[2] || '';
    const predScore = cells[3] || '';
    const pick = outcome1x2FromWord(predWord);
    if (!pick && !/[0-9]\s*-\s*[0-9]/.test(predScore)) return;

    out.push({
      site: 'windrawwin',
      homeTeam,
      awayTeam,
      dayISO: null,
      pick,
      totalsPick: totalsFromScoreline(predScore),
      homeGoals,
      awayGoals,
    });
  });

  return out;
}

async function matchOutlookArchive() {
  let html;
  try {
    html = await fetchHtml('matchoutlook-archive', 'https://www.matchoutlook.com/yesterdays-football-predictions/');
  } catch (err) {
    console.error(`[archive:matchoutlook] ${err.message}`);
    return [];
  }
  const $ = cheerio.load(html);
  const out = [];

  $('.match-section').each((_, el) => {
    const row = $(el);
    const content = row.find('.match-content').text().replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
    const teams = content.match(/^(.+?)\s+vs\s+(.+?)\s+(?:Result:|Best Bet:|$)/i);
    const res = content.match(/Result:\s*(\d{1,2})\s*-\s*(\d{1,2})/i);
    if (!teams || !res) return;

    const betRaw = row.find('.our-bet').text().replace(/\s+/g, ' ').trim();
    const bet = (betRaw.match(/best bet:\s*(.+)/i) || [, ''])[1].trim();
    let pick = null;
    if (/home win/i.test(bet)) pick = 'home';
    else if (/away win/i.test(bet)) pick = 'away';
    else if (/^draw\b/i.test(bet)) pick = 'draw';

    out.push({
      site: 'matchoutlook',
      homeTeam: teams[1].trim(),
      awayTeam: teams[2].trim(),
      dayISO: null,
      pick,
      totalsPick: inferTotalsPick(bet),
      homeGoals: Number(res[1]),
      awayGoals: Number(res[2]),
    });
  });

  return out;
}

async function fetchArchivePredictions() {
  const parts = await Promise.allSettled([winDrawWinArchive(), matchOutlookArchive()]);
  const rows = [];
  for (const p of parts) if (p.status === 'fulfilled') rows.push(...p.value);
  return rows.filter((r) => (r.pick || r.totalsPick) && Number.isFinite(r.homeGoals) && Number.isFinite(r.awayGoals));
}

module.exports = { fetchArchivePredictions };
