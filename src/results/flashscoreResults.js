const axios = require('axios');

// Full-time scores from Flashscore's data feed — near-total league
// coverage, far more than Forebet's lazy-loading results pages.
//
// The feed is a `¬`-record / `÷`-field text blob at
//   local-global.flashscore.ninja/2/x/feed/f_1_<dayOffset>_3_en_1
// (dayOffset 0 = today, -1 = yesterday, …) and needs a static-ish
// `x-fsign` header. Match fields: AA id, AB status ("3" = finished),
// AD kickoff unix ts, AE/AF home/away, AG/AH full-time score, ZA the
// tournament name (carried forward until the next ZA).
const HOST = process.env.FLASHSCORE_HOST || 'https://local-global.flashscore.ninja/2/x/feed';
const FSIGN = process.env.FLASHSCORE_FSIGN || 'SW9D1eZo';
const DAY_OFFSETS = [0, -1, -2]; // covers the 2–60h grading window
const TIMEOUT_MS = Number(process.env.FLASHSCORE_TIMEOUT_MS) || 15000;

function parseFeed(text) {
  const out = [];
  if (typeof text !== 'string' || !text.includes('÷')) return out;
  let league = null;
  let cur = null;
  const flush = () => {
    if (!cur) return;
    const hg = Number(cur.AG);
    const ag = Number(cur.AH);
    if (cur.AB === '3' && cur.AE && cur.AF && Number.isFinite(hg) && Number.isFinite(ag)) {
      const ts = Number(cur.AD);
      out.push({
        homeTeam: cur.AE,
        awayTeam: cur.AF,
        homeGoals: hg,
        awayGoals: ag,
        dayISO: Number.isFinite(ts) ? new Date(ts * 1000).toISOString().slice(0, 10) : null,
        league: cur.ZA || league,
      });
    }
    cur = null;
  };

  for (const rec of text.split('¬')) {
    const i = rec.indexOf('÷');
    if (i < 0) continue;
    const code = rec.slice(0, i).replace(/^~/, '');
    const value = rec.slice(i + 1);
    if (code === 'ZA') league = value;
    if (code === 'AA') {
      flush();
      cur = { ZA: null };
    }
    if (cur) cur[code] = value;
  }
  flush();
  return out;
}

async function fetchOne(dayOffset) {
  const url = `${HOST}/f_1_${dayOffset}_3_en_1`;
  const { data } = await axios.get(url, {
    timeout: TIMEOUT_MS,
    responseType: 'text',
    headers: {
      'x-fsign': FSIGN,
      Referer: 'https://www.flashscore.com/',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
  });
  return parseFeed(typeof data === 'string' ? data : String(data));
}

/**
 * Returns [{ homeTeam, awayTeam, homeGoals, awayGoals, dayISO, league }]
 * for every finished match in the last few days. Never throws — a failed
 * or rejected fetch (e.g. the fsign rotated) just yields fewer rows.
 */
async function fetchFlashscoreResults() {
  const byKey = new Map();
  for (const d of DAY_OFFSETS) {
    try {
      for (const r of await fetchOne(d)) {
        byKey.set(`${r.homeTeam}|${r.awayTeam}|${r.dayISO}`, r);
      }
    } catch (err) {
      console.error(`[results:flashscore] day ${d} failed:`, err.response?.status || err.message || err);
    }
  }
  return [...byKey.values()];
}

module.exports = { fetchFlashscoreResults, parseFeed };
