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

// AC = stage code for a live match. '38' isn't documented anywhere — added
// after production showed it on several simultaneous South American
// fixtures all sitting at ~59 real elapsed minutes since kickoff with a
// 0-0/1-0-type scoreline, the exact profile of "just past halftime";
// apparently a regional/competition-specific variant of '13'. Any other
// still-unmapped code falls through to the generic 'live' stage — see
// public/app.js's liveClock(), which infers "past halftime" from elapsed
// time alone as a backstop so an unrecognized code doesn't silently skip
// the halftime-break correction.
const LIVE_STAGE = { '11': 'HT', '12': '1st half', '13': '2nd half', '38': '2nd half', '40': 'extra time', '41': 'extra time', '50': 'penalties' };

/**
 * @param mode 'finished' (default — AB "3", returns FT rows) or 'live'
 *             (AB "2", returns rows with the running score + stage).
 */
function parseFeed(text, mode = 'finished') {
  const out = [];
  if (typeof text !== 'string' || !text.includes('÷')) return out;
  const wantStatus = mode === 'live' ? '2' : '3';
  let league = null;
  let cur = null;
  const flush = () => {
    if (!cur) return;
    const hg = Number(cur.AG);
    const ag = Number(cur.AH);
    if (cur.AB === wantStatus && cur.AE && cur.AF && Number.isFinite(hg) && Number.isFinite(ag)) {
      const ts = Number(cur.AD);
      const iso = Number.isFinite(ts) ? new Date(ts * 1000).toISOString() : null;
      const row = {
        homeTeam: cur.AE,
        awayTeam: cur.AF,
        homeGoals: hg,
        awayGoals: ag,
        dayISO: iso ? iso.slice(0, 10) : null,
        league: cur.ZA || league,
      };
      if (mode === 'live') {
        row.stage = LIVE_STAGE[cur.AC] || 'live';
        row.kickoffISO = iso;
      }
      out.push(row);
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

async function fetchFeedText(dayOffset) {
  const { data } = await axios.get(`${HOST}/f_1_${dayOffset}_3_en_1`, {
    timeout: TIMEOUT_MS,
    responseType: 'text',
    headers: {
      'x-fsign': FSIGN,
      Referer: 'https://www.flashscore.com/',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
  });
  return typeof data === 'string' ? data : String(data);
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
      for (const r of parseFeed(await fetchFeedText(d), 'finished')) {
        byKey.set(`${r.homeTeam}|${r.awayTeam}|${r.dayISO}`, r);
      }
    } catch (err) {
      console.error(`[results:flashscore] day ${d} failed:`, err.response?.status || err.message || err);
    }
  }
  return [...byKey.values()];
}

/**
 * In-progress matches with their running score + stage
 * ([{ homeTeam, awayTeam, homeGoals, awayGoals, stage, league }]). Today's
 * feed only. Never throws.
 */
async function fetchFlashscoreLive() {
  try {
    return parseFeed(await fetchFeedText(0), 'live');
  } catch (err) {
    console.error('[results:flashscore] live feed failed:', err.response?.status || err.message || err);
    return [];
  }
}

module.exports = { fetchFlashscoreResults, fetchFlashscoreLive, parseFeed };
