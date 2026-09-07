const cheerio = require('cheerio');
const { fetchHtml } = require('../scrapers/tipsters/fetchHtml');
const { inferPick } = require('../scrapers/tipsters/forebet');
const { totalsFromScoreline, inferTotalsPick } = require('../scrapers/tipsters/totalsHeuristics');

// Back-fill source: pages where a site shows its own PAST prediction and
// the final score in the same row, so a prediction can be graded without
// any stored history. Only the sites that keep such an archive:
//   Forebet     /en/football-predictions-for-yesterday  (+ 2-days-ago)
//   WinDrawWin  /predictions/yesterday
//   PredictZ    /predictions/yesterday/
//   MatchOutlook /yesterdays-football-predictions/       (open, no Cloudflare)
// Each returns { site, homeTeam, awayTeam, dayISO, pick, totalsPick,
// homeGoals, awayGoals } for rows that have a real full-time score.

const SCORE_RE = /\b(\d{1,2})\s*[-:]\s*(\d{1,2})\b/;

function dayFromText(t) {
  const d = String(t).match(/(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})/);
  if (!d) return null;
  const yyyy = d[3].length === 2 ? `20${d[3]}` : d[3];
  return `${yyyy}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`;
}

async function forebetArchive() {
  const urls = [
    'https://www.forebet.com/en/football-predictions-for-yesterday',
    'https://www.forebet.com/en/football-predictions-for-2-days-ago',
  ];
  const out = [];
  for (const url of urls) {
    let html;
    try {
      html = await fetchHtml('forebet-archive', url);
    } catch (err) {
      console.error(`[archive:forebet] ${url}: ${err.message}`);
      continue;
    }
    const $ = cheerio.load(html);
    $('[class*="rcnt"]').each((_, el) => {
      const row = $(el);
      const name = row.find('meta[itemprop="name"]').attr('content');
      if (!name) return;
      const teams = name.split(/\s+-\s+| vs /i);
      if (teams.length < 2) return;

      let ft = '';
      row
        .find('.l_scr, .lscr_td, .rsFin, [class*="l_scr"]:not([class*="ex_"]):not([class*="avg_"])')
        .each((__, s) => {
          const t = $(s).text().trim();
          if (/^\s*\d{1,2}\s*[-:]\s*\d{1,2}\s*$/.test(t)) {
            ft = t;
            return false;
          }
          return undefined;
        });
      const m = ft.match(SCORE_RE);
      if (!m) return;

      const predText = row.find('span.forepr').first().text().trim();
      const exScore = row.find('.ex_sc').first().text().replace(/\s+/g, ' ').trim();
      out.push({
        site: 'forebet',
        homeTeam: teams[0].trim(),
        awayTeam: teams[1].trim(),
        dayISO: dayFromText(row.find('[class*="date"]').first().text()),
        pick: inferPick(predText),
        totalsPick: totalsFromScoreline(exScore),
        homeGoals: Number(m[1]),
        awayGoals: Number(m[2]),
      });
    });
  }
  return out;
}

function outcomeWord(text) {
  if (/home/i.test(text)) return 'home';
  if (/away/i.test(text)) return 'away';
  if (text) return 'draw';
  return null;
}

async function winDrawWinArchive() {
  let html;
  try {
    html = await fetchHtml('windrawwin-archive', 'https://www.windrawwin.com/predictions/yesterday');
  } catch (err) {
    console.error(`[archive:windrawwin]: ${err.message}`);
    return [];
  }
  const $ = cheerio.load(html);
  const out = [];
  $('.wttr').each((_, el) => {
    const row = $(el);
    const teamEls = row.find('.wtmoblnk');
    if (teamEls.length < 2) return;
    const home = $(teamEls[0]).text().trim();
    const away = $(teamEls[1]).text().trim();
    if (!home || !away) return;

    const predictionText = row.find('.wtprd').first().text().trim();
    const predScore = row.find('.predscore').first().text().trim();
    // WinDrawWin shows the played score in .wtsc / .wtrs / a "wtres" cell
    let ft = '';
    row.find('.wtsc, .wtrs, .wtres, [class*="wtsc"], [class*="wtrs"]').each((__, s) => {
      const t = $(s).text().trim();
      if (/^\s*\d{1,2}\s*[-:]\s*\d{1,2}\s*$/.test(t)) {
        ft = t;
        return false;
      }
      return undefined;
    });
    const m = ft.match(SCORE_RE);
    if (!m) return;

    out.push({
      site: 'windrawwin',
      homeTeam: home,
      awayTeam: away,
      dayISO: null,
      pick: outcomeWord(predictionText),
      totalsPick: totalsFromScoreline(predScore) || totalsFromScoreline(predictionText),
      homeGoals: Number(m[1]),
      awayGoals: Number(m[2]),
    });
  });
  return out;
}

async function predictzArchive() {
  let html;
  try {
    html = await fetchHtml('predictz-archive', 'https://www.predictz.com/predictions/yesterday/');
  } catch (err) {
    console.error(`[archive:predictz]: ${err.message}`);
    return [];
  }
  const $ = cheerio.load(html);
  const out = [];
  $('.ptcnt').each((_, el) => {
    const row = $(el);
    const home = row.find('.ptmobh').first().text().trim();
    const away = row.find('.ptmoba').first().text().trim();
    if (!home || !away) return;
    const predictionText = row.find('.ptpredboxsml').first().text().trim();
    // PredictZ shows the actual score in .ptscore / .ptmobscore on results view
    let ft = '';
    row.find('.ptscore, .ptmobscore, [class*="ptscore"], [class*="score"]').each((__, s) => {
      const t = $(s).text().trim();
      if (/^\s*\d{1,2}\s*[-:]\s*\d{1,2}\s*$/.test(t)) {
        ft = t;
        return false;
      }
      return undefined;
    });
    const m = ft.match(SCORE_RE);
    if (!m) return;
    out.push({
      site: 'predictz',
      homeTeam: home,
      awayTeam: away,
      dayISO: null,
      pick: outcomeWord(predictionText),
      totalsPick: totalsFromScoreline(predictionText),
      homeGoals: Number(m[1]),
      awayGoals: Number(m[2]),
    });
  });
  return out;
}

async function matchOutlookArchive() {
  let html;
  try {
    html = await fetchHtml('matchoutlook-archive', 'https://www.matchoutlook.com/yesterdays-football-predictions/');
  } catch (err) {
    console.error(`[archive:matchoutlook]: ${err.message}`);
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
  const parts = await Promise.allSettled([
    forebetArchive(),
    winDrawWinArchive(),
    predictzArchive(),
    matchOutlookArchive(),
  ]);
  const rows = [];
  for (const p of parts) if (p.status === 'fulfilled') rows.push(...p.value);
  return rows.filter((r) => (r.pick || r.totalsPick) && Number.isFinite(r.homeGoals));
}

module.exports = { fetchArchivePredictions };
