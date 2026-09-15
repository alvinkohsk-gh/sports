/*
 * THROWAWAY debug script — not part of the real pipeline. Dumps every
 * field code Flashscore's feed carries per finished match (not just the
 * ones src/results/flashscoreResults.js currently parses: AA/AB/AD/AE/AF/
 * AG/AH/ZA), looking for a half-time-score field, so the Bankroll page's
 * auto-check could settle a "Halftime 1X2" bet too. Never merged; run
 * once via workflow dispatch on a debug branch, output read back via git
 * fetch of the debug-capture branch it publishes to.
 */
const axios = require('axios');
const fs = require('fs');

const HOST = 'https://local-global.flashscore.ninja/2/x/feed';
const FSIGN = 'SW9D1eZo';

async function fetchFeedText(dayOffset) {
  const { data } = await axios.get(`${HOST}/f_1_${dayOffset}_3_en_1`, {
    timeout: 15000,
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

function parseAllFields(text) {
  const records = [];
  let cur = null;
  const flush = () => {
    if (cur) records.push(cur);
    cur = null;
  };
  for (const rec of text.split('¬')) {
    const i = rec.indexOf('÷');
    if (i < 0) continue;
    const code = rec.slice(0, i).replace(/^~/, '');
    const value = rec.slice(i + 1);
    if (code === 'AA') {
      flush();
      cur = {};
    }
    if (cur) cur[code] = value;
  }
  flush();
  return records;
}

async function main() {
  const text = await fetchFeedText(-1); // yesterday: everything finished
  const records = parseAllFields(text);
  const finished = records.filter((r) => r.AB === '3' && r.AE && r.AF);
  const allCodes = new Set();
  finished.forEach((r) => Object.keys(r).forEach((c) => allCodes.add(c)));

  const out = {
    probedAt: new Date().toISOString(),
    finishedCount: finished.length,
    allFieldCodesSeen: [...allCodes].sort(),
    // full raw record for the first several finished matches, so any
    // field that looks like a plausible halftime score (smaller than the
    // full-time AG/AH pair) can be spotted by eye
    sampleRecords: finished.slice(0, 15),
  };
  fs.mkdirSync('debug-tipsters', { recursive: true });
  fs.writeFileSync('debug-tipsters/flashscore-ht-probe.json', JSON.stringify(out, null, 2));
  console.log('wrote debug-tipsters/flashscore-ht-probe.json —', finished.length, 'finished matches,', allCodes.size, 'field codes seen');
}

main().catch((err) => {
  console.error('probe failed:', err.message);
  fs.mkdirSync('debug-tipsters', { recursive: true });
  fs.writeFileSync('debug-tipsters/flashscore-ht-probe.json', JSON.stringify({ error: err.message }, null, 2));
});
